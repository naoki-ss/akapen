// ④の「朱書きを書き足す」の自動の点検（#133）
// 書き足す → 一覧に出る → 開き直しても残る → PDF に入る、と、AI の文面の直し・動かす・Ctrl+Z・消す を通す。
// 終わったら、その結果の書き足しを始める前の状態に戻す。
//
//   node scripts/e2e/markup.mjs <判定のID> [スクショのフォルダ]
//   BASE=http://localhost:3000 CHROME=/usr/bin/google-chrome PROJECT=sample-b
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const job = process.argv[2];
const shots = process.argv[3];
if (!job) {
  console.error("判定のIDを渡してください");
  process.exit(2);
}
const BASE = process.env.BASE ?? "http://localhost:3000";
const PROJECT = process.env.PROJECT ?? "sample-b";
const api = `${BASE}/api/check/${job}/markup`;
const pageUrl = `${BASE}/projects/${PROJECT}/check/${job}`;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "OK " : "NG "} ${name}${detail ? `：${detail}` : ""}`);
};
const getMarkup = async () => (await fetch(api, { cache: "no-store" })).json();
const putMarkup = (body) =>
  fetch(api, { method: "PUT", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify(body) });

const before = await getMarkup();
const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? "/usr/bin/google-chrome",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const shot = async (name) => {
  if (!shots) return;
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, `${name}.png`) });
};
const saved = () => page.waitForResponse((r) => r.url().startsWith(api) && r.request().method() === "PUT");

try {
  await page.goto(pageUrl, { waitUntil: "load" });
  await page.locator('[class*="items"] li').first().waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "施工図", exact: true }).click();
  const toolbar = page.getByRole("toolbar", { name: "朱書きを追加" });
  await toolbar.waitFor();
  check("施工図で「朱書きを追加」が出る", await toolbar.isVisible());
  await page.waitForTimeout(800);
  const numbersBefore = await page.locator('[class*="items"] li').count();

  // 丸を描いて文を入れる
  await toolbar.getByRole("button", { name: "丸" }).click();
  const frame = page.locator('[class*="sheetFrame"]');
  const box = await frame.boundingBox();
  const x = box.x + box.width * 0.42;
  const y = box.y + box.height * 0.42;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y + 30, { steps: 5 });
  await page.mouse.move(x + 130, y + 70, { steps: 5 });
  await page.mouse.up();
  await page.getByRole("textbox", { name: "題名" }).fill("梁の継手位置");
  await page.getByRole("textbox", { name: "コメント" }).fill("継手の位置を設計図と合わせてください");
  await shot("1-draft");
  const put1 = saved();
  await page.getByRole("button", { name: "朱書きに追加" }).click();
  await put1;
  const listItem = page.locator('[class*="items"] li', { hasText: "梁の継手位置" });
  await listItem.waitFor();
  const itemText = await listItem.innerText();
  check("一覧に番号付きで出る", /\d+/.test(itemText) && itemText.includes("手書き"), itemText.replace(/\s+/g, " "));
  check("一覧の件数が1つ増える", (await page.locator('[class*="items"] li').count()) === numbersBefore + 1);
  const drawn = (await getMarkup()).items.find((item) => item.title === "梁の継手位置");
  check("サーバーに保存される", Boolean(drawn && drawn.shape === "ellipse" && drawn.color === "red"));
  await shot("2-added");

  // 開き直しても残る
  await page.reload({ waitUntil: "load" });
  await page.locator('[class*="items"] li').first().waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "施工図", exact: true }).click();
  const again = page.locator('[class*="items"] li', { hasText: "梁の継手位置" });
  await again.waitFor();
  check("開き直しても残る", await again.isVisible());
  check("図面に文が描かれる", await page.locator('[class*="manualText"]', { hasText: "継手の位置" }).isVisible());

  // 選ぶと比較に「手書き」、3D では位置なし
  await again.locator("button").click();
  await page.waitForTimeout(700);
  check("比較に手書きの朱書きとして出る", await page.getByRole("region", { name: "書き足した朱書き" }).isVisible());
  await shot("3-selected");

  // 動かす（選んだ形をドラッグ）
  const hit = page.locator('[class*="manualItem"][data-active="true"] [class*="manualHit"]');
  const hitBox = await hit.boundingBox();
  const put2 = saved();
  await page.mouse.move(hitBox.x + hitBox.width / 2, hitBox.y + hitBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(hitBox.x + hitBox.width / 2 + 40, hitBox.y + hitBox.height / 2 + 20, { steps: 6 });
  await page.mouse.up();
  await put2;
  const moved = (await getMarkup()).items.find((item) => item.id === drawn.id);
  check("動かせる", moved && moved.box[0] > drawn.box[0] && moved.box[1] > drawn.box[1]);

  // Ctrl+Z で1つ戻す
  const put3 = saved();
  await page.keyboard.press("Control+z");
  await put3;
  const undone = (await getMarkup()).items.find((item) => item.id === drawn.id);
  check("Ctrl+Z で1つ戻る", undone && Math.abs(undone.box[0] - drawn.box[0]) < 1e-4);

  await page.getByRole("button", { name: "3D", exact: true }).click();
  check("3D では「3D の位置なし」", await page.getByText("3D の位置なし").isVisible());
  await page.getByRole("button", { name: "施工図", exact: true }).click();

  // AI の指摘の文面を直す
  const first = page.locator('[class*="items"] li').first();
  await first.locator("button").click();
  await page.getByRole("button", { name: "文面を直す" }).click();
  await page.getByRole("textbox", { name: "題名" }).fill("直した題名（点検）");
  const put4 = saved();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await put4;
  const editedItem = page.locator('[class*="items"] li', { hasText: "直した題名（点検）" });
  check("AI の文面を直すと「編集済み」", (await editedItem.innerText()).includes("編集済み"));
  await shot("4-edited");

  // PDF に入る
  const pdfPath = path.join(shots ?? path.join(tmpdir(), "akapen-e2e"), "marked.pdf");
  mkdirSync(path.dirname(pdfPath), { recursive: true });
  const pdf = await fetch(`${BASE}/api/check/${job}/export?public=1`);
  writeFileSync(pdfPath, Buffer.from(await pdf.arrayBuffer()));
  const text = execFileSync(
    path.join(process.cwd(), ".venv", "bin", "python"),
    ["-c", "import pymupdf,sys;print(''.join(p.get_text() for p in pymupdf.open(sys.argv[1])))", pdfPath],
    { encoding: "utf8" },
  );
  check("朱書きPDFに書き足した朱書きが入る", pdf.ok && text.includes("継手の位置を設計図と合わせてください"));
  check("朱書きPDFに直した文面が入る", text.includes("直した題名（点検）"));

  // 消す（選んで Delete）
  await page.locator('[class*="items"] li', { hasText: "梁の継手位置" }).locator("button").click();
  await page.waitForTimeout(300);
  const put5 = saved();
  await page.keyboard.press("Delete");
  await put5;
  check("Delete で消える", !(await getMarkup()).items.some((item) => item.id === drawn.id));
  check("画面のエラーがない", errors.length === 0, errors.join(" / "));
} catch (error) {
  check("途中で止まった", false, String(error).split("\n")[0]);
  await shot("error");
} finally {
  await putMarkup(before);
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `${failed} 件が通りません` : `すべて通りました（${results.length} 件）`);
process.exit(failed ? 1 : 0);
