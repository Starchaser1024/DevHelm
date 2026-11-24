"use client";

import { clsx } from "clsx";

import { Button } from "@/components/arc/button/button";
import styles from "./card.module.css";

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <section className={clsx(styles.card, className)}>{children}</section>;
}

export function PageTitle({ title, description }: { title: string; description: string }) {
  return (
    <div className={styles.pageTitle}>
      <h1 className={styles.pageTitleHeading}>{title}</h1>
      <p className={styles.pageTitleDescription}>{description}</p>
    </div>
  );
}

type ArcButtonProps = React.ComponentProps<typeof Button>;

export function PrimaryButton({ children, className, ...props }: ArcButtonProps) {
  return (
    <Button variant="primary" className={className} {...props}>
      {children}
    </Button>
  );
}

/** 列表项 / 次要操作：整行可点，左对齐；active 为选中态（accent 高亮） */
export function GhostButton({ children, className, type = "button", active = false, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type={type}
      aria-current={active ? "true" : undefined}
      className={clsx(styles.listItem, active && styles.listItemActive, className)}
      {...props}
    >
      {children}
    </button>
  );
}
