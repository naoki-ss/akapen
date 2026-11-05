"use client";

import { useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { Finding } from "@/lib/check";
import { colorName } from "@/lib/findings";
import { boundsOf, type Shape } from "@/lib/markup";
import type { Box } from "@/lib/sheets";
import styles from "./check.module.css";

type Numbered = Finding & { number: number };
type Point = { x: number; y: number };

// 雲マークの線。四角の周りを時計回りに、小さな弧を外へふくらませてつなぐ
export function cloudPath(x0: number, y0: number, x1: number, y1: number) {
  const width = x1 - x0;
  const height = y1 - y0;
  const step = Math.max(8, Math.min(18, Math.min(width, height) / 3));
  const corners: Point[] = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
  let d = `M ${x0} ${y0}`;
  for (let side = 0; side < 4; side++) {
    const a = corners[side];
    const b = corners[(side + 1) % 4];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const count = Math.max(1, Math.round(length / step));
    for (let i = 1; i <= count; i++) {
      const x = a.x + ((b.x - a.x) * i) / count;
      const y = a.y + ((b.y - a.y) * i) / count;
      const r = length / count / 2;
      d += ` A ${r} ${r} 0 0 1 ${x} ${y}`;
    }
  }
  return d;
}

// 矢じりの3点。先端は終点
function arrowHead(from: Point, to: Point, size: number) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const left = { x: to.x - size * Math.cos(angle - 0.45), y: to.y - size * Math.sin(angle - 0.45) };
  const right = { x: to.x - size * Math.cos(angle + 0.45), y: to.y - size * Math.sin(angle + 0.45) };
  return `${to.x},${to.y} ${left.x},${left.y} ${right.x},${right.y}`;
}

// 形を画面の座標で描く。a は始点（左上）、b は終点（右下）
export function ShapeLines({ shape, a, b, width }: { shape: Shape; a: Point; b: Point; width: number }) {
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  if (shape === "arrow") {
    return (
      <>
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={width} />
        <polygon points={arrowHead(a, b, 6 + width * 3)} className={styles.manualHead} />
      </>
    );
  }
  if (shape === "ellipse") {
    return <ellipse cx={(x0 + x1) / 2} cy={(y0 + y1) / 2} rx={(x1 - x0) / 2} ry={(y1 - y0) / 2} strokeWidth={width} />;
  }
  if (shape === "rect") return <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} strokeWidth={width} />;
  if (shape === "cloud") return <path d={cloudPath(x0, y0, x1, y1)} strokeWidth={width} />;
  return <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />;
}

type Operation = {
  id: string;
  // move：全体を動かす。0〜3：つまみ（矢印は 0 が始点、1 が終点。ほかは四隅）
  handle: "move" | number;
  start: [number, number];
  box: Box;
  moved: boolean;
};

const corner = (box: Box, index: number): [number, number] => {
  const [x0, y0, x1, y1] = boundsOf(box);
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ][index] as [number, number];
};

// 人が書き足した朱書き。形・番号札・文を描き、選んだものは動かしたり大きさを変えたりできる
export default function ManualMarks({
  items,
  activeId,
  editable,
  toScreen,
  toPage,
  onSelect,
  onChange,
}: {
  items: Numbered[];
  activeId: string | null;
  editable: boolean;
  toScreen: (x: number, y: number) => Point;
  toPage: (clientX: number, clientY: number) => [number, number];
  onSelect: (finding: Numbered) => void;
  onChange: (id: string, box: Box) => void;
}) {
  // つかんでいる間の状態
  const [operation, setOperation] = useState<Operation | null>(null);
  const [live, setLive] = useState<{ id: string; box: Box } | null>(null);

  const begin = (event: ReactPointerEvent, finding: Numbered, handle: Operation["handle"]) => {
    event.stopPropagation();
    if (!editable || !finding.manual) {
      onSelect(finding);
      return;
    }
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    setOperation({
      id: finding.id,
      handle,
      start: toPage(event.clientX, event.clientY),
      box: finding.manual.box,
      moved: false,
    });
  };

  const move = (event: ReactPointerEvent) => {
    const op = operation;
    if (!op) return;
    const [x, y] = toPage(event.clientX, event.clientY);
    const dx = x - op.start[0];
    const dy = y - op.start[1];
    if (!op.moved && Math.abs(dx) + Math.abs(dy) < 0.002) return;
    if (!op.moved) setOperation({ ...op, moved: true });
    const [a, b, c, d] = op.box;
    let box: Box;
    if (op.handle === "move") {
      // はみ出さない範囲で動かす
      const [bx0, by0, bx1, by1] = boundsOf(op.box);
      const mx = Math.min(1 - bx1, Math.max(-bx0, dx));
      const my = Math.min(1 - by1, Math.max(-by0, dy));
      box = [a + mx, b + my, c + mx, d + my];
    } else if (items.find((item) => item.id === op.id)?.manual?.shape === "arrow") {
      box = op.handle === 0 ? [x, y, c, d] : [a, b, x, y];
    } else {
      // つかんだ角を動かし、向かいの角は止めておく
      const fixed = corner(op.box, (op.handle + 2) % 4);
      box = boundsOf([fixed[0], fixed[1], x, y]);
    }
    setLive({ id: op.id, box });
  };

  const end = (finding: Numbered) => {
    const op = operation;
    setOperation(null);
    if (!op) return;
    if (op.moved && live?.id === op.id) onChange(op.id, live.box);
    else if (!op.moved) onSelect(finding);
    setLive(null);
  };

  return (
    <>
      <svg className={styles.manualLayer} aria-hidden>
        {items.map((finding) => {
          const mark = finding.manual!;
          const box = live?.id === finding.id ? live.box : mark.box;
          const a = toScreen(box[0], box[1]);
          const b = toScreen(box[2], box[3]);
          const active = finding.id === activeId;
          return (
            <g
              key={finding.id}
              className={styles.manualShape}
              data-color={colorName(finding)}
              data-active={active}
              data-dim={Boolean(activeId) && !active}
            >
              <ShapeLines shape={mark.shape} a={a} b={b} width={active ? 2.4 : 2} />
            </g>
          );
        })}
      </svg>
      {items.map((finding) => {
        const mark = finding.manual!;
        const box = live?.id === finding.id ? live.box : mark.box;
        const [x0, y0, x1, y1] = boundsOf(box);
        const p0 = toScreen(x0, y0);
        const p1 = toScreen(x1, y1);
        const active = finding.id === activeId;
        const color = colorName(finding);
        const text = finding.comment || finding.title;
        const isText = mark.shape === "text";
        const handles =
          mark.shape === "arrow"
            ? [toScreen(box[0], box[1]), toScreen(box[2], box[3])]
            : [0, 1, 2, 3].map((index) => {
                const [cx, cy] = corner(box, index);
                return toScreen(cx, cy);
              });
        return (
          <div key={finding.id} className={styles.manualItem} data-color={color} data-active={active} data-dim={Boolean(activeId) && !active}>
            {/* 押して選ぶ・つかんで動かす範囲 */}
            <div
              className={styles.manualHit}
              data-editable={editable}
              style={{ left: p0.x - 6, top: p0.y - 6, width: p1.x - p0.x + 12, height: p1.y - p0.y + 12 }}
              aria-label={`指摘 ${finding.number}：${finding.title}（手書き）`}
              role="button"
              onPointerDown={(event) => begin(event, finding, "move")}
              onPointerMove={(event) => move(event)}
              onPointerUp={() => end(finding)}
            />
            <i className={`${styles.manualNumber} mono`} style={{ left: p0.x - 2, top: p0.y - 2 }}>
              {finding.number}
            </i>
            {text && (
              <span
                className={`${styles.manualText} hand`}
                data-shape={mark.shape}
                style={
                  isText
                    ? ({ left: p0.x + 22, top: p0.y + 1, width: Math.max(80, p1.x - p0.x - 24) } as CSSProperties)
                    : { left: p0.x, top: p1.y + 4 }
                }
              >
                {text}
              </span>
            )}
            {active &&
              editable &&
              handles.map((point, index) => (
                <span
                  key={index}
                  className={styles.manualHandle}
                  style={{ left: point.x - 5, top: point.y - 5 }}
                  onPointerDown={(event) => begin(event, finding, index)}
                  onPointerMove={(event) => move(event)}
                  onPointerUp={() => end(finding)}
                />
              ))}
          </div>
        );
      })}
    </>
  );
}
