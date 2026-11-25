from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.db.models import AnalysisResult, PullRequest
from app.schemas.analysis import PRReviewOutput
from app.services.agents.pr_review_agent import PRReviewAgent
from app.services.pr_feedback import PR_FEEDBACK_ANALYSIS_TYPE

PR_READINESS_SUITE_ID = "pr-merge-readiness"


class _DeterministicNoopLLM:
    model = "deterministic-eval"

    async def chat_json(self, system_prompt: str, user_payload: dict[str, Any]) -> dict[str, Any]:
        return {}


@dataclass(frozen=True)
class PRReadinessEvalCase:
    id: str
    title: str
    pr_payload: dict[str, Any]
    context: dict[str, Any]
    expected_should_block: bool
    expected_recommendation: str
    critical_issue_keywords: list[str] = field(default_factory=list)
    has_stale_doc: bool = False
    expected_gap_categories: list[str] = field(default_factory=list)
    source: str = "builtin"
    feedback_label: str | None = None

    def to_canonical_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "source": self.source,
            "feedback_label": self.feedback_label,
            "pr_payload": self.pr_payload,
            "context": self.context,
            "expected_should_block": self.expected_should_block,
            "expected_recommendation": self.expected_recommendation,
            "critical_issue_keywords": self.critical_issue_keywords,
            "has_stale_doc": self.has_stale_doc,
            "expected_gap_categories": self.expected_gap_categories,
        }


def _verifier_fixture(*, rule_status: str = "confirmed", checks: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "report_version": 1,
        "generated_at": "2026-04-10T09:00:00+08:00",
        "task": {
            "id": 10,
            "name": "PR 候选环境行为对比验收",
            "requirement": "验证关键接口权限与响应契约",
            "baseline_url": "http://127.0.0.1:18001",
            "candidate_url": "http://127.0.0.1:18002",
        },
        "rule_version": {
            "id": 4,
            "version": 1,
            "status": rule_status,
            "note": "基准对比规则",
            "confirmed_at": "2026-04-10T08:55:00+08:00" if rule_status == "confirmed" else None,
        },
        "run": {
            "id": 31,
            "status": "completed",
            "started_at": "2026-04-10T08:58:00+08:00",
            "finished_at": "2026-04-10T08:58:03+08:00",
            "error": None,
        },
        "summary": {
            "headline": "自动验收汇总",
            "total_checks": len(checks),
            "executed_checks": len(checks),
            "counts": {},
        },
        "checks": checks,
    }


def builtin_pr_readiness_cases() -> list[PRReadinessEvalCase]:
    return [
        PRReadinessEvalCase(
            id="pr-01-auth-bypass",
            title="路由层移除权限依赖引发越权风险",
            pr_payload={
                "number": 101,
                "state": "open",
                "author": "dev-a",
                "head_sha": "101aa22bb33cc44d",
                "title": "Simplify order detail route signature",
                "body": "Clean up route dependencies.",
                "files": [
                    {
                        "filename": "backend/app/api/routes/orders.py",
                        "additions": 1,
                        "deletions": 2,
                        "patch": "@@ -24,4 +24,3 @@\n-async def get_order(order_id: str, user=Depends(require_permission('repo:read'))):\n+async def get_order(order_id: str):\n     return fetch_order(order_id)\n",
                    },
                    {
                        "filename": "backend/app/tests/test_orders.py",
                        "additions": 6,
                        "deletions": 0,
                        "patch": "@@ -1,0 +1,6 @@\n+def test_get_order():\n+    assert True\n",
                    },
                ],
                "comments": [],
            },
            context={"ci_summary": {"recent_runs": 2, "failed_runs": 0, "failed": []}},
            expected_should_block=True,
            expected_recommendation="修改后合入",
            critical_issue_keywords=["权限或认证"],
        ),
        PRReadinessEvalCase(
            id="pr-02-pagination-break",
            title="未带验收证明直接移除分页契约字段",
            pr_payload={
                "number": 102,
                "state": "open",
                "author": "dev-b",
                "head_sha": "202aa22bb33cc44d",
                "title": "Rename order list pagination field",
                "body": "Switch next_cursor to cursor_token.",
                "files": [
                    {
                        "filename": "backend/app/schemas/orders.py",
                        "additions": 1,
                        "deletions": 1,
                        "patch": "@@ -12,4 +12,4 @@\n-    next_cursor: str | None = None\n+    cursor_token: str | None = None\n",
                    },
                    {
                        "filename": "backend/app/tests/test_orders_schema.py",
                        "additions": 8,
                        "deletions": 1,
                        "patch": "@@ -1,2 +1,9 @@\n+def test_schema():\n+    assert True\n",
                    },
                ],
                "comments": [],
            },
            context={"ci_summary": {"recent_runs": 2, "failed_runs": 0, "failed": []}},
            expected_should_block=True,
            expected_recommendation="修改后合入",
            critical_issue_keywords=["契约"],
        ),
        PRReadinessEvalCase(
            id="pr-03-failing-ci",
            title="CI 单元测试失败阻塞合入",
            pr_payload={
                "number": 103,
                "state": "open",
                "author": "dev-c",
                "head_sha": "303aa22bb33cc44d",
                "title": "Adjust retry backoff multiplier",
                "body": "Tune retry delay.",
                "files": [
                    {
                        "filename": "backend/app/services/retry.py",
                        "additions": 4,
                        "deletions": 2,
                        "patch": "@@ -8,4 +8,6 @@\n-    delay = base * 2\n+    delay = base * 3\n",
                    },
                    {
                        "filename": "backend/app/tests/test_retry.py",
                        "additions": 4,
                        "deletions": 1,
                        "patch": "@@ -10,3 +10,6 @@\n+    assert True\n",
                    },
                ],
                "comments": [],
            },
            context={
                "ci_summary": {
                    "recent_runs": 3,
                    "failed_runs": 1,
                    "failed": [
                        {
                            "run_id": "run-208",
                            "name": "backend-pytest",
                            "conclusion": "failure",
                            "logs_text": "FAILED app/tests/test_retry.py::test_backoff_window - AssertionError",
                        }
                    ],
                }
            },
            expected_should_block=True,
            expected_recommendation="暂缓",
            critical_issue_keywords=["失败 CI"],
        ),
        PRReadinessEvalCase(
            id="pr-04-missing-migration",
            title="ORM 模型新增持久化列缺少 Alembic 迁移脚本",
            pr_payload={
                "number": 104,
                "state": "open",
                "author": "dev-d",
                "head_sha": "404aa22bb33cc44d",
                "title": "Track SLA deadline on Issue model",
                "body": "Add sla_hours column to issues.",
                "files": [
                    {
                        "filename": "backend/app/db/models.py",
                        "additions": 2,
                        "deletions": 0,
                        "patch": "@@ -98,3 +98,5 @@\n+    sla_hours: Mapped[int] = mapped_column(Integer, default=48)\n",
                    },
                    {
                        "filename": "backend/app/tests/test_issue_sla.py",
                        "additions": 9,
                        "deletions": 0,
                        "patch": "@@ -1,0 +1,9 @@\n+def test_sla_default():\n+    assert True\n",
                    },
                ],
                "comments": [],
            },
            context={"ci_summary": {"recent_runs": 2, "failed_runs": 0, "failed": []}},
            expected_should_block=True,
            expected_recommendation="修改后合入",
            critical_issue_keywords=["Alembic"],
            expected_gap_categories=["unverified_migration"],
        ),
        PRReadinessEvalCase(
            id="pr-05-stale-runbook",
            title="移除遗留启动参数但关联运维手册未同步更新",
            pr_payload={
                "number": 105,
                "state": "open",
                "author": "dev-e",
                "head_sha": "505aa22bb33cc44d",
                "title": "Remove deprecated --legacy-sync-flag option",
                "body": "Clean up CLI parser.",
                "files": [
                    {
                        "filename": "backend/app/services/sync_cli.py",
                        "additions": 2,
                        "deletions": 4,
                        "patch": "@@ -15,6 +15,4 @@\n-    parser.add_argument('--legacy-sync-flag', action='store_true')\n+    parser.add_argument('--incremental', action='store_true')\n",
                    },
                    {
                        "filename": "backend/app/tests/test_sync_cli.py",
                        "additions": 7,
                        "deletions": 1,
                        "patch": "@@ -1,3 +1,9 @@\n+def test_incremental_flag():\n+    assert True\n",
                    },
                ],
                "comments": [],
            },
            context={
                "ci_summary": {"recent_runs": 2, "failed_runs": 0, "failed": []},
                "project_documents": [
                    {
                        "source_type": "project_doc",
                        "title": "仓库同步排障手册",
                        "snippet": "全量回填异常时请附加 `--legacy-sync-flag` 参数执行应急同步。",
                        "source_id": "doc-sync",
                        "metadata": {"filename": "ops_sync_runbook.md", "checksum": "77bc19fe0012"},
                    }
                ],
            },
            expected_should_block=False,
            expected_recommendation="暂缓",
            has_stale_doc=True,
            expected_gap_categories=["stale_doc"],
        ),
        PRReadinessEvalCase(
            id="pr-06-expected-change-verified",
            title="破坏性分页改造已通过已确认的 expected_change 行为验收",
            pr_payload={
                "number": 106,
                "state": "open",
                "author": "dev-f",
                "head_sha": "606aa22bb33cc44d",
                "title": "Migrate order pagination to cursor_token with acceptance proof",
                "body": "Implements Issue #42.",
                "files": [
                    {
                        "filename": "backend/app/schemas/orders.py",
                        "additions": 2,
                        "deletions": 2,
                        "patch": "@@ -12,4 +12,4 @@\n-    next_cursor: str | None = None\n+    cursor_token: str | None = None\n",
                    },
                    {
                        "filename": "backend/app/tests/test_orders_cursor.py",
                        "additions": 15,
                        "deletions": 0,
                        "patch": "@@ -1,0 +1,15 @@\n+def test_cursor_pagination():\n+    assert True\n",
                    },
                ],
                "comments": [],
            },
            context={
                "ci_summary": {"recent_runs": 2, "failed_runs": 0, "failed": []},
                "acceptance_report": _verifier_fixture(
                    rule_status="confirmed",
                    checks=[
                        {
                            "id": "cursor-field-v2",
                            "name": "游标字段升级为 cursor_token",
                            "category": "existing_behavior",
                            "expected_change_ref": "Issue #42",
                            "classification": {
                                "code": "expected_change",
                                "label": "预期行为变化",
                                "reason": "按 Issue #42 完成分页协议升级",
                            },
                            "diff_summary": "next_cursor -> cursor_token",
                        },
                        {
                            "id": "second-page-fetch",
                            "name": "携带 cursor_token 获取次页结果",
                            "category": "new_requirement",
                            "classification": {
                                "code": "satisfied",
                                "label": "已满足",
                                "reason": "候选环境分页游标断言通过",
                            },
                            "diff_summary": "HTTP 200 且无重复记录",
                        },
                    ],
                ),
            },
            expected_should_block=False,
            expected_recommendation="建议合入",
        ),
        PRReadinessEvalCase(
            id="pr-07-verifier-regression",
            title="change-verifier 检出跨租户订单越权回归",
            pr_payload={
                "number": 107,
                "state": "open",
                "author": "dev-g",
                "head_sha": "707aa22bb33cc44d",
                "title": "Optimize order lookup SQL join",
                "body": "Reduce query latency.",
                "files": [
                    {
                        "filename": "backend/app/services/order_repo.py",
                        "additions": 9,
                        "deletions": 6,
                        "patch": "@@ -31,7 +31,10 @@\n+    return db.execute(stmt).scalar_one_or_none()\n",
                    },
                    {
                        "filename": "backend/app/tests/test_order_repo.py",
                        "additions": 8,
                        "deletions": 0,
                        "patch": "@@ -1,0 +1,8 @@\n+def test_order_lookup():\n+    assert True\n",
                    },
                ],
                "comments": [],
            },
            context={
                "ci_summary": {"recent_runs": 2, "failed_runs": 0, "failed": []},
                "acceptance_report": _verifier_fixture(
                    rule_status="confirmed",
                    checks=[
                        {
                            "id": "read-other-order-denied",
                            "name": "非归属用户读取订单必须返回 403",
                            "category": "existing_behavior",
                            "classification": {
                                "code": "regression",
                                "label": "回归",
                                "reason": "baseline 返回 403，candidate 返回 200",
                            },
                            "diff_summary": "HTTP 403 -> HTTP 200",
                        }
                    ],
                ),
            },
            expected_should_block=True,
            expected_recommendation="修改后合入",
            critical_issue_keywords=["行为验收检出回归"],
        ),
        PRReadinessEvalCase(
            id="pr-08-verifier-unverifiable",
            title="change-verifier 候选环境沙箱不可达产生证据缺口",
            pr_payload={
                "number": 108,
                "state": "open",
                "author": "dev-h",
                "head_sha": "808aa22bb33cc44d",
                "title": "Add webhook delivery retry jitter",
                "body": "Prevent thundering herd.",
                "files": [
                    {
                        "filename": "backend/app/services/webhook_sender.py",
                        "additions": 6,
                        "deletions": 2,
                        "patch": "@@ -19,3 +19,7 @@\n+    jitter = 0.2\n",
                    },
                    {
                        "filename": "backend/app/tests/test_webhook_sender.py",
                        "additions": 10,
                        "deletions": 0,
                        "patch": "@@ -1,0 +1,10 @@\n+def test_jitter():\n+    assert True\n",
                    },
                ],
                "comments": [],
            },
            context={
                "ci_summary": {"recent_runs": 2, "failed_runs": 0, "failed": []},
                "acceptance_report": _verifier_fixture(
                    rule_status="confirmed",
                    checks=[
                        {
                            "id": "webhook-callback-delivery",
                            "name": "回调接收端投递验证",
                            "category": "existing_behavior",
                            "classification": {
                                "code": "unverifiable",
                                "label": "无法判断",
                                "reason": "候选环境回调监听容器未就绪",
                            },
                            "diff_summary": "连接被拒绝",
                        }
                    ],
                ),
            },
            expected_should_block=False,
            expected_recommendation="暂缓",
            expected_gap_categories=["unverifiable_check"],
        ),
        PRReadinessEvalCase(
            id="pr-09-clean-bugfix",
            title="带完整单测与通过 CI 的幂等键缺陷修复",
            pr_payload={
                "number": 109,
                "state": "open",
                "author": "dev-i",
                "head_sha": "909aa22bb33cc44d",
                "title": "Strip whitespace when normalizing idempotency key",
                "body": "Fixes duplicate retry edge case.",
                "files": [
                    {
                        "filename": "backend/app/services/idempotency.py",
                        "additions": 3,
                        "deletions": 1,
                        "patch": "@@ -14,3 +14,5 @@\n-    return raw_key\n+    return raw_key.strip()\n",
                    },
                    {
                        "filename": "backend/app/tests/test_idempotency.py",
                        "additions": 12,
                        "deletions": 0,
                        "patch": "@@ -1,0 +1,12 @@\n+def test_strip_idempotency_key():\n+    assert True\n",
                    },
                ],
                "comments": [],
            },
            context={"ci_summary": {"recent_runs": 3, "failed_runs": 0, "failed": []}},
            expected_should_block=False,
            expected_recommendation="建议合入",
        ),
        PRReadinessEvalCase(
            id="pr-10-docs-only",
            title="纯架构部署文档勘误更新",
            pr_payload={
                "number": 110,
                "state": "open",
                "author": "dev-j",
                "head_sha": "a10aa22bb33cc44d",
                "title": "Clarify Milvus port mapping in deployment guide",
                "body": "Documentation update only.",
                "files": [
                    {
                        "filename": "docs/architecture/deployment.md",
                        "additions": 8,
                        "deletions": 2,
                        "patch": "@@ -30,4 +30,10 @@\n+Milvus 默认监听 19530 端口。\n",
                    }
                ],
                "comments": [],
            },
            context={"ci_summary": {"recent_runs": 1, "failed_runs": 0, "failed": []}},
            expected_should_block=False,
            expected_recommendation="建议合入",
        ),
    ]


def compile_pr_feedback_regression_cases(
    db: Session | None,
    repo_id: UUID | str | None = None,
) -> list[PRReadinessEvalCase]:
    if db is None:
        return []
    query = db.query(AnalysisResult).filter(
        AnalysisResult.target_type == "pull_request",
        AnalysisResult.analysis_type == PR_FEEDBACK_ANALYSIS_TYPE,
    )
    if repo_id is not None:
        repo_uuid = repo_id if isinstance(repo_id, UUID) else UUID(str(repo_id))
        pr_ids = [row.id for row in db.query(PullRequest.id).filter(PullRequest.repo_id == repo_uuid).all()]
        if not pr_ids:
            return []
        query = query.filter(AnalysisResult.target_id.in_(pr_ids))

    rows = query.order_by(AnalysisResult.created_at.asc()).all()
    compiled: list[PRReadinessEvalCase] = []
    for row in rows:
        snapshot = row.input_snapshot or {}
        feedback = row.result_json or {}
        pr_payload = snapshot.get("pull_request")
        if not isinstance(pr_payload, dict):
            continue
        label = str(feedback.get("label") or "").strip()
        if label not in {"useful", "false_positive", "missed_issue"}:
            continue
        expected_should_block = bool(feedback.get("expected_blocking"))
        expected_verdict = str(feedback.get("expected_merge_recommendation") or ("修改后合入" if expected_should_block else "建议合入"))
        critical_keywords: list[str] = []
        if label == "missed_issue":
            expected_should_block = True
            keyword = str(feedback.get("missed_issue_title") or feedback.get("note") or "").strip()
            if keyword:
                critical_keywords.append(keyword)
        elif label == "false_positive":
            expected_should_block = False

        compiled.append(
            PRReadinessEvalCase(
                id=f"feedback-{str(row.id)[:8]}",
                title=f"PR #{pr_payload.get('number')}: {pr_payload.get('title') or label} ({label})",
                pr_payload=pr_payload,
                context=snapshot.get("context") if isinstance(snapshot.get("context"), dict) else {},
                expected_should_block=expected_should_block,
                expected_recommendation=expected_verdict,
                critical_issue_keywords=critical_keywords,
                has_stale_doc=False,
                expected_gap_categories=[],
                source="user_feedback",
                feedback_label=label,
            )
        )
    return compiled


def build_pr_readiness_dataset(
    db: Session | None = None,
    repo_id: UUID | str | None = None,
    *,
    include_feedback: bool = True,
) -> tuple[list[PRReadinessEvalCase], dict[str, Any]]:
    builtin_cases = builtin_pr_readiness_cases()
    feedback_cases = compile_pr_feedback_regression_cases(db, repo_id) if include_feedback else []
    all_cases = [*builtin_cases, *feedback_cases]
    serialized = [case.to_canonical_dict() for case in all_cases]
    canonical = json.dumps(serialized, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    dataset_sha256 = hashlib.sha256(canonical).hexdigest()
    metadata = {
        "id": PR_READINESS_SUITE_ID,
        "name": PR_READINESS_SUITE_ID,
        "label": "PR 合入就绪度与反馈回归评测集",
        "description": "覆盖权限绕过、契约破坏、失败 CI、缺失迁移、过期文档、change-verifier 验收联动及人工标注反馈用例。",
        "schema_version": 1,
        "source": "hybrid_feedback" if feedback_cases else "builtin",
        "sha256": dataset_sha256,
        "case_count": len(all_cases),
        "builtin_case_count": len(builtin_cases),
        "feedback_case_count": len(feedback_cases),
        "ready": True,
        "missing_sources": [],
        "recommended": True,
    }
    return all_cases, metadata


def _has_valid_citation(item: dict[str, Any]) -> bool:
    citations = item.get("citations")
    if not isinstance(citations, list) or not citations:
        return False
    return any(
        isinstance(c, dict)
        and bool(str(c.get("locator") or "").strip())
        and bool(str(c.get("snippet") or "").strip())
        for c in citations
    )


async def run_pr_merge_readiness_eval(
    db: Session | None = None,
    repo_id: UUID | str | None = None,
    *,
    include_feedback: bool = True,
    agent: PRReviewAgent | None = None,
) -> dict[str, Any]:
    cases, dataset_meta = build_pr_readiness_dataset(db, repo_id, include_feedback=include_feedback)
    reviewer = agent or PRReviewAgent(llm=_DeterministicNoopLLM())  # type: ignore[arg-type]

    predicted_block_total = 0
    true_positive_blocks = 0
    non_blocking_ground_truth_total = 0
    false_positive_blocks = 0
    critical_expected_total = 0
    critical_detected_hits = 0
    bindable_items_total = 0
    bound_items_hits = 0
    stale_doc_cases_total = 0
    stale_doc_detected_hits = 0
    verdict_matches = 0

    case_results: list[dict[str, Any]] = []

    for case in cases:
        raw_output = await reviewer.run(case.pr_payload, case.context)
        validated = PRReviewOutput.model_validate(raw_output).model_dump()

        blocking_findings = validated.get("blocking_findings") or []
        advisory_findings = validated.get("advisory_findings") or []
        evidence_gaps = validated.get("evidence_gaps") or []
        citations = validated.get("citations") or []
        predicted_block = len(blocking_findings) > 0

        if predicted_block:
            predicted_block_total += 1
            if case.expected_should_block:
                true_positive_blocks += 1

        if not case.expected_should_block:
            non_blocking_ground_truth_total += 1
            if predicted_block:
                false_positive_blocks += 1

        searchable_blocker_text = " ".join(
            f"{item.get('title', '')} {item.get('evidence', '')}"
            for item in [*blocking_findings, *evidence_gaps]
        ).lower()
        matched_critical: list[str] = []
        missing_critical: list[str] = []
        for keyword in case.critical_issue_keywords:
            critical_expected_total += 1
            if keyword.lower() in searchable_blocker_text:
                critical_detected_hits += 1
                matched_critical.append(keyword)
            else:
                missing_critical.append(keyword)

        has_files = bool(case.pr_payload.get("files"))
        for item in [*blocking_findings, *advisory_findings]:
            if has_files or case.context.get("ci_summary") or case.context.get("acceptance_report"):
                bindable_items_total += 1
                if _has_valid_citation(item):
                    bound_items_hits += 1
        for gap in evidence_gaps:
            if gap.get("category") != "missing_diff_context":
                bindable_items_total += 1
                if _has_valid_citation(gap):
                    bound_items_hits += 1

        stale_detected = any(c.get("source_type") == "doc" and c.get("stale") is True for c in citations) and any(
            g.get("category") == "stale_doc" for g in evidence_gaps
        )
        if case.has_stale_doc:
            stale_doc_cases_total += 1
            if stale_detected:
                stale_doc_detected_hits += 1

        verdict = str(validated.get("merge_recommendation") or "")
        verdict_ok = verdict == case.expected_recommendation
        if verdict_ok:
            verdict_matches += 1

        gap_categories = {str(g.get("category") or "") for g in evidence_gaps}
        gaps_ok = set(case.expected_gap_categories) <= gap_categories
        case_passed = (
            (predicted_block == case.expected_should_block)
            and not missing_critical
            and gaps_ok
            and (not case.has_stale_doc or stale_detected)
        )

        case_results.append(
            {
                "id": case.id,
                "title": case.title,
                "source": case.source,
                "feedback_label": case.feedback_label,
                "expected_should_block": case.expected_should_block,
                "predicted_block": predicted_block,
                "expected_recommendation": case.expected_recommendation,
                "actual_recommendation": verdict,
                "verdict_matched": verdict_ok,
                "matched_critical_issues": matched_critical,
                "missing_critical_issues": missing_critical,
                "blocking_count": len(blocking_findings),
                "advisory_count": len(advisory_findings),
                "evidence_gap_count": len(evidence_gaps),
                "citation_count": len(citations),
                "stale_doc_detected": stale_detected,
                "hard_rules": {"passed": case_passed},
                "ragas_errors": {},
            }
        )

    blocking_precision = round(true_positive_blocks / predicted_block_total, 4) if predicted_block_total else 1.0
    false_blocking_rate = (
        round(false_positive_blocks / non_blocking_ground_truth_total, 4)
        if non_blocking_ground_truth_total
        else 0.0
    )
    critical_issue_recall = (
        round(critical_detected_hits / critical_expected_total, 4) if critical_expected_total else 1.0
    )
    citation_binding_rate = round(bound_items_hits / bindable_items_total, 4) if bindable_items_total else 1.0
    stale_doc_detection_rate = (
        round(stale_doc_detected_hits / stale_doc_cases_total, 4) if stale_doc_cases_total else 1.0
    )
    merge_verdict_accuracy = round(verdict_matches / len(cases), 4) if cases else 0.0

    summary_metrics = {
        "blocking_precision": blocking_precision,
        "false_blocking_rate": false_blocking_rate,
        "critical_issue_recall": critical_issue_recall,
        "citation_binding_rate": citation_binding_rate,
        "stale_doc_detection_rate": stale_doc_detection_rate,
        "merge_verdict_accuracy": merge_verdict_accuracy,
    }
    passed = (
        blocking_precision >= 0.85
        and false_blocking_rate <= 0.15
        and critical_issue_recall >= 0.85
        and citation_binding_rate >= 0.95
        and stale_doc_detection_rate >= 0.95
    )

    return {
        "kind": "pr_merge_readiness",
        "status": "passed" if passed else "failed",
        "execution_status": "completed",
        "quality_status": "passed" if passed else "failed",
        "evaluation_complete": True,
        "passed": passed,
        "target": {
            "name": "PRReviewAgent",
            "repo_id": str(repo_id) if repo_id else None,
        },
        "evaluation_set": dataset_meta,
        "dataset_sha256": dataset_meta["sha256"],
        "summary_metrics": summary_metrics,
        **summary_metrics,
        "cases": case_results,
    }
