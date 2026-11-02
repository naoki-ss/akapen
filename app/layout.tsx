import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "施工図チェックシステム",
  description: "設計図書から建物を3D化し、施工図をAIでチェックする",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
