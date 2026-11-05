import type { NextRequest } from "next/server";
import { crossSite, uploadEnabled } from "@/lib/jobs";
import {
  cleanItems,
  deleteKnowledge,
  editKnowledge,
  validItemId,
} from "@/lib/knowledge";

const refused = () =>
  Response.json({ error: "変更できません" }, { status: 403 });

// 項目を直す
export async function PUT(
  request: NextRequest,
  ctx: RouteContext<"/api/knowledge/items/[id]">,
) {
  const { id } = await ctx.params;
  if (!uploadEnabled() || crossSite(request) || !validItemId(id)) return refused();
  const items = cleanItems([await request.json()]);
  if (!items) {
    return Response.json(
      { error: "チェック項目、確認すること、対象の図面の種類を入れてください" },
      { status: 400 },
    );
  }
  await editKnowledge(id, items[0]);
  return Response.json({ ok: true });
}

// 項目を消す
export async function DELETE(
  request: NextRequest,
  ctx: RouteContext<"/api/knowledge/items/[id]">,
) {
  const { id } = await ctx.params;
  if (!uploadEnabled() || crossSite(request) || !validItemId(id)) return refused();
  await deleteKnowledge(id);
  return Response.json({ ok: true });
}
