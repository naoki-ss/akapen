"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { LAYER_LABELS, type LayerKey, type SheetTarget } from "@/lib/sheets";
import LayerToggles from "./LayerToggles";
import styles from "./SheetViewer.module.css";

// 施工図の1ページを開く。bbox があれば、その範囲に赤枠を重ねる
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
  const frame = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  // 開いたときと拡大したときに、赤枠の場所まで動かす（ページの下端にある枠は画面の外になる）
  useEffect(() => {
    frame.current?.scrollIntoView({ block: "center", inline: "center" });
  }, [zoomed]);

  const layered = sheet.base_image !== undefined;
  const src = `${base}/${sheet.base_image ?? sheet.image}`;
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
            {!layered && (
              <a href={src} target="_blank" rel="noreferrer">
                別のタブで開く
              </a>
            )}
            <button onClick={onClose}>閉じる</button>
          </div>
        </header>
        <div className={styles.scroller}>
          <div
            className={styles.page}
            style={{ width: zoomed ? "300%" : "100%" }}
          >
            <Image
              src={src}
              alt={sheet.title}
              width={sheet.width}
              height={sheet.height}
              unoptimized
            />
            {sheet.layers
              ?.filter((layer) => visibleLayers.has(layer.key))
              .map((layer) => (
                <Image
                  key={layer.key}
                  className={styles.layer}
                  src={`${base}/${layer.image}`}
                  alt={`朱書き（${LAYER_LABELS[layer.key]}）`}
                  width={sheet.width}
                  height={sheet.height}
                  unoptimized
                />
              ))}
            {bbox && (
              <div
                ref={frame}
                className={styles.frame}
                style={{
                  left: `${bbox[0] * 100}%`,
                  top: `${bbox[1] * 100}%`,
                  width: `${(bbox[2] - bbox[0]) * 100}%`,
                  height: `${(bbox[3] - bbox[1]) * 100}%`,
                }}
              />
            )}
          </div>
        </div>
        {sheet.note && <p className={styles.note}>{sheet.note}</p>}
      </div>
    </div>
  );
}
