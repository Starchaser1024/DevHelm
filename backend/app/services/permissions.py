from __future__ import annotations

import secrets
import uuid
from collections.abc import Callable

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import ActionDraft, AuditLog, PullRequest, Repository, User
from app.db.session import get_db

ROLE_PERMISSIONS: dict[str, set[str]] = {
    "owner": {"repo:read", "repo:sync", "agent:run", "draft:create", "draft:approve", "eval:read", "settings:manage"},
    "maintainer": {"repo:read", "repo:sync", "agent:run", "draft:create", "draft:approve", "eval:read"},
    "developer": {"repo:read", "agent:run", "draft:create", "eval:read"},
    "viewer": {"repo:read", "eval:read"},
}

_LOCAL_ENVS = {"development", "dev", "test", "local"}


def _is_local_or_demo_mode() -> bool:
    return bool(settings.demo_mode) or settings.app_env.strip().lower() in _LOCAL_ENVS


def _try_parse_uuid(raw: str | None) -> uuid.UUID | None:
    if not raw:
        return None
    try:
        return uuid.UUID(str(raw).strip())
    except (ValueError, TypeError, AttributeError):
        return None


def _extract_request_token(request: Request) -> tuple[str | None, bool]:
    auth_header = (request.headers.get("Authorization") or "").strip()
    if auth_header:
        if auth_header.lower().startswith("bearer "):
            return auth_header[7:].strip(), True
        return "", True
    header_token = request.headers.get("X-DevHelm-Token")
    if header_token is not None:
        return header_token.strip(), True
    return None, False


def _lookup_user(db: Session, identifier: str) -> User | None:
    parsed_id = _try_parse_uuid(identifier)
    if parsed_id is not None:
        by_id = db.get(User, parsed_id)
        if by_id is not None:
            return by_id
    return db.query(User).filter(User.name == identifier).order_by(User.created_at.asc()).first()


def _get_or_upsert_actor(db: Session, *, name: str, role: str) -> User:
    actor_name = f"actor-{role}" if name == "demo-owner" and role != "owner" else name
    user = _lookup_user(db, actor_name)
    if user is None:
        user = User(name=actor_name, role=role)
        db.add(user)
        db.commit()
        db.refresh(user)
        return user
    if (user.role or "").lower() != role:
        user.role = role
        db.commit()
        db.refresh(user)
    return user


def ensure_demo_user(db: Session) -> User:
    user = db.query(User).filter(User.name == "demo-owner").order_by(User.created_at.asc()).first()
    if user is None:
        user = db.query(User).filter(User.role == "owner").order_by(User.created_at.asc()).first()
    if user is None:
        user = User(name="demo-owner", role="owner")
        db.add(user)
        db.commit()
        db.refresh(user)
    elif (user.role or "").lower() != "owner":
        user.role = "owner"
        db.commit()
        db.refresh(user)
    return user


def has_permission(user: User, permission: str) -> bool:
    return permission in ROLE_PERMISSIONS.get((user.role or "viewer").lower(), set())


def resolve_current_user(
    request: Request,
    db: Session = Depends(get_db),
) -> User:
    configured_token = (settings.api_auth_token or "").strip() or None
    provided_token, token_header_present = _extract_request_token(request)
    local_or_demo = _is_local_or_demo_mode()
    token_verified = False

    if configured_token is not None:
        if token_header_present:
            if not provided_token or not secrets.compare_digest(provided_token, configured_token):
                raise HTTPException(status_code=401, detail="无效的访问令牌")
            token_verified = True
        elif not local_or_demo or not settings.auth_demo_fallback_enabled:
            raise HTTPException(status_code=401, detail="缺少访问令牌")
    elif not local_or_demo:
        raise HTTPException(status_code=401, detail="非开发模式要求配置并提供有效的访问令牌")

    raw_user = (request.headers.get("X-DevHelm-User") or "").strip() or None
    raw_role_header = request.headers.get("X-DevHelm-Role")
    raw_role = raw_role_header.strip().lower() if raw_role_header and raw_role_header.strip() else None

    if raw_role is not None:
        if raw_role not in ROLE_PERMISSIONS:
            raise HTTPException(status_code=400, detail=f"未知角色：{raw_role}")
        if not local_or_demo and not token_verified:
            raise HTTPException(status_code=401, detail="缺少访问令牌")
        actor_name = raw_user or f"actor-{raw_role}"
        return _get_or_upsert_actor(db, name=actor_name, role=raw_role)

    if raw_user is not None:
        existing = _lookup_user(db, raw_user)
        if existing is not None:
            normalized_role = (existing.role or "viewer").lower()
            if normalized_role not in ROLE_PERMISSIONS:
                raise HTTPException(status_code=403, detail=f"用户角色不受支持：{existing.role}")
            return existing
        if token_verified:
            return _get_or_upsert_actor(db, name=raw_user, role="owner")
        raise HTTPException(status_code=401, detail=f"未找到用户：{raw_user}")

    if token_verified:
        return _get_or_upsert_actor(db, name="service-token", role="owner")

    if local_or_demo and settings.auth_demo_fallback_enabled:
        return ensure_demo_user(db)

    raise HTTPException(status_code=401, detail="缺少身份认证信息")


def _resolve_audit_scope(
    db: Session,
    request: Request | None,
) -> tuple[uuid.UUID | None, str | None, str | None]:
    if request is None:
        return None, None, None
    path_params = request.path_params or {}
    if raw_repo_id := path_params.get("repo_id"):
        parsed = _try_parse_uuid(str(raw_repo_id))
        if parsed is not None and db.get(Repository, parsed) is not None:
            return parsed, "repository", str(parsed)
    if raw_pr_id := path_params.get("pr_id"):
        parsed = _try_parse_uuid(str(raw_pr_id))
        if parsed is not None and (pr := db.get(PullRequest, parsed)) is not None:
            return pr.repo_id, "pull_request", str(pr.id)
    if raw_draft_id := path_params.get("draft_id"):
        parsed = _try_parse_uuid(str(raw_draft_id))
        if parsed is not None and (draft := db.get(ActionDraft, parsed)) is not None:
            return draft.repo_id, "action_draft", str(draft.id)
    return None, None, None


def require_permission(permission: str) -> Callable:
    def dependency(
        request: Request,
        db: Session = Depends(get_db),
    ) -> User:
        user = resolve_current_user(request, db)
        if not has_permission(user, permission):
            repo_id, target_type, target_id = _resolve_audit_scope(db, request)
            write_audit_log(
                db,
                user=user,
                repo_id=repo_id,
                action=f"permission.denied:{permission}",
                target_type=target_type,
                target_id=target_id,
                status="denied",
                request_json={
                    "path": request.url.path,
                    "method": request.method,
                    "role": user.role,
                },
                result_json={
                    "required_permission": permission,
                    "actor": user.name,
                },
            )
            db.commit()
            raise HTTPException(status_code=403, detail=f"需要权限：{permission}")
        return user

    return dependency


def write_audit_log(
    db: Session,
    *,
    user: User | None,
    repo_id=None,
    action: str,
    target_type: str | None = None,
    target_id: str | None = None,
    status: str = "success",
    request_json: dict | None = None,
    result_json: dict | None = None,
) -> AuditLog:
    row = AuditLog(
        user_id=user.id if user else None,
        repo_id=repo_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        status=status,
        request_json=request_json or {},
        result_json=result_json or {},
    )
    db.add(row)
    db.flush()
    return row
