import type { Metadata } from "next";
import { JetBrains_Mono, Noto_Sans_JP, Yomogi } from "next/font/google";
import { INTRO_SCRIPT } from "@/lib/intro";
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
    <html lang="ja" className={`${sans.variable} ${mono.variable} ${hand.variable}`} suppressHydrationWarning>
      <head>
        {/* トップの表示の動きの前に、本物の画面を隠す（components/SketchIntro.tsx） */}
        <script dangerouslySetInnerHTML={{ __html: INTRO_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
