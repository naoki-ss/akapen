"use client";

import Image from "next/image";
import { useCallback, useState } from "react";
import {
  SOURCE_LABELS,
  type CheckResult,
  type Finding,
} from "@/lib/check";
import type { Box, Sheet } from "@/lib/sheets";
import type { ResultRow } from "@/lib/useUploadJob";
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
}: {
  finding: Finding;
  base: string;
  sheets: Sheet[];
  onOpenSheet: (sheet: Sheet, bbox: Box, label: string) => void;
}) {
  const sheet = sheets.find((s) => s.id === finding.drawing.sheet);
  return (
    <div className={styles.detail}>
      <p>{finding.content}</p>
      {finding.needs_confirmation && (
        <p className={styles.notice}>
          図面だけでは食い違いと言い切れない点です。人の確認が必要です。
        </p>
      )}
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
        <dt>確認の方法</dt>
        <dd>{SOURCE_LABELS[finding.source]}</dd>
      </dl>
      {finding.minutes_refs && (
        <>
          <h4>議事録の該当箇所</h4>
          <ul className={styles.minutesRefs}>
            {finding.minutes_refs.map((ref) => (
              <li key={ref.id}>
                <b>{ref.id}</b> {ref.text}
              </li>
            ))}
          </ul>
        </>
      )}
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

export function FindingCards({
  findings,
  activeId,
  onActivate,
  base,
  sheets,
  onOpenSheet,
}: {
  findings: Finding[];
  activeId: string | null;
  onActivate: (finding: Finding | null) => void;
  base: string;
  sheets: Sheet[];
  onOpenSheet: (sheet: Sheet, bbox: Box, label: string) => void;
}) {
  // 開いた指摘の内容が枠の外に隠れないように、枠の上端まで動かす
  const showOpened = useCallback((card: HTMLElement | null) => {
    card?.scrollIntoView({ block: "start" });
  }, []);
  return (
    <>
      {findings.map((finding) => {
        const active = finding.id === activeId;
        return (
          <article
            key={finding.id}
            ref={active ? showOpened : undefined}
            className={styles.card}
          >
            <button
              className={styles.cardHead}
              aria-expanded={active}
              onClick={() => onActivate(active ? null : finding)}
            >
              {finding.number !== undefined && (
                <span
                  className={styles.number}
                  data-source={finding.source_type}
                >
                  {finding.number}
                </span>
              )}
              <span
                className={`${styles.badge} ${SEVERITY_CLASS[finding.severity]}`}
              >
                {finding.severity}
              </span>
              <span className={styles.title}>{finding.title}</span>
              {finding.source_type === "minutes" && (
                <span className={`${styles.badge} ${styles.minutes}`}>
                  議事録
                </span>
              )}
              {finding.source_type === "knowledge" && (
                <span className={`${styles.badge} ${styles.knowledge}`}>
                  ナレッジ
                </span>
              )}
              {finding.needs_confirmation && (
                <span className={`${styles.badge} ${styles.unconfirmed}`}>
                  要確認
                </span>
              )}
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
              />
            )}
          </article>
        );
      })}
    </>
  );
}

function ResultRows({ rows }: { rows: ResultRow[] }) {
  return (
    <ul className={styles.rows}>
      {rows.map((row) => (
        <li key={row.id}>
          <b>
            {row.id} {row.result}
            {row.pages.length > 0 &&
              `（${row.pages.map((n) => `p.${n}`).join("、")}）`}
          </b>
          <span>{row.item ? `${row.item}：${row.content}` : row.content}</span>
          {row.reason && <small>{row.reason}</small>}
        </li>
      ))}
    </ul>
  );
}

type Tab = "findings" | "minutes" | "checklist";

// 指摘の一覧。入れた施工図の結果には項目ごとの確認結果のタブが付く
export default function CheckPanel({
  findings,
  totalFindings,
  lead,
  notes,
  changes,
  minutes,
  checklist,
  activeId,
  onActivate,
  base,
  sheets,
  onOpenSheet,
}: {
  findings: Finding[];
  totalFindings: number;
  lead?: string;
  notes?: string[];
  changes?: CheckResult["changes"];
  minutes?: ResultRow[] | null;
  checklist?: ResultRow[] | null;
  activeId: string | null;
  onActivate: (finding: Finding | null) => void;
  base: string;
  sheets: Sheet[];
  onOpenSheet: (sheet: Sheet, bbox: Box, label: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("findings");
  const tabs: { key: Tab; label: string }[] = [
    {
      key: "findings",
      label:
        findings.length === totalFindings
          ? `指摘 ${totalFindings} 件`
          : `指摘 ${findings.length} / ${totalFindings} 件`,
    },
    ...(minutes ? [{ key: "minutes" as Tab, label: "議事録" }] : []),
    ...(checklist ? [{ key: "checklist" as Tab, label: "チェックリスト" }] : []),
  ];

  return (
    <div className={styles.root}>
      <div className={styles.tabs} role="tablist">
        {tabs.map((item) => (
          <button
            key={item.key}
            role="tab"
            aria-selected={tab === item.key}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {tab === "minutes" && minutes ? (
        <div className={styles.list}>
          <p className={styles.lead}>
            議事録の項目ごとに、この施工図に関係するか、反映されているかを確認した結果です。
          </p>
          <ResultRows rows={minutes} />
        </div>
      ) : tab === "checklist" && checklist ? (
        <div className={styles.list}>
          <p className={styles.lead}>
            社内チェックリストの項目ごとの確認結果です。
          </p>
          <ResultRows rows={checklist} />
        </div>
      ) : (
        <div className={styles.list}>
          <p className={styles.lead}>
            AIが挙げた確認候補です。確定する前に人が確認してください。
            {lead && ` ${lead}`}
          </p>
          {notes?.map((note) => (
            <p key={note} className={styles.notice}>
              {note}
            </p>
          ))}
          <FindingCards
            findings={findings}
            activeId={activeId}
            onActivate={onActivate}
            base={base}
            sheets={sheets}
            onOpenSheet={onOpenSheet}
          />
          {changes && changes.length > 0 && (
            <section className={styles.changes}>
              <h3>意図した変更（指摘ではありません）</h3>
              <p>
                施工順変更版の目的どおりの変更です。指摘には含めていません。
              </p>
              <ul>
                {changes.map((c) => (
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
