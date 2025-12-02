// app/layout.tsx
import "./globals.css";
import type { Metadata } from "next";
import { ReactNode } from "react";
import { DiscordProfileSyncClient } from "@/app/components/DiscordProfileSyncClient";

export const metadata: Metadata = {
  title: "GBF Raid ID Relay",
  description: "Granblue Fantasy raid id viewer",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>
        {/* ここで Discord プロフィール同期を一度だけ実行 */}
        <DiscordProfileSyncClient />
        {children}
      </body>
    </html>
  );
}
