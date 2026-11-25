from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import settings
from app.db.models import Base, Document, Issue, PRFile, PullRequest, Repository, WorkflowRun
from app.db.session import get_db
from app.main import create_app
from app.services.agents.pr_review_agent import PRReviewAgent
from app.services.llm.client import LLMClient
from app.services.rag.vector_store import reset_milvus_store_cache


class NoopLLM:
    model = "deterministic-test"

    async def chat_json(self, system_prompt, user_payload):
        return {}


@pytest.fixture()
def pr_client(monkeypatch):
    monkeypatch.setattr(settings, "milvus_enabled", False)
    monkeypatch.setattr(settings, "auto_sync_enabled", False)
    monkeypatch.setattr(LLMClient, "chat_json", NoopLLM().chat_json)
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


def _seed_repo_and_pr(
    session,
    *,
    number: int = 42,
    title: str = "Update order query endpoint",
    body: str = "Sync order query permissions and pagination.",
    files: list[dict] | None = None,
    ci_conclusion: str | None = "success",
) -> tuple[Repository, PullRequest]:
    repo = Repository(
        owner="acme",
        name=f"service-{uuid.uuid4().hex[:6]}",
        full_name=f"acme/service-{uuid.uuid4().hex[:6]}",
    )
    session.add(repo)
    session.flush()

    pr = PullRequest(
        repo_id=repo.id,
        number=number,
        title=title,
        body=body,
        state="open",
        author="lin",
        base_branch="main",
        head_branch=f"feat/pr-{number}",
    )
    session.add(pr)
    session.flush()

    for file_item in files or []:
        session.add(
            PRFile(
                pr_id=pr.id,
                filename=file_item["filename"],
                status=file_item.get("status", "modified"),
                additions=file_item.get("additions", 10),
                deletions=file_item.get("deletions", 2),
                patch=file_item.get("patch", ""),
            )
        )

    if ci_conclusion is not None:
        session.add(
            WorkflowRun(
                repo_id=repo.id,
                github_run_id=104,
                name="backend-ci",
                status="completed",
                conclusion=ci_conclusion,
                logs_text="pytest app/tests/test_orders.py FAILED AssertionError" if ci_conclusion == "failure" else "209 passed",
            )
        )
    session.commit()
    session.refresh(pr)
    return repo, pr


def _build_change_verifier_report(
    *,
    report_version: int = 1,
    rule_status: str = "confirmed",
    checks: list[dict],
    auth_header: str = "Bearer [REDACTED]",
) -> dict:
    return {
        "report_version": report_version,
        "generated_at": "2026-04-12T10:30:00+08:00",
        "note": "本报告仅覆盖列出的检查项；所有证据均已脱敏。",
        "task": {
            "id": 7,
            "name": "订单查询权限与分页接口验收",
            "requirement": "非订单归属用户访问详情必须返回 403；新分页参数支持 cursor。",
            "baseline_url": "http://127.0.0.1:18001",
            "candidate_url": "http://127.0.0.1:18002",
        },
        "rule_version": {
            "id": 3,
            "version": 2,
            "status": rule_status,
            "note": "覆盖越权拒绝与分页游标结构",
            "confirmed_at": "2026-04-12T10:20:00+08:00" if rule_status == "confirmed" else None,
        },
        "run": {
            "id": 19,
            "status": "completed",
            "started_at": "2026-04-12T10:25:00+08:00",
            "finished_at": "2026-04-12T10:25:04+08:00",
            "error": None,
        },
        "summary": {
            "headline": "候选环境验收对比结果",
            "total_checks": len(checks),
            "executed_checks": len(checks),
            "counts": {},
        },
        "checks": [
            {
                **check,
                "baseline": check.get(
                    "baseline",
                    {
                        "status": "passed",
                        "reason": "状态码与断言匹配",
                        "steps": [{"name": "请求接口", "request": {"method": "GET", "path": "/orders/1", "headers": {"Authorization": auth_header}}}],
                    },
                ),
                "candidate": check.get(
                    "candidate",
                    {
                        "status": "passed",
                        "reason": "状态码与断言匹配",
                        "steps": [],
                    },
                ),
            }
            for check in checks
        ],
    }


@pytest.mark.asyncio
async def test_pr_review_agent_binds_anchored_citations_and_stale_doc_gaps() -> None:
    agent = PRReviewAgent(llm=NoopLLM())  # type: ignore[arg-type]
    result = await agent.run(
        {
            "number": 58,
            "state": "open",
            "author": "alice",
            "head_sha": "a1b2c3d4e5f60718",
            "title": "Remove legacy X-Legacy-Auth-Token fallback",
            "body": "Drop deprecated auth header support.",
            "files": [
                {
                    "filename": "backend/app/api/routes/rag.py",
                    "additions": 8,
                    "deletions": 5,
                    "patch": "@@ -40,6 +42,17 @@\n-    legacy = request.headers.get('X-Legacy-Auth-Token')\n+    token = extract_bearer_token(request)\n",
                },
                {
                    "filename": "backend/app/tests/test_rag_auth.py",
                    "additions": 14,
                    "deletions": 0,
                    "patch": "@@ -1,0 +1,14 @@\n+def test_bearer_token_required():\n+    assert True\n",
                },
            ],
            "comments": [],
        },
        {
            "ci_summary": {"recent_runs": 2, "failed_runs": 0, "failed": []},
            "project_documents": [
                {
                    "source_type": "project_doc",
                    "title": "网关排障手册",
                    "snippet": "内部服务调用仍可携带 `X-Legacy-Auth-Token` 请求头绕过网关鉴权。",
                    "source_id": "doc-1",
                    "metadata": {"filename": "gateway_runbook.md", "checksum": "8f3a12bc9900"},
                }
            ],
            "related_issues": [
                {
                    "source_type": "issue",
                    "title": "下线旧鉴权请求头",
                    "snippet": "清理遗留的旧请求头兼容逻辑。",
                    "source_id": "99",
                    "metadata": {"number": 99, "state": "open"},
                }
            ],
        },
    )

    diff_citations = [c for c in result["citations"] if c["source_type"] == "diff"]
    assert any(
        c["locator"] == "backend/app/api/routes/rag.py#L42-L58" and c["version_ref"] == "commit:a1b2c3d4e5f6"
        for c in diff_citations
    )
    doc_citations = [c for c in result["citations"] if c["source_type"] == "doc"]
    assert len(doc_citations) == 1
    assert doc_citations[0]["locator"] == "doc:gateway_runbook.md@sha256:8f3a12bc"
    assert doc_citations[0]["stale"] is True

    issue_citations = [c for c in result["citations"] if c["source_type"] == "issue"]
    assert issue_citations[0]["locator"] == "issue:#99"

    assert result["blocking_findings"] == []
    assert len(result["advisory_findings"]) >= 1
    assert any(gap["category"] == "stale_doc" for gap in result["evidence_gaps"])
    assert result["merge_recommendation"] == "暂缓"


@pytest.mark.asyncio
async def test_pr_review_agent_detects_auth_bypass_and_missing_migration_as_blockers() -> None:
    agent = PRReviewAgent(llm=NoopLLM())  # type: ignore[arg-type]
    result = await agent.run(
        {
            "number": 61,
            "state": "open",
            "author": "bob",
            "title": "Add audit column and simplify route handler",
            "body": "Quick cleanup",
            "files": [
                {
                    "filename": "backend/app/api/routes/orders.py",
                    "additions": 2,
                    "deletions": 3,
                    "patch": "@@ -18,5 +18,4 @@\n-def get_order(order_id: int, user=Depends(require_permission('repo:read'))):\n+def get_order(order_id: int):\n     return load_order(order_id)\n",
                },
                {
                    "filename": "backend/app/db/models.py",
                    "additions": 2,
                    "deletions": 0,
                    "patch": "@@ -112,3 +112,5 @@\n+    reviewer_tier: Mapped[str] = mapped_column(String(40), default='standard')\n",
                },
                {
                    "filename": "backend/app/tests/test_orders.py",
                    "additions": 6,
                    "deletions": 0,
                    "patch": "@@ -1,2 +1,8 @@\n+def test_get_order():\n+    assert True\n",
                },
            ],
            "comments": [],
        },
        {"ci_summary": {"recent_runs": 1, "failed_runs": 0, "failed": []}},
    )

    titles = [item["title"] for item in result["blocking_findings"]]
    assert any("权限或认证" in title for title in titles)
    assert any("Alembic" in title for title in titles)
    assert any(gap["category"] == "unverified_migration" for gap in result["evidence_gaps"])
    assert all(item["citations"] for item in result["blocking_findings"])
    assert result["merge_recommendation"] == "修改后合入"


def test_acceptance_report_endpoint_validates_version_and_blocks_on_regression(pr_client) -> None:
    client, SessionTesting = pr_client
    with SessionTesting() as db:
        _repo, pr = _seed_repo_and_pr(
            db,
            number=77,
            files=[
                {
                    "filename": "backend/app/services/orders.py",
                    "additions": 12,
                    "deletions": 3,
                    "patch": "@@ -22,4 +22,13 @@\n+    return query.all()\n",
                },
                {
                    "filename": "backend/app/tests/test_orders.py",
                    "additions": 10,
                    "deletions": 0,
                    "patch": "@@ -1,0 +1,10 @@\n+def test_orders(): pass\n",
                },
            ],
        )
        pr_id = str(pr.id)

    bad_resp = client.post(
        f"/api/pull-requests/{pr_id}/acceptance-report",
        json=_build_change_verifier_report(report_version=2, checks=[]),
    )
    assert bad_resp.status_code == 422

    regression_report = _build_change_verifier_report(
        rule_status="confirmed",
        auth_header="Bearer secret-live-token-123456",
        checks=[
            {
                "id": "read-other-order-denied",
                "name": "读取他人订单应被拒绝",
                "category": "existing_behavior",
                "expectation": "返回 403",
                "classification": {
                    "code": "regression",
                    "label": "回归",
                    "reason": "baseline 返回 403，candidate 返回 200 并泄露订单详情",
                },
                "diff_summary": "HTTP 403 -> HTTP 200",
            },
            {
                "id": "create-order-idempotent",
                "name": "幂等创建订单",
                "category": "new_requirement",
                "expectation": "重复请求返回同一订单号",
                "classification": {
                    "code": "not_met",
                    "label": "新需求未满足",
                    "reason": "candidate 重复创建了两条记录",
                },
                "diff_summary": "期望单条订单，实际产生重复主键",
            },
        ],
    )
    ingest_resp = client.post(f"/api/pull-requests/{pr_id}/acceptance-report", json=regression_report)
    assert ingest_resp.status_code == 200
    ingested = ingest_resp.json()
    assert ingested["blocking_check_ids"] == ["read-other-order-denied", "create-order-idempotent"]
    assert "secret-live-token-123456" not in str(ingested["report"])

    get_resp = client.get(f"/api/pull-requests/{pr_id}/acceptance-report")
    assert get_resp.status_code == 200
    assert get_resp.json()["report_sha256"] == ingested["report_sha256"]

    analyze_resp = client.post(f"/api/pull-requests/{pr_id}/analyze?use_pr_snapshot=false")
    assert analyze_resp.status_code == 200
    review = analyze_resp.json()["result"]
    assert review["merge_recommendation"] == "修改后合入"

    acceptance_blockers = [
        item
        for item in review["blocking_findings"]
        if any(c["source_type"] == "acceptance_report" for c in item["citations"])
    ]
    assert len(acceptance_blockers) == 2
    locators = {c["locator"] for item in acceptance_blockers for c in item["citations"]}
    assert {"check:read-other-order-denied", "check:create-order-idempotent"} <= locators


def test_acceptance_report_unverifiable_and_draft_downgrade_to_hold_while_expected_change_clears(pr_client) -> None:
    client, SessionTesting = pr_client
    with SessionTesting() as db:
        repo, pr = _seed_repo_and_pr(
            db,
            number=88,
            title="Switch pagination response to cursor token",
            body="Intentional v2 cursor contract migration.",
            files=[
                {
                    "filename": "backend/app/schemas/orders.py",
                    "additions": 6,
                    "deletions": 4,
                    "patch": "@@ -10,5 +10,7 @@\n-    next_cursor: str | None = None\n+    cursor_token: str | None = None\n",
                },
                {
                    "filename": "backend/app/tests/test_orders_schema.py",
                    "additions": 12,
                    "deletions": 2,
                    "patch": "@@ -1,3 +1,13 @@\n+def test_cursor_token():\n+    assert True\n",
                },
            ],
        )
        db.add(
            Issue(
                repo_id=repo.id,
                number=42,
                title="Migrate order list pagination to cursor_token",
                body="Replace next_cursor with cursor_token.",
                state="open",
            )
        )
        db.add(
            Document(
                repo_id=repo.id,
                source_type="project_doc",
                source_id=uuid.uuid4(),
                title="订单分页规范 v2",
                content="分页接口统一返回 cursor_token 字段。",
                meta={"filename": "pagination_v2.md", "checksum": "91ab44ef1029"},
            )
        )
        db.commit()
        pr_id = str(pr.id)

    # 1. Draft rule + unverifiable check -> downgrades merge_recommendation to 暂缓
    draft_unverifiable = _build_change_verifier_report(
        rule_status="draft",
        checks=[
            {
                "id": "cursor-pagination-check",
                "name": "分页游标行为验证",
                "category": "new_requirement",
                "classification": {
                    "code": "unverifiable",
                    "label": "无法判断",
                    "reason": "candidate 测试数据库未启动，连接被拒绝",
                },
                "diff_summary": "连接候选环境超时",
            }
        ],
    )
    resp1 = client.post(f"/api/pull-requests/{pr_id}/acceptance-report", json=draft_unverifiable)
    assert resp1.status_code == 200

    # Without confirmed expected_change, contract break blocks first; now test confirmed expected_change + unverifiable
    confirmed_unverifiable = _build_change_verifier_report(
        rule_status="confirmed",
        checks=[
            {
                "id": "cursor-contract-v2",
                "name": "游标字段切换为 cursor_token",
                "category": "existing_behavior",
                "expected_change_ref": "Issue #42",
                "classification": {
                    "code": "expected_change",
                    "label": "预期行为变化",
                    "reason": "按 Issue #42 将 next_cursor 升级为 cursor_token",
                },
                "diff_summary": "next_cursor -> cursor_token",
            },
            {
                "id": "audit-webhook-delivery",
                "name": "审计回调投递",
                "category": "existing_behavior",
                "classification": {
                    "code": "unverifiable",
                    "label": "无法判断",
                    "reason": "下游沙箱回调接收端不可达",
                },
                "diff_summary": "candidate 环境网络隔离",
            },
        ],
    )
    client.post(f"/api/pull-requests/{pr_id}/acceptance-report", json=confirmed_unverifiable)
    hold_review = client.post(f"/api/pull-requests/{pr_id}/analyze?use_pr_snapshot=false").json()["result"]
    assert hold_review["blocking_findings"] == []
    assert any(gap["category"] == "unverifiable_check" and gap["locator"] == "check:audit-webhook-delivery" for gap in hold_review["evidence_gaps"])
    assert hold_review["merge_recommendation"] == "暂缓"

    # 2. Confirmed expected_change + satisfied -> positive behavioral proof clears contract break and reaches 建议合入
    confirmed_all_green = _build_change_verifier_report(
        rule_status="confirmed",
        checks=[
            {
                "id": "cursor-contract-v2",
                "name": "游标字段切换为 cursor_token",
                "category": "existing_behavior",
                "expected_change_ref": "Issue #42",
                "classification": {
                    "code": "expected_change",
                    "label": "预期行为变化",
                    "reason": "按 Issue #42 将 next_cursor 升级为 cursor_token",
                },
                "diff_summary": "next_cursor -> cursor_token",
            },
            {
                "id": "list-orders-satisfied",
                "name": "分页拉取下一页订单",
                "category": "new_requirement",
                "classification": {
                    "code": "satisfied",
                    "label": "已满足",
                    "reason": "携带 cursor_token 成功返回第二页数据",
                },
                "diff_summary": "候选环境新断言全部通过",
            },
        ],
    )
    client.post(f"/api/pull-requests/{pr_id}/acceptance-report", json=confirmed_all_green)
    ready_resp = client.post(f"/api/pull-requests/{pr_id}/analyze?use_pr_snapshot=false").json()
    ready_review = ready_resp["result"]
    assert ready_review["blocking_findings"] == []
    assert ready_review["evidence_gaps"] == []
    assert ready_review["merge_recommendation"] == "建议合入"
    assert len(ready_review["acceptance_summary"]["positive_proofs"]) == 2
    assert ready_resp["evidence_summary"]["ci_status"]["state"] == "passed"
