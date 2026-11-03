"use client";

import Image from "next/image";
import { useState } from "react";
import {
  SOURCE_LABELS,
  type CheckResult,
  type EvalReport,
  type Finding,
  type HumanItem,
  type RunStats,
} from "@/lib/check";
import type { Box, Sheet } from "@/lib/sheets";
import CompareViewer, { type CompareTarget } from "./CompareViewer";
import styles from "./CheckPanel.module.css";

const SEVERITY_CLASS: Record<Finding["severity"], string> = {
  高: styles.high,
  中: styles.middle,
  低: styles.low,
  要確認: styles.unconfirmed,
};

function DrawingImage({
  base,
  src,
  alt,
}: {
  base: string;
  src: string;
  alt: string;
}) {
  // 切り抜きごとに縦横比が違うので、幅に合わせて高さを決める
  return (
    <Image
      className={styles.image}
      src={`${base}/${src}`}
      alt={alt}
      width={800}
      height={500}
      unoptimized
    />
  );
}

function FindingDetail({
  finding,
  base,
  sheets,
  onOpenSheet,
  onCompare,
}: {
  finding: Finding;
  base: string;
  sheets: Sheet[];
  onOpenSheet: (sheet: Sheet, bbox: Box, label: string) => void;
  onCompare: (target: CompareTarget) => void;
}) {
  const sheet = sheets.find((s) => s.id === finding.drawing.sheet);
  const main = finding.evidence[0];
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
      {finding.human_view ? (
        <>
          <h4>同じ箇所の比較</h4>
          <button
            className={styles.openCompare}
            onClick={() =>
              onCompare({
                title: finding.title,
                left: { label: "AIの朱書き", src: `${base}/${main.image}` },
                right: {
                  label: `人の朱書き（${finding.human_view?.note}）`,
                  src: `${base}/${finding.human_view?.image}`,
                },
              })
            }
          >
            大きく並べて見る
          </button>
          <div className={styles.columns}>
            <figure className={styles.evidence}>
              <figcaption>
                <b>AIの朱書き</b>（{main.where}）
              </figcaption>
              <DrawingImage
                base={base}
                src={main.image}
                alt={`AIの朱書き ${main.where}`}
              />
            </figure>
            <figure className={styles.evidence}>
              <figcaption>
                <b>人の朱書き</b>（{finding.human_view.note}）
              </figcaption>
              <DrawingImage
                base={base}
                src={finding.human_view.image}
                alt={`人の朱書き ${finding.human_view.note}`}
              />
            </figure>
          </div>
        </>
      ) : (
        <>
          <h4>根拠</h4>
          {finding.evidence.map((ev) => (
            <figure key={ev.image} className={styles.evidence}>
              <figcaption>
                {ev.doc} p.{ev.page}・{ev.where}
                {ev.text && (
                  <>
                    ：<b>{ev.text}</b>
                  </>
                )}
              </figcaption>
              <DrawingImage
                base={base}
                src={ev.image}
                alt={`${ev.doc} ${ev.where}`}
              />
              {ev.note && <small>{ev.note}</small>}
            </figure>
          ))}
        </>
      )}
      {sheet && (
        <button
          className={styles.openSheet}
          onClick={() =>
            onOpenSheet(sheet, finding.drawing.bbox, finding.title)
          }
        >
          図面全体で見る（p.{sheet.page}）
        </button>
      )}
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
  stats,
  base,
  sheets,
  onOpenSheet,
  onCompare,
  lead,
}: {
  items: HumanItem[];
  findings: Finding[];
  stats?: RunStats;
  base: string;
  sheets: Sheet[];
  onOpenSheet: (sheet: Sheet, bbox: Box, label: string) => void;
  onCompare: (target: CompareTarget) => void;
  lead?: string;
}) {
  return (
    <div className={styles.list}>
      <p className={styles.lead}>
        {lead ??
          "実際のチェックバックの朱書きと、チェック機能の指摘を並べています。"}
      </p>
      {items.map((item) => {
        const linked = findings.find(
          (f) => item.key_id && f.key_ids.includes(item.key_id),
        );
        const related = findings.filter((f) =>
          item.finding_ids?.includes(f.id),
        );
        const sheet = sheets.find((s) => s.id === item.sheet);
        return (
          <article key={item.id} className={styles.compare}>
            <h3>{item.drawing}</h3>
            <div className={styles.columns}>
              <div>
                <h4>人の朱書き</h4>
                <p>{item.note}</p>
                {item.image && (
                  <DrawingImage base={base} src={item.image} alt={item.note} />
                )}
              </div>
              <div>
                <h4>チェック機能</h4>
                {item.finding_ids ? (
                  related.length > 0 ? (
                    <ul className={styles.relatedList}>
                      {related.map((f) => (
                        <li key={f.id}>{f.title}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>この箇所の指摘はありません</p>
                  )
                ) : (
                  <p>
                    {linked
                      ? linked.title
                      : item.key_id && stats
                        ? `この回は検出できませんでした（${runCountText(stats, item.key_id)}）`
                        : "照合の範囲外です"}
                  </p>
                )}
                {item.ai_image && (
                  <DrawingImage
                    base={base}
                    src={item.ai_image}
                    alt={`朱書き前の図面 ${item.drawing}`}
                  />
                )}
              </div>
            </div>
            <p className={styles.summary}>{item.summary}</p>
            {item.image && item.ai_image && (
              <button
                className={styles.openCompare}
                onClick={() =>
                  onCompare({
                    title: item.drawing,
                    left: {
                      label: "朱書き前の図面",
                      src: `${base}/${item.ai_image}`,
                    },
                    right: { label: "人の朱書き", src: `${base}/${item.image}` },
                  })
                }
              >
                大きく並べて見る
              </button>
            )}
            {sheet && item.bbox && (
              <button
                className={styles.openSheet}
                onClick={() =>
                  onOpenSheet(sheet, item.bbox as Box, item.note)
                }
              >
                図面全体で見る（p.{sheet.page}）
              </button>
            )}
          </article>
        );
      })}
    </div>
  );
}

const runCountText = (stats: RunStats, id: string) => {
  const hits = stats.detected[id] ?? 0;
  return `${stats.runs}回中${hits}回検出、${stats.runs - hits}回見逃し`;
};

type Tab = "findings" | "human";

export default function CheckPanel({
  result,
  report,
  stats,
  humanItems,
  humanLead,
  activeId,
  onActivate,
  base,
  sheets,
  onOpenSheet,
}: {
  result: CheckResult;
  // 正解ファイルがある物件だけ採点を出す
  report?: EvalReport;
  stats?: RunStats;
  humanItems: HumanItem[];
  humanLead?: string;
  activeId: string | null;
  onActivate: (finding: Finding | null) => void;
  base: string;
  sheets: Sheet[];
  onOpenSheet: (sheet: Sheet, bbox: Box, label: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("findings");
  const [compare, setCompare] = useState<CompareTarget | null>(null);

  return (
    <div className={styles.root}>
      {compare && (
        <CompareViewer target={compare} onClose={() => setCompare(null)} />
      )}
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
        <HumanCompare
          items={humanItems}
          findings={result.findings}
          stats={stats}
          base={base}
          sheets={sheets}
          onOpenSheet={onOpenSheet}
          onCompare={setCompare}
          lead={humanLead}
        />
      ) : (
        <div className={styles.list}>
          <p className={styles.lead}>{result.mode}</p>
          {report && <ScoreSummary report={report} />}
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
                {active && (
                  <FindingDetail
                    finding={finding}
                    base={base}
                    sheets={sheets}
                    onOpenSheet={onOpenSheet}
                    onCompare={setCompare}
                  />
                )}
              </article>
            );
          })}
          {report && stats && report.missed.length > 0 && (
            <section className={styles.missed}>
              <h3>AIが見逃した例</h3>
              <p>
                正解ファイルにあるのに、この回の判定では挙がらなかった項目です。
                画面の指摘は、同じ条件で{stats.runs}回判定したうちの最初の回です。
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
                    <span>
                      {m.title}（{runCountText(stats, m.id)}）
                    </span>
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
