"use client";

import { useEffect, useMemo, useState } from "react";

import { Alert } from "@/components/arc/alert/alert";
import { Button } from "@/components/arc/button/button";
import { ChatThread, type ChatMessage } from "@/components/arc/chat-thread/chat-thread";
import { Select } from "@/components/arc/select/select";
import { Card, PageTitle } from "@/components/ui/card";
import { apiGet, apiPostStream } from "@/lib/api";
import type { Repository } from "@/lib/types";

const SAMPLES = [
  "Why did the latest CI fail?",
  "Summarize the risk in the latest PR",
  "Who should own the latest Issue?",
  "Generate this week's engineering report",
  "Read backend/app/services/agents/chat_agent.py and explain tool calling"
];

const WELCOME_TEXT =
  "你好，我是 DevHelm Agent。选择仓库后可以问我：为什么最新 CI 失败了、最新 PR 有哪些风险、Issue 建议交给谁、或者生成一份工程周报。";

export default function ChatPage() {
  const [repos, setRepos] = useState<Repository[]>([]);
  const [repoId, setRepoId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Repository[]>("/api/repos").then((items) => {
      setRepos(items);
      setRepoId((current) => current || items[0]?.id || "");
    });
  }, []);

  useEffect(() => {
    setMessages((current) =>
      current.length > 0 ? current : [{ id: "welcome", authorId: "agent", text: WELCOME_TEXT, createdAt: Date.now() }]
    );
  }, []);

  const participants = useMemo(
    () => [
      { id: "user", name: "你" },
      { id: "agent", name: "DevHelm Agent" }
    ],
    []
  );

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || !repoId || loading) return;
    setError(null);
    const stamp = Date.now();
    const userId = `u-${stamp}`;
    const agentId = `a-${stamp}`;
    setMessages((current) => [
      ...current,
      { id: userId, authorId: "user", text: trimmed, createdAt: stamp, status: "sent" },
      { id: agentId, authorId: "agent", text: "", createdAt: stamp }
    ]);
    setLoading(true);
    let answer = "";
    try {
      await apiPostStream(
        "/api/chat/stream",
        { repo_id: repoId, message: trimmed, context: { time_range: "7d", messages: [] } },
        (event, rawData) => {
          if (event === "delta") {
            const data = rawData as { content?: string };
            if (data.content) {
              answer += data.content;
              setMessages((current) => current.map((message) => (message.id === agentId ? { ...message, text: answer } : message)));
            }
          }
          if (event === "final") {
            const data = rawData as { answer?: string };
            const finalText = data.answer || answer;
            if (finalText) {
              setMessages((current) => current.map((message) => (message.id === agentId ? { ...message, text: finalText } : message)));
            }
          }
        }
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "请求失败，请稍后重试。";
      setError(message);
      setMessages((current) => current.map((entry) => (entry.id === agentId ? { ...entry, text: entry.text || `（请求失败：${message}）` } : entry)));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PageTitle title="Agent Chat" description="原生工具调用：检索代码、搜索记忆、执行专项分析，并起草真正的外部操作草稿。" />

      <div className="flex flex-col gap-4">
        <Card>
          <div className="max-w-sm">
            <Select
              label="仓库"
              placeholder="选择仓库"
              value={repoId}
              onValueChange={setRepoId}
              options={repos.map((repo) => ({ value: repo.id, label: repo.full_name }))}
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {SAMPLES.map((sample) => (
              <Button key={sample} variant="secondary" size="sm" disabled={loading || !repoId} onClick={() => void send(sample)}>
                {sample}
              </Button>
            ))}
          </div>
        </Card>

        {error && <Alert tone="danger" title="请求失败">{error}</Alert>}

        <div className="h-[600px] overflow-hidden rounded-panel border border-line bg-surface">
          <ChatThread
            participants={participants}
            currentUserId="user"
            messages={messages}
            typing={loading ? ["agent"] : undefined}
            onSend={(draft) => {
              void send(draft.text);
            }}
            allowAttachments={false}
            placeholder="输入你的问题，例如：为什么最新的 CI 失败了？"
            locale="zh-CN"
            label="Agent 对话"
            className="h-full"
            labels={{
              sending: "发送中",
              sent: "已发送",
              failed: "发送失败",
              retry: "重试",
              typing: (names) => `${names.join("、")} 正在输入…`,
              jumpToLatest: "跳到最新",
              unknownAuthor: "未知成员"
            }}
          />
        </div>
      </div>
    </>
  );
}
