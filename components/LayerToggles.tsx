"use client";

import { ALL_LAYERS, LAYER_LABELS, type LayerKey } from "@/lib/sheets";
import styles from "./check/check.module.css";

const COLOR: Record<LayerKey, string> = {
  design: "red",
  minutes: "red",
  knowledge: "blue",
};

// 凡例を兼ねた小さな印。押すとその種類の朱書きを消す。指摘のない種類は出さない
export default function LayerToggles({
  counts,
  visible,
  onToggle,
  noKnowledge,
}: {
  counts: Partial<Record<LayerKey, number | null>>;
  visible: ReadonlySet<LayerKey>;
  onToggle?: (key: LayerKey) => void;
  // チェックリストがなく、青の照合をしていない結果
  noKnowledge?: boolean;
}) {
  return (
    <div className={styles.legend} role="group" aria-label="朱書きの種類">
      {ALL_LAYERS.filter((key) => key in counts && counts[key] !== 0).map(
        (key) => (
          <button
            key={key}
            data-color={COLOR[key]}
            aria-pressed={visible.has(key)}
            title={`${LAYER_LABELS[key]}の朱書きを${visible.has(key) ? "消す" : "出す"}`}
            onClick={() => onToggle?.(key)}
          >
            <i aria-hidden />
            {LAYER_LABELS[key]}
            {typeof counts[key] === "number" && (
              <span className="mono">{counts[key]}</span>
            )}
          </button>
        ),
      )}
      {noKnowledge && (
        <span className={styles.legendNone} data-color="blue">
          <i aria-hidden />
          ナレッジ 該当なし
        </span>
      )}
    </div>
  );
}
