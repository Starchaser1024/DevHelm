"use client";

import "./globals.css";
import "@/components/arc/foundation.css";

/** 根级错误边界：连根布局都渲染失败时使用，必须自带 html/body。 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="zh-CN" data-accent="green">
      <body>
        <div className="flex min-h-screen items-center justify-center px-6">
          <div className="w-full max-w-lg">
            <h1 className="text-xl font-medium text-ink">DevHelm 加载失败</h1>
            <p className="mt-2 text-sm leading-6 text-ink-2">
              应用根布局渲染时出现异常，请刷新页面重试；如果持续失败，请确认前端依赖安装完整。
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={reset}
                className="inline-flex h-9 items-center rounded-control bg-accent px-3 text-sm font-medium text-white"
              >
                重试
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex h-9 items-center rounded-control border border-line bg-surface px-3 text-sm font-medium text-ink"
              >
                刷新页面
              </button>
            </div>
            <p className="mt-4 break-words rounded-control bg-surface p-3 text-xs leading-5 text-ink-2">
              {error.message || "未知错误"}
              {error.digest ? `（digest: ${error.digest}）` : ""}
            </p>
          </div>
        </div>
      </body>
    </html>
  );
}
