/** 把后端 / 网络异常转成可以直接展示给用户的中文提示。 */
export function getFriendlyError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  if (raw === "Failed to fetch") {
    return "无法访问后端 API。请确认后端服务已启动，并且 CORS 允许当前前端端口。";
  }
  try {
    const parsed = JSON.parse(raw) as { detail?: unknown; message?: unknown };
    if (typeof parsed.detail === "string") return parsed.detail;
    if (typeof parsed.message === "string") return parsed.message;
  } catch {
    // 下面回退到原始错误消息。
  }
  return raw || "未知错误";
}
