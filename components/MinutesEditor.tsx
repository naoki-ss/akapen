"use client";

import { X, Plus } from "lucide-react";
import { useState } from "react";
import type { Decision, Minutes, Todo } from "@/lib/minutes";
import styles from "./Minutes.module.css";

type Draft = Omit<Minutes, "id">;

const splitWords = (text: string) =>
  text
    .split(/[、,\s]+/)
    .map((word) => word.trim())
    .filter(Boolean);

function DecisionRow({
  value,
  onChange,
  onRemove,
}: {
  value: Decision;
  onChange: (next: Decision) => void;
  onRemove: () => void;
}) {
  const words = (label: string, key: "grids" | "floors" | "members") => (
    <label>
      {label}
      <input
        defaultValue={value[key].join("、")}
        onBlur={(e) => onChange({ ...value, [key]: splitWords(e.target.value) })}
      />
    </label>
  );
  return (
    <li className={styles.row}>
      <label className={styles.wide}>
        決定事項
        <textarea
          rows={2}
          value={value.text}
          onChange={(e) => onChange({ ...value, text: e.target.value })}
        />
      </label>
      {value.page ? <small className={styles.pageRef}>出典 p.{value.page}</small> : null}
      {value.quote ? <small className={styles.quoteRef}>原文：{value.quote}</small> : null}
      {words("通り芯", "grids")}
      {words("階", "floors")}
      {words("部材", "members")}
      <button
        type="button"
        className={styles.remove}
        aria-label="この決定事項を消す"
        onClick={onRemove}
      >
        <X size={14} />
      </button>
    </li>
  );
}

// 議事録の編集。⑤で作るときと、履歴から直すときに同じものを使う
export default function MinutesEditor({
  initial,
  saving,
  error,
  saveLabel,
  onSave,
  onCancel,
}: {
  initial: Draft;
  saving: boolean;
  error: string;
  saveLabel: string;
  onSave: (draft: Draft) => void;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [keys, setKeys] = useState(() => initial.decisions.map((_, index) => index));
  const [nextKey, setNextKey] = useState(initial.decisions.length);
  const update = (values: Partial<Draft>) => setDraft({ ...draft, ...values });
  const setTodo = (index: number, todo: Todo) =>
    update({ todos: draft.todos.map((item, i) => (i === index ? todo : item)) });
  return (
    <div className={styles.editor}>
      <div className={styles.head}>
        <label className={styles.wide}>
          題名
          <input value={draft.title} onChange={(e) => update({ title: e.target.value })} />
        </label>
        <label>
          日付
          <input
            type="date"
            value={draft.date}
            onChange={(e) => update({ date: e.target.value })}
          />
        </label>
      </div>
      <h3>決定事項</h3>
      <ul className={styles.list}>
        {draft.decisions.map((decision, index) => (
          <DecisionRow
            key={keys[index]}
            value={decision}
            onChange={(next) =>
              update({
                decisions: draft.decisions.map((item, i) => (i === index ? next : item)),
              })
            }
            onRemove={() => {
              update({ decisions: draft.decisions.filter((_, i) => i !== index) });
              setKeys(keys.filter((_, i) => i !== index));
            }}
          />
        ))}
      </ul>
      <button
        type="button"
        className={styles.secondary}
        onClick={() => {
          update({
            decisions: [
              ...draft.decisions,
              { id: "", text: "", grids: [], floors: [], members: [] },
            ],
          });
          setKeys([...keys, nextKey]);
          setNextKey(nextKey + 1);
        }}
      >
        <Plus size={14} /> 決定事項を足す
      </button>
      <h3>宿題</h3>
      <ul className={styles.list}>
        {draft.todos.map((todo, index) => (
          <li key={index} className={styles.todo}>
            <input
              aria-label={`宿題 ${index + 1}`}
              value={todo.text}
              onChange={(e) => setTodo(index, { ...todo, text: e.target.value })}
            />
            <button
              type="button"
              className={styles.remove}
              aria-label="この宿題を消す"
              onClick={() =>
                update({ todos: draft.todos.filter((_, i) => i !== index) })
              }
            >
              <X size={14} />
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className={styles.secondary}
        onClick={() => update({ todos: [...draft.todos, { id: "", text: "" }] })}
      >
        <Plus size={14} /> 宿題を足す
      </button>
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primary}
          disabled={saving || !draft.title.trim() || !draft.date}
          onClick={() => onSave(draft)}
        >
          {saveLabel}
        </button>
        {onCancel && (
          <button type="button" className={styles.secondary} onClick={onCancel}>
            やめる
          </button>
        )}
      </div>
    </div>
  );
}
