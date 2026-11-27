from __future__ import annotations

from typing import Any

from app.schemas.analysis import PRAcceptanceSummary, PREvidenceGap, PRReviewCitation, PRReviewOutput
from app.services.agents.base import BaseAgent
from app.services.agents.pr_review_heuristics import (
    _AUTH_BYPASS_ADD_TOKENS,
    _AUTH_GUARD_TOKENS,
    _BACKTICK_TOKEN_RE,
    _CONTRACT_TOKENS,
    _DOC_SUFFIXES,
    _HUNK_HEADER_RE,
    _ORM_SCHEMA_TOKENS,
    build_diff_citation,
    build_finding,
    build_test_suggestions,
    estimate_review_confidence,
    evaluate_context_acceptance,
    evaluate_diff_and_context_risks,
    find_migration_files,
    find_risky_files,
    is_doc_file,
    is_test_file,
    normalize_citations,
    resolve_version_ref,
)
from app.services.llm.client import LLMClient
from app.services.llm.prompts import PR_REVIEW_PROMPT
from app.services.pr_acceptance import evaluate_acceptance_report
from app.services.rag.chunking import chunk_pr_files

__all__ = [
    "PRAcceptanceSummary",
    "PREvidenceGap",
    "PRReviewAgent",
    "PRReviewCitation",
    "PRReviewOutput",
    "evaluate_acceptance_report",
]


class PRReviewAgent(BaseAgent):
    name = "pr_review_agent"
    description = "围绕 PR 合入就绪度聚合多源证据引用，按阻塞问题、一般建议与证据不足三类输出审查结论。"
    available_tools = ["get_pull_request_detail", "get_pull_request_files", "chunk_diff"]

    def __init__(self, llm: LLMClient | None = None) -> None:
        self.llm = llm or LLMClient()

    async def run(self, input_data: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        diff_chunks = chunk_pr_files(input_data.get("files", []))
        fallback = self._fallback_review(input_data, context, diff_chunks)
        llm_output = await self.llm.chat_json(
            PR_REVIEW_PROMPT,
            {"pull_request": input_data, "diff_chunks": diff_chunks, "context": context},
        )
        if llm_output:
            try:
                return PRReviewOutput.model_validate(self._merge_with_fallback(llm_output, fallback)).model_dump()
            except Exception:
                pass
        return fallback

    def _fallback_review(
        self,
        input_data: dict[str, Any],
        context: dict[str, Any],
        diff_chunks: list[dict[str, Any]],
    ) -> dict[str, Any]:
        files = input_data.get("files", []) or []
        comments = input_data.get("comments", []) or []
        filenames = [str(item.get("filename") or "") for item in files if item.get("filename")]
        total_additions = sum(int(item.get("additions") or 0) for item in files)
        total_deletions = sum(int(item.get("deletions") or 0) for item in files)
        is_docs_only = bool(filenames) and all(is_doc_file(name) for name in filenames)

        risky_files = find_risky_files(filenames)
        test_files = [name for name in filenames if is_test_file(name)]
        migration_files = find_migration_files(filenames)

        version_ref = resolve_version_ref(input_data, context)
        diff_citations_by_file = {
            str(item.get("filename") or ""): build_diff_citation(item, version_ref=version_ref)
            for item in files
            if item.get("filename")
        }
        primary_diff_citation = next(iter(diff_citations_by_file.values()), None)
        acceptance_eval = evaluate_context_acceptance(context)
        acceptance_summary: PRAcceptanceSummary | None = acceptance_eval["summary"] if acceptance_eval else None

        evaluated = evaluate_diff_and_context_risks(
            input_data=input_data,
            context=context,
            files=files,
            filenames=filenames,
            comments=comments,
            diff_chunks=diff_chunks,
            is_docs_only=is_docs_only,
            risky_files=risky_files,
            test_files=test_files,
            migration_files=migration_files,
            total_additions=total_additions,
            total_deletions=total_deletions,
            diff_citations_by_file=diff_citations_by_file,
            primary_diff_citation=primary_diff_citation,
            version_ref=version_ref,
            acceptance_eval=acceptance_eval,
        )
        review_findings = evaluated["review_findings"]
        blocking_issues = evaluated["blocking_issues"]
        evidence_gaps = evaluated["evidence_gaps"]
        failed_ci = evaluated["failed_ci"]

        merge_recommendation, recommendation_reason = self._choose_recommendation(
            input_data=input_data,
            files=files,
            blocking_issues=blocking_issues,
            evidence_gaps=evidence_gaps,
            failed_ci=failed_ci,
            has_auth_bypass=evaluated["has_auth_bypass"],
        )
        plan = [
            "理解 PR 标题、描述、分支、变更文件和关联上下文。",
            "按模块拆分 diff 风险，提取行级证据锚点并检查权限、契约与数据库迁移。",
            "核查项目文档新鲜度（识别已过期资料）与关联 Issue 上下文。",
            "检查 CI 门禁状态、review comments 与 change-verifier 行为验收报告。",
            "按阻塞问题、一般建议、证据不足三类桶输出合入就绪度结论。",
        ]
        executed_steps = [
            f"已读取 PR #{input_data.get('number')}，状态 {input_data.get('state') or 'unknown'}，作者 {input_data.get('author') or 'unknown'}。",
            f"已扫描 {len(files)} 个变更文件，合计 +{total_additions} / -{total_deletions}。",
            f"已识别 {len(risky_files)} 个敏感文件、{len(test_files)} 个测试文件、{len(comments)} 条 review comment。",
            f"已绑定 {len(diff_citations_by_file)} 条 diff 锚点、{evaluated['doc_citations_count']} 条文档引用（过期 {evaluated['stale_doc_gaps_count']} 条）、{failed_ci} 个失败 CI 信号"
            + (f"，并纳入验收任务「{acceptance_summary.task_name}」。" if acceptance_summary else "。"),
            f"已输出结论：{merge_recommendation}（阻塞问题 {sum(bool(f.get('blocking')) for f in review_findings)} 项，证据不足 {len(evidence_gaps)} 项）。",
        ]
        return PRReviewOutput(
            summary=f"PR #{input_data.get('number')} 修改了 {len(files)} 个文件，主要集中在 {', '.join(filenames[:3]) or '未提供文件'}。",
            plan=plan,
            executed_steps=executed_steps,
            merge_recommendation=merge_recommendation,
            recommendation_reason=recommendation_reason,
            review_findings=review_findings,
            evidence_gaps=evidence_gaps,
            citations=[*diff_citations_by_file.values(), *evaluated["context_citations"]],
            acceptance_summary=acceptance_summary,
            key_changes=[f"更新 {name}" for name in filenames[:5]],
            risk_points=list(dict.fromkeys(evaluated["risk_points"])) if files else ["缺少 changed files，风险判断有限"],
            blocking_issues=blocking_issues,
            review_checklist=["确认接口兼容性", "确认错误处理路径", "确认测试覆盖关键分支", "确认 review comments 已回应"],
            test_suggestions=build_test_suggestions(filenames, risky_files, failed_ci),
            files_need_attention=(risky_files or filenames)[:5],
            review_comments=[str(c.get("body") or "").strip() for c in comments[:5] if str(c.get("body") or "").strip()],
            confidence=estimate_review_confidence(files, context, failed_ci, blocking_issues, evidence_gaps, acceptance_summary),
        ).model_dump()

    def _merge_with_fallback(self, output: dict[str, Any], fallback: dict[str, Any]) -> dict[str, Any]:
        merged = {**fallback, **output}
        for key in (
            "plan", "executed_steps", "review_findings", "key_changes", "risk_points",
            "blocking_issues", "review_checklist", "test_suggestions", "files_need_attention", "review_comments",
        ):
            if not merged.get(key):
                merged[key] = fallback[key]
        for key in ("merge_recommendation", "recommendation_reason", "summary"):
            if not str(merged.get(key) or "").strip():
                merged[key] = fallback[key]

        merged["acceptance_summary"] = fallback.get("acceptance_summary") or merged.get("acceptance_summary")
        normalized_findings = self._normalize_review_findings(merged.get("review_findings"), fallback)

        existing_ids = {item.get("finding_id") for item in normalized_findings if item.get("finding_id")}
        for fb_item in fallback.get("review_findings") or []:
            if str(fb_item.get("finding_id") or "").startswith("acceptance-") and fb_item.get("finding_id") not in existing_ids:
                normalized_findings.insert(0, fb_item)

        merged["review_findings"] = normalized_findings
        merged["evidence_gaps"] = self._merge_evidence_gaps(merged.get("evidence_gaps"), fallback.get("evidence_gaps"))
        merged["citations"] = [*fallback.get("citations", []), *(merged.get("citations") or [])]
        merged["blocking_issues"] = self._blocking_issues_from_findings(merged.get("blocking_issues"), merged["review_findings"])

        if merged["blocking_issues"] and merged.get("merge_recommendation") == "建议合入":
            merged["merge_recommendation"] = "修改后合入"
            merged["recommendation_reason"] = "存在 P1/P2 审查发现，完成修复或确认后才能放行。"
        elif not merged["blocking_issues"] and merged["evidence_gaps"] and merged.get("merge_recommendation") == "建议合入":
            merged["merge_recommendation"] = "暂缓"
            gap_titles = "、".join(str(item.get("title") or "") for item in merged["evidence_gaps"][:2] if item.get("title"))
            merged["recommendation_reason"] = f"存在待补齐的验证证据缺口（{gap_titles}），补齐前暂缓合入。"
        return merged

    def _normalize_review_findings(self, items: Any, fallback: dict[str, Any]) -> list[dict[str, Any]]:
        source = items if isinstance(items, list) and items else fallback.get("review_findings") or []
        fallback_citations = [item for item in (fallback.get("citations") or []) if isinstance(item, dict)]
        normalized: list[dict[str, Any]] = []
        for index, item in enumerate(source, start=1):
            if not isinstance(item, dict):
                continue
            severity = str(item.get("severity") or "").strip().upper()
            if severity not in {"P1", "P2", "P3"}:
                severity = "P3"
            title = str(item.get("title") or item.get("summary") or item.get("message") or "").strip()
            evidence = str(item.get("evidence") or item.get("reason") or item.get("description") or "").strip()
            required_action = str(item.get("required_action") or item.get("action") or item.get("recommendation") or "").strip()
            if not title and not evidence:
                continue
            raw_blocking = item.get("blocking")
            blocking = severity in {"P1", "P2"} if raw_blocking is None else raw_blocking is True
            citations = normalize_citations(item.get("citations"), fallback_citations, f"{title} {evidence}")
            normalized.append(
                build_finding(
                    severity,
                    title or evidence[:80],
                    evidence or title,
                    required_action or "请补充可复核的处理说明。",
                    blocking=blocking,
                    citations=citations,
                    finding_id=str(item.get("finding_id") or f"finding-{index}"),
                )
            )
        return normalized or fallback.get("review_findings") or []

    def _merge_evidence_gaps(self, llm_gaps: Any, fallback_gaps: Any) -> list[dict[str, Any]]:
        merged: list[dict[str, Any]] = []
        seen_titles: set[str] = set()
        for raw in [*(fallback_gaps or []), *(llm_gaps if isinstance(llm_gaps, list) else [])]:
            if not isinstance(raw, dict):
                continue
            title = str(raw.get("title") or "").strip()
            description = str(raw.get("description") or raw.get("reason") or title).strip()
            if not title or title in seen_titles:
                continue
            seen_titles.add(title)
            merged.append(
                PREvidenceGap(
                    gap_id=str(raw.get("gap_id") or f"gap-{len(merged) + 1}"),
                    category=str(raw.get("category") or "other"),
                    title=title,
                    description=description,
                    required_evidence=str(raw.get("required_evidence") or "补充可复核的验证记录。"),
                    locator=str(raw["locator"]) if raw.get("locator") else None,
                    citations=normalize_citations(raw.get("citations"), [], title),
                ).model_dump()
            )
        return merged

    def _blocking_issues_from_findings(self, blocking_issues: Any, review_findings: list[dict[str, Any]]) -> list[str]:
        rows = [str(item).strip() for item in blocking_issues or [] if str(item).strip()]
        for finding in review_findings:
            if finding.get("blocking"):
                action = str(finding.get("required_action") or "").strip()
                title = str(finding.get("title") or "").strip()
                message = f"{title}：{action}" if title and action else title or action
                if message:
                    rows.append(message)
        return list(dict.fromkeys(rows))

    def _choose_recommendation(
        self,
        *,
        input_data: dict[str, Any],
        files: list[dict[str, Any]],
        blocking_issues: list[str],
        evidence_gaps: list[dict[str, Any]],
        failed_ci: int,
        has_auth_bypass: bool = False,
    ) -> tuple[str, str]:
        state = str(input_data.get("state") or "").lower()
        text = f"{input_data.get('title', '')} {input_data.get('body', '')}".lower()
        if state == "closed" and not input_data.get("merged_at"):
            return "拒绝", "PR 已关闭且没有合并记录，当前不建议继续合入。"
        if any(token in text for token in ("do not merge", "wip", "draft", "blocked", "暂缓", "不要合并")):
            return "暂缓", "PR 描述中存在 WIP/blocked/暂缓信号，需要等待作者更新。"
        if failed_ci:
            return "暂缓", "存在失败 CI 信号，合并前需要先确认根因并恢复质量门禁。"
        if not files:
            return "暂缓", "缺少 changed files，无法判断真实影响范围。"
        if has_auth_bypass:
            return "修改后合入", "检测到权限或认证校验被削弱的阻断性风险，必须修复并补充越权测试后再重新审查。"
        if blocking_issues:
            return "修改后合入", "存在可定位的阻塞问题，完成修复与验证补充后可重新评估。"
        if evidence_gaps:
            gap_summary = "、".join(str(item.get("title") or "") for item in evidence_gaps[:2] if item.get("title"))
            return "暂缓", f"未发现直接功能回归，但关键验证证据不足（{gap_summary}），补齐前暂缓合入。"
        return "建议合入", "未发现阻塞问题且验证证据齐备，按 checklist 完成最终确认后可以合入。"
