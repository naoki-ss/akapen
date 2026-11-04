"use client";

import { useCallback } from "react";
import type { CheckResult, Finding } from "@/lib/check";
import { colorName } from "@/lib/findings";
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

// 左の指摘の一覧。題名だけを並べ、そのほかは下にたたむ
export default function FindingList({
  findings,
  excluded,
  activeId,
  notes,
  changes,
  minutes,
  checklist,
  onSelect,
}: {
  findings: Numbered[];
  excluded: ReadonlySet<number>;
  activeId: string | null;
  notes?: string[];
  changes?: CheckResult["changes"];
  minutes?: ResultRow[] | null;
  checklist?: ResultRow[] | null;
  onSelect: (finding: Numbered) => void;
}) {
  // 枠から選んだときも、一覧の中で見えるようにする
  const showActive = useCallback((item: HTMLLIElement | null) => {
    item?.scrollIntoView({ block: "nearest" });
  }, []);
  return (
    <div className={styles.list}>
      <div className={styles.listBody}>
        <ul className={styles.items}>
          {findings.map((finding) => {
            const active = finding.id === activeId;
            return (
              <li key={finding.id} ref={active ? showActive : undefined}>
                <button
                  data-active={active}
                  data-off={excluded.has(finding.number)}
                  onClick={() => onSelect(finding)}
                >
                  <i
                    className={`${styles.number} mono`}
                    data-color={colorName(finding)}
                  >
                    {finding.number}
                  </i>
                  <span className={styles.itemBody}>{finding.title}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
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
