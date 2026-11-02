"use client";

import Image from "next/image";
import { useState } from "react";
import {
  demoImage,
  SOURCE_LABELS,
  type CheckResult,
  type EvalReport,
  type Finding,
  type HumanItem,
} from "@/lib/check";
import styles from "./CheckPanel.module.css";

const SEVERITY_CLASS: Record<Finding["severity"], string> = {
  高: styles.high,
  中: styles.middle,
  低: styles.low,
  要確認: styles.unconfirmed,
};

function DrawingImage({ src, alt }: { src: string; alt: string }) {
  // 切り抜きごとに縦横比が違うので、幅に合わせて高さを決める
  return (
    <Image
      className={styles.image}
      src={demoImage(src)}
      alt={alt}
      width={800}
      height={500}
      unoptimized
    />
  );
}

function FindingDetail({ finding }: { finding: Finding }) {
  return (
    <div className={styles.detail}>
      <p>{finding.content}</p>
      {finding.severity === "要確認" && (
        <p className={styles.notice}>
          現場の担当者に確認中です。確認が取れるまで食い違いとは断定しません。
        </p>
      )}
      <dl className={styles.facts}>
        <dt>対象の図面</dt>
        <dd>
          {finding.drawing.doc} p.{finding.drawing.page}
        </dd>
        <dt>関係する部材</dt>
        <dd>
          {[...finding.members.grids, ...finding.members.marks].join("、")}
          （{finding.members.floor}）
        </dd>
        <dt>判定</dt>
        <dd>{SOURCE_LABELS[finding.source]}</dd>
      </dl>
      <h4>根拠</h4>
      {finding.evidence.map((ev) => (
        <figure key={ev.image} className={styles.evidence}>
          <figcaption>
            {ev.doc} p.{ev.page}・{ev.where}：<b>{ev.text}</b>
          </figcaption>
          <DrawingImage src={ev.image} alt={`${ev.doc} ${ev.where}`} />
          {ev.note && <small>{ev.note}</small>}
        </figure>
      ))}
    </div>
  );
}

function ScoreSummary({ report }: { report: EvalReport }) {
  return (
    <div className={styles.score}>
      <div>
        <b>
          {report.detected.length} / {report.required_total}
        </b>
        検出
      </div>
      <div>
        <b>{report.false_positives.length}</b>誤検知
      </div>
      <div>
        <b>{report.traps.every((t) => t.passed) ? "通過" : "不合格"}</b>
        ひっかけ
      </div>
    </div>
  );
}

function HumanCompare({
  items,
  findings,
}: {
  items: HumanItem[];
  findings: Finding[];
}) {
  return (
    <div className={styles.list}>
      <p className={styles.lead}>
        実際のチェックバックの朱書きと、チェック機能の指摘を並べています。
      </p>
      {items.map((item) => {
        const linked = findings.find(
          (f) => item.key_id && f.key_ids.includes(item.key_id),
        );
        return (
          <article key={item.id} className={styles.compare}>
            <h3>{item.drawing}</h3>
            <div className={styles.columns}>
              <div>
                <h4>人の朱書き</h4>
                <p>{item.note}</p>
                {item.image && (
                  <DrawingImage src={item.image} alt={item.note} />
                )}
              </div>
              <div>
                <h4>チェック機能</h4>
                <p>
                  {linked
                    ? linked.title
                    : item.key_id
                      ? "検出できませんでした"
                      : "照合の範囲外です"}
                </p>
              </div>
            </div>
            <p className={styles.summary}>{item.summary}</p>
          </article>
        );
      })}
    </div>
  );
}

type Tab = "findings" | "human";

export default function CheckPanel({
  result,
  report,
  humanItems,
  activeId,
  onActivate,
}: {
  result: CheckResult;
  report: EvalReport;
  humanItems: HumanItem[];
  activeId: string | null;
  onActivate: (finding: Finding | null) => void;
}) {
  const [tab, setTab] = useState<Tab>("findings");

  return (
    <div className={styles.root}>
      <div className={styles.tabs} role="tablist">
        <button
          role="tab"
          aria-selected={tab === "findings"}
          onClick={() => setTab("findings")}
        >
          指摘一覧（{result.findings.length}）
        </button>
        <button
          role="tab"
          aria-selected={tab === "human"}
          onClick={() => setTab("human")}
        >
          人の朱書きと比較
        </button>
      </div>
      {tab === "human" ? (
        <HumanCompare items={humanItems} findings={result.findings} />
      ) : (
        <div className={styles.list}>
          <p className={styles.lead}>{result.mode}</p>
          <ScoreSummary report={report} />
          {result.findings.map((finding) => {
            const active = finding.id === activeId;
            return (
              <article key={finding.id} className={styles.card}>
                <button
                  className={styles.cardHead}
                  aria-expanded={active}
                  onClick={() => onActivate(active ? null : finding)}
                >
                  <span
                    className={`${styles.badge} ${SEVERITY_CLASS[finding.severity]}`}
                  >
                    {finding.severity}
                  </span>
                  <span className={styles.title}>{finding.title}</span>
                  {finding.planted && (
                    <span className={styles.planted}>デモ用に仕込み</span>
                  )}
                </button>
                {active && <FindingDetail finding={finding} />}
              </article>
            );
          })}
          {report.missed.length > 0 && (
            <section className={styles.missed}>
              <h3>AIが見逃した例</h3>
              <p>
                正解ファイルにあるのに、今回の判定では挙がらなかった項目です。
                「要確認」は現場の担当者に確認中で、食い違いとは断定していません。
              </p>
              <ul>
                {report.missed.map((m) => (
                  <li key={m.id}>
                    {m.needs_confirmation && (
                      <span className={`${styles.badge} ${styles.unconfirmed}`}>
                        要確認
                      </span>
                    )}
                    {m.title}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {result.changes.length > 0 && (
            <section className={styles.changes}>
              <h3>意図した変更（指摘ではありません）</h3>
              <p>
                施工順変更版の目的どおりの変更です。指摘には含めていません。
              </p>
              <ul>
                {result.changes.map((c) => (
                  <li key={c.no}>
                    No.{c.no}（{c.grid}）：{c.before} → {c.after} 番目
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
