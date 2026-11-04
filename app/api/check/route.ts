import type { NextRequest } from "next/server";
import {
  crossSite,
  isRegistered,
  listJobs,
  MAX_UPLOAD_BYTES,
  prepareJob,
  uploadEnabled,
} from "@/lib/jobs";

const error = (message: string, status: number) =>
  Response.json({ error: message }, { status });

export async function GET(request: NextRequest) {
  const project = request.nextUrl.searchParams.get("project") ?? "";
  const jobs = uploadEnabled() ? listJobs(project) : [];
  return Response.json({ jobs }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  if (!uploadEnabled()) {
    return error("この環境では施工図のチェックはできません", 403);
  }
  if (crossSite(request))
    return error("別のサイトからの送信は受け付けません", 403);
  const form = await request.formData();
  const file = form.get("file");
  const project = String(form.get("project") ?? "");
  if (!(file instanceof File)) return error("PDFを選んでください", 400);
  if (file.size > MAX_UPLOAD_BYTES)
    return error("ファイルが大きすぎます（100MBまで）", 413);
  if (!isRegistered(project))
    return error("設計図書が登録されていない物件です", 400);
  const pdf = Buffer.from(await file.arrayBuffer());
  if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") {
    return error("PDFファイルではありません", 400);
  }
  try {
    return Response.json(await prepareJob(pdf, project, file.name));
  } catch (failure) {
    return error((failure as Error).message, 400);
  }
}
