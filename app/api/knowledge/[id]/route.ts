import type { NextRequest } from "next/server";
import { uploadEnabled } from "@/lib/jobs";
import { importFolder, importStatus } from "@/lib/knowledge";

export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/knowledge/[id]">,
) {
  const { id } = await ctx.params;
  const folder = uploadEnabled() ? importFolder(id) : null;
  if (!folder)
    return Response.json({ error: "見つかりません" }, { status: 404 });
  return Response.json(importStatus(folder), {
    headers: { "Cache-Control": "no-store" },
  });
}
