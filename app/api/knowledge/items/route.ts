import type { NextRequest } from "next/server";
import { crossSite, uploadEnabled } from "@/lib/jobs";
import { addKnowledge, cleanItems } from "@/lib/knowledge";

// 1件ずつの追加。AIは呼ばない
export async function POST(request: NextRequest) {
  if (!uploadEnabled() || crossSite(request))
    return Response.json({ error: "追加できません" }, { status: 403 });
  const items = cleanItems([await request.json()]);
  if (!items) {
    return Response.json(
      { error: "チェック項目、確認すること、対象の図面の種類を入れてください" },
      { status: 400 },
    );
  }
  await addKnowledge("手入力", items);
  return Response.json({ ok: true });
}
