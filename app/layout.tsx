import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "アカペン｜施工図チェック",
  description: "施工図を設計図書・議事録・社内チェックリストと照らし合わせ、朱書きを付けて返す",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
