"use client";

import { Minus, Plus } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Finding } from "@/lib/check";
import { colorName, noteOf, regionsOf } from "@/lib/findings";
import { boundsOf, MAX_COMMENT, MAX_TITLE, type Ink, type Shape } from "@/lib/markup";
import type { Box, Sheet } from "@/lib/sheets";
import styles from "./check.module.css";
import ManualMarks, { ShapeLines } from "./ManualMarks";

export type Drawn = { shape: Shape; color: Ink; box: Box; title: string; comment: string };

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

const boxArea = ([x0, y0, x1, y1]: Box) => (x1 - x0) * (y1 - y0);

// 枠を順に描く数の上限。多くても1秒で描き終わるようにする
const MAX_ORDER = 10;
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
  tool = null,
  ink = "red",
  editable = false,
  onCreate,
  onMove,
}: {
  sheet: Sheet;
  base: string;
  findings: Numbered[];
  activeId: string | null;
  onSelect: (finding: Numbered) => void;
  onClear: () => void;
  // 朱書きを追加するときの形と色。null のときは、ドラッグで図面を動かす
  tool?: Shape | null;
  ink?: Ink;
  editable?: boolean;
  onCreate?: (drawn: Drawn) => void;
  onMove?: (id: string, box: Box) => void;
}) {
  const ratio = sheet.width / sheet.height;
  const manualItems = useMemo(() => findings.filter((f) => f.manual), [findings]);
  const aiFindings = useMemo(() => findings.filter((f) => !f.manual), [findings]);
  const notes = useMemo(
    () => placeNotes(aiFindings, activeId, ratio),
    [aiFindings, activeId, ratio],
  );
  // 描いている途中の形と、文を待っている形
  const [sketch, setSketch] = useState<{ shape: Shape; color: Ink; box: Box } | null>(null);
  const [pending, setPending] = useState<{ shape: Shape; color: Ink; box: Box } | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftComment, setDraftComment] = useState("");
  const frameRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const sheetImage = `${base}/${sheet.base_image ?? sheet.image}`;
  const [loadedImage, setLoadedImage] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
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
  // 指摘が離れた場所を複数指すときは、最初の場所に寄る（全部を収めると寄れない）
  // 書き足した朱書きは、動かしても寄り直さない（選んだときだけ寄る）
  const [manualFocus, setManualFocus] = useState<{ id: string; key: string } | null>(null);
  if (active?.manual && manualFocus?.id !== active.id) {
    setManualFocus({ id: active.id, key: JSON.stringify([boundsOf(active.manual.box)]) });
  }
  const regionsKey = active
    ? active.manual
      ? (manualFocus?.id === active.id ? manualFocus.key : JSON.stringify([boundsOf(active.manual.box)]))
      : JSON.stringify(regionsOf(active).slice(0, 1))
    : "";

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

  // 画面の位置を、図面の上の位置（0〜1）にする
  const toPage = (clientX: number, clientY: number): [number, number] => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect || !page.width) return [0, 0];
    return [
      Math.min(1, Math.max(0, (clientX - rect.left - view.x) / (page.width * view.scale))),
      Math.min(1, Math.max(0, (clientY - rect.top - view.y) / (page.height * view.scale))),
    ];
  };
  const toScreen = (x: number, y: number) => ({
    x: view.x + x * page.width * view.scale,
    y: view.y + y * page.height * view.scale,
  });

  const finishDraft = () => {
    if (!pending || !onCreate) return;
    if (!draftTitle.trim() && !draftComment.trim()) return;
    onCreate({ ...pending, title: draftTitle.trim(), comment: draftComment.trim() });
    setPending(null);
  };

  // 図面の上の位置（0〜1）を、枠の中の位置（px）にする
  const onScreen = ([x0, y0, x1, y1]: Box) => ({
    left: view.x + x0 * page.width * view.scale,
    top: view.y + y0 * page.height * view.scale,
    width: (x1 - x0) * page.width * view.scale,
    height: (y1 - y0) * page.height * view.scale,
  });

  return (
    <div
      ref={frameRef}
      className={styles.sheetFrame}
      data-tool={tool ?? undefined}
      onPointerDown={(event) => {
        if (tool && editable && !pending) {
          event.currentTarget.setPointerCapture(event.pointerId);
          const [x, y] = toPage(event.clientX, event.clientY);
          setSketch({ shape: tool, color: ink, box: [x, y, x, y] });
          return;
        }
        drag.current = {
          x: event.clientX - view.x,
          y: event.clientY - view.y,
          startX: event.clientX,
          startY: event.clientY,
          moved: false,
        };
      }}
      onPointerMove={(event) => {
        if (sketch) {
          const [x, y] = toPage(event.clientX, event.clientY);
          setSketch({ ...sketch, box: [sketch.box[0], sketch.box[1], x, y] });
          return;
        }
        const state = drag.current;
        if (!state) return;
        if (
          Math.abs(event.clientX - state.startX) + Math.abs(event.clientY - state.startY) >
          DRAG_THRESHOLD
        ) {
          state.moved = true;
        }
        if (state.moved) {
          if (!dragging) setDragging(true);
          setView((current) =>
            clamp({ ...current, x: event.clientX - state.x, y: event.clientY - state.y }),
          );
        }
      }}
      onPointerUp={() => {
        if (sketch) {
          const [x0, y0, x1, y1] = sketch.box;
          const small = Math.abs(x1 - x0) * page.width * view.scale < 8 && Math.abs(y1 - y0) * page.height * view.scale < 8;
          if (small && sketch.shape !== "text") {
            setSketch(null);
            return;
          }
          // テキストだけは押しただけでも置ける。決まった大きさの箱にする
          const box: Box = small
            ? [x0, y0, Math.min(1, x0 + 160 / (page.width * view.scale)), Math.min(1, y0 + 40 / (page.height * view.scale))]
            : sketch.shape === "arrow"
              ? sketch.box
              : boundsOf(sketch.box);
          setPending({ ...sketch, box });
          setDraftTitle("");
          setDraftComment("");
          setSketch(null);
          return;
        }
        setDragging(false);
        // クリックの判定のあとで消す
        requestAnimationFrame(() => {
          drag.current = null;
        });
      }}
      onPointerLeave={() => {
        if (sketch) return;
        setDragging(false);
        drag.current = null;
      }}
      onClickCapture={(event) => {
        // ドラッグのあとのクリックは選択にしない
        if (drag.current?.moved) event.stopPropagation();
      }}
    >
      <div
        className={styles.sheetPage}
        data-dragging={dragging}
        style={
          {
            width: page.width,
            height: page.height,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          } as CSSProperties
        }
        onClick={onClear}
      >
        <Image
          src={sheetImage}
          onLoad={() => setLoadedImage(sheetImage)}
          alt={sheet.title}
          width={sheet.width}
          height={sheet.height}
          loading="eager"
          unoptimized
        />
      </div>
      {/* 枠と番号札と注記は図面と別の層に置く。座標だけが拡大に合わせて動き、線の太さと文字の大きさは一定 */}
      <div
        className={styles.sheetMarks}
        data-focus={Boolean(active)}
        data-tool={Boolean(tool)}
        data-ready={loadedImage === sheetImage}
        data-dragging={dragging}
      >
        {/* 大きな枠を下に置く。重なっていても、小さな枠を押せる */}
        {[...aiFindings].sort((a, b) => boxArea(regionsOf(b)[0]) - boxArea(regionsOf(a)[0])).map((finding, order) => {
          const active = finding.id === activeId;
          const color = colorName(finding);
          return regionsOf(finding).map((region, index) => (
            <button
              key={`${finding.id}-${index}`}
              className={styles.frame}
              style={{ ...onScreen(region), "--order": Math.min(order, MAX_ORDER) } as CSSProperties}
              data-color={color}
              data-active={active}
              aria-label={`指摘 ${finding.number}：${finding.title}`}
              onClick={(event) => {
                event.stopPropagation();
                onSelect(finding);
              }}
            >
              {/* 枠はペンで描くように現れる。番号札は描き終わりに出る */}
              {/* 全体を見る間は、ホバーで番号と題名を出す */}
              {index === 0 && !activeId && (
                <span className={styles.frameTip}>
                  {finding.number} {finding.title}
                </span>
              )}
              <svg className={styles.frameLine} aria-hidden>
                <rect x="0" y="0" width="100%" height="100%" pathLength={1} />
              </svg>
              {index === 0 && (
                <i className={`${styles.frameNumber} mono`}>{finding.number}</i>
              )}
            </button>
          ));
        })}
        {aiFindings.map((finding) => {
          const spot = notes.get(finding.id);
          // 指摘を見ている間は、選んだ指摘の注記だけを出す
          if (!spot || (activeId && finding.id !== activeId)) return null;
          return (
            <button
              key={finding.id}
              className={`${styles.note} hand`}
              style={{
                left: view.x + spot.left * page.width * view.scale,
                top: view.y + spot.top * page.height * view.scale,
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
        <ManualMarks
          items={manualItems}
          activeId={activeId}
          editable={editable && !tool}
          toScreen={toScreen}
          toPage={toPage}
          onSelect={onSelect}
          onChange={(id, box) => onMove?.(id, box)}
        />
        {(sketch ?? pending) && (
          <svg className={styles.manualLayer} aria-hidden>
            <g className={styles.manualShape} data-color={(sketch ?? pending)!.color} data-active="true">
              <ShapeLines
                shape={(sketch ?? pending)!.shape}
                a={toScreen((sketch ?? pending)!.box[0], (sketch ?? pending)!.box[1])}
                b={toScreen((sketch ?? pending)!.box[2], (sketch ?? pending)!.box[3])}
                width={2.4}
              />
            </g>
          </svg>
        )}
      </div>
      {pending && (
        <form
          className={styles.draftForm}
          style={(() => {
            const [, , bx1, by1] = boundsOf(pending.box);
            const [bx0] = boundsOf(pending.box);
            const p = toScreen(bx0, by1);
            const right = toScreen(bx1, by1);
            return {
              left: Math.max(8, Math.min(frame.width - 288, p.x)),
              top: Math.max(8, Math.min(frame.height - 190, right.y + 10)),
            };
          })()}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setPending(null);
            }
          }}
          onSubmit={(event) => {
            event.preventDefault();
            finishDraft();
          }}
        >
          <input
            autoFocus
            aria-label="題名"
            placeholder="題名（短く）"
            maxLength={MAX_TITLE}
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
          />
          <textarea
            aria-label="コメント"
            placeholder="コメント"
            rows={2}
            maxLength={MAX_COMMENT}
            value={draftComment}
            onChange={(event) => setDraftComment(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                finishDraft();
              }
            }}
          />
          <div>
            <button type="button" className={styles.btn} onClick={() => setPending(null)}>
              やめる
            </button>
            <button type="submit" className={styles.btnPrimary} disabled={!draftTitle.trim() && !draftComment.trim()}>
              朱書きに追加
            </button>
          </div>
        </form>
      )}
      <div className={styles.zoomButtons} onPointerDown={(event) => event.stopPropagation()}>
        <button aria-label="拡大" onClick={() => zoomAt(1.4, frame.width / 2, frame.height / 2)}><Plus size={15} /></button>
        <button aria-label="縮小" onClick={() => zoomAt(1 / 1.4, frame.width / 2, frame.height / 2)}><Minus size={15} /></button>
        <button onClick={() => setView(clamp({ scale: 1, x: 0, y: 0 }))}>全体</button>
      </div>
    </div>
  );
}
