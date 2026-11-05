"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Ledger, Proposal, ProposedPage } from "@/lib/ledger";
import type { ShopSheet, ShopVersion } from "@/lib/sheetStatus";
import AppFrame from "../AppFrame";
import styles from "./ledger.module.css";
import screens from "./screens.module.css";

type Choice = { sheet: string; title: string };

// ページごとに、束ねる先を確かめて選ぶ。図名が合わないページは必ず選んでもらう
function ReviewSet({
  slug,
  id,
  initial,
  label,
  date,
  onDone,
}: {
  slug: string;
  id: string;
  initial: Proposal;
  label: string;
  date: string;
  onDone: () => void;
}) {
  const [proposal, setProposal] = useState(initial);
  const [choices, setChoices] = useState<Record<number, Choice>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const choiceOf = (page: ProposedPage): Choice =>
    choices[page.page] ?? { sheet: page.sheet ?? "", title: page.title };
  const pending = proposal.pages.filter((page) => {
    const choice = choiceOf(page);
    return !choice.sheet || (choice.sheet === "new" && !choice.title.trim());
  });

  const post = async (body: object) => {
    setBusy(true);
    setError("");
    const response = await fetch(`/api/projects/${slug}/ledger/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) setError(result.error);
    return response.ok ? result : null;
  };

  return (
    <section className={styles.review}>
      <h2>
        {label}：{proposal.pages.length} ページの束ねる先
      </h2>
      {pending.length > 0 && (
        <p className={styles.note}>
          赤い行は、図名が合わないか読めなかったページです。元のページを選ぶか、新しいページにしてください。
        </p>
      )}
      {proposal.unread > 0 && (
        <p className={styles.note}>
          図名を読めないページが {proposal.unread} 枚あります。{" "}
          <button
            className={styles.secondary}
            disabled={busy}
            onClick={async () => {
              const result = await post({ action: "read-titles" });
              if (result) setProposal(result.proposal);
            }}
          >
            AIで読む（約 {proposal.ai_usd} ドル）
          </button>
        </p>
      )}
      <table className={styles.table}>
        <thead>
          <tr>
            <th>p.</th>
            <th>図番</th>
            <th>図名</th>
            <th>束ねる先</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {proposal.pages.map((page) => {
            const choice = choiceOf(page);
            const bad = !choice.sheet || (choice.sheet === "new" && !choice.title.trim());
            return (
              <tr key={page.page} data-bad={bad}>
                <td className="mono">{page.page}</td>
                <td className="mono">{page.number}</td>
                <td>
                  {choice.sheet === "new" ? (
                    <input
                      aria-label={`p.${page.page} の図名`}
                      value={choice.title}
                      onChange={(e) =>
                        setChoices({
                          ...choices,
                          [page.page]: { ...choice, title: e.target.value },
                        })
                      }
                    />
                  ) : (
                    page.title || "（読めません）"
                  )}
                </td>
                <td>
                  <select
                    aria-label={`p.${page.page} の束ねる先`}
                    value={choice.sheet}
                    onChange={(e) =>
                      setChoices({
                        ...choices,
                        [page.page]: { ...choice, sheet: e.target.value },
                      })
                    }
                  >
                    <option value="">選んでください</option>
                    <option value="new">新しいページ</option>
                    {proposal.sheets.map((sheet) => (
                      <option key={sheet.id} value={sheet.id}>
                        {sheet.title}
                        {sheet.id === page.candidate ? "（同じ図番）" : ""}
                      </option>
                    ))}
                  </select>
                </td>
                <td className={styles.note}>{page.note}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {error && <p className={styles.error}>{error}</p>}
      <button
        className={screens.action}
        disabled={busy || pending.length > 0}
        onClick={async () => {
          const result = await post({
            action: "commit",
            label,
            date,
            assign: proposal.pages.map((page) => ({
              page: page.page,
              ...choiceOf(page),
            })),
          });
          if (result) onDone();
        }}
      >
        台帳に入れる
      </button>
    </section>
  );
}

function AddSet({ slug }: { slug: string }) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [incoming, setIncoming] = useState<{ id: string; proposal: Proposal } | null>(null);

  if (incoming) {
    return (
      <ReviewSet
        slug={slug}
        id={incoming.id}
        initial={incoming.proposal}
        label={label}
        date={date}
        onDone={() => {
          setIncoming(null);
          setLabel("");
          setDate("");
          router.refresh();
        }}
      />
    );
  }
  return (
    <div className={styles.add}>
      <label>
        版の名前
        <input
          placeholder="例：差替図面"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </label>
      <label>
        日付
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label>
        PDF
        <input
          type="file"
          accept=".pdf"
          aria-label="新しい版のPDF"
          disabled={!label.trim() || busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setBusy(true);
            setError("");
            const form = new FormData();
            form.append("file", file);
            const response = await fetch(`/api/projects/${slug}/ledger`, {
              method: "POST",
              body: form,
            });
            const body = await response.json();
            setBusy(false);
            if (response.ok) setIncoming(body);
            else setError(body.error);
          }}
        />
      </label>
      {busy && <span className={styles.note}>図番と図名を読んでいます…</span>}
      {error && <span className={styles.error}>{error}</span>}
    </div>
  );
}

// 設計図書の一覧。ページごとに版を束ねて見せる
function DesignTable({ ledger }: { ledger: Ledger }) {
  const setOf = (id: string) => ledger.sets.find((item) => item.id === id);
  if (ledger.sheets.length === 0) {
    return <p className={styles.note}>まだ台帳に入っていません。</p>;
  }
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>図番</th>
          <th>図名</th>
          <th>版</th>
        </tr>
      </thead>
      <tbody>
        {ledger.sheets.map((sheet) => {
          const latest = sheet.versions[sheet.versions.length - 1];
          return (
            <tr key={sheet.id}>
              <td className="mono">{latest.number}</td>
              <td>{sheet.title}</td>
              <td>
                <ol className={styles.versions}>
                  {sheet.versions.map((version) => (
                    <li
                      key={version.set}
                      data-latest={version === latest}
                      title={`${setOf(version.set)?.label} p.${version.page}`}
                    >
                      第{version.version}版
                      {version === latest ? "（最新）" : "（旧版）"}：
                      {setOf(version.set)?.label}
                      <small> p.{version.page}</small>
                    </li>
                  ))}
                </ol>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// 前の版から変わった部材。図面の文字を比べた結果を出す
function MemberChanges({ ledger }: { ledger: Ledger }) {
  const latestSet = ledger.sets[ledger.sets.length - 1];
  const previous = ledger.sets[ledger.sets.length - 2];
  if (!latestSet || !previous) return null;
  const changed = ledger.sheets.flatMap((sheet) => {
    const version = sheet.versions.find((item) => item.set === latestSet.id);
    const changes = version?.changes;
    return changes && (changes.rows.length || changes.marks.length)
      ? [{ sheet, changes }]
      : [];
  });
  if (changed.length === 0) return null;
  return (
    <details className={styles.changes}>
      <summary>
        {latestSet.label}で変わった部材（{changed.length} ページ）
      </summary>
      <p className={styles.note}>
        前の版と図面の文字を比べた結果です。符号の数と部材リストの行の違いを出しています。場所までは分かりません。3Dの作り直しは、確認してから行います。
      </p>
      {changed.map(({ sheet, changes }) => (
        <section key={sheet.id}>
          <h3>{sheet.title}</h3>
          {changes.rows.length > 0 && (
            <table className={styles.table}>
              <tbody>
                {changes.rows.map((row) => (
                  <tr key={row.mark}>
                    <td className="mono">{row.mark}</td>
                    <td>{row.before || "（なし）"}</td>
                    <td>→ {row.after || "（なし）"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {changes.marks.length > 0 && (
            <p className="mono">
              {changes.marks
                .map((mark) => `${mark.mark} ${mark.before}→${mark.after}か所`)
                .join("、")}
            </p>
          )}
        </section>
      ))}
    </details>
  );
}

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
          <th />
        </tr>
      </thead>
      <tbody>
        {shop.flatMap((sheet) =>
          sheet.versions.map((version) => (
            <tr key={`${sheet.key}-${version.version}`} data-state={version.state}>
              <td>{version.version === 1 ? sheet.title : ""}</td>
              <td>
                {version.page === null ? (
                  `第${version.version}版`
                ) : (
                  <Link href={`/projects/${slug}/check/${version.job}`}>
                    第{version.version}版
                  </Link>
                )}
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
                {version.stale.length > 0 && (
                  <small className={styles.error}>
                    <br />
                    設計図書が更新されました。再チェックが必要です
                  </small>
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

// 図面台帳
export default function LedgerScreen({
  slug,
  name,
  ledger,
  canAdd,
  shop,
}: {
  slug: string;
  name: string;
  ledger: Ledger;
  canAdd: boolean;
  shop: ShopSheet[];
}) {
  return (
    <AppFrame
      crumbs={[
        { label: "現場を選ぶ", href: "/" },
        { label: name, href: `/projects/${slug}` },
        { label: "図面台帳" },
      ]}
    >
      <div className={screens.page}>
        <div className={screens.pageHead}>
          <h1>図面台帳</h1>
        </div>
        {canAdd && (
          <>
            <h2 className={styles.heading}>確定版の一覧</h2>
            <ConfirmedList slug={slug} shop={shop} />
            <h2 className={styles.heading}>施工図</h2>
            <ShopTable slug={slug} shop={shop} />
          </>
        )}
        <h2 className={styles.heading}>設計図書</h2>
        {canAdd && <AddSet slug={slug} />}
        <MemberChanges ledger={ledger} />
        <DesignTable ledger={ledger} />
      </div>
    </AppFrame>
  );
}
