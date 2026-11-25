"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { HelmMark } from "@/components/brand/helm-mark";

import styles from "./app-shell.module.css";

const navItems = [
  { href: "/", label: "工作台" },
  { href: "/pull-requests", label: "PR 审查" },
  { href: "/knowledge", label: "项目知识" },
  { href: "/rag", label: "RAG 工作室" },
  { href: "/repos", label: "仓库" },
  { href: "/action-drafts", label: "草稿" },
  { href: "/workflow-runs", label: "运行记录" },
  { href: "/workspaces", label: "报告" },
  { href: "/code-graph", label: "代码图谱" },
  { href: "/evals", label: "评测" }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/" className={styles.brand}>
            <span className={styles.brandMark}>
              <HelmMark size={18} strokeWidth={2} />
            </span>
            DevHelm
          </Link>
          <nav className={styles.nav} aria-label="主导航">
            {navItems.map((item) => {
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`${styles.link} ${active ? styles.linkActive : ""}`}
                  aria-current={active ? "page" : undefined}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
