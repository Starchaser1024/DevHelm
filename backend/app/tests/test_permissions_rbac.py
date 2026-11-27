from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import settings
from app.db.models import AuditLog, Base, PRFile, PullRequest, Repository, User
from app.db.session import get_db
from app.main import create_app
from app.schemas.repos import RepoSyncResponse
from app.services.github.client import GitHubClient
from app.services.llm.client import LLMClient
from app.services.rag.vector_store import reset_milvus_store_cache


class _NoopLLM:
    model = "deterministic-test"

    async def chat_json(self, system_prompt, user_payload):
        return {}


@pytest.fixture()
def rbac_client(monkeypatch):
    monkeypatch.setattr(settings, "milvus_enabled", False)
    monkeypatch.setattr(settings, "auto_sync_enabled", False)
    monkeypatch.setattr(settings, "app_env", "development")
    monkeypatch.setattr(settings, "demo_mode", True)
    monkeypatch.setattr(settings, "api_auth_token", None)
    monkeypatch.setattr(settings, "auth_demo_fallback_enabled", True)
    monkeypatch.setattr(LLMClient, "chat_json", _NoopLLM().chat_json)
    reset_milvus_store_cache()

    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    SessionTesting = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    app = create_app()

    def _override_db():
        db = SessionTesting()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _override_db
    with TestClient(app) as client:
        yield client, SessionTesting
    engine.dispose()


def _seed_repo_and_pr(session) -> tuple[Repository, PullRequest]:
    suffix = uuid.uuid4().hex[:6]
    repo = Repository(
        owner="acme",
        name=f"svc-{suffix}",
        full_name=f"acme/svc-{suffix}",
    )
    session.add(repo)
    session.flush()

    pr = PullRequest(
        repo_id=repo.id,
        number=15,
        title="Tighten RBAC guardrails",
        body="Ensure write routes enforce actor permissions.",
        state="open",
        author="dev-a",
        base_branch="main",
        head_branch="feat/rbac",
    )
    session.add(pr)
    session.flush()
    session.add(
        PRFile(
            pr_id=pr.id,
            filename="backend/app/services/permissions.py",
            status="modified",
            additions=20,
            deletions=4,
            patch="@@ -1,4 +1,12 @@\n+def resolve_current_user(request, db):\n+    pass\n",
        )
    )
    session.commit()
    session.refresh(repo)
    session.refresh(pr)
    return repo, pr


def test_four_tier_rbac_matrix_and_denied_audit_logs(rbac_client, monkeypatch) -> None:
    client, SessionTesting = rbac_client
    with SessionTesting() as db:
        repo, pr = _seed_repo_and_pr(db)
        repo_id = str(repo.id)
        pr_id = str(pr.id)

    async def _fake_sync(_db, target_repo, _payload):
        return RepoSyncResponse(
            repo_id=target_repo.id,
            status="completed",
            synced={"issues": 2, "pull_requests": 1, "workflow_runs": 0},
        )

    async def _fake_create_comment(_self, _owner, _name, _number, body):
        return {"id": 91001, "html_url": "https://github.com/acme/svc/issues/15#issuecomment-91001", "body": body}

    monkeypatch.setattr("app.api.routes.repos.sync_repository", _fake_sync)
    monkeypatch.setattr("app.api.routes.repos.sync_repository_code_analysis_by_id", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(GitHubClient, "create_issue_comment", _fake_create_comment)

    viewer_headers = {"X-DevHelm-User": "viewer-user", "X-DevHelm-Role": "viewer"}
    developer_headers = {"X-DevHelm-User": "dev-user", "X-DevHelm-Role": "developer"}
    maintainer_headers = {"X-DevHelm-User": "maint-user", "X-DevHelm-Role": "maintainer"}
    owner_headers = {"X-DevHelm-User": "owner-user", "X-DevHelm-Role": "owner"}

    # 1. Viewer: allowed repo:read & eval:read, denied draft:create, agent:run, repo:sync
    assert client.get("/api/repos", headers=viewer_headers).status_code == 200
    assert client.get("/api/evals/pr-regression-cases", headers=viewer_headers).status_code == 200

    denied_draft_create = client.post(
        f"/api/pull-requests/{pr_id}/comment-draft",
        json={"reviewer_confirmed": True},
        headers=viewer_headers,
    )
    assert denied_draft_create.status_code == 403
    assert "draft:create" in denied_draft_create.json()["detail"]

    denied_agent_run = client.post(
        f"/api/pull-requests/{pr_id}/analyze",
        headers=viewer_headers,
    )
    assert denied_agent_run.status_code == 403
    assert "agent:run" in denied_agent_run.json()["detail"]

    denied_viewer_sync = client.post(
        f"/api/repos/{repo_id}/sync",
        json={"limit": 5},
        headers=viewer_headers,
    )
    assert denied_viewer_sync.status_code == 403
    assert "repo:sync" in denied_viewer_sync.json()["detail"]

    # 2. Developer: allowed agent:run & draft:create, denied draft:approve & repo:sync
    analyzed = client.post(f"/api/pull-requests/{pr_id}/analyze", headers=developer_headers)
    assert analyzed.status_code == 200

    created_draft_resp = client.post(
        f"/api/pull-requests/{pr_id}/comment-draft",
        json={"reviewer_confirmed": True, "analysis_id": analyzed.json()["analysis_id"]},
        headers=developer_headers,
    )
    assert created_draft_resp.status_code == 200
    draft_id = created_draft_resp.json()["id"]

    denied_dev_approve = client.post(
        f"/api/action-drafts/{draft_id}/confirm",
        headers=developer_headers,
    )
    assert denied_dev_approve.status_code == 403
    assert "draft:approve" in denied_dev_approve.json()["detail"]

    denied_dev_sync = client.post(
        f"/api/repos/{repo_id}/sync",
        json={"limit": 5},
        headers=developer_headers,
    )
    assert denied_dev_sync.status_code == 403
    assert "repo:sync" in denied_dev_sync.json()["detail"]

    # 3. Maintainer: allowed draft:approve & repo:sync, denied settings:manage
    approved_resp = client.post(
        f"/api/action-drafts/{draft_id}/confirm",
        headers=maintainer_headers,
    )
    assert approved_resp.status_code == 200
    assert approved_resp.json()["draft"]["status"] == "executed"

    synced_resp = client.post(
        f"/api/repos/{repo_id}/sync",
        json={"limit": 5},
        headers=maintainer_headers,
    )
    assert synced_resp.status_code == 200
    assert synced_resp.json()["status"] == "completed"

    denied_maint_audit = client.get(
        "/api/action-drafts/audit-logs",
        headers=maintainer_headers,
    )
    assert denied_maint_audit.status_code == 403
    assert "settings:manage" in denied_maint_audit.json()["detail"]

    # 4. Owner: allowed settings:manage and sees all denied AuditLog entries
    audit_resp = client.get("/api/action-drafts/audit-logs", headers=owner_headers)
    assert audit_resp.status_code == 200
    audit_rows = audit_resp.json()
    denied_rows = [row for row in audit_rows if row["status"] == "denied"]
    denied_actions = {row["action"] for row in denied_rows}
    assert {
        "permission.denied:draft:create",
        "permission.denied:agent:run",
        "permission.denied:repo:sync",
        "permission.denied:draft:approve",
        "permission.denied:settings:manage",
    }.issubset(denied_actions)

    with SessionTesting() as db:
        approve_denial = (
            db.query(AuditLog)
            .filter(AuditLog.action == "permission.denied:draft:approve", AuditLog.status == "denied")
            .one()
        )
        dev_user = db.query(User).filter(User.name == "dev-user").one()
        assert approve_denial.user_id == dev_user.id
        assert str(approve_denial.repo_id) == repo_id
        assert approve_denial.request_json == {
            "path": f"/api/action-drafts/{draft_id}/confirm",
            "method": "POST",
            "role": "developer",
        }


def test_unknown_role_and_user_lookup_and_default_demo_fallback(rbac_client) -> None:
    client, SessionTesting = rbac_client
    with SessionTesting() as db:
        seeded_viewer = User(name="alice@acme.dev", role="viewer")
        db.add(seeded_viewer)
        db.commit()
        db.refresh(seeded_viewer)
        seeded_viewer_id = str(seeded_viewer.id)

    # Unknown role rejected with 400
    bad_role = client.get("/api/repos", headers={"X-DevHelm-User": "eve", "X-DevHelm-Role": "superadmin"})
    assert bad_role.status_code == 400
    assert "superadmin" in bad_role.json()["detail"]

    # Lookup existing user by email/name or UUID without X-DevHelm-Role enforces stored role
    assert client.get("/api/repos", headers={"X-DevHelm-User": "alice@acme.dev"}).status_code == 200
    denied_by_name = client.get("/api/action-drafts/audit-logs", headers={"X-DevHelm-User": "alice@acme.dev"})
    assert denied_by_name.status_code == 403
    denied_by_id = client.get("/api/action-drafts/audit-logs", headers={"X-DevHelm-User": seeded_viewer_id})
    assert denied_by_id.status_code == 403

    # Unknown user without role header rejected with 401
    unknown_actor = client.get("/api/repos", headers={"X-DevHelm-User": "nonexistent-user"})
    assert unknown_actor.status_code == 401

    # Unauthenticated request still falls back to demo-owner (owner) even when viewer was created first
    fallback_owner = client.get("/api/action-drafts/audit-logs")
    assert fallback_owner.status_code == 200


def test_non_dev_bearer_token_enforcement(rbac_client, monkeypatch) -> None:
    client, _SessionTesting = rbac_client
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "demo_mode", False)
    monkeypatch.setattr(settings, "api_auth_token", "prod-token-9876")

    assert client.get("/api/repos").status_code == 401
    assert client.get("/api/repos", headers={"Authorization": "Bearer wrong-token"}).status_code == 401
    assert client.get("/api/repos", headers={"X-DevHelm-Token": "wrong-token"}).status_code == 401

    assert client.get("/api/repos", headers={"Authorization": "Bearer prod-token-9876"}).status_code == 200
    assert client.get("/api/action-drafts/audit-logs", headers={"X-DevHelm-Token": "prod-token-9876"}).status_code == 200

    # Valid service token with delegated developer actor enforces developer role
    delegated = client.get(
        "/api/action-drafts/audit-logs",
        headers={
            "Authorization": "Bearer prod-token-9876",
            "X-DevHelm-User": "ci-bot",
            "X-DevHelm-Role": "developer",
        },
    )
    assert delegated.status_code == 403
