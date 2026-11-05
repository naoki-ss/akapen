import type { NextRequest } from "next/server";
import {
  crossSite,
  jobFolder,
  readDecisionReasons,
  readDecisions,
  saveDecisions,
  uploadEnabled,
} from "@/lib/jobs";
import { recordRemoved, removeFeedback } from "@/lib/feedback";
import { decisionsAllowed } from "@/lib/sheetStatus";

export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/check/[id]/decisions">,
) {
  const { id } = await ctx.params;
  const folder = uploadEnabled() ? jobFolder(id) : null;
  return Response.json(
    {
      excluded: folder ? readDecisions(folder) : [],
      reasons: folder ? readDecisionReasons(folder) : {},
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

// 朱書きから外した指摘の番号を保存する
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/check/[id]/decisions">,
) {
  const { id } = await ctx.params;
  const folder = uploadEnabled() ? jobFolder(id) : null;
  if (!folder || crossSite(request)) {
    return Response.json({ error: "保存できません" }, { status: 403 });
  }
  const { excluded, reason, note } = (await request.json()) as {
    excluded: unknown;
    reason?: unknown;
    note?: unknown;
  };
  if (!Array.isArray(excluded) || !excluded.every(Number.isInteger)) {
    return Response.json({ error: "番号の形が違います" }, { status: 400 });
  }
  if (!decisionsAllowed(folder, readDecisions(folder), excluded)) {
    return Response.json({ error: "確定した図面は変更できません" }, { status: 409 });
  }
  // 新しく消した指摘の理由を残し、環境共通のフィードバックにも入れる。戻した指摘は取り除く
  const before = readDecisions(folder);
  const reasons = readDecisionReasons(folder);
  for (const number of excluded as number[]) {
    if (before.includes(number)) continue;
    const entry = {
      reason: String(reason ?? "").slice(0, 40),
      note: String(note ?? "").slice(0, 500),
      at: new Date().toISOString(),
    };
    reasons[number] = entry;
    recordRemoved(id, folder, number, entry);
  }
  for (const number of before) {
    if ((excluded as number[]).includes(number)) continue;
    delete reasons[number];
    removeFeedback(id, number);
  }
  saveDecisions(folder, excluded as number[], reasons);
  return Response.json({ ok: true });
}
