"use client";

import CountUp from "../CountUp";
import Link from "next/link";
import { useCallback } from "react";
import type { CheckResult, Finding } from "@/lib/check";
import { isBlue } from "@/lib/findings";
import type { ResultRow } from "@/lib/useUploadJob";
import styles from "./check.module.css";

type Numbered = Finding & { number: number };

function ResultRows({ rows }: { rows: ResultRow[] }) {
  return (
    <ul className={styles.rows}>
      {rows.map((row, index) => (
        <li key={`${row.id}-${index}`}>
          <b>
            <span className="mono">{row.id}</span> {row.result}
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

export type DrawingGroup = {
  key: string;
  title: string;
  // この結果の図面なら指摘と選ぶ操作がある。別の結果の図面は開くリンクにする
  findings: Numbered[] | null;
  href: string | null;
  red: number;
  blue: number;
};

function Items({
  label,
  color,
  findings,
  activeId,
  showActive,
  onSelect,
  newId,
}: {
  newId?: string | null;
  label: string;
  color: "red" | "blue";
  findings: Numbered[];
  activeId: string | null;
  showActive: (item: HTMLLIElement | null) => void;
  onSelect: (finding: Numbered) => void;
}) {
  if (findings.length === 0) return null;
  return (
    <>
      <h4 className={styles.colorHead} data-color={color}>
        {label} {findings.length}
      </h4>
      <ul className={styles.items}>
        {findings.map((finding) => {
          const active = finding.id === activeId;
          return (
            <li key={finding.id} ref={active ? showActive : undefined}>
              <button data-active={active} data-new={finding.id === newId} onClick={() => onSelect(finding)}>
                <i className={`${styles.number} mono`} data-color={color}>
                  {finding.number}
                </i>
                <span className={styles.itemBody}>
                  {finding.title}
                  {finding.manual && <em className={styles.badge}>手書き</em>}
                  {finding.edited && <em className={styles.badge}>編集済み</em>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

// 左の指摘の一覧。図面ごとにまとめ、開くと赤と青に分かれて並ぶ
export default function FindingList({
  groups,
  openKey,
  removed,
  onRestore,
  activeId,
  notes,
  changes,
  minutes,
  checklist,
  onSelect,
  onOpenGroup,
  newId,
}: {
  // 書き足した直後の朱書き。一覧で少し光らせる
  newId?: string | null;
  groups: DrawingGroup[];
  openKey: string | null;
  // 朱書きから消した指摘。たたんで見せ、元に戻せる
  removed: Numbered[];
  onRestore: (number: number) => void;
  activeId: string | null;
  notes?: string[];
  changes?: CheckResult["changes"];
  minutes?: ResultRow[] | null;
  checklist?: ResultRow[] | null;
  onSelect: (finding: Numbered) => void;
  onOpenGroup: (key: string) => void;
}) {
  // 枠から選んだときも、一覧の中で見えるようにする
  const showActive = useCallback((item: HTMLLIElement | null) => {
    item?.scrollIntoView({ block: "nearest" });
  }, []);
  return (
    <div className={styles.list}>
      <div className={styles.listBody}>
        {groups.map((group) =>
          group.findings ? (
            <details
              key={group.key}
              className={styles.drawingGroup}
              open={group.key === openKey}
            >
              <summary
                onClick={(event) => {
                  event.preventDefault();
                  onOpenGroup(group.key);
                }}
              >
                <b>{group.title}</b>
                <span className="mono">
                  <i data-color="red">赤<CountUp value={group.red} /></i>・<i data-color="blue">青<CountUp value={group.blue} /></i>
                </span>
              </summary>
              <Items
                label="赤"
                color="red"
                findings={group.findings.filter((f) => !isBlue(f))}
                activeId={activeId}
                newId={newId}
                showActive={showActive}
                onSelect={onSelect}
              />
              <Items
                label="青"
                color="blue"
                findings={group.findings.filter(isBlue)}
                activeId={activeId}
                newId={newId}
                showActive={showActive}
                onSelect={onSelect}
              />
            </details>
          ) : (
            <Link key={group.key} href={group.href ?? "#"} className={styles.drawingLink}>
              <b>{group.title}</b>
              <span className="mono">
                <i data-color="red">赤<CountUp value={group.red} /></i>・<i data-color="blue">青<CountUp value={group.blue} /></i>
              </span>
            </Link>
          ),
        )}
      </div>
      {removed.length > 0 && (
        <details className={styles.more}>
          <summary>消した指摘（{removed.length}）</summary>
          <ul className={styles.removedList}>
            {removed.map((finding) => (
              <li key={finding.id}>
                <span>{finding.title}</span>
                <button
                  className={styles.ghost}
                  onClick={() => onRestore(finding.number)}
                >
                  元に戻す
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <details className={styles.more}>
        <summary>このチェックについて</summary>
        <div>
          <p>AIが挙げた確認の候補です。確定する前に人が確認してください。</p>
          {notes?.map((note) => <p key={note}>{note}</p>)}
          {changes && changes.length > 0 && (
            <>
              <h3>意図した変更（指摘ではありません）</h3>
              <ul className={styles.rows}>
                {changes.map((c) => (
                  <li key={c.no}>
                    No.{c.no}（<span className="mono">{c.grid}</span>）：
                    {c.before} → {c.after} 番目
                  </li>
                ))}
              </ul>
            </>
          )}
          {minutes && (
            <>
              <h3>議事録の項目ごとの確認</h3>
              <ResultRows rows={minutes} />
            </>
          )}
          {checklist && (
            <>
              <h3>チェックリストの項目ごとの確認</h3>
              <ResultRows rows={checklist} />
            </>
          )}
        </div>
      </details>
    </div>
  );
}
