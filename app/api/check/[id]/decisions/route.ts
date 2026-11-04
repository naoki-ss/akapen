import type { NextRequest } from "next/server";
import {
  crossSite,
  jobFolder,
  readDecisions,
  saveDecisions,
  uploadEnabled,
} from "@/lib/jobs";

export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/check/[id]/decisions">,
) {
  const { id } = await ctx.params;
  const folder = uploadEnabled() ? jobFolder(id) : null;
  return Response.json(
    { excluded: folder ? readDecisions(folder) : [] },
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
  const { excluded } = (await request.json()) as { excluded: unknown };
  if (!Array.isArray(excluded) || !excluded.every(Number.isInteger)) {
    return Response.json({ error: "番号の形が違います" }, { status: 400 });
  }
  saveDecisions(folder, excluded);
  return Response.json({ ok: true });
}
