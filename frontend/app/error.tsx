"use client";

import { RotateCcw } from "lucide-react";

import { Button } from "@/components/arc/button/button";
import { PageTitle } from "@/components/ui/card";

/** 路由级错误边界：某个页面渲染失败时保留 AppShell，提供重试而不是整页崩掉。 */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6">
      <div className="w-full max-w-lg">
        <PageTitle
          title="页面加载失败"
          description="这个页面在渲染时出现异常。可以先重试；如果反复出现，请查看浏览器控制台和后端日志。"
        />
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="primary" size="sm" onClick={reset}>
            <RotateCcw size={15} strokeWidth={1.75} aria-hidden="true" />
            重试
          </Button>
          <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
            刷新页面
          </Button>
        </div>
        <p className="mt-4 break-words rounded-control bg-surface p-3 text-xs leading-5 text-ink-2">
          {error.message || "未知错误"}
          {error.digest ? `（digest: ${error.digest}）` : ""}
        </p>
      </div>
    </div>
  );
}
