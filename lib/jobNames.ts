// 判定の結果の名前。図面の名前で呼ぶ

import type { JobSummary } from "./useUploadJob";

const dateFormat = new Intl.DateTimeFormat("ja-JP", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Tokyo",
});

export function drawingName(pages: JobSummary["pages"]) {
  const first = pages[0]?.title ?? `p.${pages[0]?.number}`;
  return pages.length > 1 ? `${first} ほか ${pages.length - 1} 図面` : first;
}

// 同じ図面を何度もチェックすることがあるので、日時を添えて見分ける
export const jobOption = (job: JobSummary) =>
  `${drawingName(job.pages)}（${dateFormat.format(new Date(job.uploaded_at))}）`;
