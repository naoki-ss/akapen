import Link from "next/link";
import AppFrame from "../AppFrame";
import styles from "./screens.module.css";

// ① プロジェクト一覧
export default function ProjectList({
  projects,
  canRegister,
}: {
  projects: { slug: string; name: string; hasModel: boolean }[];
  canRegister: boolean;
}) {
  return (
    <AppFrame crumbs={[{ label: "プロジェクト一覧" }]}>
      <div className={styles.page}>
        <div className={styles.pageHead}>
          <h1>プロジェクト</h1>
          {canRegister && (
            <Link className={styles.action} href="/projects/new">
              ＋ 新しいプロジェクトを登録
            </Link>
          )}
        </div>
        <ul className={styles.cards}>
          {projects.map((project) => (
            <li key={project.slug}>
              <Link href={`/projects/${project.slug}`}>
                <b>{project.name}</b>
                <span>{project.hasModel ? "3D あり" : "3D なし"}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </AppFrame>
  );
}
