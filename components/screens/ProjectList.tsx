"use client";

import Link from "next/link";
import { useState } from "react";
import type { ProjectCard } from "@/lib/buildings";
import AppFrame from "../AppFrame";
import styles from "./screens.module.css";

type Running = {
  slug: string;
  name: string;
  message: string;
  done: number;
  total: number;
};

const dateFormat = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  timeZone: "Asia/Tokyo",
});

function Thumb({ card }: { card: ProjectCard }) {
  if (!card.thumbnail) return <div className={styles.thumb}>3Dなし</div>;
  const { viewBox, columns, beams } = card.thumbnail;
  return (
    <div className={styles.thumb}>
      <svg viewBox={viewBox} aria-hidden>
        <path d={columns} className={styles.thumbColumn} />
        <path d={beams} className={styles.thumbBeam} />
      </svg>
    </div>
  );
}

// ① プロジェクト一覧
export default function ProjectList({
  projects,
  running,
  canRegister,
}: {
  projects: ProjectCard[];
  running: Running[];
  canRegister: boolean;
}) {
  const [query, setQuery] = useState("");
  const [structure, setStructure] = useState("");
  const structures = [
    ...new Set(projects.flatMap((p) => (p.structure ? [p.structure] : []))),
  ];
  const shown = projects.filter(
    (p) =>
      p.name.includes(query.trim()) &&
      (!structure || p.structure === structure),
  );

  return (
    <AppFrame crumbs={[{ label: "プロジェクト一覧" }]}>
      <div className={styles.page}>
        <div className={styles.pageHead}>
          <h1>プロジェクト</h1>
          <input
            className={styles.search}
            type="search"
            placeholder="名前で検索"
            aria-label="名前で検索"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            className={styles.search}
            aria-label="構造で絞り込む"
            value={structure}
            onChange={(e) => setStructure(e.target.value)}
          >
            <option value="">すべての構造</option>
            {structures.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
          {canRegister && (
            <Link className={styles.action} href="/projects/new">
              ＋ 新しいプロジェクトを登録
            </Link>
          )}
        </div>
        <ul className={styles.cards}>
          {running.map((project) => (
            <li key={project.slug}>
              <Link href={`/projects/new?watch=${project.slug}`}>
                <div className={styles.thumb}>3Dを作成中</div>
                <div className={styles.cardBody}>
                  <b>{project.name}</b>
                  <div className={styles.progress}>
                    <div
                      style={{
                        width: `${project.total ? (project.done / project.total) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <small>{project.message}</small>
                </div>
              </Link>
            </li>
          ))}
          {shown.map((project) => (
            <li key={project.slug}>
              <Link href={`/projects/${project.slug}`}>
                <Thumb card={project} />
                <div className={styles.cardBody}>
                  <b>{project.name}</b>
                  <small>
                    {[
                      project.use,
                      project.structure,
                      project.floors > 0 ? `${project.floors}階建て` : null,
                    ]
                      .filter(Boolean)
                      .join("・")}
                  </small>
                  <small>
                    設計図書 <span className="mono">{project.documents}</span>・施工図{" "}
                    <span className="mono">{project.sheets}</span>
                    {project.updatedAt &&
                      `・更新 ${dateFormat.format(new Date(project.updatedAt))}`}
                  </small>
                  <div className={styles.openCounts} aria-label="未対応の指摘">
                    <small>未対応</small>
                    <i className="mono" data-color="red">
                      赤 {project.red}
                    </i>
                    <i className="mono" data-color="blue">
                      青 {project.blue}
                    </i>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
        {shown.length === 0 && running.length === 0 && (
          <p className={styles.none}>当てはまるプロジェクトはありません。</p>
        )}
      </div>
    </AppFrame>
  );
}
