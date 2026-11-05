"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { MinutesSummary } from "@/lib/minutes";
import MinutesRecorder from "../MinutesRecorder";
import styles from "../Minutes.module.css";
import screens from "./screens.module.css";

// 議事録のタブ。履歴と、音声または貼り付けでの作成
export default function MinutesTab({
  slug,
  rows,
  canCreate,
}: {
  slug: string;
  rows: MinutesSummary[];
  canCreate: boolean;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  return (
    <div className={screens.page}>
      {canCreate && !creating && (
        <div className={screens.pageHead}>
          <button className={screens.action} onClick={() => setCreating(true)}>
            ＋ 議事録を作る
          </button>
        </div>
      )}
      {creating && (
        <MinutesRecorder
          slug={slug}
          inline
          onClose={() => setCreating(false)}
          onSaved={() => router.refresh()}
        />
      )}
      {rows.length === 0 ? (
        <p className={styles.note}>
          {canCreate ? "議事録はまだありません。" : "議事録は公開用の表示では出しません。"}
        </p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>日付</th>
              <th>題名</th>
              <th>決定事項</th>
              <th>作成方法</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="mono">{row.date}</td>
                <td>
                  <Link href={`/projects/${slug}/minutes/${row.id}`}>{row.title}</Link>
                </td>
                <td className="mono">{row.decisionCount} 件</td>
                <td>{row.method}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
