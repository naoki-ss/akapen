// 朱書きから消した指摘と理由。環境で共通に持ち、次のチェックに活かす

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { RemovedReason } from "./jobs";

const FILE = path.join(homedir(), "sekozu-data", "feedback", "removed.json");

type Row = RemovedReason & {
  job: string;
  number: number;
  title: string;
  content: string;
  source_type: string;
};

const read = (): Row[] =>
  existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : [];

function write(rows: Row[]) {
  mkdirSync(path.dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(rows, null, 1));
}

export function recordRemoved(
  job: string,
  folder: string,
  number: number,
  entry: RemovedReason,
) {
  const result = JSON.parse(readFileSync(path.join(folder, "result.json"), "utf8"));
  const finding = result.findings.find(
    (item: { number: number }) => item.number === number,
  );
  if (!finding) return;
  write([
    ...read().filter((row) => !(row.job === job && row.number === number)),
    {
      ...entry,
      job,
      number,
      title: finding.title,
      content: finding.content,
      source_type: finding.source_type,
    },
  ]);
}

export function removeFeedback(job: string, number: number) {
  write(read().filter((row) => !(row.job === job && row.number === number)));
}
