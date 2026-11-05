import type { NextRequest } from "next/server";
import { crossSite, uploadEnabled } from "@/lib/jobs";
import { cleanItems, importFolder, registerImport } from "@/lib/knowledge";

// 確認画面で直した項目を登録する
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/knowledge/[id]/register">,
) {
  const { id } = await ctx.params;
  if (!uploadEnabled() || !importFolder(id) || crossSite(request))
    return Response.json({ error: "登録できません" }, { status: 403 });
  const body = await request.json();
  const items = cleanItems(body.items);
  if (!items) {
    return Response.json(
      { error: "チェック項目、確認すること、対象の図面の種類を入れてください" },
      { status: 400 },
    );
  }
  registerImport(id, String(body.name ?? ""), items);
  return Response.json({ items: items.length });
}
