"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { SheetTarget } from "@/lib/sheets";
import styles from "./SheetViewer.module.css";

// 施工図の1ページを開く。bbox があれば、その範囲に赤枠を重ねる
export default function SheetViewer({
  target,
  onClose,
}: {
  target: SheetTarget;
  onClose: () => void;
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

  const src = `${base}/${sheet.image}`;
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
            <button onClick={() => setZoomed(!zoomed)}>
              {zoomed ? "全体を表示" : "拡大"}
            </button>
            <a href={src} target="_blank" rel="noreferrer">
              別のタブで開く
            </a>
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
