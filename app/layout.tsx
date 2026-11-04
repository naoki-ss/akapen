import type { Metadata } from "next";
import { JetBrains_Mono, Noto_Sans_JP, Yomogi } from "next/font/google";
import "./globals.css";

const sans = Noto_Sans_JP({
  subsets: ["latin"],
  variable: "--font-sans",
  preload: false,
});
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });
const hand = Yomogi({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-hand",
  preload: false,
});

export const metadata: Metadata = {
  title: "アカペン｜施工図チェック",
  description: "施工図を設計図書・議事録・社内チェックリストと照らし合わせ、朱書きを付けて返す",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className={`${sans.variable} ${mono.variable} ${hand.variable}`}>
      <body>{children}</body>
    </html>
  );
}
