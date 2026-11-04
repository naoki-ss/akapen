"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef } from "react";
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

const LARGE_SCALE = 2.6;
const MAX_SCALE = 4;

// 選んだ枠が枠全体の半分くらいになる倍率
function fitScale(regions: Box[]) {
  const x0 = Math.min(...regions.map((r) => r[0]));
  const y0 = Math.min(...regions.map((r) => r[1]));
  const x1 = Math.max(...regions.map((r) => r[2]));
  const y1 = Math.max(...regions.map((r) => r[3]));
  return Math.min(MAX_SCALE, Math.max(1, 0.5 / Math.max(x1 - x0, y1 - y0, 0.01)));
}

// 朱書きした施工図。枠はクリックで選べる。外した指摘は選択中のときだけ薄く出す
export default function AnnotatedSheet({
  sheet,
  base,
  findings,
  excluded,
  activeId,
  zoom,
  onSelect,
  onClear,
}: {
  sheet: Sheet;
  base: string;
  findings: Numbered[];
  excluded: ReadonlySet<number>;
  activeId: string | null;
  // auto は選んだ指摘まで自動で寄る。full は全体、large は大きく
  zoom: "auto" | "full" | "large";
  onSelect: (finding: Numbered) => void;
  onClear: () => void;
}) {
  const ratio = sheet.width / sheet.height;
  const shown = useMemo(
    () =>
      findings.filter(
        (f) => !excluded.has(f.number) || f.id === activeId,
      ),
    [findings, excluded, activeId],
  );
  const notes = useMemo(
    () => placeNotes(shown, activeId, ratio),
    [shown, activeId, ratio],
  );
  const activeBox = useRef<HTMLButtonElement>(null);

  const active = findings.find((finding) => finding.id === activeId);
  const scale =
    zoom === "large"
      ? LARGE_SCALE
      : zoom === "auto" && active
        ? fitScale(regionsOf(active))
        : 1;

  // 選んだ枠が見える場所まで動かす
  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => {
      activeBox.current?.scrollIntoView({ block: "center", inline: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [active, scale]);

  return (
    <div className={styles.sheetScroller}>
      <div
        className={styles.sheetPage}
        data-focus={Boolean(active)}
        style={{
          width: `calc(min(100cqw, calc(100cqh * ${ratio})) * ${scale})`,
        }}
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
        {shown.map((finding) => {
          const active = finding.id === activeId;
          const color = colorName(finding);
          const off = excluded.has(finding.number);
          return regionsOf(finding).map((region, index) => (
            <button
              key={`${finding.id}-${index}`}
              ref={active && index === 0 ? activeBox : undefined}
              className={styles.frame}
              style={boxStyle(region)}
              data-color={color}
              data-active={active}
              data-off={off}
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
        {shown.map((finding) => {
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
    </div>
  );
}
