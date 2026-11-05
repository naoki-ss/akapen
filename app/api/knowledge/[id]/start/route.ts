import type { NextRequest } from "next/server";
import { crossSite, uploadEnabled } from "@/lib/jobs";
import { importFolder, startImport } from "@/lib/knowledge";

// AIでの整理を始める。費用が掛かるのはここから
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/knowledge/[id]/start">,
) {
  const { id } = await ctx.params;
  const folder = uploadEnabled() ? importFolder(id) : null;
  if (!folder || crossSite(request))
    return Response.json({ error: "始められません" }, { status: 403 });
  return Response.json({ started: startImport(folder) });
}
