"use client";

import { ALL_LAYERS, LAYER_LABELS, type LayerKey } from "@/lib/sheets";
import styles from "./check/check.module.css";

const COLOR_NAME: Record<LayerKey, string> = {
  design: "赤",
  minutes: "赤",
  knowledge: "青",
};

// 赤（設計図書・議事録）と青（ナレッジ）の凡例と、種類ごとの表示の切り替え。
// onToggle がないときは凡例だけを出す。counts にある種類だけを出し、値が数のときは件数も出す
export default function LayerToggles({
  counts,
  visible,
  onToggle,
}: {
  counts: Partial<Record<LayerKey, number | null>>;
  visible: ReadonlySet<LayerKey>;
  onToggle?: (key: LayerKey) => void;
}) {
  return (
    <fieldset className={styles.layerToggles}>
      <legend>朱書きの表示</legend>
      {ALL_LAYERS.filter((key) => key in counts).map((key) => (
        <label key={key} data-color={COLOR_NAME[key]}>
          {onToggle ? (
            <input
              type="checkbox"
              checked={visible.has(key)}
              onChange={() => onToggle(key)}
            />
          ) : (
            <i className={styles.swatch} aria-hidden />
          )}
          <b>{COLOR_NAME[key]}</b>
          {LAYER_LABELS[key]}
          {typeof counts[key] === "number" && ` ${counts[key]}`}
        </label>
      ))}
    </fieldset>
  );
}
