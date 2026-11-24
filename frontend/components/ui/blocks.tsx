/** 报告/内容页共享的小组件：全部使用 Arc 语义 token，供各页面复用。 */
import { clsx } from "clsx";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Section({ title, note, children, className }: { title: string; note?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={className}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-ink">{title}</h3>
        {note ? <span className="text-xs text-ink-2">{note}</span> : null}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

export function Panel({ label, children, className }: { label?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={clsx("rounded-control border border-line bg-panel px-4 py-3 text-sm leading-6 text-ink-2", className)}>
      {label ? (
        <>
          <div className="text-xs text-ink-2">{label}</div>
          <div className="mt-1">{children}</div>
        </>
      ) : (
        children
      )}
    </div>
  );
}

export function TextList({ items }: { items: string[] }) {
  return (
    <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-6 text-ink-2 marker:text-ink-2">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

export function MetaRow({ children, note }: { children: React.ReactNode; note?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {children}
      {note ? <span className="ml-auto text-xs text-ink-2">{note}</span> : null}
    </div>
  );
}

export function ReportBody({ children }: { children: React.ReactNode }) {
  return <div className="mt-6 flex flex-col gap-5 border-t border-line pt-6">{children}</div>;
}

export function FileRow({ children }: { children: React.ReactNode }) {
  return <div className="rounded-control border border-line bg-panel px-4 py-2.5 font-mono text-xs text-ink-2">{children}</div>;
}

/** Markdown 渲染（与工作区页一致的样式），用于周报等长文内容。 */
export function MarkdownBlock({ content }: { content: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ children, ...props }) => (
            <div className="markdown-table-wrap">
              <table {...props}>{children}</table>
            </div>
          )
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
