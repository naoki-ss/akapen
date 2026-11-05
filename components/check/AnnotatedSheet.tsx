"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Finding } from "@/lib/check";
import { colorName, noteOf, regionsOf } from "@/lib/findings";
import type { Box, Sheet } from "@/lib/sheets";
import styles from "./check.module.css";

type Numbered = Finding & { number: number };
type NoteSpot = { left: number; top: number; width: number };

// 図面の幅に対する注記の大きさ（1文字の幅と、1行の高さ）
const CHAR_WIDTH = 0.0098;
const LINE_HEIGHT = 0.022;
const MAX_CHARS = 26;

const clip = (text: string) =>
  text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS - 1)}…` : text;

const hits = (
  a: { x0: number; y0: number; x1: number; y1: number },
  b: { x0: number; y0: number; x1: number; y1: number },
) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

// 枠の周りで、ほかの注記と重ならない場所を探す。選択中の指摘を先に置き、置けない注記は出さない
function placeNotes(findings: Numbered[], activeId: string | null, ratio: number) {
  const taken: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const spots = new Map<string, NoteSpot>();
  const order = [...findings].sort(
    (a, b) => Number(b.id === activeId) - Number(a.id === activeId),
  );
  for (const finding of order) {
    const [x0, y0, x1, y1] = regionsOf(finding)[0];
    const width = clip(noteOf(finding)).length * CHAR_WIDTH + 0.008;
    const height = LINE_HEIGHT * ratio;
    const candidates = [
      { left: x0, top: y0 - height - 0.003 },
      { left: x0, top: y1 + 0.003 },
      { left: x1 + 0.004, top: y0 },
      { left: x0 - width - 0.004, top: y0 },
    ];
    const free = candidates.find(({ left, top }) => {
      const box = { x0: left, y0: top, x1: left + width, y1: top + height };
      return (
        left >= 0 &&
        top >= 0 &&
        box.x1 <= 1 &&
        box.y1 <= 1 &&
        !taken.some((other) => hits(box, other))
      );
    });
    const spot = free ?? (finding.id === activeId ? candidates[0] : null);
    if (!spot) continue;
    taken.push({
      x0: spot.left,
      y0: spot.top,
      x1: spot.left + width,
      y1: spot.top + height,
    });
    spots.set(finding.id, { ...spot, width });
  }
  return spots;
}

const boxStyle = ([x0, y0, x1, y1]: Box) => ({
  left: `${x0 * 100}%`,
  top: `${y0 * 100}%`,
  width: `${(x1 - x0) * 100}%`,
  height: `${(y1 - y0) * 100}%`,
});

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const DRAG_THRESHOLD = 4;
type View = { scale: number; x: number; y: number };

// 選んだ枠が枠全体の半分くらいになる倍率
function fitScale(regions: Box[], frame: { width: number; height: number }, page: { width: number; height: number }) {
  const x0 = Math.min(...regions.map((r) => r[0]));
  const y0 = Math.min(...regions.map((r) => r[1]));
  const x1 = Math.max(...regions.map((r) => r[2]));
  const y1 = Math.max(...regions.map((r) => r[3]));
  const scale = Math.min(
    (frame.width * 0.5) / Math.max((x1 - x0) * page.width, 1),
    (frame.height * 0.5) / Math.max((y1 - y0) * page.height, 1),
  );
  return {
    scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale)),
    centerX: (x0 + x1) / 2,
    centerY: (y0 + y1) / 2,
  };
}

// 朱書きした施工図。枠の中でズームとパンができ、枠の外にはみ出さない。指摘を選ぶと、そこへ自動で寄る
export default function AnnotatedSheet({
  sheet,
  base,
  findings,
  activeId,
  onSelect,
  onClear,
}: {
  sheet: Sheet;
  base: string;
  findings: Numbered[];
  activeId: string | null;
  onSelect: (finding: Numbered) => void;
  onClear: () => void;
}) {
  const ratio = sheet.width / sheet.height;
  const notes = useMemo(
    () => placeNotes(findings, activeId, ratio),
    [findings, activeId, ratio],
  );
  const frameRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; startX: number; startY: number; moved: boolean } | null>(null);
  const page = {
    width: Math.min(frame.width, frame.height * ratio),
    height: Math.min(frame.width, frame.height * ratio) / ratio,
  };

  // はみ出さないように位置を直す。図面が枠より小さいときは真ん中に置く
  const clamp = useCallback(
    (next: View): View => {
      const width = page.width * next.scale;
      const height = page.height * next.scale;
      return {
        scale: next.scale,
        x: width <= frame.width ? (frame.width - width) / 2 : Math.min(0, Math.max(frame.width - width, next.x)),
        y: height <= frame.height ? (frame.height - height) / 2 : Math.min(0, Math.max(frame.height - height, next.y)),
      };
    },
    [frame.width, frame.height, page.width, page.height],
  );

  const active = findings.find((finding) => finding.id === activeId);
  const regionsKey = active ? JSON.stringify(regionsOf(active)) : "";

  // 枠の大きさを見張る
  useEffect(() => {
    const node = frameRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) =>
      setFrame({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // 選んだ指摘へ寄る。選んでいないときは全体を見せる
  useEffect(() => {
    if (!frame.width) return;
    const next = () => {
      if (!regionsKey) return clamp({ scale: 1, x: 0, y: 0 });
      const fit = fitScale(JSON.parse(regionsKey), frame, page);
      return clamp({
        scale: fit.scale,
        x: frame.width / 2 - fit.centerX * page.width * fit.scale,
        y: frame.height / 2 - fit.centerY * page.height * fit.scale,
      });
    };
    // 枠の大きさや選択が変わったときだけ計算し直す
    const request = requestAnimationFrame(() => setView(next()));
    return () => cancelAnimationFrame(request);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionsKey, frame.width, frame.height, sheet.id]);

  const zoomAt = useCallback(
    (factor: number, atX: number, atY: number) =>
      setView((current) => {
        const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, current.scale * factor));
        const rate = scale / current.scale;
        return clamp({
          scale,
          x: atX - (atX - current.x) * rate,
          y: atY - (atY - current.y) * rate,
        });
      }),
    [clamp],
  );

  // ホイールでズームする。ページがスクロールしないよう、自分で受ける
  useEffect(() => {
    const node = frameRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = node.getBoundingClientRect();
      zoomAt(event.deltaY < 0 ? 1.2 : 1 / 1.2, event.clientX - box.left, event.clientY - box.top);
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  return (
    <div
      ref={frameRef}
      className={styles.sheetFrame}
      onPointerDown={(event) => {
        drag.current = {
          x: event.clientX - view.x,
          y: event.clientY - view.y,
          startX: event.clientX,
          startY: event.clientY,
          moved: false,
        };
      }}
      onPointerMove={(event) => {
        const state = drag.current;
        if (!state) return;
        if (
          Math.abs(event.clientX - state.startX) + Math.abs(event.clientY - state.startY) >
          DRAG_THRESHOLD
        ) {
          state.moved = true;
        }
        if (state.moved) {
          setView((current) =>
            clamp({ ...current, x: event.clientX - state.x, y: event.clientY - state.y }),
          );
        }
      }}
      onPointerUp={() => {
        // クリックの判定のあとで消す
        requestAnimationFrame(() => {
          drag.current = null;
        });
      }}
      onPointerLeave={() => {
        drag.current = null;
      }}
      onClickCapture={(event) => {
        // ドラッグのあとのクリックは選択にしない
        if (drag.current?.moved) event.stopPropagation();
      }}
    >
      <div
        className={styles.sheetPage}
        data-focus={Boolean(active)}
        style={
          {
            width: page.width,
            height: page.height,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            "--view-scale": view.scale,
          } as CSSProperties
        }
        onClick={onClear}
      >
        <Image
          src={`${base}/${sheet.base_image ?? sheet.image}`}
          alt={sheet.title}
          width={sheet.width}
          height={sheet.height}
          loading="eager"
          unoptimized
        />
        {findings.map((finding) => {
          const active = finding.id === activeId;
          const color = colorName(finding);
          return regionsOf(finding).map((region, index) => (
            <button
              key={`${finding.id}-${index}`}
              className={styles.frame}
              style={boxStyle(region)}
              data-color={color}
              data-active={active}
              aria-label={`指摘 ${finding.number}：${finding.title}`}
              onClick={(event) => {
                event.stopPropagation();
                onSelect(finding);
              }}
            >
              {index === 0 && (
                <i className={`${styles.frameNumber} mono`}>{finding.number}</i>
              )}
            </button>
          ));
        })}
        {findings.map((finding) => {
          const spot = notes.get(finding.id);
          if (!spot) return null;
          return (
            <button
              key={finding.id}
              className={`${styles.note} hand`}
              style={{
                left: `${spot.left * 100}%`,
                top: `${spot.top * 100}%`,
              }}
              data-color={colorName(finding)}
              data-active={finding.id === activeId}
              onClick={(event) => {
                event.stopPropagation();
                onSelect(finding);
              }}
              tabIndex={-1}
            >
              {clip(noteOf(finding))}
            </button>
          );
        })}
      </div>
      <div className={styles.zoomButtons} onPointerDown={(event) => event.stopPropagation()}>
        <button aria-label="拡大" onClick={() => zoomAt(1.4, frame.width / 2, frame.height / 2)}>＋</button>
        <button aria-label="縮小" onClick={() => zoomAt(1 / 1.4, frame.width / 2, frame.height / 2)}>－</button>
        <button onClick={() => setView(clamp({ scale: 1, x: 0, y: 0 }))}>全体</button>
      </div>
    </div>
  );
}
