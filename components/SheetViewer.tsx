"use client";

import { useEffect, useState } from "react";
import type { LayerKey, SheetTarget } from "@/lib/sheets";
import LayerToggles from "./LayerToggles";
import SheetCanvas from "./SheetCanvas";
import styles from "./SheetViewer.module.css";

// 施工図の1ページを別の窓で開く（3Dの部材から開くときなど）
export default function SheetViewer({
  target,
  onClose,
  visibleLayers,
  onToggleLayer,
}: {
  target: SheetTarget;
  onClose: () => void;
  visibleLayers: ReadonlySet<LayerKey>;
  onToggleLayer: (key: LayerKey) => void;
}) {
  const { sheet, bbox, label, base } = target;
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  return (
    <div className={styles.backdrop} role="dialog" aria-label={sheet.title}>
      <div className={styles.window}>
        <header className={styles.head}>
          <div>
            <b>
              {sheet.doc} p.{sheet.page}：{sheet.title}
            </b>
            {label && <span>{label}</span>}
          </div>
          <div className={styles.actions}>
            {sheet.layers && (
              <LayerToggles
                counts={Object.fromEntries(
                  sheet.layers.map((layer) => [layer.key, null]),
                )}
                visible={visibleLayers}
                onToggle={onToggleLayer}
              />
            )}
            <button onClick={() => setZoomed(!zoomed)}>
              {zoomed ? "全体を表示" : "拡大"}
            </button>
            <button onClick={onClose}>閉じる</button>
          </div>
        </header>
        <SheetCanvas
          sheet={sheet}
          base={base}
          bbox={bbox}
          zoomed={zoomed}
          visibleLayers={visibleLayers}
        />
        {sheet.note && <p className={styles.note}>{sheet.note}</p>}
      </div>
    </div>
  );
}
