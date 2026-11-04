import type { NextRequest } from "next/server";
import { crossSite, uploadEnabled } from "@/lib/jobs";
import { projectFolder, startProject } from "@/lib/projects";

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/projects/[slug]/start">,
) {
  const { slug } = await ctx.params;
  const folder =
    uploadEnabled() && !crossSite(request) ? projectFolder(slug) : null;
  if (!folder)
    return Response.json({ error: "見つかりません" }, { status: 404 });
  if (!startProject(folder))
    return Response.json({ error: "もう始まっています" }, { status: 409 });
  return Response.json({ ok: true });
}
