from __future__ import annotations

import hashlib
import re
from pathlib import Path
from typing import Any

from app.schemas.analysis import PRAcceptanceSummary, PREvidenceGap, PRReviewCitation, PRReviewOutput
from app.services.agents.base import BaseAgent
from app.services.llm.client import LLMClient
from app.services.llm.prompts import PR_REVIEW_PROMPT
from app.services.pr_acceptance import evaluate_acceptance_report
from app.services.rag.chunking import chunk_pr_files

_HUNK_HEADER_RE = re.compile(r"@@\s*-\d+(?:,\d+)?\s+\+(\d+)(?:,(\d+))?\s*@@")
_BACKTICK_TOKEN_RE = re.compile(r"`([A-Za-z0-9_./:-]{5,})`")
_DOC_SUFFIXES = {".md", ".markdown", ".mdx", ".rst", ".txt", ".adoc"}
_AUTH_GUARD_TOKENS = (
    "require_permission",
    "verify_token",
    "get_current_user",
    "check_permission",
    "is_authenticated",
    "ensure_authorized",
    "owner_id ==",
    "user_id ==",
    "tenant_id ==",
)
_AUTH_BYPASS_ADD_TOKENS = (
    "skip_auth = true",
    "allow_anonymous = true",
    "bypass_auth = true",
    "disable_auth = true",
)
_CONTRACT_TOKENS = (
    "next_cursor",
    "page_size",
    "total_count",
    "has_more",
    "pagination",
    "response_model",
)
_ORM_SCHEMA_TOKENS = (
    "mapped_column(",
    "column(",
    "foreignkey(",
    "__tablename__",
    "uniqueconstraint(",
)


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
        is_docs_only = bool(filenames) and all(self._is_doc_file(name) for name in filenames)

        risky_files = [
            name
            for name in filenames
            if not self._is_test_file(name)
            and not self._is_doc_file(name)
            and any(
                token in name.lower()
                for token in ["auth", "security", "migration", "schema", "payment", "permission", "config", "ci", "workflow"]
            )
        ]
        test_files = [name for name in filenames if self._is_test_file(name)]
        migration_files = [
            name
            for name in filenames
            if "migrations/versions/" in name.replace("\\", "/").lower() or "alembic/versions/" in name.replace("\\", "/").lower()
        ]
        total_patch_chars = sum(len(str(item.get("patch") or "")) for item in files)

        version_ref = self._resolve_version_ref(input_data, context)
        diff_citations_by_file = {
            str(item.get("filename") or ""): self._build_diff_citation(item, version_ref=version_ref)
            for item in files
            if item.get("filename")
        }
        primary_diff_citation = next(iter(diff_citations_by_file.values()), None)

        acceptance_eval = self._evaluate_context_acceptance(context)
        acceptance_summary: PRAcceptanceSummary | None = acceptance_eval["summary"] if acceptance_eval else None
        has_confirmed_expected_change = bool(acceptance_eval and acceptance_eval.get("has_confirmed_expected_change"))
        has_confirmed_positive_proof = bool(acceptance_eval and acceptance_eval.get("has_confirmed_positive_proof"))

        risk_points: list[str] = []
        blocking_issues: list[str] = []
        review_findings: list[dict[str, Any]] = []
        evidence_gaps: list[dict[str, Any]] = []
        context_citations: list[dict[str, Any]] = []

        ci_summary = context.get("ci_summary") if isinstance(context.get("ci_summary"), dict) else None
        failed_ci = int((ci_summary or {}).get("failed_runs") or 0)
        if failed_ci:
            ci_citations = self._build_ci_citations(ci_summary or {}, failed_ci)
            message = f"关联仓库仍有 {failed_ci} 个失败 CI，需要先确认是否由当前 PR 引入或阻塞合并。"
            blocking_issues.append(message)
            review_findings.append(
                self._finding(
                    "P1",
                    "失败 CI 阻塞合并",
                    message,
                    "先修复或解释失败 CI，再重新评估合入。",
                    blocking=True,
                    citations=ci_citations,
                )
            )

        auth_bypass = self._detect_auth_bypass(files, diff_citations_by_file, version_ref)
        if auth_bypass is not None:
            file_name, snippet_line, citation = auth_bypass
            message = f"文件 {file_name} 移除了权限/认证校验或引入了匿名绕过分支（{snippet_line}）。"
            risk_points.append(message)
            blocking_issues.append(message)
            review_findings.append(
                self._finding(
                    "P1",
                    "权限或认证边界存在绕过风险",
                    message,
                    "恢复权限/身份校验逻辑，并补充越权拒绝用例后再提交审查。",
                    blocking=True,
                    citations=[citation],
                )
            )

        contract_break = self._detect_contract_break(files, diff_citations_by_file, version_ref)
        if contract_break is not None:
            file_name, detail, citation = contract_break
            if has_confirmed_expected_change:
                proof_citations = [citation, *((acceptance_eval or {}).get("positive_proofs") or [])[:2]]
                review_findings.append(
                    self._finding(
                        "P3",
                        "接口契约变更已由行为验收确认",
                        f"文件 {file_name} 包含预期契约调整（{detail}），已通过已确认的 change-verifier expected_change 验收核验。",
                        "合并前同步通知下游调用方并确认发布说明。",
                        blocking=False,
                        citations=proof_citations,
                    )
                )
            else:
                message = f"文件 {file_name} 修改或移除了既有响应/分页契约字段（{detail}），且缺少已确认的 expected_change 行为验收依据。"
                risk_points.append(message)
                blocking_issues.append(message)
                review_findings.append(
                    self._finding(
                        "P1",
                        "接口或分页契约存在破坏性变更",
                        message,
                        "保留向后兼容字段，或提交经确认的 change-verifier expected_change 验收报告。",
                        blocking=True,
                        citations=[citation],
                    )
                )

        unmigrated_model = self._detect_unmigrated_schema_change(files, migration_files, diff_citations_by_file, version_ref)
        if unmigrated_model is not None:
            file_name, detail, citation = unmigrated_model
            message = f"文件 {file_name} 变更了持久化表结构定义（{detail}），但当前 PR 未包含对应的 Alembic 迁移脚本。"
            risk_points.append(message)
            blocking_issues.append(message)
            review_findings.append(
                self._finding(
                    "P1",
                    "数据库模型变更缺少 Alembic 迁移脚本",
                    message,
                    "生成并提交 backend/migrations/versions 迁移脚本，验证 upgrade/downgrade 与 alembic check。",
                    blocking=True,
                    citations=[citation],
                )
            )
            evidence_gaps.append(
                {
                    "gap_id": "gap-unverified-migration",
                    "category": "unverified_migration",
                    "title": "缺少数据库迁移脚本与升级验证",
                    "description": message,
                    "required_evidence": "补充 Alembic 版本迁移文件，并附上空库升级与回滚检查结果。",
                    "locator": citation["locator"],
                    "citations": [citation],
                }
            )

        if acceptance_eval:
            for item in acceptance_eval["blocking_findings"]:
                blocking_issues.append(f"{item['title']}：{item['required_action']}")
                risk_points.append(item["title"])
                review_findings.append(item)
            evidence_gaps.extend(acceptance_eval["evidence_gaps"])
            context_citations.extend(acceptance_eval["positive_proofs"])

        doc_citations, stale_doc_gaps = self._build_doc_citations_and_gaps(
            context.get("project_documents") or [],
            files=files,
            filenames=filenames,
        )
        context_citations.extend(doc_citations)
        if stale_doc_gaps:
            evidence_gaps.extend(stale_doc_gaps)
            for gap in stale_doc_gaps:
                risk_points.append(gap["title"])

        issue_citations = self._build_issue_citations(context.get("related_issues") or [])
        context_citations.extend(issue_citations)

        if risky_files:
            risky_citations = [diff_citations_by_file[name] for name in risky_files[:3] if name in diff_citations_by_file]
            message = f"高敏感文件需要重点审查：{', '.join(risky_files[:5])}"
            risk_points.append(message)
            if test_files or has_confirmed_positive_proof:
                review_findings.append(
                    self._finding(
                        "P3",
                        "敏感路径变更已附带测试或验收覆盖",
                        f"{message}；已检测到关联验证（{', '.join(test_files[:2]) or 'change-verifier 行为验收'}）。",
                        "人工复核异常分支与最小权限边界后放行。",
                        blocking=False,
                        citations=risky_citations,
                    )
                )
            else:
                blocking_issues.append(message)
                review_findings.append(
                    self._finding(
                        "P2",
                        "敏感文件变更需要重点验证",
                        message,
                        "补充代码审查记录、回归测试或人工验证说明。",
                        blocking=True,
                        citations=risky_citations,
                    )
                )

        if comments:
            comment_citations = self._build_comment_citations(comments, primary_diff_citation, version_ref)
            message = f"已有 {len(comments)} 条 review comment，需要确认是否都已处理。"
            risk_points.append(message)
            blocking_issues.append(message)
            review_findings.append(
                self._finding(
                    "P2",
                    "Review 评论尚需确认",
                    message,
                    "逐条回应并确认评论已解决后再放行。",
                    blocking=True,
                    citations=comment_citations,
                )
            )

        if total_patch_chars > 12000 or len(diff_chunks) > 8:
            message = "Diff 较大，建议按模块分块 Review，避免遗漏跨文件影响。"
            risk_points.append(message)
            review_findings.append(
                self._finding(
                    "P3",
                    "Diff 体量较大",
                    message,
                    "按模块拆分审查路径，必要时补充分阶段验证。",
                    blocking=False,
                    citations=[primary_diff_citation] if primary_diff_citation else [],
                )
            )

        if files and not is_docs_only and not test_files and not has_confirmed_positive_proof and (risky_files or total_additions + total_deletions > 250):
            target_citations = [diff_citations_by_file[name] for name in (risky_files or filenames)[:2] if name in diff_citations_by_file]
            message = "当前变更缺少明显测试文件，合并前需要补充自动化测试或明确手工验证记录。"
            blocking_issues.append(message)
            review_findings.append(
                self._finding(
                    "P2",
                    "缺少测试覆盖证明",
                    message,
                    "补充自动化测试，或留下可复核的手工验证记录。",
                    blocking=True,
                    citations=target_citations,
                )
            )
            evidence_gaps.append(
                {
                    "gap_id": "gap-missing-tests",
                    "category": "missing_test_evidence",
                    "title": "缺少自动化测试或行为验收证据",
                    "description": message,
                    "required_evidence": "提交覆盖核心变更分支的测试文件，或关联已确认的 change-verifier 验收报告。",
                    "locator": target_citations[0]["locator"] if target_citations else None,
                    "citations": target_citations,
                }
            )

        if not files:
            evidence_gaps.append(
                {
                    "gap_id": "gap-missing-diff",
                    "category": "missing_diff_context",
                    "title": "缺少变更文件与 Diff 快照",
                    "description": "当前 PR 未同步到 changed files，无法核验具体源码改动范围。",
                    "required_evidence": "重新同步仓库 PR 文件列表与 patch 后再执行合入审查。",
                    "locator": f"pr:#{input_data.get('number') or 'unknown'}",
                    "citations": [],
                }
            )
        elif (
            ci_summary is not None
            and int(ci_summary.get("recent_runs") or 0) == 0
            and failed_ci == 0
            and not is_docs_only
            and not has_confirmed_positive_proof
        ):
            ci_gap_citation = PRReviewCitation(
                source_type="ci",
                title="CI 运行记录缺失",
                locator="ci:missing",
                snippet="当前仓库尚未采集到关联的 GitHub Actions CI 运行记录。",
                version_ref=version_ref,
                stale=False,
            ).model_dump()
            evidence_gaps.append(
                {
                    "gap_id": "gap-missing-ci",
                    "category": "missing_ci",
                    "title": "缺少 CI 验证记录",
                    "description": "当前代码变更未查询到已完成的 CI 流水线结果，无法确认构建与回归测试门禁状态。",
                    "required_evidence": "触发并同步最新 CI 运行结果，或附上已确认的候选环境验收报告。",
                    "locator": "ci:missing",
                    "citations": [ci_gap_citation],
                }
            )

        if context.get("require_behavioral_acceptance") and acceptance_eval is None and not is_docs_only:
            gap_citations = [primary_diff_citation] if primary_diff_citation else []
            evidence_gaps.append(
                {
                    "gap_id": "gap-missing-acceptance",
                    "category": "missing_behavioral_acceptance",
                    "title": "缺少 HTTP 行为对比验收报告",
                    "description": "当前变更涉及对外服务行为，但尚未导入 change-verifier 基准/候选对比验收报告。",
                    "required_evidence": "导入 report_version=1 的 change-verifier JSON 验收报告并确认无回归。",
                    "locator": primary_diff_citation["locator"] if primary_diff_citation else None,
                    "citations": gap_citations,
                }
            )

        if not risk_points:
            risk_points.append("需要确认边界条件和异常路径是否有测试覆盖")

        if not review_findings:
            advisory_citations = [
                *([primary_diff_citation] if primary_diff_citation else []),
                *context_citations[:2],
            ]
            review_findings.append(
                self._finding(
                    "P3",
                    "未发现明确阻断项",
                    "基于当前 diff、评论、CI 与关联上下文证据，未发现明确 P1/P2 阻断项。",
                    "按 checklist 完成最终人工确认。",
                    blocking=False,
                    citations=advisory_citations,
                )
            )

        blocking_issues = list(dict.fromkeys(blocking_issues))
        merge_recommendation, recommendation_reason = self._choose_recommendation(
            input_data=input_data,
            files=files,
            blocking_issues=blocking_issues,
            evidence_gaps=evidence_gaps,
            failed_ci=failed_ci,
            has_auth_bypass=auth_bypass is not None,
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
            f"已绑定 {len(diff_citations_by_file)} 条 diff 锚点、{len(doc_citations)} 条文档引用（过期 {len(stale_doc_gaps)} 条）、{failed_ci} 个失败 CI 信号"
            + (f"，并纳入验收任务「{acceptance_summary.task_name}」。" if acceptance_summary else "。"),
            f"已输出结论：{merge_recommendation}（阻塞问题 {sum(bool(f.get('blocking')) for f in review_findings)} 项，证据不足 {len(evidence_gaps)} 项）。",
        ]
        all_citations = [
            *diff_citations_by_file.values(),
            *context_citations,
        ]
        return PRReviewOutput(
            summary=f"PR #{input_data.get('number')} 修改了 {len(files)} 个文件，主要集中在 {', '.join(filenames[:3]) or '未提供文件'}。",
            plan=plan,
            executed_steps=executed_steps,
            merge_recommendation=merge_recommendation,
            recommendation_reason=recommendation_reason,
            review_findings=review_findings,
            evidence_gaps=evidence_gaps,
            citations=all_citations,
            acceptance_summary=acceptance_summary,
            key_changes=[f"更新 {name}" for name in filenames[:5]],
            risk_points=list(dict.fromkeys(risk_points)) if files else ["缺少 changed files，风险判断有限"],
            blocking_issues=blocking_issues,
            review_checklist=["确认接口兼容性", "确认错误处理路径", "确认测试覆盖关键分支", "确认 review comments 已回应"],
            test_suggestions=self._test_suggestions(filenames, risky_files, failed_ci),
            files_need_attention=(risky_files or filenames)[:5],
            review_comments=[str(comment.get("body") or "").strip() for comment in comments[:5] if str(comment.get("body") or "").strip()],
            confidence=self._estimate_confidence(files, context, failed_ci, blocking_issues, evidence_gaps, acceptance_summary),
        ).model_dump()

    def _merge_with_fallback(self, output: dict[str, Any], fallback: dict[str, Any]) -> dict[str, Any]:
        merged = {**fallback, **output}
        for key in [
            "plan",
            "executed_steps",
            "review_findings",
            "key_changes",
            "risk_points",
            "blocking_issues",
            "review_checklist",
            "test_suggestions",
            "files_need_attention",
            "review_comments",
        ]:
            if not merged.get(key):
                merged[key] = fallback[key]
        for key in ["merge_recommendation", "recommendation_reason", "summary"]:
            if not str(merged.get(key) or "").strip():
                merged[key] = fallback[key]

        merged["acceptance_summary"] = fallback.get("acceptance_summary") or merged.get("acceptance_summary")
        normalized_findings = self._normalize_review_findings(merged.get("review_findings"), fallback)

        # Preserve deterministic acceptance-report blocking findings so safety gates cannot be dropped.
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

    def _finding(
        self,
        severity: str,
        title: str,
        evidence: str,
        required_action: str,
        *,
        blocking: bool | None = None,
        citations: list[dict[str, Any]] | None = None,
        finding_id: str = "",
    ) -> dict[str, Any]:
        return {
            "finding_id": finding_id,
            "severity": severity,
            "title": title,
            "evidence": evidence,
            "required_action": required_action,
            "blocking": severity in {"P1", "P2"} if blocking is None else blocking,
            "citations": [item for item in (citations or []) if isinstance(item, dict)],
        }

    def _normalize_citations(self, items: Any, fallback_citations: list[dict[str, Any]], hint_text: str = "") -> list[dict[str, Any]]:
        valid_types = {"diff", "ci", "issue", "doc", "acceptance_report"}
        normalized: list[dict[str, Any]] = []
        if isinstance(items, list):
            for raw in items:
                if not isinstance(raw, dict):
                    continue
                source_type = str(raw.get("source_type") or "").strip()
                locator = str(raw.get("locator") or "").strip()
                title = str(raw.get("title") or locator).strip()
                snippet = str(raw.get("snippet") or title).strip()
                if source_type in valid_types and locator and title and snippet:
                    normalized.append(
                        PRReviewCitation(
                            source_type=source_type,  # type: ignore[arg-type]
                            title=title,
                            locator=locator,
                            snippet=snippet,
                            version_ref=str(raw["version_ref"]) if raw.get("version_ref") else None,
                            stale=bool(raw.get("stale", False)),
                        ).model_dump()
                    )
        if normalized:
            return normalized
        lowered_hint = hint_text.lower()
        for candidate in fallback_citations:
            locator = str(candidate.get("locator") or "").lower()
            base_path = locator.split("#", 1)[0]
            if base_path and base_path in lowered_hint:
                return [candidate]
        return fallback_citations[:1]

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
            citations = self._normalize_citations(item.get("citations"), fallback_citations, f"{title} {evidence}")
            normalized.append(
                self._finding(
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
                    citations=self._normalize_citations(raw.get("citations"), [], title),
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
        if any(token in text for token in ["do not merge", "wip", "draft", "blocked", "暂缓", "不要合并"]):
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

    def _resolve_version_ref(self, input_data: dict[str, Any], context: dict[str, Any]) -> str | None:
        snapshot_sha = (context.get("pr_snapshot") or {}).get("commit_sha") if isinstance(context.get("pr_snapshot"), dict) else None
        head_sha = snapshot_sha or input_data.get("head_sha") or input_data.get("commit_sha")
        if head_sha:
            return f"commit:{str(head_sha)[:12]}"
        if input_data.get("head_branch"):
            return f"branch:{input_data['head_branch']}"
        return None

    def _parse_patch_line_range(self, patch: str, fallback_lines: int) -> tuple[int, int]:
        matches = list(_HUNK_HEADER_RE.finditer(patch or ""))
        if matches:
            first_start = int(matches[0].group(1))
            last_start = int(matches[-1].group(1))
            last_count = int(matches[-1].group(2) or 1)
            last_end = max(first_start, last_start + max(0, last_count - 1))
            return first_start, last_end
        end_line = max(1, fallback_lines)
        return 1, end_line

    def _build_diff_citation(
        self,
        file_item: dict[str, Any],
        *,
        version_ref: str | None,
        snippet_override: str | None = None,
        title_override: str | None = None,
    ) -> dict[str, Any]:
        filename = str(file_item.get("filename") or "patch.diff")
        patch = str(file_item.get("patch") or "").strip()
        additions = int(file_item.get("additions") or 0)
        deletions = int(file_item.get("deletions") or 0)
        fallback_span = additions or len(patch.splitlines()) or 1
        start_line, end_line = self._parse_patch_line_range(patch, fallback_span)
        locator = f"{filename}#L{start_line}-L{end_line}" if end_line > start_line else f"{filename}#L{start_line}"
        snippet = (snippet_override or patch or f"{filename} (+{additions} / -{deletions})")[:260].strip()
        return PRReviewCitation(
            source_type="diff",
            title=title_override or f"Diff：{filename}",
            locator=locator,
            snippet=snippet,
            version_ref=version_ref,
            stale=False,
        ).model_dump()

    def _build_ci_citations(self, ci_summary: dict[str, Any], failed_ci: int) -> list[dict[str, Any]]:
        failed_items = ci_summary.get("failed") if isinstance(ci_summary.get("failed"), list) else []
        citations: list[dict[str, Any]] = []
        for idx, run in enumerate(failed_items[:3], start=1):
            if not isinstance(run, dict):
                continue
            run_ref = str(run.get("run_id") or run.get("id") or f"run-{idx}").strip()
            locator = run_ref if run_ref.startswith("ci:") else f"ci:{run_ref}"
            name = str(run.get("name") or f"CI #{idx}").strip()
            logs = str(run.get("logs_text") or f"Workflow {name} conclusion={run.get('conclusion') or 'failure'}").strip()
            citations.append(
                PRReviewCitation(
                    source_type="ci",
                    title=f"失败 CI：{name}",
                    locator=locator,
                    snippet=logs[:260],
                    version_ref=str(run["commit_sha"])[:12] if run.get("commit_sha") else None,
                    stale=False,
                ).model_dump()
            )
        if not citations:
            citations.append(
                PRReviewCitation(
                    source_type="ci",
                    title="失败 CI 门禁信号",
                    locator=f"ci:failed-runs-{failed_ci}",
                    snippet=f"关联仓库最近 CI 存在 {failed_ci} 次失败运行记录。",
                    stale=False,
                ).model_dump()
            )
        return citations

    def _build_comment_citations(
        self,
        comments: list[dict[str, Any]],
        primary_diff_citation: dict[str, Any] | None,
        version_ref: str | None,
    ) -> list[dict[str, Any]]:
        citations: list[dict[str, Any]] = []
        for idx, comment in enumerate(comments[:3], start=1):
            if not isinstance(comment, dict):
                continue
            body = str(comment.get("body") or "").strip()
            if not body:
                continue
            path = str(comment.get("path") or "").strip()
            line = comment.get("line")
            if path and line:
                locator = f"{path}#L{line}"
            elif path:
                locator = f"{path}#L1"
            elif primary_diff_citation:
                locator = str(primary_diff_citation["locator"])
            else:
                locator = f"diff:comment-{idx}"
            author = str(comment.get("author") or "reviewer")
            citations.append(
                PRReviewCitation(
                    source_type="diff",
                    title=f"Review 评论（@{author}）",
                    locator=locator,
                    snippet=body[:240],
                    version_ref=version_ref,
                    stale=False,
                ).model_dump()
            )
        return citations or ([primary_diff_citation] if primary_diff_citation else [])

    def _build_doc_citations_and_gaps(
        self,
        project_documents: list[dict[str, Any]],
        *,
        files: list[dict[str, Any]],
        filenames: list[str],
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        removed_text, added_text = self._split_removed_and_added_lines(files)
        changed_basenames = {Path(name).name.casefold() for name in filenames}
        citations: list[dict[str, Any]] = []
        gaps: list[dict[str, Any]] = []

        for doc in project_documents[:4]:
            if not isinstance(doc, dict):
                continue
            title = str(doc.get("title") or "").strip()
            snippet = str(doc.get("snippet") or "").strip()
            if not title or not snippet:
                continue
            meta = doc.get("metadata") if isinstance(doc.get("metadata"), dict) else {}
            doc_filename = str(meta.get("filename") or meta.get("source_file") or title).strip()
            raw_hash = str(meta.get("checksum") or meta.get("sha256") or hashlib.sha256(snippet.encode("utf-8")).hexdigest())
            short_hash = raw_hash[:8]
            locator = f"doc:{doc_filename}@sha256:{short_hash}"
            version_ref = str(meta.get("commit_sha") or meta.get("version") or f"sha256:{short_hash}")

            stale_reason = ""
            if (
                meta.get("stale") is True
                or meta.get("outdated") is True
                or meta.get("deprecated") is True
                or str(meta.get("freshness") or "").lower() == "stale"
                or bool(meta.get("superseded_by"))
            ):
                stale_reason = str(meta.get("stale_reason") or meta.get("superseded_by") or "文档元数据标记为已过期版本")
            elif Path(doc_filename).name.casefold() not in changed_basenames:
                for token in _BACKTICK_TOKEN_RE.findall(snippet):
                    if token in removed_text and token not in added_text:
                        stale_reason = f"文档仍引用本次 Diff 已移除的标识符 `{token}`，且该文档未随 PR 同步更新"
                        break

            is_stale = bool(stale_reason)
            citation = PRReviewCitation(
                source_type="doc",
                title=title,
                locator=locator,
                snippet=snippet[:260],
                version_ref=version_ref,
                stale=is_stale,
            ).model_dump()
            citations.append(citation)
            if is_stale:
                gaps.append(
                    {
                        "gap_id": f"gap-stale-doc-{short_hash}",
                        "category": "stale_doc",
                        "title": f"关联运维/架构文档已过期：{title}",
                        "description": f"引用资料 `{locator}` 存在陈旧风险：{stale_reason}。",
                        "required_evidence": f"同步更新 `{doc_filename}` 并重新索引知识库，避免按旧手册误判合入条件。",
                        "locator": locator,
                        "citations": [citation],
                    }
                )
        return citations, gaps

    def _build_issue_citations(self, related_issues: list[dict[str, Any]]) -> list[dict[str, Any]]:
        citations: list[dict[str, Any]] = []
        for item in related_issues[:3]:
            if not isinstance(item, dict):
                continue
            title = str(item.get("title") or "").strip()
            snippet = str(item.get("snippet") or "").strip()
            if not title or not snippet:
                continue
            meta = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
            number = meta.get("number")
            source_id = str(item.get("source_id") or "").strip()
            locator = f"issue:#{number}" if number is not None else f"issue:{source_id or title[:24]}"
            citations.append(
                PRReviewCitation(
                    source_type="issue",
                    title=title,
                    locator=locator,
                    snippet=snippet[:240],
                    version_ref=str(meta["state"]) if meta.get("state") else None,
                    stale=False,
                ).model_dump()
            )
        return citations

    def _evaluate_context_acceptance(self, context: dict[str, Any]) -> dict[str, Any] | None:
        raw_acceptance = context.get("acceptance_report")
        if not raw_acceptance or not isinstance(raw_acceptance, dict):
            return None
        try:
            return evaluate_acceptance_report(raw_acceptance)
        except Exception as exc:
            invalid_citation = PRReviewCitation(
                source_type="acceptance_report",
                title="行为验收报告格式校验失败",
                locator="acceptance_report:invalid",
                snippet=str(exc)[:240],
                stale=False,
            ).model_dump()
            return {
                "summary": None,
                "blocking_findings": [],
                "evidence_gaps": [
                    {
                        "gap_id": "gap-invalid-acceptance",
                        "category": "missing_behavioral_acceptance",
                        "title": "行为验收报告版本或结构不受支持",
                        "description": f"无法解析关联的行为验收报告：{exc}",
                        "required_evidence": "重新导入符合 report_version=1 规范的 change-verifier JSON 报告。",
                        "locator": "acceptance_report:invalid",
                        "citations": [invalid_citation],
                    }
                ],
                "positive_proofs": [],
                "has_confirmed_expected_change": False,
                "has_confirmed_positive_proof": False,
            }

    def _split_removed_and_added_lines(self, files: list[dict[str, Any]]) -> tuple[str, str]:
        removed: list[str] = []
        added: list[str] = []
        for item in files:
            patch = str(item.get("patch") or "")
            for line in patch.splitlines():
                if line.startswith("---") or line.startswith("+++"):
                    continue
                if line.startswith("-"):
                    removed.append(line[1:])
                elif line.startswith("+"):
                    added.append(line[1:])
        return "\n".join(removed), "\n".join(added)

    def _detect_auth_bypass(
        self,
        files: list[dict[str, Any]],
        diff_citations_by_file: dict[str, dict[str, Any]],
        version_ref: str | None,
    ) -> tuple[str, str, dict[str, Any]] | None:
        for item in files:
            filename = str(item.get("filename") or "")
            if self._is_test_file(filename) or self._is_doc_file(filename):
                continue
            patch = str(item.get("patch") or "")
            removed_lines = [
                line[1:].strip()
                for line in patch.splitlines()
                if line.startswith("-") and not line.startswith("---")
            ]
            added_lines = [
                line[1:].strip()
                for line in patch.splitlines()
                if line.startswith("+") and not line.startswith("+++")
            ]
            added_joined = "\n".join(added_lines).lower()
            for line in added_lines:
                if any(token in line.lower() for token in _AUTH_BYPASS_ADD_TOKENS):
                    citation = diff_citations_by_file.get(filename) or self._build_diff_citation(item, version_ref=version_ref)
                    return filename, line[:120], citation
            for line in removed_lines:
                lowered = line.lower()
                matched_guard = next((token for token in _AUTH_GUARD_TOKENS if token in lowered), None)
                if matched_guard and not any(token in added_joined for token in _AUTH_GUARD_TOKENS):
                    citation = diff_citations_by_file.get(filename) or self._build_diff_citation(item, version_ref=version_ref)
                    return filename, line[:120], citation
        return None

    def _detect_contract_break(
        self,
        files: list[dict[str, Any]],
        diff_citations_by_file: dict[str, dict[str, Any]],
        version_ref: str | None,
    ) -> tuple[str, str, dict[str, Any]] | None:
        for item in files:
            filename = str(item.get("filename") or "")
            lowered_path = filename.replace("\\", "/").lower()
            if self._is_test_file(filename) or self._is_doc_file(filename):
                continue
            if not any(part in lowered_path for part in ("schemas/", "routes/", "api/", "controllers/", "dto")):
                continue
            patch = str(item.get("patch") or "")
            removed_lines = [
                line[1:].strip()
                for line in patch.splitlines()
                if line.startswith("-") and not line.startswith("---")
            ]
            added_joined = "\n".join(
                line[1:].strip()
                for line in patch.splitlines()
                if line.startswith("+") and not line.startswith("+++")
            ).lower()
            for line in removed_lines:
                lowered_line = line.lower()
                matched = next((token for token in _CONTRACT_TOKENS if token in lowered_line), None)
                if matched and matched not in added_joined:
                    citation = diff_citations_by_file.get(filename) or self._build_diff_citation(item, version_ref=version_ref)
                    return filename, line[:120], citation
        return None

    def _detect_unmigrated_schema_change(
        self,
        files: list[dict[str, Any]],
        migration_files: list[str],
        diff_citations_by_file: dict[str, dict[str, Any]],
        version_ref: str | None,
    ) -> tuple[str, str, dict[str, Any]] | None:
        if migration_files:
            return None
        for item in files:
            filename = str(item.get("filename") or "")
            lowered_path = filename.replace("\\", "/").lower()
            if not (lowered_path.endswith("models.py") or "/models/" in lowered_path):
                continue
            patch = str(item.get("patch") or "")
            for raw_line in patch.splitlines():
                if raw_line.startswith(("+++", "---")) or not raw_line.startswith(("+", "-")):
                    continue
                stripped = raw_line[1:].strip()
                if any(token in stripped.lower() for token in _ORM_SCHEMA_TOKENS):
                    citation = diff_citations_by_file.get(filename) or self._build_diff_citation(item, version_ref=version_ref)
                    return filename, stripped[:120], citation
        return None

    def _is_test_file(self, filename: str) -> bool:
        lowered = filename.replace("\\", "/").lower()
        return any(token in lowered for token in ["test", "spec", "__tests__", "pytest", "playwright"])

    def _is_doc_file(self, filename: str) -> bool:
        normalized = filename.replace("\\", "/")
        suffix = Path(normalized).suffix.lower()
        return suffix in _DOC_SUFFIXES or normalized.lower().startswith("docs/")

    def _test_suggestions(self, filenames: list[str], risky_files: list[str], failed_ci: int) -> list[str]:
        suggestions = ["运行相关单元测试和集成测试"]
        lowered = " ".join(filenames).lower()
        if any(token in lowered for token in ["frontend", ".tsx", ".ts", "next", "react"]):
            suggestions.append("运行前端类型检查/构建，并覆盖关键页面交互")
        if any(token in lowered for token in ["backend", ".py", "api", "db"]):
            suggestions.append("运行后端 pytest，并覆盖接口或数据库边界")
        if risky_files:
            suggestions.append("对敏感文件补充回归测试或人工验证记录")
        if failed_ci:
            suggestions.append("先修复失败 CI，再重新运行完整流水线")
        return list(dict.fromkeys(suggestions))

    def _estimate_confidence(
        self,
        files: list[dict[str, Any]],
        context: dict[str, Any],
        failed_ci: int,
        blocking_issues: list[str],
        evidence_gaps: list[dict[str, Any]],
        acceptance_summary: PRAcceptanceSummary | None,
    ) -> float:
        score = 0.52
        if files:
            score += 0.12
        if context.get("code_references"):
            score += 0.08
        if context.get("project_documents"):
            score += 0.06
        if context.get("conversation_evidence"):
            score += 0.04
        if acceptance_summary and acceptance_summary.rule_status == "confirmed":
            score += 0.1
        if failed_ci or blocking_issues:
            score += 0.04
        if evidence_gaps:
            score -= min(0.16, 0.05 * len(evidence_gaps))
        return round(max(0.35, min(0.92, score)), 2)
