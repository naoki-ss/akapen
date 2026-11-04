import type { NextRequest } from "next/server";
import { jobFolder, readStatus, uploadEnabled } from "@/lib/jobs";

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/check/[id]">) {
  const { id } = await ctx.params;
  const folder = uploadEnabled() ? jobFolder(id) : null;
  if (!folder) return Response.json({ error: "見つかりません" }, { status: 404 });
  return Response.json(readStatus(folder), { headers: { "Cache-Control": "no-store" } });
}
