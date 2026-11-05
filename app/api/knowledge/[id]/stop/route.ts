import type { NextRequest } from "next/server";
import { crossSite, uploadEnabled } from "@/lib/jobs";
import { importFolder, stopImport } from "@/lib/knowledge";

// 整理を止める
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/knowledge/[id]/stop">,
) {
  const { id } = await ctx.params;
  const folder = uploadEnabled() ? importFolder(id) : null;
  if (!folder || crossSite(request))
    return Response.json({ error: "止められません" }, { status: 403 });
  stopImport(folder);
  return Response.json({ ok: true });
}
