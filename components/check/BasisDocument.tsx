"use client";

import Image from "next/image";
import type { DesignRef, Finding } from "@/lib/check";
import { colorName } from "@/lib/findings";
import styles from "./check.module.css";

type Numbered = Finding & { number: number };

const LOCATED: Record<DesignRef["located"], string> = {
  ai: "枠はAIが示した位置です。",
  text: "枠は指摘の符号や数値を図面の文字から探した位置の目安です。",
  page: "該当箇所を図面の文字から見つけられなかったので、ページ全体を出しています。",
  known: "",
};

function DesignFigure({
  finding,
  item,
  base,
}: {
  finding: Numbered;
  item: DesignRef;
  base: string;
}) {
  const src = `${base}/${item.image}`;
  return (
    <figure className={styles.docFigure}>
      <figcaption className={styles.documentHead}>
        <b>
          {item.doc} p.{item.page}
        </b>
        {item.where && <span>{item.where}</span>}
        <a href={src} target="_blank" rel="noreferrer">
          大きく開く
        </a>
      </figcaption>
      <div className={styles.docImage}>
        <Image
          src={src}
          alt={`${item.doc} p.${item.page}`}
          width={item.width}
          height={item.height}
          unoptimized
        />
        {item.box && (
          <span
            className={styles.docBox}
            data-color={colorName(finding)}
            style={{
              left: `${item.box[0] * 100}%`,
              top: `${item.box[1] * 100}%`,
              width: `${(item.box[2] - item.box[0]) * 100}%`,
              height: `${(item.box[3] - item.box[1]) * 100}%`,
            }}
          >
            <b className="mono" data-side={item.box[0] < 0.08 ? "right" : "left"}>
              {finding.number}
            </b>
          </span>
        )}
      </div>
      {LOCATED[item.located] && (
        <p className={styles.docNote}>{LOCATED[item.located]}</p>
      )}
    </figure>
  );
}

// 施工図の隣に並べる根拠の資料。設計図の切り抜き、議事録の該当の行、チェック項目のカード
export default function BasisDocument({
  finding,
  base,
  publicView,
}: {
  finding: Numbered;
  base: string;
  publicView: boolean;
}) {
  const refs = finding.design_refs ?? [];
  const shown = publicView ? refs.filter((item) => item.masked) : refs;
  const blocks = finding.minutes_context ?? [];
  const card = finding.checklist_card;
  const empty = shown.length === 0 && blocks.length === 0 && !card;

  return (
    <aside className={styles.document} aria-label="根拠の資料">
      {shown.map((item) => (
        <DesignFigure
          key={item.image}
          finding={finding}
          item={item}
          base={base}
        />
      ))}
      {shown.length < refs.length && (
        <p className={styles.docNote}>
          図面枠を塗りつぶせなかった資料は、公開・デモ用の表示では出していません。
        </p>
      )}
      {(finding.design_refs_more ?? 0) > 0 && (
        <p className={styles.docNote}>
          ほかに {finding.design_refs_more} つの資料も根拠です。右の「根拠資料を開く」に出ています。
        </p>
      )}
      {blocks.map((block) => (
        <section key={`${block.doc}${block.heading}`}>
          <h3 className={styles.documentHead}>
            <i className={`${styles.number} mono`} data-color={colorName(finding)}>
              {finding.number}
            </i>
            <span>
              議事録 {block.doc}
              <br />
              <small>{block.heading}</small>
            </span>
          </h3>
          <ol className={styles.minutesLines}>
            {block.lines.map((line) => (
              <li key={line.id} data-hit={line.hit}>
                <span className="mono">{line.id}</span>
                <span>{line.text}</span>
              </li>
            ))}
          </ol>
        </section>
      ))}
      {card && (
        <section className={styles.checkCard}>
          <i className={`${styles.number} mono`} data-color={colorName(finding)}>
            {finding.number}
          </i>{" "}
          <small>
            チェックリスト {card.checklist}
            {card.section && `／${card.section}`}
          </small>
          <h3>{card.item}</h3>
          <ul>
            {card.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {card.note && <p className={styles.docNote}>補足：{card.note}</p>}
          {card.source?.file && (
            <p className={styles.docNote}>
              出典：{card.source.file}
              {card.source.page && ` ${card.source.page}`}
            </p>
          )}
        </section>
      )}
      {empty && (
        <p className={styles.docNote}>
          この指摘に並べられる資料はありません。根拠は右の文面をご覧ください。
        </p>
      )}
    </aside>
  );
}
