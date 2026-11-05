"use client";

import { useState } from "react";
import type { Finding } from "@/lib/check";
import {
  colorName,
  detailOf,
  reasonOf,
  regionsOf,
  sourceLabel,
} from "@/lib/findings";
import type { Box, Sheet } from "@/lib/sheets";
import { REMOVE_REASONS, type RemoveReason } from "@/lib/useDecisions";
import BasisDocument from "./BasisDocument";
import styles from "./check.module.css";

type Numbered = Finding & { number: number };

// 切り抜きの枠の縦横比
const CROP_ASPECT = 2;
const CROP_PADDING = 1.5;
const MIN_WINDOW = 0.1;

// 該当箇所のまわりを、同じ比率で図面から切り出して見せる。余白が出ないよう図面の中に収める
function SheetCrop({
  sheet,
  base,
  region,
  color,
}: {
  sheet: Sheet;
  base: string;
  region: Box;
  color: "red" | "blue";
}) {
  const ratio = sheet.width / sheet.height;
  const [x0, y0, x1, y1] = region;
  let high = Math.max(
    (y1 - y0) * CROP_PADDING,
    ((x1 - x0) * CROP_PADDING * ratio) / CROP_ASPECT,
    MIN_WINDOW,
  );
  let wide = (high * CROP_ASPECT) / ratio;
  if (wide > 1) {
    high /= wide;
    wide = 1;
  }
  if (high > 1) {
    wide /= high;
    high = 1;
  }
  const left = Math.min(1 - wide, Math.max(0, (x0 + x1 - wide) / 2));
  const top = Math.min(1 - high, Math.max(0, (y0 + y1 - high) / 2));
  return (
    <div className={styles.sheetCrop} style={{ aspectRatio: CROP_ASPECT }}>
      {/* 図面の一部を拡大して切り出すので、next/image の最適化は使わない */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`${base}/${sheet.base_image ?? sheet.image}`}
        alt="施工図の該当箇所"
        style={{
          width: `${100 / wide}%`,
          height: `${100 / high}%`,
          left: `${(-left / wide) * 100}%`,
          top: `${(-top / high) * 100}%`,
        }}
      />
      <span
        className={styles.docBox}
        data-color={color}
        style={{
          left: `${((x0 - left) / wide) * 100}%`,
          top: `${((y0 - top) / high) * 100}%`,
          width: `${((x1 - x0) / wide) * 100}%`,
          height: `${((y1 - y0) / high) * 100}%`,
        }}
      />
    </div>
  );
}

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
      <div key={finding.id} className={styles.compareColumns}>
        <div className={styles.compareCard} data-side="sheet">
          <h3>施工図（いまの状態）</h3>
          {finding.sheet_value && (
            <p className={styles.sheetReading}>{finding.sheet_value}</p>
          )}
          <SheetCrop
            sheet={sheet}
            base={base}
            region={regionsOf(finding)[0]}
            color={color}
          />
        </div>
        <div className={styles.compareCard} data-side="basis">
          <h3>根拠（{sourceLabel(finding)}）</h3>
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
                元のファイルを開く（{fileSource.file}
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
