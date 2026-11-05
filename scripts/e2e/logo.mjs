// トップのロゴの動きの自動の点検
//   node scripts/e2e/logo.mjs [スクショのフォルダ]
//   BASE=http://localhost:3000 CHROME=/usr/bin/google-chrome
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const BASE = process.env.BASE ?? "http://localhost:3000";
const shots = process.argv[2];
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "OK " : "NG "} ${name}${detail ? `：${detail}` : ""}`);
};
const phase = async (page) => {
  await page.locator("[data-ready]").waitFor();
  return page.evaluate(() => document.querySelector("[data-phase]")?.getAttribute("data-phase"));
};

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome" });
try {
  for (const width of [1440, 1920]) {
    const height = width === 1440 ? 900 : 1080;
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.goto(BASE, { waitUntil: "load" });
    const first = await phase(page);
    check(`${width}：最初に開くと再生する`, first === "draw" || first === "line", first);
    // 再生中もカードは押せる（上に覆いがない）
    const card = page.locator('a[href^="/projects/"][href$="/model"]').first();
    const box = await card.boundingBox();
    const top = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.closest("a")?.getAttribute("href") ?? null,
      [box.x + box.width / 2, box.y + box.height / 2],
    );
    check(`${width}：再生中もカードが押せる`, Boolean(top && top.endsWith("/model")), top ?? "");
    await page.waitForFunction(() => document.querySelector("[data-phase]")?.getAttribute("data-phase") === "done", null, { timeout: 4000 });
    check(`${width}：2秒台で終わる`, true);
    const layout = await page.evaluate(() => {
      const logo = document.querySelector('svg[aria-label="アカペン"]').getBoundingClientRect();
      const head = document.querySelector("h1").getBoundingClientRect();
      const scroller = document.querySelector("main > div");
      return {
        inside: logo.left >= 0 && logo.right <= window.innerWidth && logo.top >= 0,
        above: logo.bottom <= head.top + 1,
        noSideScroll: !scroller || scroller.scrollWidth <= scroller.clientWidth,
      };
    });
    check(`${width}：崩れない（ロゴが画面の中、見出しの上、横にはみ出さない）`, layout.inside && layout.above && layout.noSideScroll, JSON.stringify(layout));
    if (shots) {
      mkdirSync(shots, { recursive: true });
      await page.screenshot({ path: path.join(shots, `top-${width}.png`) });
    }
    // 同じ回のうちに戻ったときは再生しない（画面の中の移動と、読み込み直し）
    await page.goto(`${BASE}/knowledge`, { waitUntil: "load" });
    await page.locator('header a[href="/"]').first().click();
    await page.waitForURL(`${BASE}/`);
    check(`${width}：トップへ戻ると最後の状態`, (await phase(page)) === "done");
    await page.reload({ waitUntil: "load" });
    check(`${width}：読み込み直しても最後の状態`, (await phase(page)) === "done");
    check(`${width}：画面のエラーがない`, errors.length === 0, errors.join(" / "));
    await context.close();
  }

  // クリックで最後へ飛ばす
  const skip = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await skip.goto(BASE, { waitUntil: "load" });
  await skip.locator("[data-ready]").waitFor();
  await skip.mouse.click(5, 300);
  check("クリックで最後の状態へ飛ぶ", (await phase(skip)) === "done");
  await skip.close();
  const key = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await key.goto(BASE, { waitUntil: "load" });
  await key.locator("[data-ready]").waitFor();
  await key.keyboard.press("Shift");
  check("キーで最後の状態へ飛ぶ", (await phase(key)) === "done");
  await key.close();

  // 動きを減らす設定では再生しない
  const reduced = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const calm = await reduced.newPage();
  await calm.goto(BASE, { waitUntil: "load" });
  check("動きを減らす設定では再生しない", (await phase(calm)) === "done");
  await reduced.close();

  // 動画用の画面は毎回再生する
  const preview = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const film = await preview.newPage();
  await film.goto(`${BASE}/preview/logo`, { waitUntil: "load" });
  const p1 = await phase(film);
  await film.waitForFunction(() => document.querySelector("[data-phase]")?.getAttribute("data-phase") === "done", null, { timeout: 4000 });
  await film.reload({ waitUntil: "load" });
  const p2 = await phase(film);
  check("/preview/logo は開くたびに再生する", p1 === "draw" && p2 === "draw", `${p1} ${p2}`);
  const fits = await film.evaluate(() => {
    const r = document.querySelector('svg[aria-label="アカペン"]').getBoundingClientRect();
    return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
  });
  check("/preview/logo が 1920×1080 に収まる", fits);
  if (shots) {
    await film.waitForTimeout(2600);
    await film.screenshot({ path: path.join(shots, "preview-1920.png") });
  }
  await preview.close();
} catch (error) {
  check("途中で止まった", false, String(error).split("\n")[0]);
} finally {
  await browser.close();
}
const failed = results.filter((ok) => !ok).length;
console.log(failed ? `${failed} 件が通りません` : `すべて通りました（${results.length} 件）`);
process.exit(failed ? 1 : 0);
