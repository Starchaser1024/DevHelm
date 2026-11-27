"use client";

import { useCallback, useEffect, useState } from "react";

import { apiGet, apiPost } from "@/lib/api";
import type { Repository } from "@/lib/types";
import {
  FEEDBACK_LABELS,
  type AcceptanceReportRecord,
  type ActionDraftCreated,
  type AnalyzeResponse,
  type EvidenceSummary,
  type PRFeedbackRecord,
  type PRFeedbackSubmitPayload,
  type PRReview,
  type PullRequest
} from "./types";

export function usePRReviewWorkbench() {
  const [repos, setRepos] = useState<Repository[]>([]);
  const [repoId, setRepoId] = useState("");
  const [prs, setPrs] = useState<PullRequest[]>([]);
  const [selected, setSelected] = useState<PullRequest | null>(null);

  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<PRReview | null>(null);
  const [evidenceSummary, setEvidenceSummary] = useState<EvidenceSummary | null>(null);
  const [acceptanceRecord, setAcceptanceRecord] = useState<AcceptanceReportRecord | null>(null);
  const [feedbackHistory, setFeedbackHistory] = useState<PRFeedbackRecord[]>([]);

  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [importOpen, setImportOpen] = useState(false);
  const [reportJsonText, setReportJsonText] = useState("");
  const [importingReport, setImportingReport] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const [selectedFindingIds, setSelectedFindingIds] = useState<Record<string, boolean>>({});
  const [selectedGapIds, setSelectedGapIds] = useState<Record<string, boolean>>({});
  const [confirmedVerdict, setConfirmedVerdict] = useState<string>("暂缓");
  const [reviewerNote, setReviewerNote] = useState("");
  const [reviewerConfirmed, setReviewerConfirmed] = useState(false);
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [createdDraft, setCreatedDraft] = useState<ActionDraftCreated | null>(null);

  const [submittingFeedback, setSubmittingFeedback] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  const applyAnalysisState = useCallback((data: AnalyzeResponse | null) => {
    if (!data) {
      setAnalysisId(null);
      setAnalysis(null);
      setEvidenceSummary(null);
      setSelectedFindingIds({});
      setSelectedGapIds({});
      setReviewerConfirmed(false);
      setCreatedDraft(null);
      return;
    }
    setAnalysisId(String(data.analysis_id));
    setAnalysis(data.result);
    setEvidenceSummary(data.evidence_summary ?? null);
    setConfirmedVerdict(data.result.merge_recommendation);
    const nextFindings: Record<string, boolean> = {};
    for (const item of data.result.review_findings ?? []) {
      if (item.finding_id) nextFindings[item.finding_id] = true;
    }
    const nextGaps: Record<string, boolean> = {};
    for (const gap of data.result.evidence_gaps ?? []) {
      if (gap.gap_id) nextGaps[gap.gap_id] = true;
    }
    setSelectedFindingIds(nextFindings);
    setSelectedGapIds(nextGaps);
    setReviewerConfirmed(false);
    setCreatedDraft(null);
  }, []);

  const loadPrAuxiliaryData = useCallback(
    async (prId: string) => {
      const [latestAnalysis, latestAcceptance, feedbacks] = await Promise.all([
        apiGet<AnalyzeResponse>(`/api/pull-requests/${prId}/latest-analysis`).catch(() => null),
        apiGet<AcceptanceReportRecord>(`/api/pull-requests/${prId}/acceptance-report`).catch(() => null),
        apiGet<PRFeedbackRecord[]>(`/api/pull-requests/${prId}/feedback`).catch(() => [])
      ]);
      applyAnalysisState(latestAnalysis);
      setAcceptanceRecord(latestAcceptance);
      setFeedbackHistory(feedbacks);
      setFeedbackMessage(null);
    },
    [applyAnalysisState]
  );

  const loadRepoPullRequests = useCallback(
    async (targetRepoId: string) => {
      if (!targetRepoId) {
        setPrs([]);
        setSelected(null);
        return;
      }
      setLoading(true);
      try {
        const items = await apiGet<PullRequest[]>(`/api/repos/${targetRepoId}/pull-requests`);
        setPrs(items);
        const first = items[0] ?? null;
        setSelected(first);
        if (first) {
          await loadPrAuxiliaryData(first.id);
        } else {
          applyAnalysisState(null);
          setAcceptanceRecord(null);
          setFeedbackHistory([]);
        }
      } catch {
        setPrs([]);
        setSelected(null);
      } finally {
        setLoading(false);
      }
    },
    [applyAnalysisState, loadPrAuxiliaryData]
  );

  useEffect(() => {
    apiGet<Repository[]>("/api/repos")
      .then((repoList) => {
        setRepos(repoList);
        const initialRepo = repoList[0]?.id ?? "";
        setRepoId(initialRepo);
        return loadRepoPullRequests(initialRepo);
      })
      .catch(() => {
        setRepos([]);
        setLoading(false);
      });
  }, [loadRepoPullRequests]);

  async function selectRepo(nextRepoId: string) {
    setRepoId(nextRepoId);
    await loadRepoPullRequests(nextRepoId);
  }

  async function selectPr(pr: PullRequest) {
    setSelected(pr);
    setError(null);
    await loadPrAuxiliaryData(pr.id);
  }

  async function analyze() {
    if (!selected || analyzing) return;
    setAnalyzing(true);
    setError(null);
    try {
      const data = await apiPost<AnalyzeResponse>(`/api/pull-requests/${selected.id}/analyze`, {});
      applyAnalysisState(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "分析失败，请稍后重试。");
    } finally {
      setAnalyzing(false);
    }
  }

  async function importAcceptanceReport() {
    if (!selected || !reportJsonText.trim() || importingReport) return;
    setImportingReport(true);
    setImportError(null);
    try {
      const parsed = JSON.parse(reportJsonText);
      const saved = await apiPost<AcceptanceReportRecord>(`/api/pull-requests/${selected.id}/acceptance-report`, parsed);
      setAcceptanceRecord(saved);
      setImportOpen(false);
      setReportJsonText("");
      const refreshed = await apiPost<AnalyzeResponse>(`/api/pull-requests/${selected.id}/analyze`, {});
      applyAnalysisState(refreshed);
    } catch (err) {
      setImportError(
        err instanceof SyntaxError
          ? "JSON 格式解析失败，请粘贴完整的 report_version=1 JSON 报告。"
          : err instanceof Error
            ? err.message
            : "导入行为验收报告失败。"
      );
    } finally {
      setImportingReport(false);
    }
  }

  async function createCommentDraft() {
    if (!selected || !analysis || !reviewerConfirmed || creatingDraft) return;
    setCreatingDraft(true);
    setError(null);
    try {
      const draft = await apiPost<ActionDraftCreated>(`/api/pull-requests/${selected.id}/comment-draft`, {
        analysis_id: analysisId,
        reviewer_confirmed: true,
        confirmed_merge_recommendation: confirmedVerdict,
        confirmed_finding_ids: Object.entries(selectedFindingIds).filter(([, v]) => v).map(([id]) => id),
        confirmed_gap_ids: Object.entries(selectedGapIds).filter(([, v]) => v).map(([id]) => id),
        reviewer_note: reviewerNote.trim() || null
      });
      setCreatedDraft(draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建评论草稿失败。");
    } finally {
      setCreatingDraft(false);
    }
  }

  async function submitFeedback(payload: PRFeedbackSubmitPayload): Promise<boolean> {
    if (!selected || submittingFeedback) return false;
    setSubmittingFeedback(true);
    setError(null);
    setFeedbackMessage(null);
    try {
      const created = await apiPost<PRFeedbackRecord>(`/api/pull-requests/${selected.id}/feedback`, {
        ...payload,
        analysis_id: analysisId
      });
      setFeedbackHistory((prev) => [created, ...prev]);
      setFeedbackMessage(`已记录「${FEEDBACK_LABELS[payload.label].text}」反馈，自动纳入离线 PR 合入回归评测集。`);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交反馈失败。");
      return false;
    } finally {
      setSubmittingFeedback(false);
    }
  }

  return {
    repos,
    repoId,
    prs,
    selected,
    analysis,
    evidenceSummary,
    acceptanceRecord,
    feedbackHistory,
    loading,
    analyzing,
    error,
    importOpen,
    setImportOpen,
    reportJsonText,
    setReportJsonText,
    importingReport,
    importError,
    setImportError,
    selectedFindingIds,
    setSelectedFindingIds,
    selectedGapIds,
    setSelectedGapIds,
    confirmedVerdict,
    setConfirmedVerdict,
    reviewerNote,
    setReviewerNote,
    reviewerConfirmed,
    setReviewerConfirmed,
    creatingDraft,
    createdDraft,
    submittingFeedback,
    feedbackMessage,
    selectRepo,
    selectPr,
    analyze,
    importAcceptanceReport,
    createCommentDraft,
    submitFeedback
  };
}
