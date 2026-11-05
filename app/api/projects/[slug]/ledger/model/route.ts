import type { NextRequest } from "next/server";
import { crossSite, uploadEnabled } from "@/lib/jobs";
import { modelStatus, stopModelUpdate, validIds } from "@/lib/ledger";

// 建物データと3Dの更新の進み具合
export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/projects/[slug]/ledger/model">,
) {
  const { slug } = await ctx.params;
  if (!uploadEnabled() || !validIds(slug))
    return Response.json({ error: "見つかりません" }, { status: 404 });
  return Response.json(modelStatus(slug), { headers: { "Cache-Control": "no-store" } });
}

// 更新を止める
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/projects/[slug]/ledger/model">,
) {
  const { slug } = await ctx.params;
  if (!uploadEnabled() || crossSite(request) || !validIds(slug))
    return Response.json({ error: "止められません" }, { status: 403 });
  stopModelUpdate(slug);
  return Response.json({ ok: true });
}
