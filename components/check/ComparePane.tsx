"use client";

import Image from "next/image";
import { useState } from "react";
import type { Finding } from "@/lib/check";
import { colorName, detailOf, reasonOf, sourceLabel } from "@/lib/findings";
import { REMOVE_REASONS, type RemoveReason } from "@/lib/useDecisions";
import BasisDocument from "./BasisDocument";
import styles from "./check.module.css";

type Numbered = Finding & { number: number };

// 右下の比較。施工図のいまの状態と根拠を並べ、なぜ問題かの一文と操作を出す
export default function ComparePane({
  finding,
  locked,
  base,
  publicView,
  onRemove,
}: {
  finding: Numbered | null;
  // 外せないとき（確定した図面、固定の結果）
  locked: boolean;
  base: string;
  publicView: boolean;
  onRemove: (why: RemoveReason) => void;
}) {
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const [removingFor, setRemovingFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  if (!finding) {
    return (
      <section className={styles.compare}>
        <p className={styles.compareEmpty}>
          左の一覧か図面の枠から指摘を選ぶと、施工図と根拠を並べて出します。
        </p>
      </section>
    );
  }
  const color = colorName(finding);
  const crop = finding.evidence[0];
  const opened = openedFor === finding.id;
  return (
    <section className={styles.compare} aria-label="施工図と根拠の比較">
      <header className={styles.compareHead} data-color={color}>
        <i className={`${styles.number} mono`} data-color={color}>
          {finding.number}
        </i>
        <h2>{finding.title}</h2>
        <span className={styles.colorTag} data-color={color}>
          {color === "red" ? "赤：" : "青："}
          {sourceLabel(finding)}
        </span>
      </header>
      <div className={styles.compareColumns}>
        <div className={styles.compareCard} data-side="sheet">
          <h3>施工図（いまの状態）</h3>
          {crop && (
            <Image
              src={`${base}/${crop.image}`}
              alt="施工図の該当箇所"
              width={800}
              height={500}
              unoptimized
            />
          )}
          {finding.sheet_value && (
            <p className={styles.compareValue}>{finding.sheet_value}</p>
          )}
        </div>
        <div className={styles.compareCard} data-side="basis">
          <h3>根拠（{sourceLabel(finding)}）</h3>
          <BasisDocument finding={finding} base={base} publicView={publicView} />
          {finding.design_value && (
            <p className={styles.compareValue}>{finding.design_value}</p>
          )}
        </div>
      </div>
      <p className={styles.reason}>{reasonOf(finding)}</p>
      {(finding.needs_confirmation || finding.severity === "要確認") && (
        <small className={styles.confirm}>
          図面だけでは言い切れません。人の確認が必要です。
        </small>
      )}
      <div className={styles.basisActions}>
        {!locked && (
          <button
            className={styles.ghost}
            aria-expanded={removingFor === finding.id}
            onClick={() =>
              setRemovingFor(removingFor === finding.id ? null : finding.id)
            }
          >
            この指摘を朱書きから外す
          </button>
        )}
        <button
          className={styles.ghost}
          aria-expanded={opened}
          onClick={() => setOpenedFor(opened ? null : finding.id)}
        >
          根拠資料を{opened ? "閉じる" : "開く"}
        </button>
      </div>
      {removingFor === finding.id && (
        <fieldset className={styles.removeForm}>
          <legend>外す理由（任意）。次のチェックに活かします</legend>
          {REMOVE_REASONS.map((name) => (
            <label key={name}>
              <input
                type="radio"
                name="remove-reason"
                checked={reason === name}
                onChange={() => setReason(name)}
              />
              {name}
            </label>
          ))}
          {reason === "その他" && (
            <input
              aria-label="その他の理由"
              placeholder="理由"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          )}
          <button
            className={styles.btn}
            onClick={() => {
              onRemove({ reason, note });
              setRemovingFor(null);
              setReason("");
              setNote("");
            }}
          >
            朱書きから外す
          </button>
        </fieldset>
      )}
      {opened && (
        <div className={styles.sources}>
          <p>{detailOf(finding)}</p>
          {finding.source_type !== "knowledge" &&
            !finding.minutes_refs?.length &&
            finding.sources &&
            finding.sources.length > 0 && (
              <ul>
                {finding.sources.map((source) => (
                  <li key={`${source.doc}${source.page}${source.where}`}>
                    {source.doc} {source.page}・{source.where}
                  </li>
                ))}
              </ul>
            )}
        </div>
      )}
    </section>
  );
}
