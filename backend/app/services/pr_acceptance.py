from __future__ import annotations

import hashlib
import json
import re
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.db.models import AnalysisResult, PullRequest, User
from app.schemas.analysis import PRAcceptanceSummary, PRReviewCitation
from app.schemas.pull_requests import AcceptanceReportIngestRequest, AcceptanceReportResponse
from app.services.permissions import write_audit_log

ACCEPTANCE_ANALYSIS_TYPE = "pr_acceptance_report"

_SENSITIVE_KEYS = {
    "authorization",
    "cookie",
    "set-cookie",
    "x-api-key",
    "password",
    "passwd",
    "secret",
    "client_secret",
    "api_key",
    "apikey",
    "access_token",
    "refresh_token",
    "private_key",
}
_BEARER_RE = re.compile(r"\b(Bearer|Basic)\s+(?!\[REDACTED\])[A-Za-z0-9._~+/=-]{6,}", re.IGNORECASE)

_LABEL_TO_CODE = {
    "回归": "regression",
    "原有行为回归": "regression",
    "未满足": "not_met",
    "新需求未满足": "not_met",
    "无法判断": "unverifiable",
    "无法验证": "unverifiable",
    "预期行为变化": "expected_change",
    "预期变化": "expected_change",
    "预期变更": "expected_change",
    "已满足": "satisfied",
    "新需求已满足": "satisfied",
    "保持一致": "kept",
    "保持原有行为": "kept",
    "通过": "satisfied",
}

_CODE_LABELS = {
    "regression": "回归",
    "not_met": "新需求未满足",
    "unverifiable": "无法判断",
    "expected_change": "预期行为变化",
    "satisfied": "已满足",
    "kept": "保持一致",
    "unchanged": "保持一致",
    "passed": "通过",
}


def redact_acceptance_payload(value: Any) -> Any:
    if isinstance(value, dict):
        redacted: dict[str, Any] = {}
        for key, item in value.items():
            lowered = str(key).strip().lower()
            if lowered in _SENSITIVE_KEYS:
                redacted[key] = "[REDACTED]"
            else:
                redacted[key] = redact_acceptance_payload(item)
        return redacted
    if isinstance(value, list):
        return [redact_acceptance_payload(item) for item in value]
    if isinstance(value, str):
        return _BEARER_RE.sub(r"\1 [REDACTED]", value)
    return value


def _classify_check_code(raw_classification: Any) -> tuple[str, str, str]:
    if isinstance(raw_classification, str):
        raw_text = raw_classification.strip()
        code = _LABEL_TO_CODE.get(raw_text, raw_text.lower())
        label = _CODE_LABELS.get(code, raw_text or "未知")
        return code, label, ""
    if isinstance(raw_classification, dict):
        raw_code = str(
            raw_classification.get("code")
            or raw_classification.get("kind")
            or raw_classification.get("status")
            or ""
        ).strip()
        raw_label = str(raw_classification.get("label") or "").strip()
        reason = str(raw_classification.get("reason") or "").strip()
        code = raw_code.lower() if raw_code else _LABEL_TO_CODE.get(raw_label, "")
        label = raw_label or _CODE_LABELS.get(code, code or "未知")
        return code, label, reason
    return "", "未知", ""


def _check_snippet(check: dict[str, Any], label: str, reason: str) -> str:
    parts: list[str] = []
    if label or reason:
        parts.append(f"判定：{label}" + (f" —— {reason}" if reason else ""))
    diff_summary = str(check.get("diff_summary") or "").strip()
    if diff_summary:
        parts.append(f"前后对比：{diff_summary}")
    expected_ref = str(check.get("expected_change_ref") or "").strip()
    if expected_ref:
        parts.append(f"变更依据：{expected_ref}")
    expectation = str(check.get("expectation") or "").strip()
    if expectation and not parts:
        parts.append(f"期望：{expectation}")
    return "；".join(parts)[:320] or f"验收检查项 {check.get('id') or check.get('name') or 'check'}"


def evaluate_acceptance_report(raw_payload: dict[str, Any], *, ingested_at: str | None = None) -> dict[str, Any]:
    report_dict = raw_payload.get("report") if isinstance(raw_payload.get("report"), dict) and "report_version" in raw_payload["report"] else raw_payload
    validated = AcceptanceReportIngestRequest.model_validate(redact_acceptance_payload(report_dict))
    normalized_report = validated.model_dump(mode="json")

    task = normalized_report["task"]
    rule_version = normalized_report["rule_version"]
    run = normalized_report["run"]
    raw_summary = normalized_report.get("summary") or {}
    checks = normalized_report.get("checks") or []

    rule_ver = rule_version.get("version")
    rule_status = str(rule_version.get("status") or "draft").strip().lower()
    run_id = run.get("id")
    run_status = str(run.get("status") or "unknown").strip().lower()
    version_ref = f"rule:v{rule_ver}@run:{run_id}"

    computed_counts: dict[str, int] = {}
    blocking_findings: list[dict[str, Any]] = []
    evidence_gaps: list[dict[str, Any]] = []
    positive_proofs: list[PRReviewCitation] = []
    blocking_check_ids: list[str] = []
    evidence_gap_ids: list[str] = []
    positive_check_ids: list[str] = []
    has_expected_change = False

    if rule_status != "confirmed":
        rule_locator = f"rule:v{rule_ver}"
        rule_citation = PRReviewCitation(
            source_type="acceptance_report",
            title=f"验收规则 v{rule_ver}（{rule_status}）",
            locator=rule_locator,
            snippet=f"任务「{task['name']}」关联的验收规则版本 v{rule_ver} 当前状态为 {rule_status}，尚未人工确认。",
            version_ref=version_ref,
            stale=False,
        )
        evidence_gaps.append(
            {
                "gap_id": f"gap-rule-v{rule_ver}",
                "category": "draft_acceptance_rules",
                "title": "行为验收规则仍为草稿状态",
                "description": f"change-verifier 验收任务「{task['name']}」使用的规则版本 v{rule_ver} 状态为 {rule_status}，未经人工确认的规则不能单独作为合入放行依据。",
                "required_evidence": "在 change-verifier 中确认规则版本（status=confirmed）后重新运行候选环境验收。",
                "locator": rule_locator,
                "citations": [rule_citation.model_dump()],
            }
        )
        evidence_gap_ids.append(rule_locator)

    for index, check in enumerate(checks, start=1):
        if not isinstance(check, dict):
            continue
        check_id = str(check.get("id") or f"check-{index}").strip()
        check_name = str(check.get("name") or check_id).strip()
        code, label, reason = _classify_check_code(check.get("classification"))
        if code:
            computed_counts[code] = computed_counts.get(code, 0) + 1
        locator = f"check:{check_id}"
        snippet = _check_snippet(check, label, reason)
        citation = PRReviewCitation(
            source_type="acceptance_report",
            title=f"{check_name}（{label}）",
            locator=locator,
            snippet=snippet,
            version_ref=version_ref,
            stale=False,
        )

        if code in {"regression", "not_met"}:
            blocking_check_ids.append(check_id)
            finding_title = (
                f"行为验收检出回归：{check_name}"
                if code == "regression"
                else f"新需求行为验收未达标：{check_name}"
            )
            blocking_findings.append(
                {
                    "finding_id": f"acceptance-{check_id}",
                    "severity": "P1",
                    "title": finding_title,
                    "evidence": snippet,
                    "required_action": f"修复检查项 `{check_id}` 暴露的接口行为偏差，并重新执行 change-verifier 验收。",
                    "blocking": True,
                    "citations": [citation.model_dump()],
                }
            )
        elif code == "unverifiable":
            evidence_gap_ids.append(check_id)
            evidence_gaps.append(
                {
                    "gap_id": f"gap-check-{check_id}",
                    "category": "unverifiable_check",
                    "title": f"行为验收项无法判定：{check_name}",
                    "description": f"检查项 `{check_id}` 返回无法判断（unverifiable）：{reason or snippet}",
                    "required_evidence": f"恢复基准/候选环境依赖或预置数据后重新验证 `{check_id}`。",
                    "locator": locator,
                    "citations": [citation.model_dump()],
                }
            )
        elif code in {"expected_change", "satisfied", "kept", "unchanged", "passed"}:
            positive_check_ids.append(check_id)
            positive_proofs.append(citation)
            if code == "expected_change":
                has_expected_change = True

    if run_status in {"failed", "error"} and not blocking_findings and not checks:
        run_locator = f"run:{run_id}"
        run_error = str(run.get("error") or f"验收运行状态异常：{run_status}")
        run_citation = PRReviewCitation(
            source_type="acceptance_report",
            title=f"验收运行 #{run_id}",
            locator=run_locator,
            snippet=run_error[:280],
            version_ref=version_ref,
            stale=False,
        )
        evidence_gaps.append(
            {
                "gap_id": f"gap-run-{run_id}",
                "category": "unverifiable_check",
                "title": "行为验收运行未正常完成",
                "description": f"验收运行 `{run_id}` 状态为 {run_status}：{run_error}",
                "required_evidence": "排查验收运行异常并生成完整的检查项对比结果。",
                "locator": run_locator,
                "citations": [run_citation.model_dump()],
            }
        )
        evidence_gap_ids.append(run_locator)

    raw_counts = raw_summary.get("counts") if isinstance(raw_summary.get("counts"), dict) else {}
    merged_counts = {**computed_counts, **{str(k): int(v) for k, v in raw_counts.items() if isinstance(v, (int, float))}}
    total_checks = int(raw_summary.get("total_checks") if isinstance(raw_summary.get("total_checks"), int) else len(checks))
    executed_checks = int(raw_summary.get("executed_checks") if isinstance(raw_summary.get("executed_checks"), int) else len(checks))
    headline = str(raw_summary.get("headline") or "").strip()
    if not headline:
        if blocking_check_ids:
            headline = f"检出 {len(blocking_check_ids)} 项阻断性行为偏差"
        elif evidence_gap_ids:
            headline = f"存在 {len(evidence_gap_ids)} 项待补齐的行为验收证据缺口"
        else:
            headline = f"全部 {executed_checks} 项行为验收检查通过"

    effective_ingested_at = ingested_at or raw_payload.get("ingested_at") or normalized_report.get("generated_at")
    summary_model = PRAcceptanceSummary(
        report_version=1,
        task_id=task.get("id"),
        task_name=str(task.get("name") or ""),
        rule_version=rule_ver,
        rule_status=rule_status,
        run_id=run_id,
        run_status=run_status,
        headline=headline,
        counts=merged_counts,
        total_checks=total_checks,
        executed_checks=executed_checks,
        positive_proofs=positive_proofs,
        ingested_at=effective_ingested_at,
    )

    canonical_bytes = json.dumps(normalized_report, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    report_sha256 = hashlib.sha256(canonical_bytes).hexdigest()

    return {
        "report": normalized_report,
        "report_sha256": report_sha256,
        "summary": summary_model,
        "blocking_findings": blocking_findings,
        "evidence_gaps": evidence_gaps,
        "positive_proofs": [item.model_dump() for item in positive_proofs],
        "blocking_check_ids": blocking_check_ids,
        "evidence_gap_ids": evidence_gap_ids,
        "positive_check_ids": positive_check_ids,
        "has_confirmed_expected_change": rule_status == "confirmed" and has_expected_change and not blocking_check_ids,
        "has_confirmed_positive_proof": rule_status == "confirmed" and bool(positive_check_ids) and not blocking_check_ids and not evidence_gap_ids,
    }


def ingest_pr_acceptance_report(
    db: Session,
    pr: PullRequest,
    raw_payload: dict[str, Any],
    *,
    user: User | None = None,
) -> AcceptanceReportResponse:
    now_dt = datetime.now(UTC)
    ingested_at = now_dt.isoformat()
    evaluated = evaluate_acceptance_report(raw_payload, ingested_at=ingested_at)
    summary: PRAcceptanceSummary = evaluated["summary"]

    stored_json = {
        "ingested_at": ingested_at,
        "report_sha256": evaluated["report_sha256"],
        "summary": summary.model_dump(mode="json"),
        "blocking_check_ids": evaluated["blocking_check_ids"],
        "evidence_gap_ids": evaluated["evidence_gap_ids"],
        "positive_check_ids": evaluated["positive_check_ids"],
        "report": evaluated["report"],
    }
    record = AnalysisResult(
        target_type="pull_request",
        target_id=pr.id,
        analysis_type=ACCEPTANCE_ANALYSIS_TYPE,
        input_snapshot={
            "pr_id": str(pr.id),
            "pr_number": pr.number,
            "report_version": 1,
            "report_sha256": evaluated["report_sha256"],
            "rule_status": summary.rule_status,
            "run_status": summary.run_status,
        },
        result_json=stored_json,
        model_name="change-verifier/v1",
        created_at=now_dt,
    )
    db.add(record)
    write_audit_log(
        db,
        user=user,
        repo_id=pr.repo_id,
        action="pull_request.acceptance_report.ingest",
        target_type="pull_request",
        target_id=str(pr.id),
        request_json={
            "pr_number": pr.number,
            "task_name": summary.task_name,
            "rule_version": summary.rule_version,
            "rule_status": summary.rule_status,
            "report_sha256": evaluated["report_sha256"],
        },
        result_json={
            "blocking_checks": len(evaluated["blocking_check_ids"]),
            "evidence_gaps": len(evaluated["evidence_gap_ids"]),
            "positive_checks": len(evaluated["positive_check_ids"]),
        },
    )
    db.commit()
    db.refresh(record)
    return AcceptanceReportResponse(
        pr_id=pr.id,
        record_id=record.id,
        ingested_at=ingested_at,
        report_sha256=evaluated["report_sha256"],
        summary=summary,
        blocking_check_ids=evaluated["blocking_check_ids"],
        evidence_gap_ids=evaluated["evidence_gap_ids"],
        positive_check_ids=evaluated["positive_check_ids"],
        report=evaluated["report"],
    )


def get_latest_pr_acceptance_report(db: Session, pr_id: UUID) -> AcceptanceReportResponse | None:
    row = (
        db.query(AnalysisResult)
        .filter(
            AnalysisResult.target_type == "pull_request",
            AnalysisResult.target_id == pr_id,
            AnalysisResult.analysis_type == ACCEPTANCE_ANALYSIS_TYPE,
        )
        .order_by(AnalysisResult.created_at.desc())
        .first()
    )
    if row is None:
        return None
    payload = row.result_json or {}
    ingested_at = str(payload.get("ingested_at") or (row.created_at.isoformat() if row.created_at else ""))
    summary = PRAcceptanceSummary.model_validate(payload.get("summary") or {})
    return AcceptanceReportResponse(
        pr_id=pr_id,
        record_id=row.id,
        ingested_at=ingested_at,
        report_sha256=str(payload.get("report_sha256") or ""),
        summary=summary,
        blocking_check_ids=[str(item) for item in payload.get("blocking_check_ids") or []],
        evidence_gap_ids=[str(item) for item in payload.get("evidence_gap_ids") or []],
        positive_check_ids=[str(item) for item in payload.get("positive_check_ids") or []],
        report=payload.get("report") or {},
    )
