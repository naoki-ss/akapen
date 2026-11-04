"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import {
  LAYER_LABELS,
  type Box,
  type LayerKey,
  type Sheet,
} from "@/lib/sheets";
import styles from "./SheetViewer.module.css";

// 施工図の1ページ。朱書きの種類ごとの画像を重ね、bbox があれば確認中の範囲に枠を出す。
// marks は朱書きが画像に入っていない図面（チェック済みの結果）に重ねる赤枠
export default function SheetCanvas({
  sheet,
  base,
  bbox,
  marks,
  zoomed,
  visibleLayers,
}: {
  sheet: Sheet;
  base: string;
  bbox?: Box;
  marks?: Box[];
  zoomed: boolean;
  visibleLayers: ReadonlySet<LayerKey>;
}) {
  const frame = useRef<HTMLDivElement>(null);

  // 枠の場所まで動かす（ページの下端にある枠は画面の外になる）
  useEffect(() => {
    frame.current?.scrollIntoView({ block: "center", inline: "center" });
  }, [zoomed, bbox]);

  const ratio = sheet.width / sheet.height;
  return (
    <div className={styles.scroller}>
      <div
        className={styles.page}
        style={{
          // 全体表示は枠の中に収める。拡大は枠より大きくしてスクロールする
          width: zoomed ? "300cqw" : `min(100cqw, calc(100cqh * ${ratio}))`,
        }}
      >
        <Image
          src={`${base}/${sheet.base_image ?? sheet.image}`}
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
        {marks?.map((mark, index) => (
          // 同じ場所を指す指摘があるので、場所だけではキーにならない
          <div
            key={index}
            className={styles.mark}
            style={{
              left: `${mark[0] * 100}%`,
              top: `${mark[1] * 100}%`,
              width: `${(mark[2] - mark[0]) * 100}%`,
              height: `${(mark[3] - mark[1]) * 100}%`,
            }}
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
  );
}
