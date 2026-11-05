"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ImportEstimate, KnowledgeItem } from "@/lib/knowledge";
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
});
const toRow = (item: KnowledgeItem): Row => ({
  key: nextKey++,
  section: item.section,
  item: item.item,
  checks: item.checks.join("\n"),
  criteria: item.criteria.join("\n"),
  drawing_types: item.drawing_types,
  note: item.note,
});
const toItem = (row: Row): KnowledgeItem => ({
  section: row.section,
  item: row.item,
  checks: lines(row.checks),
  criteria: lines(row.criteria),
  drawing_types: row.drawing_types,
  note: row.note,
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
            {name} ×
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
          ×
        </button>
      )}
    </div>
  );
}

type Stage =
  | { name: "pick" }
  | { name: "estimate"; id: string; estimate: ImportEstimate; file: string }
  | { name: "running"; id: string }
  | { name: "review"; id: string }
  | { name: "done"; count: number };

function FileFlow({ kinds }: { kinds: string[] }) {
  const [stage, setStage] = useState<Stage>({ name: "pick" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [rows, setRows] = useState<Row[]>([]);

  const runningId = stage.name === "running" ? stage.id : null;
  useEffect(() => {
    if (!runningId) return;
    const timer = setInterval(async () => {
      const response = await fetch(`/api/knowledge/${runningId}`);
      const status = await response.json();
      if (status.state === "error") {
        clearInterval(timer);
        setError("整理の途中で止まりました。もう一度ファイルを入れてください。");
        setStage({ name: "pick" });
      } else if (status.state === "done" && status.draft) {
        clearInterval(timer);
        setTitle(status.draft.name);
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
          Excel・CSV・PDF・テキストを入れると、AIが「チェック項目・確認すること・判断の基準・対象の図面の種類」に整理します。kintoneから書き出したCSVも入れられます。
        </p>
        <input
          type="file"
          aria-label="ファイルを選ぶ"
          accept=".xlsx,.xlsm,.csv,.pdf,.txt,.md"
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
              setStage({ name: "running", id: stage.id });
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
    return <div className={styles.card}>AIが項目に整理しています…</div>;
  }
  if (stage.name === "done") {
    return (
      <div className={styles.card}>
        {stage.count} 項目を登録しました。これからの施工図のチェックで、対象の図面の種類に合わせて使います。
      </div>
    );
  }
  const ready = rows.length > 0 && rows.every(isComplete);
  return (
    <>
      <label className={styles.field} style={{ maxWidth: 480 }}>
        ナレッジの名前
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <p className={styles.note}>
        AIの整理を確かめて、直してから登録してください。赤い枠は、チェック項目、確認すること、対象の図面の種類のどれかが空です。
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
          ＋ 項目を足す
        </button>
        <button
          className={screens.action}
          disabled={!ready || busy}
          onClick={async () => {
            setBusy(true);
            const response = await fetch(`/api/knowledge/${stage.id}/register`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: title, items: rows.map(toItem) }),
            });
            const body = await response.json();
            setBusy(false);
            if (response.ok) setStage({ name: "done", count: body.items });
            else setError(body.error);
          }}
        >
          {rows.length} 項目を登録する
        </button>
      </div>
    </>
  );
}

function FormFlow({ kinds }: { kinds: string[] }) {
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

// ナレッジを追加する。追加したものは施工図の種類から自動で選ばれる
export default function KnowledgeScreen({
  kinds,
  back,
}: {
  kinds: string[];
  back: { href: string; label: string } | null;
}) {
  const [mode, setMode] = useState<"file" | "form">("file");
  const crumbs = [
    { label: "現場を選ぶ", href: "/" },
    ...(back ? [{ label: back.label, href: back.href }] : []),
    { label: "ナレッジを追加" },
  ];
  return (
    <AppFrame crumbs={crumbs}>
      <div className={screens.page}>
        <div className={screens.pageHead}>
          <h1>ナレッジを追加</h1>
          {back && <Link href={back.href}>現場に戻る</Link>}
        </div>
        <div className={styles.tabs}>
          <button aria-pressed={mode === "file"} onClick={() => setMode("file")}>
            ファイルで追加
          </button>
          <button aria-pressed={mode === "form"} onClick={() => setMode("form")}>
            1項目ずつ追加
          </button>
        </div>
        {mode === "file" ? <FileFlow kinds={kinds} /> : <FormFlow kinds={kinds} />}
      </div>
    </AppFrame>
  );
}
