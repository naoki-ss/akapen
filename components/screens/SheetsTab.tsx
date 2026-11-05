"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import type { ShopSheet, ShopVersion } from "@/lib/sheetStatus";
import { useUploadJob } from "@/lib/useUploadJob";
import UploadPanel from "../UploadPanel";
import styles from "./ledger.module.css";
import screens from "./screens.module.css";

const dateText = (iso: string) =>
  new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tokyo",
  }).format(new Date(iso));

// 状態を変える操作。確定は取り消せないので、名前を入れてから押す
function StateActions({ version }: { version: ShopVersion }) {
  const router = useRouter();
  const [naming, setNaming] = useState(false);
  const [by, setBy] = useState("");
  const [error, setError] = useState("");
  if (version.page === null || version.state === "確定") return null;
  const send = async (state: string) => {
    setError("");
    const response = await fetch(`/api/check/${version.job}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page: version.page, state, by }),
    });
    if (response.ok) router.refresh();
    else setError((await response.json()).error);
  };
  return (
    <div className={styles.actions}>
      {version.state === "チェック中" && (
        <button className={styles.secondary} onClick={() => send("チェックバック済み")}>
          チェックバック済みにする
        </button>
      )}
      {naming ? (
        <>
          <input
            aria-label="担当者の名前"
            placeholder="担当者の名前"
            value={by}
            onChange={(e) => setBy(e.target.value)}
          />
          <button
            className={styles.secondary}
            disabled={!by.trim()}
            onClick={() => send("確定")}
          >
            確定する（取り消せません）
          </button>
        </>
      ) : (
        <button className={styles.secondary} onClick={() => setNaming(true)}>
          確定へ
        </button>
      )}
      {error && <span className={styles.error}>{error}</span>}
    </div>
  );
}

function ShopTable({ slug, shop }: { slug: string; shop: ShopSheet[] }) {
  if (shop.length === 0) {
    return <p className={styles.note}>施工図はまだありません。</p>;
  }
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>図名</th>
          <th>版</th>
          <th>状態</th>
          <th>指摘</th>
          <th />
          <th />
        </tr>
      </thead>
      <tbody>
        {shop.flatMap((sheet) =>
          [...sheet.versions].reverse().map((version, index) => (
            <tr key={`${sheet.key}-${version.version}`} data-old={index > 0}>
              <td>{index === 0 ? <b>{sheet.title}</b> : ""}</td>
              <td>
                第{version.version}版{index > 0 && "（旧版）"}
                <small className={styles.note}>
                  {" "}
                  {dateText(version.uploaded_at)}
                  {version.rejudged > 0 && `・判定し直し ${version.rejudged} 回`}
                </small>
              </td>
              <td>
                <b>{version.state}</b>
                {version.confirmed && (
                  <small className={styles.note}>
                    {" "}
                    {version.confirmed.by}・{dateText(version.confirmed.at)}
                  </small>
                )}
                {version.stale.length > 0 && index === 0 && (
                  <small className={styles.error}>
                    <br />
                    設計図書が更新されました。再チェックが必要です
                  </small>
                )}
              </td>
              <td className="mono">
                {version.page !== null && (
                  <>
                    <span className={styles.red}>赤{version.red}</span>・
                    <span className={styles.blue}>青{version.blue}</span>
                  </>
                )}
              </td>
              <td>
                {version.page !== null && (
                  <Link
                    className={styles.resultLink}
                    href={`/projects/${slug}/check/${version.job}`}
                  >
                    チェック結果を見る
                  </Link>
                )}
              </td>
              <td>
                <StateActions version={version} />
              </td>
            </tr>
          )),
        )}
      </tbody>
    </table>
  );
}

// 確定版の一覧
function ConfirmedList({ slug, shop }: { slug: string; shop: ShopSheet[] }) {
  const finals = shop.flatMap((sheet) =>
    sheet.versions
      .filter((version) => version.confirmed)
      .slice(-1)
      .map((version) => ({ sheet, version })),
  );
  if (finals.length === 0) {
    return <p className={styles.note}>確定した施工図はまだありません。</p>;
  }
  return (
    <ul className={styles.finals}>
      {finals.map(({ sheet, version }) => (
        <li key={sheet.key}>
          <Link href={`/projects/${slug}/check/${version.job}`}>{sheet.title}</Link>
          <small className={styles.note}>
            {" "}
            第{version.version}版・{version.confirmed?.by}・
            {version.confirmed && dateText(version.confirmed.at)}
          </small>
        </li>
      ))}
    </ul>
  );
}

export type SavedRow = { title: string; job: string; red: number; blue: number };

// 公開用の表示。固定の結果の図面を一覧にする
function SavedTable({ slug, rows }: { slug: string; rows: SavedRow[] }) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>図名</th>
          <th>指摘</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.title}>
            <td>
              <b>{row.title}</b>
            </td>
            <td className="mono">
              <span className={styles.red}>赤{row.red}</span>・
              <span className={styles.blue}>青{row.blue}</span>
            </td>
            <td>
              <Link className={styles.resultLink} href={`/projects/${slug}/check/${row.job}`}>
                チェック結果を見る
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// 施工図のタブ。一覧（版・状態・赤青）から④へ
export default function SheetsTab({
  slug,
  shop,
  saved,
  canUpload,
}: {
  slug: string;
  shop: ShopSheet[];
  saved: SavedRow[];
  canUpload: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(useSearchParams().get("add") === "1");
  const showResult = useCallback(
    (jobId: string) => router.push(`/projects/${slug}/check/${jobId}`),
    [router, slug],
  );
  const job = useUploadJob(slug, showResult);
  return (
    <div className={screens.page}>
      {canUpload && (
        <>
          <div className={screens.pageHead}>
            <button className={screens.action} onClick={() => setAdding(!adding)}>
              ＋ 施工図を入れる
            </button>
          </div>
          {adding && <UploadPanel job={job} />}
        </>
      )}
      {canUpload ? (
        <>
          <ShopTable slug={slug} shop={shop} />
          <h2 className={styles.heading}>確定版の一覧</h2>
          <ConfirmedList slug={slug} shop={shop} />
        </>
      ) : (
        <SavedTable slug={slug} rows={saved} />
      )}
    </div>
  );
}
