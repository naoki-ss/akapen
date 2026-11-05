"use client";

import { X, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ImportEstimate, KnowledgeItem, KnowledgeRow } from "@/lib/knowledge";
import AppFrame from "../AppFrame";
import styles from "./knowledge.module.css";
import screens from "./screens.module.css";

// 画面で編集するときは、確認することと基準を改行で区切った文で持つ
type Row = {
  key: number;
  section: string;
  item: string;
  checks: string;
  criteria: string;
  drawing_types: string[];
  note: string;
  drawing_checkable: boolean;
  source_page: string;
};

const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

let nextKey = 1;
const emptyRow = (): Row => ({
  key: nextKey++,
  section: "",
  item: "",
  checks: "",
  criteria: "",
  drawing_types: [],
  note: "",
  drawing_checkable: true,
  source_page: "",
});
const toRow = (item: KnowledgeItem): Row => ({
  key: nextKey++,
  section: item.section,
  item: item.item,
  checks: item.checks.join("\n"),
  criteria: item.criteria.join("\n"),
  drawing_types: item.drawing_types,
  note: item.note,
  drawing_checkable: item.drawing_checkable,
  source_page: item.source_page,
});
const fromList = (row: KnowledgeRow): Row => ({
  key: nextKey++,
  section: row.section,
  item: row.item,
  checks: row.checks.join("\n"),
  criteria: row.criteria.join("\n"),
  drawing_types: row.drawing_types,
  note: row.note,
  drawing_checkable: row.drawing_checkable,
  source_page: row.source.page,
});
const toItem = (row: Row): KnowledgeItem => ({
  section: row.section,
  item: row.item,
  checks: lines(row.checks),
  criteria: lines(row.criteria),
  drawing_types: row.drawing_types,
  note: row.note,
  drawing_checkable: row.drawing_checkable,
  source_page: row.source_page,
});
const isComplete = (row: Row) =>
  Boolean(row.item.trim() && lines(row.checks).length && row.drawing_types.length);

// 対象の図面の種類を選ぶ。決まった種類にないものは「その他」で語を入れる
function KindPicker({
  kinds,
  value,
  onChange,
}: {
  kinds: string[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [other, setOther] = useState(false);
  const add = (name: string) => {
    const word = name.trim();
    if (word && !value.includes(word)) onChange([...value, word]);
  };
  return (
    <div className={styles.field}>
      対象の図面の種類
      <div className={styles.chips}>
        {value.map((name) => (
          <button
            key={name}
            type="button"
            aria-label={`${name} を外す`}
            onClick={() => onChange(value.filter((item) => item !== name))}
          >
            {name} <X size={12} />
          </button>
        ))}
      </div>
      {other ? (
        <input
          autoFocus
          placeholder="図面の題名に含まれる語"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(e.currentTarget.value);
              setOther(false);
            }
          }}
          onBlur={(e) => {
            add(e.currentTarget.value);
            setOther(false);
          }}
        />
      ) : (
        <select
          value=""
          aria-label="図面の種類を足す"
          onChange={(e) => {
            if (e.target.value === "__other") setOther(true);
            else add(e.target.value);
          }}
        >
          <option value="">種類を足す…</option>
          {kinds
            .filter((name) => !value.includes(name))
            .map((name) => (
              <option key={name}>{name}</option>
            ))}
          <option value="__other">その他（語を入れる）</option>
        </select>
      )}
    </div>
  );
}

function RowFields({
  row,
  kinds,
  onChange,
  onRemove,
}: {
  row: Row;
  kinds: string[];
  onChange: (row: Row) => void;
  onRemove?: () => void;
}) {
  const text = (label: string, key: "section" | "item" | "note") => (
    <label className={styles.field}>
      {label}
      <input
        value={row[key]}
        onChange={(e) => onChange({ ...row, [key]: e.target.value })}
      />
    </label>
  );
  const area = (label: string, key: "checks" | "criteria") => (
    <label className={styles.field}>
      {label}
      <textarea
        rows={3}
        value={row[key]}
        onChange={(e) => onChange({ ...row, [key]: e.target.value })}
      />
    </label>
  );
  return (
    <div className={styles.row} data-bad={!isComplete(row)}>
      <div>
        {text("区分", "section")}
        {text("補足", "note")}
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={row.drawing_checkable}
            onChange={(e) =>
              onChange({ ...row, drawing_checkable: e.target.checked })
            }
          />
          図面で確認できる
        </label>
      </div>
      {text("チェック項目", "item")}
      {area("確認すること（1行に1つ）", "checks")}
      {area("判断の基準（1行に1つ）", "criteria")}
      <KindPicker
        kinds={kinds}
        value={row.drawing_types}
        onChange={(drawing_types) => onChange({ ...row, drawing_types })}
      />
      {onRemove && (
        <button
          type="button"
          className={styles.remove}
          aria-label="この項目を消す"
          onClick={onRemove}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

type Stage =
  | { name: "pick" }
  | { name: "estimate"; id: string; estimate: ImportEstimate; file: string }
  | { name: "running"; id: string; seconds: number }
  | { name: "review"; id: string }
  | { name: "done"; count: number };

function FileFlow({ kinds, onAdded }: { kinds: string[]; onAdded: () => void }) {
  const [stage, setStage] = useState<Stage>({ name: "pick" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<Row[]>([]);

  const runningId = stage.name === "running" ? stage.id : null;
  useEffect(() => {
    if (!runningId) return;
    const started = Date.now();
    const timer = setInterval(async () => {
      const response = await fetch(`/api/knowledge/${runningId}`);
      const status = await response.json();
      setStage((current) =>
        current.name === "running"
          ? { ...current, seconds: Math.round((Date.now() - started) / 1000) }
          : current,
      );
      if (status.state === "stopped") {
        clearInterval(timer);
        setStage({ name: "pick" });
      } else if (status.state === "error") {
        clearInterval(timer);
        setError("整理の途中で止まりました。もう一度ファイルを入れてください。");
        setStage({ name: "pick" });
      } else if (status.state === "done" && status.draft) {
        clearInterval(timer);
        setRows(status.draft.items.map(toRow));
        setStage({ name: "review", id: runningId });
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [runningId]);

  const upload = async (file: File) => {
    setBusy(true);
    setError("");
    const form = new FormData();
    form.append("file", file);
    const response = await fetch("/api/knowledge", {
      method: "POST",
      body: form,
    });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) setError(body.error);
    else setStage({ name: "estimate", id: body.id, estimate: body.estimate, file: file.name });
  };

  if (stage.name === "pick") {
    return (
      <div className={styles.card}>
        <p>
          PDF・Word・Excel・CSVを入れると、Claudeが「チェック項目・確認すること・判断の基準・対象の図面の種類」に分けます。kintoneから書き出したCSVも入れられます。登録の前に確かめて直せます。
        </p>
        <input
          type="file"
          aria-label="ファイルを選ぶ"
          accept=".pdf,.docx,.xlsx,.xlsm,.csv,.txt,.md"
          disabled={busy}
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
        />
        {busy && <p className={styles.note}>ファイルを読んでいます…</p>}
        {error && <p className={styles.error}>{error}</p>}
      </div>
    );
  }
  if (stage.name === "estimate") {
    const { estimate } = stage;
    return (
      <div className={styles.card}>
        <p>
          <b>{stage.file}</b>
        </p>
        <p>
          文字 {estimate.chars.toLocaleString()} 字
          {estimate.image_pages > 0 && `、文字のないページ ${estimate.image_pages} 枚`}
        </p>
        <p>
          費用の目安：<b className="mono">約 {estimate.usd} ドル</b>
          （多くても {estimate.usd_high} ドルほど）
        </p>
        <p className={styles.note}>
          ファイルの内容はAnthropicのAPIへ送られます。登録するまで判定には使いません。
        </p>
        <div className={styles.actions}>
          <button
            className={screens.action}
            onClick={async () => {
              await fetch(`/api/knowledge/${stage.id}/start`, { method: "POST" });
              setStage({ name: "running", id: stage.id, seconds: 0 });
            }}
          >
            整理を始める
          </button>
          <button className={styles.secondary} onClick={() => setStage({ name: "pick" })}>
            やめる
          </button>
        </div>
      </div>
    );
  }
  if (stage.name === "running") {
    return (
      <div className={styles.card}>
        <p>
          Claudeが項目に分けています… <span className="mono">{stage.seconds} 秒</span>
        </p>
        <button
          className={styles.secondary}
          onClick={() =>
            fetch(`/api/knowledge/${stage.id}/stop`, { method: "POST" })
          }
        >
          止める
        </button>
      </div>
    );
  }
  if (stage.name === "done") {
    return (
      <div className={styles.card}>
        <p>
          {stage.count} 項目を登録しました。これからの施工図のチェックで、対象の図面の種類に合わせて使います。
        </p>
        <button className={styles.secondary} onClick={() => setStage({ name: "pick" })}>
          別のファイルを入れる
        </button>
      </div>
    );
  }
  const ready = rows.length > 0 && rows.every(isComplete);
  return (
    <>
      <p className={styles.note}>
        整理の結果を確かめて、直してから登録してください。要らない項目は × で外せます。赤い枠は、チェック項目、確認すること、対象の図面の種類のどれかが空です。
      </p>
      <div className={styles.rows}>
        {rows.map((row) => (
          <RowFields
            key={row.key}
            row={row}
            kinds={kinds}
            onChange={(next) =>
              setRows(rows.map((item) => (item.key === row.key ? next : item)))
            }
            onRemove={() => setRows(rows.filter((item) => item.key !== row.key))}
          />
        ))}
      </div>
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.actions}>
        <button className={styles.secondary} onClick={() => setRows([...rows, emptyRow()])}>
          <Plus size={14} /> 項目を足す
        </button>
        <button
          className={screens.action}
          disabled={!ready || busy}
          onClick={async () => {
            setBusy(true);
            const response = await fetch(`/api/knowledge/${stage.id}/register`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ items: rows.map(toItem) }),
            });
            const body = await response.json();
            setBusy(false);
            if (response.ok) {
              setStage({ name: "done", count: body.items });
              onAdded();
            } else setError(body.error);
          }}
        >
          {rows.length} 項目を登録する
        </button>
      </div>
    </>
  );
}

function FormFlow({ kinds, onAdded }: { kinds: string[]; onAdded: () => void }) {
  const [row, setRow] = useState<Row>(emptyRow);
  const [added, setAdded] = useState(0);
  const [error, setError] = useState("");
  return (
    <>
      <RowFields row={row} kinds={kinds} onChange={setRow} />
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.actions}>
        <button
          className={screens.action}
          disabled={!isComplete(row)}
          onClick={async () => {
            const response = await fetch("/api/knowledge/items", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(toItem(row)),
            });
            if (response.ok) {
              setAdded(added + 1);
              setError("");
              onAdded();
              // 同じ図面の項目を続けて足しやすいよう、種類と区分は残す
              setRow({ ...emptyRow(), section: row.section, drawing_types: row.drawing_types });
            } else {
              setError((await response.json()).error);
            }
          }}
        >
          この項目を追加する
        </button>
        {added > 0 && <span className={styles.note}>{added} 項目を追加しました</span>}
      </div>
    </>
  );
}

// 一覧の1行。開くと直せる。消すのは2回押す
function ListRow({ row, kinds }: { row: KnowledgeRow; kinds: string[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Row | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const url = `/api/knowledge/items/${encodeURIComponent(row.id)}`;
  if (editing) {
    return (
      <tr>
        <td colSpan={5}>
          <RowFields row={editing} kinds={kinds} onChange={setEditing} />
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.actions}>
            <button
              className={screens.action}
              disabled={!isComplete(editing)}
              onClick={async () => {
                const response = await fetch(url, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(toItem(editing)),
                });
                if (response.ok) {
                  setEditing(null);
                  router.refresh();
                } else setError((await response.json()).error);
              }}
            >
              保存する
            </button>
            <button className={styles.secondary} onClick={() => setEditing(null)}>
              やめる
            </button>
          </div>
        </td>
      </tr>
    );
  }
  return (
    <tr>
      <td>
        <b>{row.item}</b>
        {!row.drawing_checkable && <small className={styles.note}>（現地確認）</small>}
        <br />
        <small className={styles.note}>{row.checks.join("／")}</small>
      </td>
      <td>{row.drawing_types.join("、")}</td>
      <td>
        {row.source.file}
        {row.source.page && ` ${row.source.page}`}
      </td>
      <td className="mono">{row.added_at}</td>
      <td className={styles.rowActions}>
        <button className={styles.secondary} onClick={() => setEditing(fromList(row))}>
          直す
        </button>
        {deleting ? (
          <button
            className={styles.secondary}
            onClick={async () => {
              await fetch(url, { method: "DELETE" });
              setDeleting(false);
              router.refresh();
            }}
          >
            本当に消す
          </button>
        ) : (
          <button className={styles.secondary} onClick={() => setDeleting(true)}>
            消す
          </button>
        )}
      </td>
    </tr>
  );
}

const LIST_LIMIT = 200;

// ナレッジ。環境で共通で、どの物件の施工図チェックでも使う
export default function KnowledgeScreen({
  enabled,
  rows,
  kinds,
}: {
  enabled: boolean;
  rows: KnowledgeRow[];
  kinds: string[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"list" | "file" | "form">("list");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const crumbs = [{ label: "現場を選ぶ", href: "/" }, { label: "ナレッジ" }];
  const refresh = () => router.refresh();
  const shown = rows.filter(
    (row) =>
      (!kind || row.drawing_types.includes(kind)) &&
      (!query.trim() ||
        `${row.item} ${row.checks.join(" ")} ${row.source.file}`.includes(query.trim())),
  );
  const usedKinds = [...new Set(rows.flatMap((row) => row.drawing_types))];
  return (
    <AppFrame crumbs={crumbs}>
      <div className={screens.page}>
        <div className={screens.pageHead}>
          <h1>ナレッジ</h1>
        </div>
        {!enabled ? (
          <p className={styles.note}>
            社内のチェックリストは公開用の環境では表示しません。
          </p>
        ) : (
          <>
            <p className={styles.note}>
              全部の物件で共通です。施工図の種類に合う項目を、青の指摘の判定に使います。
            </p>
            <div className={styles.tabs}>
              <button aria-pressed={mode === "list"} onClick={() => setMode("list")}>
                一覧（{rows.length}）
              </button>
              <button aria-pressed={mode === "file"} onClick={() => setMode("file")}>
                ファイルをアップロード
              </button>
              <button aria-pressed={mode === "form"} onClick={() => setMode("form")}>
                1件ずつ追加
              </button>
            </div>
            {mode === "file" && <FileFlow kinds={kinds} onAdded={refresh} />}
            {mode === "form" && <FormFlow kinds={kinds} onAdded={refresh} />}
            {mode === "list" && (
              <>
                <div className={styles.filters}>
                  <input
                    className={screens.search}
                    type="search"
                    placeholder="項目やファイル名で探す"
                    aria-label="項目やファイル名で探す"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <select
                    className={screens.search}
                    aria-label="対象の図面の種類で絞り込む"
                    value={kind}
                    onChange={(e) => setKind(e.target.value)}
                  >
                    <option value="">すべての種類</option>
                    {usedKinds.map((name) => (
                      <option key={name}>{name}</option>
                    ))}
                  </select>
                  <span className={styles.note}>{shown.length} 件</span>
                </div>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>項目</th>
                      <th>対象の図面</th>
                      <th>出典</th>
                      <th>登録日</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.slice(0, LIST_LIMIT).map((row) => (
                      <ListRow key={row.id} row={row} kinds={kinds} />
                    ))}
                  </tbody>
                </table>
                {shown.length > LIST_LIMIT && (
                  <p className={styles.note}>
                    先頭の {LIST_LIMIT} 件を出しています。探す語や種類で絞り込んでください。
                  </p>
                )}
              </>
            )}
          </>
        )}
      </div>
    </AppFrame>
  );
}
