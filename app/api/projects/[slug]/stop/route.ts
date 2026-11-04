import type { NextRequest } from "next/server";
import { crossSite, uploadEnabled } from "@/lib/jobs";
import { projectFolder, requestProjectStop } from "@/lib/projects";

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/projects/[slug]/stop">,
) {
  const { slug } = await ctx.params;
  const folder =
    uploadEnabled() && !crossSite(request) ? projectFolder(slug) : null;
  if (!folder)
    return Response.json({ error: "見つかりません" }, { status: 404 });
  requestProjectStop(folder);
  return Response.json({ ok: true });
}
