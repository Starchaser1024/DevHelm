import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // 全部映射到 Arc 语义 token（foundation.css）；页面只允许用语义角色，不直接用调色板/hex
        background: "var(--background)",
        ink: "var(--foreground)",
        "ink-2": "var(--text-secondary)",
        "ink-3": "var(--text-muted)",
        surface: "var(--surface)",
        "surface-raised": "var(--surface-raised)",
        panel: "var(--surface-muted)",
        line: "var(--border)",
        "line-subtle": "var(--border-subtle)",
        "line-strong": "var(--border-strong)",
        accent: "var(--accent)",
        "accent-strong": "var(--accent-strong)",
        "accent-subtle": "var(--accent-subtle)",
        "accent-ink": "var(--accent-foreground)",
        success: "var(--success)",
        "success-subtle": "var(--success-subtle)",
        warning: "var(--warning)",
        "warning-subtle": "var(--warning-subtle)",
        warn: "var(--warning)", // 旧类名，保留兼容
        danger: "var(--danger)",
        "danger-subtle": "var(--danger-subtle)"
      },
      borderRadius: {
        control: "var(--radius-control)",
        panel: "var(--radius-panel)",
        surface: "var(--radius-surface)"
      },
      fontFamily: {
        display: "var(--font-display)",
        body: "var(--font-body)"
      },
      boxShadow: {
        // 浮层专用：两层叠加、总透明度 < 0.09（替代 shadow-xl/2xl 的默认重阴影）
        overlay: "0 24px 60px -28px rgb(15 15 15 / 0.05), 0 6px 20px -10px rgb(15 15 15 / 0.04)"
      }
    }
  },
  plugins: []
};

export default config;
