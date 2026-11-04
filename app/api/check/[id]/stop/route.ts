import type { NextRequest } from "next/server";
import { crossSite, jobFolder, requestStop, uploadEnabled } from "@/lib/jobs";

export async function POST(request: NextRequest, ctx: RouteContext<"/api/check/[id]/stop">) {
  const { id } = await ctx.params;
  const folder = uploadEnabled() && !crossSite(request) ? jobFolder(id) : null;
  if (!folder) return Response.json({ error: "見つかりません" }, { status: 404 });
  requestStop(folder);
  return Response.json({ ok: true });
}
