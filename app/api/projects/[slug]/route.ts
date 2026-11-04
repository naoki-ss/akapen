import type { NextRequest } from "next/server";
import { uploadEnabled } from "@/lib/jobs";
import { projectFolder, projectStatus } from "@/lib/projects";

export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/projects/[slug]">,
) {
  const { slug } = await ctx.params;
  const folder = uploadEnabled() ? projectFolder(slug) : null;
  if (!folder)
    return Response.json({ error: "見つかりません" }, { status: 404 });
  return Response.json(projectStatus(folder), {
    headers: { "Cache-Control": "no-store" },
  });
}
