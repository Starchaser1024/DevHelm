import type { Metadata } from "next";
import "./globals.css";
import "@/components/arc/foundation.css";
import { UnhandledErrorGuard } from "@/components/error-guard";
import { AppShell } from "@/components/layout/app-shell";

export const metadata: Metadata = {
  title: "DevHelm",
  description: "PR / Issue intelligent collaboration agent for engineering teams"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" data-accent="green">
      <body>
        <UnhandledErrorGuard />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
