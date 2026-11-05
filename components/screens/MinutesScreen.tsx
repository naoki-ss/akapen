"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Minutes } from "@/lib/minutes";
import AppFrame from "../AppFrame";
import MinutesEditor from "../MinutesEditor";
import styles from "../Minutes.module.css";
import screens from "./screens.module.css";

// 議事録の全文と、決定事項・宿題・対象部位。編集と削除もここで行う
export default function MinutesScreen({
  slug,
  name,
  minutes,
}: {
  slug: string;
  name: string;
  minutes: Minutes;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const url = `/api/projects/${slug}/minutes/${minutes.id}`;
  const crumbs = [
    { label: "現場を選ぶ", href: "/" },
    { label: name, href: `/projects/${slug}` },
    { label: "議事録", href: `/projects/${slug}/minutes` },
    { label: minutes.title },
  ];
  return (
    <AppFrame crumbs={crumbs}>
      <div className={`${screens.page} ${styles.page}`}>
        <div className={screens.pageHead}>
          <h1>{minutes.title}</h1>
          {!editing && (
            <>
              <button className={styles.secondary} onClick={() => setEditing(true)}>
                直す
              </button>
              {deleting ? (
                <button
                  className={styles.stop}
                  onClick={async () => {
                    await fetch(url, { method: "DELETE" });
                    router.push(`/projects/${slug}/minutes`);
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
            </>
          )}
        </div>
        <p className={styles.note}>
          {minutes.date}・{minutes.method}で作成
        </p>
        {editing ? (
          <MinutesEditor
            initial={minutes}
            saving={saving}
            error={error}
            saveLabel="保存する"
            onCancel={() => setEditing(false)}
            onSave={async (draft) => {
              setSaving(true);
              const response = await fetch(url, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(draft),
              });
              setSaving(false);
              if (response.ok) {
                setEditing(false);
                router.refresh();
              } else setError((await response.json()).error);
            }}
          />
        ) : (
          <>
            <h2 className={styles.title}>決定事項（{minutes.decisions.length}）</h2>
            <ul className={styles.summary}>
              {minutes.decisions.map((row) => (
                <li key={row.id}>
                  <b className="mono">{row.id}</b> {row.text}
                  {[...row.floors, ...row.grids, ...row.members].length > 0 && (
                    <small className={styles.note}>
                      {" "}
                      対象：{[...row.floors, ...row.grids, ...row.members].join("、")}
                    </small>
                  )}
                </li>
              ))}
            </ul>
            <h2 className={styles.title}>宿題（{minutes.todos.length}）</h2>
            <ul className={styles.summary}>
              {minutes.todos.map((row) => (
                <li key={row.id}>{row.text}</li>
              ))}
            </ul>
            <h2 className={styles.title}>全文</h2>
            <div className={styles.fulltext}>{minutes.transcript}</div>
          </>
        )}
      </div>
    </AppFrame>
  );
}
