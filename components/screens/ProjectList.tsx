"use client";

import CountUp from "../CountUp";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { ProjectCard } from "@/lib/buildings";
import AppFrame from "../AppFrame";
import Hint from "../Hint";
import SketchIntro from "../SketchIntro";
import SceneThumb from "../SceneThumb";
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
  if (card.image) {
    return (
      <div className={styles.thumb} data-sketch="thumb" data-building="true">
        {/* eslint-disable-next-line @next/next/no-img-element -- 作っておいた画像をそのまま見せる */}
        <img className={styles.thumbImage} src={card.image} alt="" />
      </div>
    );
  }
  if (!card.thumbnail) return <div className={styles.thumb} data-sketch="thumb">3Dなし</div>;
  const { viewBox, columns, beams } = card.thumbnail;
  return (
    <div className={styles.thumb} data-sketch="thumb" data-building="true">
      {/* 画像ができるまでと、WebGL が使えないときは線で見せる */}
      <svg viewBox={viewBox} aria-hidden>
        <path d={columns} className={styles.thumbColumn} />
        <path d={beams} className={styles.thumbBeam} />
      </svg>
      <SceneThumb slug={card.slug} />
    </div>
  );
}

// ① プロジェクト一覧
export default function ProjectList({
  projects,
  running,
  canRegister,
  replay = false,
}: {
  projects: ProjectCard[];
  running: Running[];
  canRegister: boolean;
  // 動画用：開くたびに表示の動きを再生する
  replay?: boolean;
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
    <AppFrame crumbs={[{ label: "現場を選ぶ" }]}>
      <SketchIntro replay={replay} />
      <div className={styles.page}>
        <div className={styles.pageHead}>
          <h1 data-sketch="title" data-sketch-reveal="1">
            現場を選ぶ
          </h1>
          {/* 現場が少ないうちは探す必要がないので出さない */}
          {projects.length > 6 && (
            <>
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
            </>
          )}
          {canRegister && (
            <Link className={styles.action} href="/projects/new" data-sketch="button" data-sketch-reveal="2">
              <Plus size={15} /> 新しい現場をつくる
            </Link>
          )}
        </div>
        <div data-sketch-reveal="3">
          <Hint id="list" text="現場を選ぶと、3Dでどこに問題があるかを見られます。" />
        </div>
        <ul className={styles.cards}>
          {running.map((project) => (
            <li key={project.slug} data-sketch-reveal="4">
              <Link href={`/projects/new?watch=${project.slug}`} data-sketch="card">
                <div className={styles.thumb} data-sketch="thumb">3Dを作成中</div>
                <div className={styles.cardBody} data-sketch="body">
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
            <li key={project.slug} data-sketch-reveal="4">
              <Link href={`/projects/${project.slug}/model`} data-sketch="card">
                <Thumb card={project} />
                <div className={styles.cardBody} data-sketch="body">
                  <b>{project.name}</b>
                  <small>
                    {[
                      project.use,
                      project.structure,
                      project.floors > 0 ? `${project.floors}階建て` : null,
                      project.updatedAt
                        ? `更新 ${dateFormat.format(new Date(project.updatedAt))}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join("・")}
                  </small>
                  <div className={styles.openCounts} aria-label="未対応の指摘">
                    <small>未対応の指摘</small>
                    <i className="mono" data-color="red" data-sketch="badge">
                      赤 <CountUp value={project.red} />
                    </i>
                    <i className="mono" data-color="blue" data-sketch="badge">
                      青 <CountUp value={project.blue} />
                    </i>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
        {shown.length === 0 && running.length === 0 && (
          <p className={styles.none}>当てはまる現場はありません。</p>
        )}
      </div>
    </AppFrame>
  );
}
