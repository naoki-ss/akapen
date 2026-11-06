import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./screens/screens.module.css";

export function Logo() {
  return (
    <Link href="/" className={styles.logo} data-sketch="logo">
      <svg viewBox="0 0 32 32" width="24" height="24" aria-hidden>
        <path
          d="M6 26 L9 18 L22 5 a2.8 2.8 0 0 1 4 0 l1 1 a2.8 2.8 0 0 1 0 4 L14 23 Z"
          fill="var(--red)"
        />
        <path d="M6 26 L9 18 L14 23 Z" fill="#fff" />
        <path
          d="M4 29 H28"
          stroke="var(--red)"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      </svg>
      アカペン
    </Link>
  );
}

// ①②④の共通の枠。③⑤は3Dが画面いっぱいなので、パネルの中にロゴを置く
export default function AppFrame({
  crumbs,
  children,
}: {
  crumbs: { label: string; href?: string }[];
  children: ReactNode;
}) {
  return (
    <div className={styles.frame}>
      <header className={styles.frameHead} data-sketch="header" data-sketch-reveal="0">
        <Logo />
        <nav aria-label="現在の場所" className={styles.crumbs}>
          {crumbs.map((crumb) =>
            crumb.href ? (
              <Link key={crumb.label} href={crumb.href}>
                {crumb.label}
              </Link>
            ) : (
              <span key={crumb.label} aria-current="page">
                {crumb.label}
              </span>
            ),
          )}
        </nav>
        <Link href="/knowledge" className={styles.frameLink}>
          ナレッジ
        </Link>
      </header>
      <main className={styles.frameBody}>{children}</main>
    </div>
  );
}
