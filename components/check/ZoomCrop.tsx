"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Box } from "@/lib/sheets";
import type { Finding } from "@/lib/check";
import { ShapeLines } from "./ManualMarks";
import styles from "./check.module.css";

type View = { x: number; y: number; scale: number };

// 枠のまわりの余白（枠の大きさに対する比）
const MARGIN = 1.4;
// 開いたときの倍率の上限。画像は2倍の密度で書き出してあるので、小さな枠でも粗くしない
const MAX_FIRST_SCALE = 0.9;
const MAX_SCALE = 4;
const DRAG_THRESHOLD = 3;

// 図面を枠の中で見せる。該当箇所を中央に置き、ホイールで拡大縮小、ドラッグで移動できる
export default function ZoomCrop({
  src,
  width,
  height,
  box,
  color,
  number,
  alt,
  manual,
}: {
  // 書き足した朱書きは、枠の代わりにその形を描く
  manual?: Finding["manual"];
  src: string;
  // 画像の大きさ（px）
  width: number;
  height: number;
  // 該当箇所（画像に対する 0〜1）。なければ全体を見せる
  box: Box | null;
  color: "red" | "blue";
  // 枠に付ける番号
  number?: number;
  alt: string;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View | null>(null);
  const [moved, setMoved] = useState(false);
  const drag = useRef<{ x: number; y: number; view: View; dragged: boolean } | null>(null);

  const fit = useCallback(() => {
    const element = frame.current;
    if (!element || !element.clientWidth || !element.clientHeight) return;
    const w = element.clientWidth;
    const h = element.clientHeight;
    const [x0, y0, x1, y1] = box ?? [0, 0, 1, 1];
    const boxWidth = Math.max((x1 - x0) * width, 1);
    const boxHeight = Math.max((y1 - y0) * height, 1);
    const margin = box ? MARGIN : 1;
    const scale = Math.min(w / (boxWidth * margin), h / (boxHeight * margin), box ? MAX_FIRST_SCALE : MAX_SCALE);
    setView({
      scale,
      x: w / 2 - ((x0 + x1) / 2) * width * scale,
      y: h / 2 - ((y0 + y1) / 2) * height * scale,
    });
    setMoved(false);
  }, [box, width, height]);

  // 大きさが変わったら合わせ直す。利用者が動かしたあとは動かさない
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      if (!drag.current) setMoved((current) => {
        if (!current) fit();
        return current;
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [fit]);

  // ページを動かさずに拡大縮小するので、受け身でない形で受ける
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      setView((current) => {
        if (!current) return current;
        const lowest = Math.min(element.clientWidth / width, element.clientHeight / height) * 0.8;
        const scale = Math.min(MAX_SCALE, Math.max(lowest, current.scale * Math.exp(-event.deltaY * 0.002)));
        const ratio = scale / current.scale;
        return { scale, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio };
      });
      setMoved(true);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [width, height]);

  const mark = box && view && {
    left: view.x + box[0] * width * view.scale,
    top: view.y + box[1] * height * view.scale,
    width: (box[2] - box[0]) * width * view.scale,
    height: (box[3] - box[1]) * height * view.scale,
  };

  return (
    <div
      ref={frame}
      className={styles.zoomCrop}
      onPointerDown={(event) => {
        if (!view || (event.target as HTMLElement).closest("button")) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, y: event.clientY, view, dragged: false };
      }}
      onPointerMove={(event) => {
        const state = drag.current;
        if (!state) return;
        const dx = event.clientX - state.x;
        const dy = event.clientY - state.y;
        if (!state.dragged && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
        state.dragged = true;
        setView({ ...state.view, x: state.view.x + dx, y: state.view.y + dy });
        setMoved(true);
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onDoubleClick={fit}
    >
      {/* 図面の一部を拡大して見せるので、next/image の最適化は使わない */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        draggable={false}
        style={{
          width,
          height,
          visibility: view ? "visible" : "hidden",
          transform: view ? `translate(${view.x}px, ${view.y}px) scale(${view.scale})` : undefined,
        }}
      />
      {manual && view && (
        <svg className={styles.manualLayer} aria-hidden>
          <g className={styles.manualShape} data-color={color} data-active="true">
            <ShapeLines
              shape={manual.shape}
              a={{ x: view.x + manual.box[0] * width * view.scale, y: view.y + manual.box[1] * height * view.scale }}
              b={{ x: view.x + manual.box[2] * width * view.scale, y: view.y + manual.box[3] * height * view.scale }}
              width={2.4}
            />
          </g>
        </svg>
      )}
      {mark && !manual && (
        <span className={styles.docBox} data-color={color} style={mark}>
          {number !== undefined && (
            <b className="mono" data-side={mark.left < 30 ? "right" : "left"}>
              {number}
            </b>
          )}
        </span>
      )}
      {moved && (
        <button className={styles.zoomReset} onClick={fit}>
          該当箇所に戻す
        </button>
      )}
    </div>
  );
}
