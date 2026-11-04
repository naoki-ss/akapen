"use client";

import Image from "next/image";
import { useState } from "react";
import type { Finding } from "@/lib/check";
import {
  colorName,
  detailOf,
  reasonOf,
  sourceLabel,
} from "@/lib/findings";
import styles from "./check.module.css";

type Numbered = Finding & { number: number };

// 根拠の資料を文字で並べる。設計図の画像は名前の塗りつぶしの設定がないので出さない
function sourceText(finding: Finding) {
  return (finding.sources ?? []).map(
    (source) => `${source.doc} ${source.page}・${source.where}`,
  );
}

function Compare({ finding }: { finding: Numbered }) {
  if (!finding.sheet_value || !finding.design_value) return null;
  const first = finding.sources?.[0];
  const label =
    finding.source_type === "minutes"
      ? "議事録"
      : first
        ? `${first.doc} ${first.page.replace(/（.*$/, "")}`
        : "設計図書";
  return (
    <dl className={styles.compare}>
      <div>
        <dt>施工図</dt>
        <dd className="mono">{finding.sheet_value}</dd>
      </div>
      <div>
        <dt>{label}</dt>
        <dd className="mono">{finding.design_value}</dd>
      </div>
    </dl>
  );
}

function Quotes({ finding }: { finding: Numbered }) {
  if (finding.minutes_refs?.length) {
    return (
      <blockquote className={styles.quote}>
        {finding.minutes_refs.slice(0, 4).map((ref) => (
          <p key={ref.id}>
            <span className="mono">{ref.id}</span> {ref.text}
          </p>
        ))}
        {finding.minutes_refs.length > 4 && (
          <p>ほか {finding.minutes_refs.length - 4} 項目</p>
        )}
      </blockquote>
    );
  }
  if (finding.source_type === "knowledge" && finding.sources?.[0]) {
    return (
      <blockquote className={styles.quote}>
        <p>
          <span className="mono">{finding.sources[0].page}</span>{" "}
          {finding.sources[0].where}
        </p>
      </blockquote>
    );
  }
  return null;
}

// 右上の根拠カード。何と何が食い違っているかと、残すか外すかを決める
export default function BasisCard({
  finding,
  kept,
  base,
  onKeep,
}: {
  finding: Numbered | null;
  kept: boolean;
  base: string;
  onKeep: (kept: boolean) => void;
}) {
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  if (!finding) {
    return (
      <div className={styles.basis}>
        <p className={styles.lead}>
          指摘を選ぶと、何と何が食い違っているかをここに出します。
        </p>
      </div>
    );
  }
  const opened = openedFor === finding.id;
  const sources = sourceText(finding);
  return (
    <div className={styles.basis}>
      <header className={styles.basisHead}>
        <i className={`${styles.number} mono`} data-color={colorName(finding)}>
          {finding.number}
        </i>
        <span>
          <small>{sourceLabel(finding)}との照合</small>
          <b>{finding.title}</b>
        </span>
      </header>
      <Compare finding={finding} />
      <Quotes finding={finding} />
      <p className={styles.reason}>{reasonOf(finding)}</p>
      {(finding.needs_confirmation || finding.severity === "要確認") && (
        <p className={styles.notice}>
          図面だけでは食い違いと言い切れない点です。人の確認が必要です。
        </p>
      )}
      <div className={styles.basisActions}>
        <div className={styles.segment} role="group" aria-label="朱書きの扱い">
          <button aria-pressed={kept} onClick={() => onKeep(true)}>
            朱書きに残す
          </button>
          <button aria-pressed={!kept} onClick={() => onKeep(false)}>
            外す
          </button>
        </div>
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
          {sources.length > 0 && finding.source_type !== "knowledge" && (
            <ul>
              {sources.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
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
