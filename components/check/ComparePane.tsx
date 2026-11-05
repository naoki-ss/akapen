"use client";

import { Maximize2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Finding } from "@/lib/check";
import {
  colorName,
  detailOf,
  reasonOf,
  regionsOf,
  sourceLabel,
} from "@/lib/findings";
import type { Sheet } from "@/lib/sheets";
import { REMOVE_REASONS, type RemoveReason } from "@/lib/useDecisions";
import BasisDocument from "./BasisDocument";
import styles from "./check.module.css";
import ZoomCrop from "./ZoomCrop";

type Numbered = Finding & { number: number };

// 右下の比較。施工図のいまの状態と根拠を並べ、なぜ問題かの一文と操作を出す
export default function ComparePane({
  finding,
  sheet,
  locked,
  base,
  publicView,
  onRemove,
}: {
  finding: Numbered | null;
  // その指摘の図面
  sheet: Sheet;
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
  // 施工図と根拠を並べたまま全画面で見る
  const [big, setBig] = useState(false);
  useEffect(() => {
    if (!big) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setBig(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [big]);
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
  const opened = openedFor === finding.id;
  const fileSource = finding.minutes_context
    ?.flatMap((block) => block.lines)
    .find((line) => line.hit && line.source)?.source;
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
      <div key={finding.id} className={styles.compareColumns} data-big={big}>
        {big && (
          <div className={styles.compareBigHead}>
            <i className={`${styles.number} mono`} data-color={color}>
              {finding.number}
            </i>
            <b>{finding.title}</b>
            <button className={styles.btn} onClick={() => setBig(false)}>
              <X size={14} /> 閉じる（Esc）
            </button>
          </div>
        )}
        <div className={styles.compareCard} data-side="sheet">
          <h3>
            施工図（いまの状態）
            {!big && (
              <button className={styles.expand} onClick={() => setBig(true)}>
                <Maximize2 size={12} /> 大きく開く
              </button>
            )}
          </h3>
          {finding.sheet_value && (
            <p className={styles.sheetReading}>{finding.sheet_value}</p>
          )}
          <ZoomCrop
            src={`${base}/${sheet.base_image ?? sheet.image}`}
            width={sheet.width}
            height={sheet.height}
            box={regionsOf(finding)[0]}
            color={color}
            alt="施工図の該当箇所"
          />
        </div>
        <div className={styles.compareCard} data-side="basis">
          <h3>
            根拠（{sourceLabel(finding)}）
            {!big && (
              <button className={styles.expand} onClick={() => setBig(true)}>
                <Maximize2 size={12} /> 大きく開く
              </button>
            )}
          </h3>
          <BasisDocument
            finding={finding}
            base={base}
            publicView={publicView}
          />
          {finding.design_value && (
            <p className={styles.compareValue}>{finding.design_value}</p>
          )}
        </div>
      </div>
      <div className={styles.compareFoot}>
        <p className={styles.reason}>{reasonOf(finding)}</p>
        {(finding.needs_confirmation || finding.severity === "要確認") && (
          <small className={styles.confirm}>
            図面だけでは言い切れません。人の確認が必要です。
          </small>
        )}
        <div className={styles.basisActions}>
          {!locked && (
            <button
              className={styles.btn}
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
            onClick={() => {
              // 議事録がファイルから作られていれば、元のファイルの該当ページも開く
              if (!opened && fileSource) window.open(fileSource.url, "_blank", "noopener");
              setOpenedFor(opened ? null : finding.id);
            }}
          >
            根拠資料を{opened ? "閉じる" : "開く"}
          </button>
        </div>
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
          {fileSource && (
            <p>
              <a href={fileSource.url} target="_blank" rel="noreferrer">
                {fileSource.excerpt ? "本文の該当箇所を開く" : "元のファイルを開く"}（{fileSource.file}
                {fileSource.page > 0 && ` p.${fileSource.page}`}）
              </a>
            </p>
          )}
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
