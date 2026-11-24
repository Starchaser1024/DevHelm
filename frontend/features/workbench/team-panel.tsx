import Link from "next/link";

import type { TeamMember, TeamMemberDraft } from "./types";

export function TeamWorkspace({
  members,
  draft,
  onDraftChange,
  onAddMember,
  onRemoveMember
}: {
  members: TeamMember[];
  draft: TeamMemberDraft;
  onDraftChange: (value: TeamMemberDraft) => void;
  onAddMember: () => void;
  onRemoveMember: (memberId: string) => void;
}) {
  return (
    <div className="space-y-4">
      <section className="rounded-control border border-line bg-surface p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-ink">人员管理</h3>
            <p className="mt-1 text-xs leading-5 text-ink-2">配置项目工作者，Agent 会在分配 Issue 时参考职位、擅长方向和技术栈。</p>
          </div>
          <span className="rounded-full bg-panel px-2 py-0.5 text-xs text-ink-2">{members.length} 人</span>
        </div>

        <div className="mt-4 grid gap-2">
          <input
            value={draft.name}
            onChange={(event) => onDraftChange({ ...draft, name: event.target.value })}
            placeholder="姓名，例如 Alice"
            className="h-9 rounded-control border border-line bg-surface px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-subtle"
          />
          <input
            value={draft.role}
            onChange={(event) => onDraftChange({ ...draft, role: event.target.value })}
            placeholder="职位，例如 后端工程师 / 前端工程师 / Tech Lead"
            className="h-9 rounded-control border border-line bg-surface px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-subtle"
          />
          <textarea
            value={draft.strengths}
            onChange={(event) => onDraftChange({ ...draft, strengths: event.target.value })}
            placeholder="擅长，例如 鉴权、API 设计、CI 排查"
            className="min-h-16 resize-none rounded-control border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-subtle"
          />
          <input
            value={draft.techStack}
            onChange={(event) => onDraftChange({ ...draft, techStack: event.target.value })}
            placeholder="技术栈，例如 Python, FastAPI, PostgreSQL"
            className="h-9 rounded-control border border-line bg-surface px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-subtle"
          />
          <button
            onClick={onAddMember}
            disabled={!draft.name.trim()}
            className="inline-flex h-9 items-center justify-center rounded-control bg-accent px-3 text-sm font-medium text-white transition hover:bg-accent disabled:opacity-60"
          >
            添加成员
          </button>
        </div>
      </section>

      <section className="rounded-control border border-line bg-surface p-4">
        <h3 className="text-sm font-semibold text-ink">团队成员</h3>
        <div className="mt-3 space-y-2">
          {members.length === 0 && <div className="rounded-control bg-panel p-3 text-sm text-ink-2">还没有成员。先添加一个项目工作者。</div>}
          {members.map((member) => (
            <div key={member.id} className="rounded-control border border-line bg-surface p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-ink">{member.name}</div>
                  <div className="mt-1 text-xs text-ink-2">{member.role || "未配置职位"}</div>
                </div>
                <button onClick={() => onRemoveMember(member.id)} className="rounded-control border border-line px-2 py-1 text-xs text-ink-2 hover:bg-panel">
                  移除
                </button>
              </div>
              <div className="mt-3 space-y-1 text-xs leading-5 text-ink-2">
                <div>擅长：{member.strengths || "未配置"}</div>
                <div>技术栈：{member.techStack || "未配置"}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-control border border-line bg-surface p-4 text-sm leading-7 text-ink-2">
        <div className="font-medium text-ink">报告管理</div>
        <p className="mt-2">可在中间对话框输入“生成本周研发周报”，或进入周报页面查看 Markdown 预览。</p>
        <Link href="/reports" className="mt-3 inline-flex rounded-control bg-accent px-3 py-1.5 text-xs font-medium text-white">
          打开周报页
        </Link>
      </section>
    </div>
  );
}
