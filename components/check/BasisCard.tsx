"use client";

import Image from "next/image";
import { useState } from "react";
import type { Finding } from "@/lib/check";
import { colorName, detailOf, reasonOf, sourceLabel } from "@/lib/findings";
import styles from "./check.module.css";

type Numbered = Finding & { number: number };

// 「施工図：○○」「設計図書：○○」の行。チェックリストは元の文を出す
function valueLines(finding: Numbered) {
  const lines: { label: string; text: string }[] = [];
  if (finding.sheet_value) {
    lines.push({ label: "施工図", text: finding.sheet_value });
  }
  if (finding.design_value) {
    lines.push({ label: sourceLabel(finding), text: finding.design_value });
  } else if (finding.source_type === "knowledge" && finding.sources?.[0]) {
    lines.push({ label: "チェックリスト", text: finding.sources[0].where });
  }
  return lines;
}

// 右上の根拠。何と何が食い違っているかと、理由の一文を大きく出す
export default function BasisCard({
  finding,
  kept,
  locked,
  base,
  onKeep,
}: {
  finding: Numbered | null;
  kept: boolean;
  // 確定した図面の指摘は変更できない
  locked: boolean;
  base: string;
  onKeep: (kept: boolean) => void;
}) {
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  if (!finding) {
    return (
      <div className={styles.basis}>
        <p className={styles.basisEmpty}>
          指摘を選ぶと、なぜ問題かをここに出します。
        </p>
      </div>
    );
  }
  const opened = openedFor === finding.id;
  return (
    <div className={styles.basis}>
      <header className={styles.basisHead}>
        <i className={`${styles.number} mono`} data-color={colorName(finding)}>
          {finding.number}
        </i>
        <b>{finding.title}</b>
      </header>
      {valueLines(finding).length > 0 && (
        <dl className={styles.values}>
          {valueLines(finding).map((line) => (
            <div key={line.label}>
              <dt>{line.label}</dt>
              <dd>{line.text}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className={styles.reason}>{reasonOf(finding)}</p>
      {(finding.needs_confirmation || finding.severity === "要確認") && (
        <small className={styles.confirm}>
          図面だけでは言い切れません。人の確認が必要です。
        </small>
      )}
      <div className={styles.basisActions}>
        {!locked && (
          <button className={styles.ghost} onClick={() => onKeep(!kept)}>
            {kept ? "この指摘を朱書きから外す" : "朱書きに戻す"}
          </button>
        )}
        <button
          className={styles.ghost}
          aria-expanded={opened}
          onClick={() => setOpenedFor(opened ? null : finding.id)}
        >
          根拠資料を{opened ? "閉じる" : "開く"}
        </button>
      </div>
      {opened && (
        <div className={styles.sources}>
          <p>{detailOf(finding)}</p>
          {finding.minutes_refs?.length ? (
            <ul>
              {finding.minutes_refs.map((ref) => (
                <li key={ref.id}>
                  <span className="mono">{ref.id}</span> {ref.text}
                </li>
              ))}
            </ul>
          ) : (
            finding.source_type !== "knowledge" &&
            finding.sources &&
            finding.sources.length > 0 && (
              <ul>
                {finding.sources.map((source) => (
                  <li key={`${source.doc}${source.page}${source.where}`}>
                    {source.doc} {source.page}・{source.where}
                  </li>
                ))}
              </ul>
            )
          )}
          {finding.evidence.map((ev) => (
            <figure key={ev.image}>
              <Image
                src={`${base}/${ev.image}`}
                alt={`${ev.doc} ${ev.where}`}
                width={800}
                height={500}
                unoptimized
              />
              <figcaption>
                {ev.doc} p.{ev.page}・{ev.where}
                {ev.text && `：${ev.text}`}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
