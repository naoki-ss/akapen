import type { NextRequest } from "next/server";
import { getBuilding } from "@/lib/buildings";

// ① の小さな画像を作るための建物データ。③と同じものを返す
export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/projects/[slug]/model">,
) {
  const { slug } = await ctx.params;
  const building = getBuilding(slug);
  if (!building)
    return Response.json({ error: "見つかりません" }, { status: 404 });
  return Response.json(building.model, {
    headers: { "Cache-Control": "no-store" },
  });
}
