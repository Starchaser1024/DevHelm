"use client";

import { useEffect, useState } from "react";

import { Alert } from "@/components/arc/alert/alert";
import { getFriendlyError } from "@/lib/errors";

type GuardedError = { title: string; detail: string };

/**
 * 全局兜底：捕获没有被 try/catch 接住的异步错误（事件回调里的 Promise 拒绝）
 * 和未捕获的运行时异常，转成页面内可关闭的提示，避免整个页面被错误覆盖层打断。
 */
export function UnhandledErrorGuard() {
  const [error, setError] = useState<GuardedError | null>(null);

  useEffect(() => {
    function report(reason: unknown, title: string) {
      console.error("[DevHelm] 未处理的错误：", reason);
      setError({ title, detail: getFriendlyError(reason) });
    }

    function onRejection(event: PromiseRejectionEvent) {
      event.preventDefault();
      report(event.reason, "操作失败");
    }

    function onError(event: ErrorEvent) {
      // 资源加载失败（图片、脚本）不是业务错误，忽略。
      if (!event.error && !event.message) return;
      event.preventDefault();
      report(event.error ?? event.message, "运行时错误");
    }

    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onError);
    return () => {
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("error", onError);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center px-4">
      <div className="pointer-events-auto w-full max-w-2xl">
        <Alert open={error !== null} tone="danger" title={error?.title ?? ""} onDismiss={() => setError(null)}>
          {error?.detail ?? ""}
        </Alert>
      </div>
    </div>
  );
}
