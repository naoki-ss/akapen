import type { NextRequest } from "next/server";
import { crossSite, MAX_UPLOAD_BYTES, uploadEnabled } from "@/lib/jobs";
import { PREFECTURES } from "@/lib/prefectures";
import { createProject, listProjects, maskChoices } from "@/lib/projects";

const error = (message: string, status: number) =>
  Response.json({ error: message }, { status });

export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  if (!uploadEnabled()) {
    return Response.json(
      { projects: [], maskChoices: [], enabled: false },
      { headers },
    );
  }
  return Response.json(
    { projects: listProjects(), maskChoices: maskChoices(), enabled: true },
    { headers },
  );
}

function siteOf(label: string) {
  const found = PREFECTURES.find((prefecture) => prefecture.label === label);
  return found ? { label: found.label, lat: found.lat, lon: found.lon } : null;
}

const isPdf = async (file: File) =>
  Buffer.from(await file.slice(0, 5).arrayBuffer()).toString("latin1") ===
  "%PDF-";

export async function POST(request: NextRequest) {
  if (!uploadEnabled()) return error("この環境では物件を登録できません", 403);
  if (crossSite(request))
    return error("別のサイトからの送信は受け付けません", 403);
  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();
  const design = form.get("design");
  const revised = form.get("revised");
  const architectural = form.get("architectural");
  const minutes = form
    .getAll("minutes")
    .filter((f): f is File => f instanceof File && f.size > 0);
  if (!name) return error("物件名を入れてください", 400);
  if (listProjects().some((project) => project.name === name)) {
    return error("同じ名前の物件が登録されています", 400);
  }
  if (!(design instanceof File) || design.size === 0)
    return error("構造図のPDFを選んでください", 400);
  const drawings = [design, revised, architectural].filter(
    (f): f is File => f instanceof File && f.size > 0,
  );
  for (const file of [...drawings, ...minutes]) {
    if (file.size > MAX_UPLOAD_BYTES)
      return error("ファイルが大きすぎます（100MBまで）", 413);
  }
  for (const file of drawings) {
    if (!(await isPdf(file))) return error("図面はPDFにしてください", 400);
  }
  for (const file of minutes) {
    if (!/\.(pdf|md|txt)$/i.test(file.name))
      return error("議事録はPDF、md、txt にしてください", 400);
  }
  try {
    return Response.json(
      await createProject({
        name,
        structure: form.get("structure") === "RC造" ? "RC造" : "S造",
        use: String(form.get("use") ?? "").slice(0, 40),
        site: siteOf(String(form.get("site") ?? "")),
        northDeg: Number(form.get("north_deg")) || 0,
        masksFrom: String(form.get("masks_from") ?? ""),
        design,
        revised: revised instanceof File && revised.size > 0 ? revised : null,
        minutes,
        architectural:
          architectural instanceof File && architectural.size > 0
            ? architectural
            : null,
      }),
    );
  } catch (failure) {
    return error((failure as Error).message, 400);
  }
}
