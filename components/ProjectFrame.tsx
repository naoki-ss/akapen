import Link from "next/link";
import type { ReactNode } from "react";
import AppFrame from "./AppFrame";
import styles from "./screens/screens.module.css";

export type ProjectTab = "sheets" | "design" | "minutes" | "model";

const TABS: { key: ProjectTab; label: string; path: string }[] = [
  { key: "sheets", label: "施工図", path: "" },
  { key: "design", label: "設計図書", path: "/design" },
  { key: "minutes", label: "議事録", path: "/minutes" },
  { key: "model", label: "建物3D", path: "/model" },
];

// 現場トップの枠。施工図・設計図書・議事録・建物3Dをタブで切り替える
export default function ProjectFrame({
  slug,
  name,
  tab,
  children,
}: {
  slug: string;
  name: string;
  tab: ProjectTab;
  children: ReactNode;
}) {
  return (
    <AppFrame crumbs={[{ label: "現場を選ぶ", href: "/" }, { label: name }]}>
      <div className={styles.tabBody}>
        <nav className={styles.tabs} aria-label="現場の内容" style={{ flex: "none" }}>
          {TABS.map((item) => (
            <Link
              key={item.key}
              href={`/projects/${slug}${item.path}`}
              aria-current={item.key === tab ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        {children}
      </div>
    </AppFrame>
  );
}
