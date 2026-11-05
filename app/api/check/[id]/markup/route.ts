import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { NextRequest } from "next/server";
import { crossSite, jobFolder, uploadEnabled } from "@/lib/jobs";
import { cleanMarkup, EMPTY_MARKUP, type Markup } from "@/lib/markup";
import { confirmedPages } from "@/lib/sheetStatus";

const fileOf = (folder: string) => path.join(folder, "markup.json");

function readMarkup(folder: string): Markup {
  const file = fileOf(folder);
  return existsSync(file) ? (cleanMarkup(JSON.parse(readFileSync(file, "utf8"))) ?? EMPTY_MARKUP) : EMPTY_MARKUP;
}

// 書き足した朱書きと、AI の指摘の文面の直し
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/check/[id]/markup">) {
  const { id } = await ctx.params;
  const folder = uploadEnabled() ? jobFolder(id) : null;
  return Response.json(folder ? readMarkup(folder) : EMPTY_MARKUP, {
    headers: { "Cache-Control": "no-store" },
  });
}

// 全体を置き換えて保存する。確定した図面のページは変えられない
export async function PUT(request: NextRequest, ctx: RouteContext<"/api/check/[id]/markup">) {
  const { id } = await ctx.params;
  const folder = uploadEnabled() ? jobFolder(id) : null;
  if (!folder || crossSite(request)) {
    return Response.json({ error: "保存できません" }, { status: 403 });
  }
  const next = cleanMarkup(await request.json().catch(() => null));
  if (!next) return Response.json({ error: "形が違います" }, { status: 400 });
  const locked = new Set(confirmedPages(folder).map((item) => item.page));
  if (locked.size > 0) {
    const before = readMarkup(folder);
    const result = JSON.parse(readFileSync(path.join(folder, "result.json"), "utf8"));
    const pageOf = new Map<string, number>(
      result.findings.map((f: { number: number; drawing: { page: number } }) => [String(f.number), f.drawing.page]),
    );
    const sig = (m: Markup, page: number) =>
      JSON.stringify([
        m.items.filter((item) => item.page === page),
        Object.entries(m.edits).filter(([number]) => pageOf.get(number) === page).sort(),
      ]);
    if ([...locked].some((page) => sig(before, page) !== sig(next, page))) {
      return Response.json({ error: "確定した図面は変更できません" }, { status: 409 });
    }
  }
  writeFileSync(fileOf(folder), JSON.stringify(next));
  return Response.json({ ok: true });
}
