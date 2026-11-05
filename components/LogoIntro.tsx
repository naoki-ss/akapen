"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { LOGO_GLYPHS, LOGO_HEIGHT, LOGO_WIDTH } from "./logoPaths";
import styles from "./logoIntro.module.css";

// 動きの時間（ms）。文字をなぞる → 下線を引く → 合言葉と現場一覧が出る
const DRAW = 1200;
const LINE = 300;
const REVEAL = 500;
const PLAYED = "akapen-logo-played";

// 下線（文字の下に1本）。文字と同じ座標
const UNDERLINE = `M 60 ${LOGO_HEIGHT + 70} Q ${LOGO_WIDTH / 2} ${LOGO_HEIGHT + 40} ${LOGO_WIDTH - 40} ${LOGO_HEIGHT + 62}`;
const VIEW_HEIGHT = LOGO_HEIGHT + 140;
// 鉛筆の大きさ（文字の座標で）と、先の位置（アイコンの 32 の枠の中で）
const PENCIL = 420;
const TIP = { x: 6, y: 26 };

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const easeOut = (t: number) => 1 - (1 - t) ** 3;

// 赤鉛筆が「アカペン」を手書きでなぞり、下線を引いてから、合言葉と中身（現場一覧）を出す
// replay：開くたびに必ず再生する（動画の撮影用）。ふだんは同じ回のうちに1度だけ
export default function LogoIntro({
  children,
  replay = false,
  large = false,
}: {
  children?: ReactNode;
  replay?: boolean;
  large?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const paths = useRef<(SVGPathElement | null)[]>([]);
  const glyphs = useRef<(SVGGElement | null)[]>([]);
  const line = useRef<SVGPathElement>(null);
  const pencil = useRef<SVGGElement>(null);
  const play = useRef<() => void>(() => {});

  // 描く前に最初の絵を決める（最後の状態のときに、ちらつかせない）
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const played = !replay && sessionStorage.getItem(PLAYED) === "1";
    node.dataset.phase = reduced || played ? "done" : "draw";
    node.dataset.ready = "true";
  }, [replay]);

  useEffect(() => {
    const node = root.current;
    const all = paths.current.filter((p): p is SVGPathElement => Boolean(p));
    if (!node || !line.current || !pencil.current) return;
    const lengths = all.map((p) => p.getTotalLength());
    const starts = lengths.map((_, i) => lengths.slice(0, i).reduce((a, b) => a + b, 0));
    const total = lengths.reduce((a, b) => a + b, 0);
    const lineLength = line.current.getTotalLength();
    const glyphOf = all.map((p) => Number(p.dataset.glyph));
    const lastOfGlyph = LOGO_GLYPHS.map((_, g) => glyphOf.lastIndexOf(g));

    const placePencil = (point: DOMPoint) => {
      const scale = PENCIL / 32;
      pencil.current?.setAttribute(
        "transform",
        `translate(${point.x - TIP.x * scale} ${point.y - TIP.y * scale}) scale(${scale})`,
      );
    };
    const showAll = () => {
      all.forEach((p) => (p.style.strokeDashoffset = "0"));
      glyphs.current.forEach((g) => g?.setAttribute("data-done", "true"));
      line.current!.style.strokeDashoffset = "0";
      placePencil(line.current!.getPointAtLength(lineLength));
    };

    let frame = 0;
    const finish = () => {
      cancelAnimationFrame(frame);
      showAll();
      node.dataset.phase = "done";
      sessionStorage.setItem(PLAYED, "1");
      window.removeEventListener("pointerdown", finish, true);
      window.removeEventListener("keydown", finish, true);
    };

    const start = () => {
      cancelAnimationFrame(frame);
      node.dataset.phase = "draw";
      all.forEach((p, i) => {
        p.style.strokeDasharray = `${lengths[i]} ${lengths[i] + 1}`;
        p.style.strokeDashoffset = String(lengths[i]);
      });
      glyphs.current.forEach((g) => g?.setAttribute("data-done", "false"));
      line.current!.style.strokeDasharray = `${lineLength} ${lineLength + 1}`;
      line.current!.style.strokeDashoffset = String(lineLength);
      placePencil(all[0].getPointAtLength(0));
      // クリックかキーで最後の状態へ飛ばす（押したものはそのまま効く）
      window.addEventListener("pointerdown", finish, true);
      window.addEventListener("keydown", finish, true);
      const began = performance.now();
      const tick = (now: number) => {
        const elapsed = now - began;
        if (elapsed < DRAW) {
          const drawn = total * easeInOut(elapsed / DRAW);
          let tip: DOMPoint | null = null;
          all.forEach((p, i) => {
            const shown = Math.min(lengths[i], Math.max(0, drawn - starts[i]));
            p.style.strokeDashoffset = String(lengths[i] - shown);
            if (shown > 0 && shown < lengths[i]) tip = p.getPointAtLength(shown);
          });
          lastOfGlyph.forEach((last, g) => {
            if (last >= 0 && drawn >= starts[last] + lengths[last]) glyphs.current[g]?.setAttribute("data-done", "true");
          });
          if (tip) placePencil(tip);
        } else if (elapsed < DRAW + LINE) {
          all.forEach((p) => (p.style.strokeDashoffset = "0"));
          glyphs.current.forEach((g) => g?.setAttribute("data-done", "true"));
          node.dataset.phase = "line";
          const shown = lineLength * easeOut((elapsed - DRAW) / LINE);
          line.current!.style.strokeDashoffset = String(lineLength - shown);
          placePencil(line.current!.getPointAtLength(shown));
        } else {
          line.current!.style.strokeDashoffset = "0";
          placePencil(line.current!.getPointAtLength(lineLength));
          node.dataset.phase = "reveal";
          if (elapsed >= DRAW + LINE + REVEAL) {
            finish();
            return;
          }
        }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };
    play.current = start;

    if (node.dataset.phase === "draw") start();
    else showAll();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", finish, true);
      window.removeEventListener("keydown", finish, true);
    };
  }, []);

  let index = 0;
  return (
    <div ref={root} className={styles.intro} data-large={large} data-phase="draw">
      <div className={styles.mark}>
        <svg
          className={styles.logo}
          viewBox={`-20 -40 ${LOGO_WIDTH + PENCIL} ${VIEW_HEIGHT + 60}`}
          role="img"
          aria-label="アカペン"
          onClick={replay ? () => play.current() : undefined}
        >
          {LOGO_GLYPHS.map((glyph, g) => (
            <g key={glyph.char} ref={(el) => void (glyphs.current[g] = el)} className={styles.glyph} data-done="false">
              {glyph.parts.map((d) => {
                const i = index++;
                return <path key={i} d={d} data-glyph={g} ref={(el) => void (paths.current[i] = el)} />;
              })}
            </g>
          ))}
          <path ref={line} d={UNDERLINE} className={styles.underline} />
          {/* 赤鉛筆。先（左下）が描いている線の先端につく */}
          <g ref={pencil} className={styles.pencil}>
            <path d="M6 26 L9 18 L22 5 a2.8 2.8 0 0 1 4 0 l1 1 a2.8 2.8 0 0 1 0 4 L14 23 Z" fill="var(--red)" />
            <path d="M6 26 L9 18 L14 23 Z" fill="#fff" stroke="var(--red)" strokeWidth="0.8" strokeLinejoin="round" />
          </g>
        </svg>
        <p className={`${styles.tagline} hand`}>施工図に、朱書きを。</p>
      </div>
      {children && <div className={styles.content}>{children}</div>}
    </div>
  );
}
