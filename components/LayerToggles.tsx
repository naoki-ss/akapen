"use client";

import { ALL_LAYERS, LAYER_LABELS, type LayerKey } from "@/lib/sheets";
import styles from "./CheckPanel.module.css";

// 朱書きの種類（設計図書／議事録／ナレッジ）ごとの表示の切り替え。
// counts にある種類だけを出す。値が数のときは件数も出す
export default function LayerToggles({
  counts,
  visible,
  onToggle,
}: {
  counts: Partial<Record<LayerKey, number | null>>;
  visible: ReadonlySet<LayerKey>;
  onToggle: (key: LayerKey) => void;
}) {
  return (
    <fieldset className={styles.layerToggles}>
      <legend>朱書きの表示</legend>
      {ALL_LAYERS.filter((key) => key in counts).map((key) => (
        <label key={key}>
          <input
            type="checkbox"
            checked={visible.has(key)}
            onChange={() => onToggle(key)}
          />
          {LAYER_LABELS[key]}
          {typeof counts[key] === "number" && `（${counts[key]}）`}
        </label>
      ))}
    </fieldset>
  );
}
