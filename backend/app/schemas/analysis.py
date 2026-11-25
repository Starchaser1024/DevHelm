from typing import Literal

from pydantic import BaseModel, Field, model_validator


class DuplicateCandidate(BaseModel):
    issue_id: str
    title: str
    score: float = Field(ge=0, le=1)


class IssueEvidence(BaseModel):
    source_type: str
    title: str
    snippet: str
    reference: str | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)


class IssueDrafts(BaseModel):
    clarification_comment: str | None = None
    task_breakdown: str | None = None


class IssueAnalysisOutput(BaseModel):
    summary: str
    conclusion: Literal["进入开发", "等待澄清", "关闭", "拆分", "合并到已有 Issue"]
    conclusion_reason: str
    category: Literal["Bug", "Feature", "Question", "Documentation", "Refactor", "Test", "Ops"]
    priority: Literal["P0", "P1", "P2", "P3"]
    complexity: Literal["S", "M", "L", "XL"]
    suggested_owner: str
    owner_reason: str
    duplicate_candidates: list[DuplicateCandidate] = Field(default_factory=list)
    evidence: list[IssueEvidence] = Field(default_factory=list)
    checklist: list[str] = Field(default_factory=list)
    action_items: list[str] = Field(default_factory=list)
    drafts: IssueDrafts = Field(default_factory=IssueDrafts)
    confidence: float = Field(ge=0, le=1)


PRCitationSourceType = Literal["diff", "ci", "issue", "doc", "acceptance_report"]


class PRReviewCitation(BaseModel):
    source_type: PRCitationSourceType
    title: str
    locator: str
    snippet: str
    version_ref: str | None = None
    stale: bool = False


class PREvidenceGap(BaseModel):
    gap_id: str = ""
    category: str = "other"
    title: str
    description: str
    required_evidence: str = ""
    locator: str | None = None
    citations: list[PRReviewCitation] = Field(default_factory=list)


class PRAcceptanceSummary(BaseModel):
    report_version: int = 1
    task_id: str | int | None = None
    task_name: str = ""
    rule_version: int | str | None = None
    rule_status: str = "unknown"
    run_id: str | int | None = None
    run_status: str = "unknown"
    headline: str = ""
    counts: dict[str, int] = Field(default_factory=dict)
    total_checks: int = 0
    executed_checks: int = 0
    positive_proofs: list[PRReviewCitation] = Field(default_factory=list)
    ingested_at: str | None = None


class PRReviewFinding(BaseModel):
    finding_id: str = ""
    severity: Literal["P1", "P2", "P3"]
    title: str
    evidence: str
    required_action: str
    blocking: bool = False
    citations: list[PRReviewCitation] = Field(default_factory=list)


class PRReviewOutput(BaseModel):
    summary: str
    plan: list[str] = []
    executed_steps: list[str] = []
    merge_recommendation: Literal["建议合入", "修改后合入", "暂缓", "拒绝"] = "暂缓"
    recommendation_reason: str = ""
    review_findings: list[PRReviewFinding] = Field(default_factory=list)
    blocking_findings: list[PRReviewFinding] = Field(default_factory=list)
    advisory_findings: list[PRReviewFinding] = Field(default_factory=list)
    evidence_gaps: list[PREvidenceGap] = Field(default_factory=list)
    citations: list[PRReviewCitation] = Field(default_factory=list)
    acceptance_summary: PRAcceptanceSummary | None = None
    key_changes: list[str] = []
    risk_points: list[str] = []
    blocking_issues: list[str] = []
    review_checklist: list[str] = []
    test_suggestions: list[str] = []
    files_need_attention: list[str] = []
    review_comments: list[str] = []
    confidence: float = Field(ge=0, le=1)

    @model_validator(mode="after")
    def _sync_buckets_and_citations(self) -> "PRReviewOutput":
        if not self.review_findings and (self.blocking_findings or self.advisory_findings):
            combined: list[PRReviewFinding] = []
            for item in self.blocking_findings:
                item.blocking = True
                combined.append(item)
            for item in self.advisory_findings:
                item.blocking = False
                combined.append(item)
            self.review_findings = combined

        for index, finding in enumerate(self.review_findings, start=1):
            if not finding.finding_id:
                finding.finding_id = f"finding-{index}"

        self.blocking_findings = [finding for finding in self.review_findings if finding.blocking]
        self.advisory_findings = [finding for finding in self.review_findings if not finding.blocking]

        for index, gap in enumerate(self.evidence_gaps, start=1):
            if not gap.gap_id:
                gap.gap_id = f"gap-{index}"
            if not gap.locator and gap.citations:
                gap.locator = gap.citations[0].locator

        merged_citations: list[PRReviewCitation] = []
        seen_keys: set[tuple[str, str, str]] = set()
        candidate_citations = [
            *self.citations,
            *(citation for finding in self.review_findings for citation in finding.citations),
            *(citation for gap in self.evidence_gaps for citation in gap.citations),
            *(self.acceptance_summary.positive_proofs if self.acceptance_summary else []),
        ]
        for citation in candidate_citations:
            key = (citation.source_type, citation.locator, citation.title)
            if key in seen_keys:
                continue
            seen_keys.add(key)
            merged_citations.append(citation)
        self.citations = merged_citations
        return self


class CIDebugOutput(BaseModel):
    failure_summary: str
    failure_type: Literal["test", "build", "lint", "dependency", "permission", "environment", "unknown"]
    plan: list[str] = []
    executed_steps: list[str] = []
    first_error: str | None = None
    root_cause: str = ""
    possible_causes: list[str] = []
    fix_steps: list[str] = []
    debug_steps: list[str] = []
    related_files: list[str] = []
    is_merge_blocking: bool = True
    blocking_reason: str = ""
    confidence: float = Field(ge=0, le=1)


class SafetyOutput(BaseModel):
    requires_confirmation: bool
    risk_level: Literal["low", "medium", "high"]
    reason: str
    draft: str | None = None
