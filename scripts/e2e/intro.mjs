// トップの表示の動き（朱の補助線と骨組み）の自動の点検
//   node scripts/e2e/intro.mjs [スクショのフォルダ]
//   BASE=http://localhost:3000 CHROME=/usr/bin/google-chrome
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const BASE = process.env.BASE ?? "http://localhost:3000";
const shots = process.argv[2];
if (shots) mkdirSync(shots, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "OK " : "NG "} ${name}${detail ? `：${detail}` : ""}`);
};
const state = (page) => page.evaluate(() => document.documentElement.dataset.intro ?? "none");
const linesShown = (page) => page.locator("[data-intro-lines]").count();
const waitDone = (page) =>
  page.waitForFunction(() => !document.documentElement.dataset.intro && !document.querySelector("[data-intro-lines]"), null, { timeout: 20000 });

// 線の位置（再生中に読む）と、終わったあとの要素の位置を比べる
const readLines = (page) =>
  page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll("[data-intro-lines] path[data-ref]")].map((p) => {
        const b = p.getBBox();
        return [p.dataset.ref, { left: b.x, top: b.y, right: b.x + b.width, bottom: b.y + b.height }];
      }),
    ),
  );
const readTargets = (page) =>
  page.evaluate(() => {
    const r = (el) => el.getBoundingClientRect();
    const out = {};
    const header = document.querySelector('[data-sketch="header"]');
    if (header) out["header-bottom"] = { top: r(header).bottom, bottom: r(header).bottom };
    const button = document.querySelector('[data-sketch="button"]');
    if (button) out.button = r(button).toJSON();
    document.querySelectorAll('[data-sketch="card"]').forEach((card, i) => {
      out[`card-${i}`] = r(card).toJSON();
      const thumb = card.querySelector('[data-sketch="thumb"]');
      if (thumb) out[`thumb-${i}`] = { left: r(thumb).left, right: r(thumb).right, top: r(thumb).bottom, bottom: r(thumb).bottom };
      card.querySelectorAll('[data-sketch="badge"]').forEach((badge, b) => (out[`badge-${i}-${b}`] = r(badge).toJSON()));
    });
    return out;
  });

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome" });
try {
  for (const [width, height] of [
    [1440, 900],
    [1920, 1080],
  ]) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    const consoleErrors = [];
    page.on("console", (message) => message.type() === "error" && consoleErrors.push(message.text()));
    await page.goto(BASE, { waitUntil: "commit" });
    await page.locator("[data-intro-lines]").waitFor({ timeout: 30000 });
    check(`${width}：最初に開くと再生する`, (await state(page)) === "play");
    // 再生中もカードは押せる（上に覆いがない）
    const hit = await page.evaluate(() => {
      const card = document.querySelector('[data-sketch="card"]');
      const b = card.getBoundingClientRect();
      return document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.closest('[data-sketch="card"]') === card;
    });
    check(`${width}：再生中もカードが押せる`, hit);
    // 動きの中の 0.8 秒（ページの中の時計で測る）
    await page.waitForFunction(() => performance.now() - window.__introStarted >= 800, null, { polling: 16 });
    if (shots) await page.screenshot({ path: path.join(shots, `intro-${width}-0.8s.png`) });
    // 線の位置は、消える直前（2.0秒）に読む。書体の読み込みで並びが変わっても測り直しているかを見る
    await page.waitForFunction(() => performance.now() - window.__introStarted >= 2000, null, { polling: 16 });
    const lines = await readLines(page);
    await waitDone(page);
    const seconds = (await page.evaluate(() => window.__introMs ?? 0)) / 1000;
    check(`${width}：3秒以内に終わる`, seconds < 3, `${seconds.toFixed(1)}秒`);
    if (shots) await page.screenshot({ path: path.join(shots, `intro-${width}-end.png`) });
    const targets = await readTargets(page);
    const off = [];
    for (const [ref, target] of Object.entries(targets)) {
      const line = lines[ref];
      if (!line) {
        off.push(`${ref}：線なし`);
        continue;
      }
      for (const side of ["left", "top", "right", "bottom"]) {
        if (target[side] === undefined) continue;
        if (Math.abs(line[side] - target[side]) > 1.5) off.push(`${ref}.${side} ${line[side].toFixed(1)}≠${target[side].toFixed(1)}`);
      }
    }
    check(`${width}：朱の線が要素の位置とずれない（${Object.keys(targets).length} 本）`, off.length === 0, off.slice(0, 4).join(" / "));
    // 同じ回のうちに戻ったときは再生しない（画面の中の移動と、読み込み直し）
    await page.goto(`${BASE}/knowledge`, { waitUntil: "load" });
    await page.locator('header a[href="/"]').first().click();
    await page.waitForURL(`${BASE}/`);
    await page.locator('[data-sketch="card"]').first().waitFor();
    check(`${width}：トップへ戻ると再生しない`, (await linesShown(page)) === 0 && (await state(page)) === "none");
    await page.reload({ waitUntil: "load" });
    await page.locator('[data-sketch="card"]').first().waitFor();
    await page.waitForTimeout(300);
    check(`${width}：読み込み直しても再生しない`, (await linesShown(page)) === 0 && (await state(page)) === "none");
    check(`${width}：画面のエラーがない`, errors.length === 0 && consoleErrors.length === 0, [...errors, ...consoleErrors].join(" / ").slice(0, 300));
    await context.close();
  }

  for (const [name, act] of [
    ["クリック", (page) => page.mouse.click(5, 400)],
    ["キー", (page) => page.keyboard.press("Shift")],
  ]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(BASE, { waitUntil: "commit" });
    await page.locator("[data-intro-lines]").waitFor({ timeout: 30000 });
    await act(page);
    await page.waitForTimeout(100);
    const shown = await page.evaluate(() =>
      [...document.querySelectorAll("[data-sketch-reveal]")].every((el) => getComputedStyle(el).opacity === "1"),
    );
    check(`${name}で最後の状態へ飛ぶ`, (await linesShown(page)) === 0 && shown);
    await page.close();
  }

  const reduced = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const calm = await reduced.newPage();
  await calm.goto(BASE, { waitUntil: "load" });
  await calm.locator('[data-sketch="card"]').first().waitFor();
  await calm.waitForTimeout(300);
  check("動きを減らす設定では再生しない", (await linesShown(calm)) === 0 && (await state(calm)) === "none");
  await reduced.close();

  // 動画用：開くたびに再生し、「もう一度再生」でもう一度
  const film = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await film.goto(`${BASE}/preview/logo`, { waitUntil: "commit" });
  await film.locator("[data-intro-lines]").waitFor({ timeout: 30000 });
  await waitDone(film);
  await film.reload({ waitUntil: "commit" });
  const again = await film.locator("[data-intro-lines]").waitFor({ timeout: 30000 }).then(() => true, () => false);
  await waitDone(film);
  await film.getByRole("button", { name: "もう一度再生" }).click();
  const replayed = await film.locator("[data-intro-lines]").waitFor({ timeout: 3000 }).then(() => true, () => false);
  check("/preview/logo は開くたびと「もう一度再生」で再生する", again && replayed);
  await film.close();
} catch (error) {
  check("途中で止まった", false, String(error).split("\n")[0]);
} finally {
  await browser.close();
}
const failed = results.filter((ok) => !ok).length;
console.log(failed ? `${failed} 件が通りません` : `すべて通りました（${results.length} 件）`);
process.exit(failed ? 1 : 0);
