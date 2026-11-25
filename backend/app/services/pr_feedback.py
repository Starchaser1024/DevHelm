from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.db.models import ActionDraft, AnalysisResult, PullRequest, User
from app.schemas.analysis import PREvidenceGap, PRReviewCitation, PRReviewFinding, PRReviewOutput
from app.schemas.pull_requests import PRCommentDraftRequest, PRFeedbackCreateRequest, PRFeedbackResponse
from app.services.agents.safety_agent import SafetyAgent
from app.services.permissions import write_audit_log

PR_FEEDBACK_ANALYSIS_TYPE = "pr_review_feedback"
PR_COMMENT_DRAFT_TYPE = "post_pr_review_comment"


def _resolve_pr_analysis(db: Session, pr_id: UUID, analysis_id: UUID | str | None) -> AnalysisResult | None:
    query = db.query(AnalysisResult).filter(
        AnalysisResult.target_type == "pull_request",
        AnalysisResult.target_id == pr_id,
        AnalysisResult.analysis_type == "pr_review",
    )
    if analysis_id is not None:
        try:
            target_uuid = analysis_id if isinstance(analysis_id, UUID) else UUID(str(analysis_id))
        except ValueError:
            return None
        return query.filter(AnalysisResult.id == target_uuid).one_or_none()
    return query.order_by(AnalysisResult.created_at.desc()).first()


def _format_citation_tag(citation: PRReviewCitation) -> str:
    stale_tag = " · ⚠️ 已过期资料" if citation.stale else ""
    version_tag = f" ({citation.version_ref})" if citation.version_ref else ""
    return f"`[{citation.source_type} -> {citation.locator}]`{version_tag}{stale_tag}"


def _select_findings(
    findings: list[PRReviewFinding],
    confirmed_ids: list[str] | None,
    confirmed_indices: list[int] | None,
) -> list[PRReviewFinding]:
    if confirmed_ids is None and confirmed_indices is None:
        return list(findings)
    id_set = {str(item).strip() for item in (confirmed_ids or []) if str(item).strip()}
    index_set = {int(idx) for idx in (confirmed_indices or []) if isinstance(idx, int) and idx >= 0}
    selected: list[PRReviewFinding] = []
    for index, finding in enumerate(findings):
        if finding.finding_id in id_set or index in index_set:
            selected.append(finding)
    return selected


def _select_gaps(gaps: list[PREvidenceGap], confirmed_gap_ids: list[str] | None) -> list[PREvidenceGap]:
    if confirmed_gap_ids is None:
        return list(gaps)
    id_set = {str(item).strip() for item in confirmed_gap_ids if str(item).strip()}
    return [gap for gap in gaps if gap.gap_id in id_set]


def format_pr_review_comment_markdown(
    *,
    pr: PullRequest,
    verdict: str,
    reason: str,
    blocking_findings: list[PRReviewFinding],
    advisory_findings: list[PRReviewFinding],
    evidence_gaps: list[PREvidenceGap],
    reviewer_note: str | None = None,
) -> str:
    lines: list[str] = [
        f"## PR #{pr.number} 合入就绪度审查意见：{verdict}",
        "",
        f"- **综合判断**：{reason or '已按变更文件、CI 状态与上下文证据完成审查。'}",
    ]
    if reviewer_note and reviewer_note.strip():
        lines.append(f"- **人工复核备注**：{reviewer_note.strip()}")
    lines.append("")

    lines.append(f"### 阻塞问题（{len(blocking_findings)}）")
    lines.append("")
    if blocking_findings:
        for finding in blocking_findings:
            anchors = "、".join(_format_citation_tag(c) for c in finding.citations) or "`[未绑定锚点]`"
            lines.append(f"- **[{finding.severity}] {finding.title}**")
            lines.append(f"  - 证据：{finding.evidence}")
            lines.append(f"  - 要求动作：{finding.required_action}")
            lines.append(f"  - 证据锚点：{anchors}")
    else:
        lines.append("- 无已确认的阻塞问题。")
    lines.append("")

    lines.append(f"### 一般建议（{len(advisory_findings)}）")
    lines.append("")
    if advisory_findings:
        for finding in advisory_findings:
            anchors = "、".join(_format_citation_tag(c) for c in finding.citations) or "`[未绑定锚点]`"
            lines.append(f"- **[{finding.severity}] {finding.title}**：{finding.evidence}（锚点：{anchors}）")
    else:
        lines.append("- 无额外非阻塞建议。")
    lines.append("")

    lines.append(f"### 证据不足项（{len(evidence_gaps)}）")
    lines.append("")
    if evidence_gaps:
        for gap in evidence_gaps:
            anchors = (
                "、".join(_format_citation_tag(c) for c in gap.citations)
                if gap.citations
                else (f"`[{gap.locator}]`" if gap.locator else "`[待补充定位]`")
            )
            lines.append(f"- **{gap.title}**（`{gap.category}`）")
            lines.append(f"  - 缺口说明：{gap.description}")
            if gap.required_evidence:
                lines.append(f"  - 待补证据：{gap.required_evidence}")
            lines.append(f"  - 关联定位：{anchors}")
    else:
        lines.append("- 当前验证证据齐备，无待补缺口。")

    return "\n".join(lines).strip() + "\n"


async def create_pr_comment_draft(
    db: Session,
    pr: PullRequest,
    payload: PRCommentDraftRequest,
    *,
    user: User | None = None,
) -> ActionDraft:
    if not payload.reviewer_confirmed:
        raise ValueError("生成 PR 评论草稿前必须经过审查人确认（reviewer_confirmed=true）")

    analysis_row = _resolve_pr_analysis(db, pr.id, payload.analysis_id)
    if analysis_row is None:
        raise LookupError("请先运行 PR 合入就绪度分析，再确认生成评论草稿")

    parsed = PRReviewOutput.model_validate(analysis_row.result_json or {})
    selected_findings = _select_findings(
        parsed.review_findings,
        payload.confirmed_finding_ids,
        payload.confirmed_finding_indices,
    )
    selected_blocking = [item for item in selected_findings if item.blocking]
    selected_advisory = [item for item in selected_findings if not item.blocking]
    selected_gaps = _select_gaps(parsed.evidence_gaps, payload.confirmed_gap_ids)
    verdict = payload.confirmed_merge_recommendation or parsed.merge_recommendation

    markdown = format_pr_review_comment_markdown(
        pr=pr,
        verdict=verdict,
        reason=parsed.recommendation_reason,
        blocking_findings=selected_blocking,
        advisory_findings=selected_advisory,
        evidence_gaps=selected_gaps,
        reviewer_note=payload.reviewer_note,
    )

    safety = await SafetyAgent().run(
        {"action": PR_COMMENT_DRAFT_TYPE, "draft": markdown},
        {"pr_id": str(pr.id), "verdict": verdict},
    )
    risk_level = str(safety.get("risk_level") or "medium")
    if verdict == "拒绝" or any(item.severity == "P1" for item in selected_blocking):
        risk_level = "high"

    title = f"PR #{pr.number} 审查意见（{verdict}）"
    draft = ActionDraft(
        repo_id=pr.repo_id,
        draft_type=PR_COMMENT_DRAFT_TYPE,
        target_type="pull_request",
        target_id=pr.id,
        title=title,
        content=markdown,
        risk_level=risk_level,
        status="pending_confirmation",
        created_by=user.id if user else None,
        meta={
            "action_type": PR_COMMENT_DRAFT_TYPE,
            "pr_id": str(pr.id),
            "pr_number": pr.number,
            "analysis_id": str(analysis_row.id),
            "confirmed_merge_recommendation": verdict,
            "confirmed_finding_ids": [item.finding_id for item in selected_findings],
            "confirmed_gap_ids": [gap.gap_id for gap in selected_gaps],
            "requires_confirmation": bool(safety.get("requires_confirmation", True)),
            "safety_reason": str(safety.get("reason") or ""),
        },
    )
    db.add(draft)
    write_audit_log(
        db,
        user=user,
        repo_id=pr.repo_id,
        action="pull_request.comment_draft.create",
        target_type="pull_request",
        target_id=str(pr.id),
        request_json={
            "pr_number": pr.number,
            "analysis_id": str(analysis_row.id),
            "verdict": verdict,
            "confirmed_finding_ids": [item.finding_id for item in selected_findings],
            "confirmed_gap_ids": [gap.gap_id for gap in selected_gaps],
        },
        result_json={"risk_level": risk_level, "draft_type": PR_COMMENT_DRAFT_TYPE},
    )
    db.commit()
    db.refresh(draft)
    return draft


def record_pr_feedback(
    db: Session,
    pr: PullRequest,
    payload: PRFeedbackCreateRequest,
    *,
    pr_payload: dict[str, Any],
    context_snapshot: dict[str, Any] | None = None,
    user: User | None = None,
) -> PRFeedbackResponse:
    analysis_row = _resolve_pr_analysis(db, pr.id, payload.analysis_id)
    analysis_output = (analysis_row.result_json or {}) if analysis_row else {}
    now_dt = datetime.now(UTC)
    created_at_iso = now_dt.isoformat()

    # Derive sensible ground-truth defaults when reviewer labels useful / false_positive / missed_issue
    expected_verdict = payload.expected_merge_recommendation
    expected_blocking = payload.expected_blocking
    if expected_blocking is None:
        if payload.label == "false_positive":
            expected_blocking = False
        elif payload.label == "missed_issue":
            expected_blocking = True
        elif analysis_output:
            expected_blocking = bool(analysis_output.get("blocking_findings") or analysis_output.get("blocking_issues"))

    if expected_verdict is None:
        if payload.label == "false_positive":
            expected_verdict = "建议合入"
        elif payload.label == "missed_issue":
            expected_verdict = "修改后合入"
        elif analysis_output.get("merge_recommendation") in {"建议合入", "修改后合入", "暂缓", "拒绝"}:
            expected_verdict = analysis_output["merge_recommendation"]

    ctx = context_snapshot or {}
    compact_context = {
        "ci_summary": ctx.get("ci_summary"),
        "project_documents": (ctx.get("project_documents") or [])[:4],
        "related_issues": (ctx.get("related_issues") or [])[:3],
        "acceptance_report": ctx.get("acceptance_report"),
    }

    feedback_data = {
        "pr_id": str(pr.id),
        "pr_number": pr.number,
        "repo_id": str(pr.repo_id),
        "analysis_id": str(analysis_row.id) if analysis_row else None,
        "label": payload.label,
        "finding_id": (payload.finding_id or "").strip() or None,
        "expected_merge_recommendation": expected_verdict,
        "expected_blocking": expected_blocking,
        "missed_issue_title": (payload.missed_issue_title or "").strip() or None,
        "expected_locator": (payload.expected_locator or "").strip() or None,
        "note": (payload.note or "").strip() or None,
        "created_at": created_at_iso,
    }

    row = AnalysisResult(
        target_type="pull_request",
        target_id=pr.id,
        analysis_type=PR_FEEDBACK_ANALYSIS_TYPE,
        input_snapshot={
            "repo_id": str(pr.repo_id),
            "pr_id": str(pr.id),
            "pr_number": pr.number,
            "pull_request": pr_payload,
            "context": compact_context,
            "analysis_snapshot": {
                "merge_recommendation": analysis_output.get("merge_recommendation"),
                "blocking_count": len(analysis_output.get("blocking_findings") or []),
                "gap_count": len(analysis_output.get("evidence_gaps") or []),
            },
        },
        result_json=feedback_data,
        model_name="human-reviewer",
        created_at=now_dt,
    )
    db.add(row)
    write_audit_log(
        db,
        user=user,
        repo_id=pr.repo_id,
        action="pull_request.feedback.create",
        target_type="pull_request",
        target_id=str(pr.id),
        request_json={
            "pr_number": pr.number,
            "label": payload.label,
            "finding_id": feedback_data["finding_id"],
            "missed_issue_title": feedback_data["missed_issue_title"],
        },
        result_json={"expected_blocking": expected_blocking, "expected_verdict": expected_verdict},
    )
    db.commit()
    db.refresh(row)
    return PRFeedbackResponse(id=row.id, **feedback_data)


def list_pr_feedback(db: Session, pr_id: UUID) -> list[PRFeedbackResponse]:
    rows = (
        db.query(AnalysisResult)
        .filter(
            AnalysisResult.target_type == "pull_request",
            AnalysisResult.target_id == pr_id,
            AnalysisResult.analysis_type == PR_FEEDBACK_ANALYSIS_TYPE,
        )
        .order_by(AnalysisResult.created_at.desc())
        .all()
    )
    output: list[PRFeedbackResponse] = []
    for row in rows:
        data = dict(row.result_json or {})
        if not data.get("label"):
            continue
        data.setdefault("created_at", row.created_at.isoformat() if row.created_at else "")
        output.append(PRFeedbackResponse(id=row.id, **data))
    return output
