import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GBF 参戦ID共有ビューア",
  description: "グラブル用の参戦ID共有ツール（Supabase + Next.js）",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
