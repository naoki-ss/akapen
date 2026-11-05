import type { NextRequest } from "next/server";
import { crossSite, jobFolder, uploadEnabled } from "@/lib/jobs";
import { setSheetState } from "@/lib/sheetStatus";

// 施工図の状態を変える。確定すると担当者と日時を記録し、そのページは変更できなくなる
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/check/[id]/status">,
) {
  const { id } = await ctx.params;
  const folder = uploadEnabled() ? jobFolder(id) : null;
  if (!folder || crossSite(request)) {
    return Response.json({ error: "変更できません" }, { status: 403 });
  }
  const body = await request.json();
  if (body.state !== "チェックバック済み" && body.state !== "確定") {
    return Response.json({ error: "状態が正しくありません" }, { status: 400 });
  }
  try {
    setSheetState(folder, Number(body.page), body.state, String(body.by ?? ""));
    return Response.json({ ok: true });
  } catch (failure) {
    return Response.json({ error: (failure as Error).message }, { status: 409 });
  }
}
