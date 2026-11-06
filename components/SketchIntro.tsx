"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { PLAYED_KEY } from "@/lib/intro";
import styles from "./sketchIntro.module.css";

// トップの表示の動き（約2秒）。朱の補助線と骨組みを、実際の要素の位置を測って描き、そのまま本物の画面に入れ替える
// 同じ回のうちは1度だけ。クリックかキーで最後へ。動きを減らす設定では再生しない


// 時間（秒）
const GUIDE_STEP = 0.05;
const SKETCH_START = 0.3;
const SKETCH_DRAW = 0.45;
const SKETCH_END = 1.4;
const REVEAL_START = 1.2;
const REVEAL_STEP = 0.05;
const TOTAL = 2.3;

// delay：描き始め、fade：消え始め（秒）
type Line = { key: string; d: string; delay: number; fade: number; ref?: string };

// その要素の本物が現れ始める時刻。現れる動きの遅れ（animation-delay）から読む
function revealAt(element: Element | null) {
  const target = element?.closest<HTMLElement>("[data-sketch-reveal]");
  const delay = parseFloat(target?.style.animationDelay ?? "");
  return Number.isFinite(delay) ? delay : REVEAL_START;
}

// 要素の位置。現れる前の「下から 6px」の分を引いて、最後の位置で測る
function rectOf(element: Element) {
  const r = element.getBoundingClientRect();
  const lifted = element.closest("[data-sketch-reveal]");
  const ty = lifted ? new DOMMatrixReadOnly(getComputedStyle(lifted).transform).m42 : 0;
  return new DOMRect(r.x, r.y - ty, r.width, r.height);
}

const rectPath = (r: DOMRect, inset = 0) => {
  const x0 = r.left + inset;
  const y0 = r.top + inset;
  const x1 = r.right - inset;
  const y1 = r.bottom - inset;
  return `M ${x0} ${y0} H ${x1} V ${y1} H ${x0} Z`;
};
const hLine = (y: number, x0: number, x1: number) => `M ${x0} ${y} H ${x1}`;
const vLine = (x: number, y0: number, y1: number) => `M ${x} ${y0} V ${y1}`;

// 文字だけの幅（要素の幅ではなく）
function textRect(element: Element) {
  const range = document.createRange();
  range.selectNodeContents(element);
  const r = range.getBoundingClientRect();
  const lifted = element.closest("[data-sketch-reveal]");
  const ty = lifted ? new DOMMatrixReadOnly(getComputedStyle(lifted).transform).m42 : 0;
  return new DOMRect(r.x, r.y - ty, r.width, r.height);
}

const all = (name: string) => [...document.querySelectorAll(`[data-sketch="${name}"]`)];
const one = (name: string) => document.querySelector(`[data-sketch="${name}"]`);

// 画面の要素の位置から、補助線と骨組みの線を作る
function measure() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const headerElement = one("header");
  const header = headerElement ? rectOf(headerElement) : undefined;
  const cards = all("card").map((card) => rectOf(card));
  const title = one("title");
  const button = one("button");
  const guides: Line[] = [];
  const addGuide = (d: string) => guides.push({ key: `g${guides.length}`, d, delay: guides.length * GUIDE_STEP, fade: 0 });
  if (header) addGuide(hLine(header.bottom, 0, width));
  const left = cards[0]?.left ?? (title ? rectOf(title).left : undefined);
  const right = Math.max(...cards.map((c) => c.right), button ? rectOf(button).right : 0);
  if (left !== undefined) addGuide(vLine(left, 0, height));
  if (right > 0) addGuide(vLine(right, 0, height));
  if (cards[0]) {
    addGuide(hLine(cards[0].top, 0, width));
    addGuide(hLine(cards[0].bottom, 0, width));
    // 1行目のカードの間の区切り
    const firstRow = cards.filter((c) => Math.abs(c.top - cards[0].top) < 2);
    for (let i = 1; i < firstRow.length; i++) addGuide(vLine((firstRow[i - 1].right + firstRow[i].left) / 2, 0, height));
  }

  // 骨組み：左上から右下へ、まとまりごとに順に
  const groups: string[][] = [];
  // 線ごとの対象（自動の点検で、要素の位置と比べるため）
  const refs: string[][] = [];
  const fades: number[] = [];
  const push = (paths: string[], ref: string[], element: Element | null) => {
    groups.push(paths);
    refs.push(ref);
    fades.push(revealAt(element));
  };
  if (header) push([hLine(header.bottom, 0, width)], ["header-bottom"], headerElement);
  const logo = one("logo");
  if (logo) {
    const r = rectOf(logo);
    push([hLine(r.bottom + 3, r.left, r.right)], ["logo"], logo);
  }
  if (title) {
    const r = textRect(title);
    push([hLine(r.bottom + 4, r.left, r.right)], ["title"], title);
  }
  if (button) push([rectPath(rectOf(button), 0.5)], ["button"], button);
  for (const [index, card] of all("card").entries()) {
    const outer = rectOf(card);
    push([rectPath(outer, 0.5)], [`card-${index}`], card);
    const thumb = card.querySelector('[data-sketch="thumb"]');
    const body = card.querySelector('[data-sketch="body"]');
    if (thumb) {
      const t = rectOf(thumb);
      push([hLine(t.bottom, t.left, t.right)], [`thumb-${index}`], card);
      // 3D のサムネイルの建物のおおまかな形（塔屋と本体の2つの箱と地面）
      if (thumb.getAttribute("data-building") === "true") {
        const x = (f: number) => t.left + t.width * f;
        const y = (f: number) => t.top + t.height * f;
        push([
          `M ${x(0.19)} ${y(0.86)} V ${y(0.33)} H ${x(0.28)} V ${y(0.88)}`,
          `M ${x(0.28)} ${y(0.88)} V ${y(0.42)} H ${x(0.8)} V ${y(0.82)} L ${x(0.28)} ${y(0.88)}`,
          hLine(y(0.9), x(0.1), x(0.9)),
        ], [], card);
      }
    }
    if (body) {
      const rows = [...body.querySelectorAll(":scope > b, :scope > small, :scope > div > small")].map((row) => {
        const r = textRect(row);
        return hLine(r.bottom - 2, r.left, r.right);
      });
      if (rows.length) push(rows, [], card);
      const badges = [...body.querySelectorAll('[data-sketch="badge"]')].map((badge) => rectPath(rectOf(badge), 0.5));
      if (badges.length) push(badges, badges.map((_, b) => `badge-${index}-${b}`), card);
    }
  }
  const step = Math.min(0.08, Math.max(0.02, (SKETCH_END - SKETCH_DRAW - SKETCH_START) / Math.max(1, groups.length - 1)));
  const sketch: Line[] = groups.flatMap((paths, g) =>
    paths.map((d, i) => ({ key: `s${g}-${i}`, d, delay: SKETCH_START + g * step + i * 0.02, ref: refs[g][i], fade: fades[g] })),
  );
  // 補助線は、骨組みを描き終えた直後から消す
  const drawn = Math.max(0, ...sketch.map((line) => line.delay + SKETCH_DRAW));
  for (const guide of guides) guide.fade = drawn;
  return { width, height, guides, sketch };
}

type Drawing = ReturnType<typeof measure>;

export default function SketchIntro({ replay = false }: { replay?: boolean }) {
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [run, setRun] = useState(0);
  const timer = useRef<number | null>(null);

  // 終わり。途中で飛ばしたときは、本物の画面の動きを止めて最後の状態にする
  // 現れる動きの印は外さない（外すと、カードの元の現れる動きがもう一度始まる）
  const finish = useCallback(() => {
    const skipped = timer.current !== null;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    if (skipped) {
      for (const element of document.querySelectorAll<HTMLElement>("[data-sketch-reveal]")) element.style.animation = "none";
    }
    delete document.documentElement.dataset.intro;
    // 再生にかかった時間（自動の点検で読む）
    const timing = window as Window & { __introStarted?: number; __introMs?: number };
    if (timing.__introStarted) timing.__introMs = performance.now() - timing.__introStarted;
    try {
      sessionStorage.setItem(PLAYED_KEY, "1");
    } catch {}
    setDrawing(null);
  }, []);

  // 再生するかを決め、要素の位置を測って線を作る（描く前に行う）
  useLayoutEffect(() => {
    const root = document.documentElement;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let played = false;
    try {
      played = sessionStorage.getItem(PLAYED_KEY) === "1";
    } catch {}
    if (reduced || (played && !replay && run === 0)) {
      delete root.dataset.intro;
      return;
    }
    root.dataset.intro = "play";
    // 本物の画面は、ヘッダー → 見出し → ボタン → カードの順に出す
    const targets = [...document.querySelectorAll<HTMLElement>("[data-sketch-reveal]")].sort(
      (a, b) => Number(a.dataset.sketchReveal) - Number(b.dataset.sketchReveal),
    );
    targets.forEach((element, index) => {
      element.style.removeProperty("animation");
      element.classList.remove(styles.reveal);
      void element.offsetWidth; // もう一度再生するときに動きを始めからにする
      element.style.animationDelay = `${REVEAL_START + index * REVEAL_STEP}s`;
      element.classList.add(styles.reveal);
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 要素の位置は描画の後でしか測れない
    setDrawing(measure());
    // 案内の帯が後から出るなど、並びが変わったら線を測り直す（動きは続ける）
    const remeasure = () => {
      if (root.dataset.intro === "play") setDrawing(measure());
    };
    const observer = new ResizeObserver(remeasure);
    document.querySelectorAll("[data-sketch-reveal], [data-sketch]").forEach((element) => observer.observe(element));
    (window as Window & { __introStarted?: number }).__introStarted = performance.now();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      finish();
    }, (TOTAL + targets.length * REVEAL_STEP) * 1000);
    // 文字の書体が後から読み込まれて位置が変わったら、線を測り直す（動きは続ける）
    void document.fonts?.ready.then(remeasure);
    const skip = () => finish();
    window.addEventListener("pointerdown", skip, true);
    window.addEventListener("keydown", skip, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("pointerdown", skip, true);
      window.removeEventListener("keydown", skip, true);
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [replay, run, finish]);

  useEffect(() => () => void delete document.documentElement.dataset.intro, []);

  return (
    <>
      {drawing && (
        <svg
          key={run}
          className={styles.overlay}
          width={drawing.width}
          height={drawing.height}
          viewBox={`0 0 ${drawing.width} ${drawing.height}`}
          aria-hidden
          data-intro-lines
        >
          <g className={styles.guides}>
            {drawing.guides.map((line) => (
              <path key={line.key} d={line.d} pathLength={1} style={{ animationDelay: `${line.delay}s, ${line.fade}s` }} />
            ))}
          </g>
          <g className={styles.sketch}>
            {drawing.sketch.map((line) => (
              <path key={line.key} d={line.d} pathLength={1} data-ref={line.ref} style={{ animationDelay: `${line.delay}s, ${line.fade}s` }} />
            ))}
          </g>
        </svg>
      )}
      {replay && (
        <button className={styles.replay} hidden={Boolean(drawing)} onClick={() => setRun((n) => n + 1)}>
          もう一度再生
        </button>
      )}
    </>
  );
}
