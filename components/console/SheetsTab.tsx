"use client";

import Link from "next/link";
import { useCallback } from "react";
import type { Finding } from "@/lib/check";
import { colorName } from "@/lib/findings";
import type { JobSummary } from "@/lib/useUploadJob";
import styles from "./console.module.css";

type Numbered = Finding & { number: number };

export type SheetRow = {
  key: string;
  title: string;
  detail: string;
  red: number;
  blue: number;
};

const dateFormat = new Intl.DateTimeFormat("ja-JP", {
  month: "numeric",
  day: "numeric",
  timeZone: "Asia/Tokyo",
});

function pagesText(pages: JobSummary["pages"]) {
  if (pages.length === 1) {
    return `p.${pages[0].number} ${pages[0].title ?? ""}`.trim();
  }
  const numbers = pages.map((page) => page.number);
  return `p.${numbers[0]}〜p.${numbers[numbers.length - 1]}（${numbers.length} ページ）`;
}

// 名前を付けた結果は、1ページのときの図面名も添える
export function rowOfJob(job: JobSummary): SheetRow {
  const title = job.label
    ? [job.label, job.pages.length === 1 ? job.pages[0].title : null]
        .filter(Boolean)
        .join(" ")
    : pagesText(job.pages);
  return {
    key: job.id,
    title,
    detail: [
      dateFormat.format(new Date(job.uploaded_at)),
      ...(job.stopped ? ["途中で止めた回"] : []),
      ...(job.masked ? [] : ["公開用の図面なし"]),
    ].join("・"),
    red: job.counts.design + job.counts.minutes,
    blue: job.counts.knowledge,
  };
}

// 施工図ごとの赤・青の数と、選んだ施工図のチェック箇所
export default function SheetsTab({
  slug,
  rows,
  rowKey,
  findings,
  loading,
  activeId,
  onRow,
  onFinding,
}: {
  slug: string;
  rows: SheetRow[];
  rowKey: string | null;
  findings: Numbered[];
  loading: boolean;
  activeId: string | null;
  onRow: (key: string) => void;
  onFinding: (finding: Numbered) => void;
}) {
  const showActive = useCallback((item: HTMLLIElement | null) => {
    item?.scrollIntoView({ block: "nearest" });
  }, []);
  if (rows.length === 0) {
    return (
      <p className={styles.empty}>
        チェックした施工図はまだありません。「施工図を追加」から入れてください。
      </p>
    );
  }
  return (
    <ul className={styles.sheetRows}>
      {rows.map((row) => {
        const open = row.key === rowKey;
        return (
          <li key={row.key}>
            <button
              className={styles.sheetRow}
              aria-expanded={open}
              onClick={() => onRow(row.key)}
            >
              <span>
                <b>{row.title}</b>
                <small>{row.detail}</small>
              </span>
              <i className="mono" data-color="red">
                {row.red}
              </i>
              <i className="mono" data-color="blue">
                {row.blue}
              </i>
            </button>
            {open && (
              <div className={styles.points}>
                {loading && <p className={styles.empty}>読み込み中…</p>}
                <ul>
                  {findings.map((finding) => {
                    const active = finding.id === activeId;
                    return (
                      <li
                        key={finding.id}
                        ref={active ? showActive : undefined}
                      >
                        <button
                          data-active={active}
                          onClick={() => onFinding(finding)}
                        >
                          <i className="mono" data-color={colorName(finding)}>
                            {finding.number}
                          </i>
                          <span>{finding.title}</span>
                        </button>
                        {active && (
                          <Link
                            className={styles.openCheck}
                            href={`/projects/${slug}/check/${row.key}?finding=${finding.id}`}
                          >
                            朱書きと根拠を開く →
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {!loading && (
                  <Link
                    className={styles.openCheck}
                    href={`/projects/${slug}/check/${row.key}`}
                  >
                    この施工図を開く →
                  </Link>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
