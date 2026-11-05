import type { NextRequest } from "next/server";
import { crossSite, uploadEnabled } from "@/lib/jobs";
import {
  addKnowledge,
  cleanItems,
  importFolder,
  importSourceName,
} from "@/lib/knowledge";

// 確認画面で直した項目を登録する。元のファイル名を各項目に残す
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/knowledge/[id]/register">,
) {
  const { id } = await ctx.params;
  const folder = uploadEnabled() ? importFolder(id) : null;
  if (!folder || crossSite(request))
    return Response.json({ error: "登録できません" }, { status: 403 });
  const items = cleanItems((await request.json()).items);
  if (!items) {
    return Response.json(
      { error: "チェック項目、確認すること、対象の図面の種類を入れてください" },
      { status: 400 },
    );
  }
  await addKnowledge(importSourceName(folder), items);
  return Response.json({ items: items.length });
}
