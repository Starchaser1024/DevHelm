from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.schemas.analysis import PRAcceptanceSummary, PRReviewOutput


class PRFileResponse(BaseModel):
    id: UUID
    filename: str
    status: str
    additions: int
    deletions: int
    patch: str | None = None

    model_config = {"from_attributes": True}


class PRReviewCommentResponse(BaseModel):
    id: UUID
    body: str | None = None
    path: str | None = None
    line: int | None = None
    author: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


class PullRequestResponse(BaseModel):
    id: UUID
    repo_id: UUID
    number: int
    title: str
    body: str | None = None
    state: str
    author: str | None = None
    base_branch: str | None = None
    head_branch: str | None = None
    merged_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    files: list[PRFileResponse] = []
    review_comments: list[PRReviewCommentResponse] = []

    model_config = {"from_attributes": True}


class PRAnalysisResponse(BaseModel):
    analysis_id: UUID | str
    result: PRReviewOutput
    evidence_summary: dict[str, Any] = Field(default_factory=dict)


class AcceptanceTaskPayload(BaseModel):
    id: int | str
    name: str
    requirement: str = ""
    baseline_url: str = ""
    candidate_url: str = ""

    model_config = {"extra": "allow"}


class AcceptanceRuleVersionPayload(BaseModel):
    id: int | str
    version: int | str
    status: str = "draft"
    note: str = ""
    confirmed_at: str | None = None

    model_config = {"extra": "allow"}


class AcceptanceRunPayload(BaseModel):
    id: int | str
    status: str
    started_at: str | None = None
    finished_at: str | None = None
    error: str | None = None

    model_config = {"extra": "allow"}


class AcceptanceReportIngestRequest(BaseModel):
    report_version: int
    generated_at: str | None = None
    note: str | None = None
    task: AcceptanceTaskPayload
    rule_version: AcceptanceRuleVersionPayload
    run: AcceptanceRunPayload
    summary: dict[str, Any] = Field(default_factory=dict)
    checks: list[dict[str, Any]] = Field(default_factory=list)

    @field_validator("report_version")
    @classmethod
    def _validate_report_version(cls, value: int) -> int:
        if value != 1:
            raise ValueError(f"仅支持 change-verifier report_version=1，当前为 {value}")
        return value


class AcceptanceReportResponse(BaseModel):
    pr_id: UUID | str
    record_id: UUID | str
    ingested_at: str
    report_sha256: str
    summary: PRAcceptanceSummary
    blocking_check_ids: list[str] = Field(default_factory=list)
    evidence_gap_ids: list[str] = Field(default_factory=list)
    positive_check_ids: list[str] = Field(default_factory=list)
    report: dict[str, Any] = Field(default_factory=dict)
