from __future__ import annotations

import hashlib
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = PROJECT_ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.bootstrap import ensure_schema_compatibility
from app.db.models import (
    Document,
    Issue,
    KnowledgeSourceDocument,
    PRFile,
    PRReviewComment,
    PullRequest,
    Repository,
    WorkflowRun,
)
from app.db.session import SessionLocal, engine
from app.services.conversations import backfill_all_default_conversations
from app.services.rag.indexing import index_repository_documents
from app.services.rag.knowledge_base import get_or_create_config
from app.services.rag.vector_store import DocumentPayload, add_documents

DEMO_REPO_FULL_NAME = "devhelm-labs/sample-service"


def _seed_project_docs(db: Session, repo: Repository, *, data_root: Path) -> int:
    existing_docs = (
        db.query(Document)
        .filter(Document.repo_id == repo.id, Document.source_type == "project_doc")
        .count()
    )
    if existing_docs > 0:
        return existing_docs

    docs_spec = [
        (
            "architecture_and_sync_guide.md",
            "架构与 GitHub 同步规范",
            (
                "# GitHub 同步与错误处理规范\n\n"
                "- 所有外部 GitHub REST 调用必须统一经过 `GitHubClient`，禁止在路由层裸调 HTTP。\n"
                "- 仓库连接与同步接口需要校验 `repo:sync` 权限，并写入 `AuditLog`。\n"
                "- Token 仅允许加密落盘，日志与检索文本必须执行脱敏。\n"
            ),
        ),
        (
            "release_and_pr_checklist.md",
            "PR 合入就绪度检查清单",
            (
                "# PR 合入门禁要求\n\n"
                "1. 涉及鉴权、权限或数据库 Schema 的变更必须附带回归测试。\n"
                "2. 若最近一次 `backend-test` CI 处于失败状态，必须排查根因后再合入。\n"
                "3. 移除旧配置项或兼容请求头时，必须同步更新运维与接口文档。\n"
            ),
        ),
    ]

    upload_dir = data_root / str(repo.id)
    upload_dir.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc)
    payloads: list[DocumentPayload] = []

    for filename, title, body in docs_spec:
        raw_bytes = body.encode("utf-8")
        checksum = hashlib.sha256(raw_bytes).hexdigest()
        doc_id = uuid.uuid5(uuid.NAMESPACE_URL, f"{DEMO_REPO_FULL_NAME}:{filename}")
        stored_path = upload_dir / f"{doc_id}-{filename}"
        stored_path.write_bytes(raw_bytes)

        if db.get(KnowledgeSourceDocument, doc_id) is None:
            db.add(
                KnowledgeSourceDocument(
                    id=doc_id,
                    repo_id=repo.id,
                    name=filename,
                    source_type="upload_file",
                    status="completed",
                    stored_path=str(stored_path),
                    content_type="text/markdown",
                    checksum=checksum,
                    file_size=len(raw_bytes),
                    character_count=len(body),
                    chunk_count=1,
                    created_at=now,
                    updated_at=now,
                    completed_at=now,
                )
            )
        payloads.append(
            DocumentPayload(
                source_type="project_doc",
                source_id=doc_id,
                title=title,
                content=body,
                metadata={
                    "filename": filename,
                    "checksum": checksum,
                    "chunk_index": 0,
                    "source_type": "project_doc",
                },
            )
        )

    db.flush()
    created = add_documents(
        db,
        repo.id,
        payloads,
        commit=False,
        sync_vector_store=settings.milvus_enabled,
    )
    return len(created)


def seed_demo_data(db: Session | None = None, *, data_root: Path | None = None) -> dict[str, object]:
    owns_session = db is None
    if owns_session:
        ensure_schema_compatibility(engine)
        db = SessionLocal()

    assert db is not None
    upload_base = data_root or Path(settings.upload_dir)
    if not upload_base.is_absolute():
        upload_base = Path.cwd() / upload_base

    try:
        now = datetime.now(timezone.utc)
        repo = db.query(Repository).filter(Repository.full_name == DEMO_REPO_FULL_NAME).one_or_none()
        if repo is None:
            repo = Repository(
                owner="devhelm-labs",
                name="sample-service",
                full_name=DEMO_REPO_FULL_NAME,
                description="Sample service repository for local DevHelm verification",
                default_branch="main",
                github_id=10001,
                last_sync_at=now,
            )
            db.add(repo)
            db.commit()
            db.refresh(repo)

        kb_config = get_or_create_config(db, repo.id, commit=False)
        kb_config.retrieval_method = "hybrid"
        kb_config.score_threshold_enabled = False
        if not settings.milvus_enabled:
            kb_config.rerank_provider = "heuristic"
            kb_config.rerank_model = "heuristic-reranker"
        db.flush()

        if db.query(Issue).filter(Issue.repo_id == repo.id).count() == 0:
            db.add_all(
                [
                    Issue(
                        repo_id=repo.id,
                        github_issue_id=101,
                        number=1,
                        title="Login API returns 500 when token expires",
                        body="JWT expires and backend returns 500 instead of 401.",
                        state="open",
                        labels=["bug", "auth"],
                        author="alice",
                        assignees=[],
                        created_at=now,
                    ),
                    Issue(
                        repo_id=repo.id,
                        github_issue_id=102,
                        number=2,
                        title="Add GitHub workflow sync",
                        body="Sync recent workflow runs and expose failed CI runs in dashboard.",
                        state="open",
                        labels=["feature", "ci"],
                        author="bob",
                        assignees=["backend"],
                        created_at=now,
                    ),
                    Issue(
                        repo_id=repo.id,
                        github_issue_id=103,
                        number=3,
                        title="Document local demo mode",
                        body="README should explain how to run without GitHub token.",
                        state="closed",
                        labels=["documentation"],
                        author="carol",
                        assignees=[],
                        created_at=now,
                    ),
                ]
            )
            db.flush()

        if db.query(PullRequest).filter(PullRequest.repo_id == repo.id).count() == 0:
            pr_sync = PullRequest(
                repo_id=repo.id,
                github_pr_id=201,
                number=8,
                title="Refactor GitHub sync service",
                body="Split GitHub API calls into issue, PR and actions modules and tighten token redaction.",
                state="open",
                author="dave",
                base_branch="main",
                head_branch="refactor/github-sync",
                created_at=now,
            )
            pr_auth = PullRequest(
                repo_id=repo.id,
                github_pr_id=202,
                number=12,
                title="Fix expired token handling in auth middleware",
                body="Return 401 instead of 500 when JWT is expired (#1) and cover token validation path.",
                state="open",
                author="alice",
                base_branch="main",
                head_branch="fix/expired-jwt-401",
                created_at=now,
            )
            db.add_all([pr_sync, pr_auth])
            db.flush()

            db.add_all(
                [
                    PRFile(
                        pr_id=pr_sync.id,
                        filename="backend/app/services/github/client.py",
                        status="modified",
                        additions=42,
                        deletions=8,
                        patch=(
                            "@@ -18,6 +18,14 @@\n"
                            " async def get_repo(self, owner: str, repo: str) -> dict:\n"
                            "+    response = await self._request('GET', f'/repos/{owner}/{repo}')\n"
                            "+    response.raise_for_status()\n"
                            "+    return response.json()\n"
                        ),
                    ),
                    PRFile(
                        pr_id=pr_sync.id,
                        filename="backend/app/api/routes/repos.py",
                        status="modified",
                        additions=55,
                        deletions=12,
                        patch=(
                            "@@ -20,4 +20,11 @@\n"
                            "+@router.post('/connect')\n"
                            "+async def connect_repo(payload: RepoConnectRequest, user=Depends(require_permission('repo:sync'))):\n"
                            "+    return await sync_repository(payload)\n"
                        ),
                    ),
                    PRFile(
                        pr_id=pr_auth.id,
                        filename="backend/app/services/auth_guard.py",
                        status="modified",
                        additions=19,
                        deletions=5,
                        patch=(
                            "@@ -31,5 +31,11 @@\n"
                            "-    payload = decode_jwt(raw_token)\n"
                            "+    try:\n"
                            "+        payload = decode_jwt(raw_token)\n"
                            "+    except TokenExpiredError as exc:\n"
                            "+        raise HTTPException(status_code=401, detail='Token expired') from exc\n"
                        ),
                    ),
                    PRFile(
                        pr_id=pr_auth.id,
                        filename="backend/app/tests/test_auth_guard.py",
                        status="added",
                        additions=24,
                        deletions=0,
                        patch=(
                            "@@ -0,0 +1,12 @@\n"
                            "+def test_expired_jwt_returns_401(client):\n"
                            "+    resp = client.get('/api/orders', headers={'Authorization': 'Bearer expired'})\n"
                            "+    assert resp.status_code == 401\n"
                        ),
                    ),
                ]
            )
            db.add_all(
                [
                    PRReviewComment(
                        pr_id=pr_sync.id,
                        github_comment_id=401,
                        body="Please verify token handling is not logged.",
                        path="backend/app/api/routes/repos.py",
                        line=24,
                        author="reviewer-a",
                        created_at=now,
                    ),
                    PRReviewComment(
                        pr_id=pr_sync.id,
                        github_comment_id=402,
                        body="Consider splitting GitHub sync into smaller retriable steps.",
                        path="backend/app/services/github/client.py",
                        line=22,
                        author="reviewer-b",
                        created_at=now,
                    ),
                ]
            )
            db.flush()

        if db.query(WorkflowRun).filter(WorkflowRun.repo_id == repo.id).count() == 0:
            db.add_all(
                [
                    WorkflowRun(
                        repo_id=repo.id,
                        github_run_id=301,
                        name="backend-test",
                        status="completed",
                        conclusion="failure",
                        html_url="https://github.com/devhelm-labs/sample-service/actions/runs/301",
                        jobs=[
                            {
                                "id": 9001,
                                "name": "pytest",
                                "status": "completed",
                                "conclusion": "failure",
                                "steps": [
                                    {
                                        "name": "Run backend tests",
                                        "status": "completed",
                                        "conclusion": "failure",
                                        "number": 4,
                                    }
                                ],
                            }
                        ],
                        logs_text=(
                            "pytest backend/app/tests/test_github_sync.py::test_sync_issues "
                            "FAILED AssertionError: expected 3 issues, got 2"
                        ),
                        created_at=now,
                    ),
                    WorkflowRun(
                        repo_id=repo.id,
                        github_run_id=302,
                        name="frontend-lint",
                        status="completed",
                        conclusion="success",
                        html_url="https://github.com/devhelm-labs/sample-service/actions/runs/302",
                        logs_text="",
                        created_at=now,
                    ),
                ]
            )
            db.flush()

        _seed_project_docs(db, repo, data_root=upload_base)
        index_repository_documents(
            db,
            repo.id,
            sync_vector_store=settings.milvus_enabled,
        )
        backfill_all_default_conversations(db)
        db.commit()
        db.refresh(repo)

        return {
            "repo_id": str(repo.id),
            "full_name": repo.full_name,
            "issues": db.query(Issue).filter(Issue.repo_id == repo.id).count(),
            "pull_requests": db.query(PullRequest).filter(PullRequest.repo_id == repo.id).count(),
            "workflow_runs": db.query(WorkflowRun).filter(WorkflowRun.repo_id == repo.id).count(),
            "documents": db.query(Document).filter(Document.repo_id == repo.id).count(),
        }
    finally:
        if owns_session:
            db.close()


def main() -> None:
    summary = seed_demo_data()
    print(
        f"Seeded demo data for repo {summary['full_name']} ({summary['repo_id']}): "
        f"issues={summary['issues']}, prs={summary['pull_requests']}, "
        f"ci_runs={summary['workflow_runs']}, docs={summary['documents']}"
    )


if __name__ == "__main__":
    main()
