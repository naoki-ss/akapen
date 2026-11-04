"use client";

import { useCallback, useState } from "react";
import type { CheckResult, Finding } from "@/lib/check";
import { colorName } from "@/lib/findings";
import type { ResultRow } from "@/lib/useUploadJob";
import styles from "./check.module.css";

type Numbered = Finding & { number: number };
type Tab = "findings" | "minutes" | "checklist";

function ResultRows({ rows, lead }: { rows: ResultRow[]; lead: string }) {
  return (
    <div className={styles.listBody}>
      <p className={styles.lead}>{lead}</p>
      <ul className={styles.rows}>
        {rows.map((row) => (
          <li key={row.id}>
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
    </div>
  );
}

// 左の指摘一覧。入れた施工図の結果には、項目ごとの確認結果のタブが付く
export default function FindingList({
  findings,
  total,
  excluded,
  activeId,
  notes,
  changes,
  minutes,
  checklist,
  onSelect,
}: {
  findings: Numbered[];
  total: number;
  excluded: ReadonlySet<number>;
  activeId: string | null;
  notes?: string[];
  changes?: CheckResult["changes"];
  minutes?: ResultRow[] | null;
  checklist?: ResultRow[] | null;
  onSelect: (finding: Numbered) => void;
}) {
  const [tab, setTab] = useState<Tab>("findings");
  // 枠や3Dから選んだときも、一覧の中で見えるようにする
  const showActive = useCallback((item: HTMLLIElement | null) => {
    item?.scrollIntoView({ block: "nearest" });
  }, []);
  const tabs: { key: Tab; label: string }[] = [
    {
      key: "findings",
      label:
        findings.length === total
          ? `指摘 ${total}`
          : `指摘 ${findings.length} / ${total}`,
    },
    ...(minutes ? [{ key: "minutes" as Tab, label: "議事録" }] : []),
    ...(checklist ? [{ key: "checklist" as Tab, label: "チェックリスト" }] : []),
  ];

  return (
    <div className={styles.list}>
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
        <ResultRows
          rows={minutes}
          lead="議事録の項目ごとに、この施工図に関係するか、反映されているかを確認した結果です。"
        />
      ) : tab === "checklist" && checklist ? (
        <ResultRows rows={checklist} lead="社内チェックリストの項目ごとの確認結果です。" />
      ) : (
        <div className={styles.listBody}>
          <p className={styles.lead}>
            AIが挙げた確認候補です。確定する前に人が確認してください。
          </p>
          {notes?.map((note) => (
            <p key={note} className={styles.notice}>
              {note}
            </p>
          ))}
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
                    <span className={styles.itemBody}>
                      <b>{finding.title}</b>
                      <small>
                        <span className="mono">
                          {[
                            finding.members.floor,
                            ...finding.members.marks.slice(0, 2),
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        </span>
                        {(finding.needs_confirmation ||
                          finding.severity === "要確認") &&
                          " 要確認"}
                      </small>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {changes && changes.length > 0 && (
            <section className={styles.changes}>
              <h3>意図した変更（指摘ではありません）</h3>
              <ul>
                {changes.map((c) => (
                  <li key={c.no}>
                    No.{c.no}（<span className="mono">{c.grid}</span>）：{c.before}{" "}
                    → {c.after} 番目
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
