"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import type { Draft, useUploadJob } from "@/lib/useUploadJob";
import styles from "./App.module.css";

// 3ページずつ並行して判定する。実績は1ページ 約3〜4分、約2ドル
const estimate = (pages: number) =>
  `目安 約${Math.round(Math.ceil(pages / 3) * 3.5)}分・約${pages * 2}ドル`;

const elapsed = (seconds: number) =>
  seconds < 60
    ? `${Math.round(seconds)} 秒`
    : `${Math.floor(seconds / 60)} 分 ${Math.round(seconds % 60)} 秒`;

// 判定するページを選ぶ。既定は1ページ目だけ（全ページを判定すると時間と費用が大きいため）
function PagePicker({
  draft,
  sending,
  onStart,
  onOther,
}: {
  draft: Draft;
  sending: boolean;
  onStart: (pages: number[]) => void;
  onOther: () => void;
}) {
  const [chosen, setChosen] = useState<ReadonlySet<number>>(new Set([1]));
  const toggle = (number: number) => {
    const next = new Set(chosen);
    if (next.has(number)) next.delete(number);
    else next.add(number);
    setChosen(next);
  };
  const pages = [...chosen].sort((a, b) => a - b);
  return (
    <div className={styles.pagePicker}>
      <div className={styles.pickerHead}>
        <b className={styles.fileName}>
          {draft.name}（全 {draft.pages.length} ページ）
        </b>
        <span>判定するページをクリックで選んでください</span>
      </div>
      <ul className={styles.thumbs}>
        {draft.pages.map((page) => (
          <li key={page.number}>
            <button
              aria-pressed={chosen.has(page.number)}
              aria-label={`${page.number} ページ目`}
              onClick={() => toggle(page.number)}
            >
              <Image
                src={`/api/check/${draft.id}/files/thumbs/p${page.number}.png`}
                alt=""
                width={page.width}
                height={page.height}
                unoptimized
              />
              <i>{page.number}</i>
            </button>
          </li>
        ))}
      </ul>
      <div className={styles.dropActions}>
        <button
          className={styles.primary}
          disabled={pages.length === 0 || sending}
          onClick={() => onStart(pages)}
        >
          {pages.length} ページのチェックを始める
        </button>
        <button className={styles.secondary} onClick={onOther}>
          別のPDFを選ぶ
        </button>
        <small>
          {pages.length > 0 ? estimate(pages.length) : "ページを選んでください"}
        </small>
      </div>
    </div>
  );
}

// 施工図を入れる部分
export default function UploadPanel({
  job,
}: {
  job: ReturnType<typeof useUploadJob>;
}) {
  const { status, error, running, draft, sending } = job;
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [notPdf, setNotPdf] = useState(false);

  const choose = (chosen: File | undefined) => {
    if (!chosen) return;
    const isPdf = chosen.name.toLowerCase().endsWith(".pdf");
    setNotPdf(!isPdf);
    if (isPdf) job.prepare(chosen);
  };

  const percent = status?.pages_total
    ? Math.round((status.pages_done / status.pages_total) * 100)
    : 0;

  return (
    <>
      <section className={styles.startStep}>
        <div
          className={styles.drop}
          data-over={over}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            if (!running && !sending) choose(e.dataTransfer.files[0]);
          }}
        >
          <input
            ref={input}
            type="file"
            hidden
            accept="application/pdf,.pdf"
            aria-label="施工図のPDF"
            onChange={(e) => {
              choose(e.target.files?.[0]);
              // 同じファイルをもう一度選べるようにする
              e.target.value = "";
            }}
          />
          {running ? (
            <div className={styles.progress} role="status">
              <b>{status?.message ?? "図面を送っています"}</b>
              <div className={styles.bar}>
                <div style={{ width: `${percent}%` }} />
              </div>
              {status && <small>経過 {elapsed(status.seconds)}</small>}
              <button
                className={styles.secondary}
                disabled={job.stopping}
                onClick={job.stop}
              >
                {job.stopping ? "止めています…" : "チェックを止める"}
              </button>
              <small>
                止めても、終わったページの結果は残ります。画面を閉じてもチェックは止まりません。
              </small>
            </div>
          ) : sending && !draft ? (
            <b role="status">PDFを読み込んでいます…</b>
          ) : (
            <>
              <span>施工図のPDFをここに置く</span>
              <button
                className={styles.primarySmall}
                onClick={() => input.current?.click()}
              >
                PDFを選ぶ
              </button>
            </>
          )}
          {notPdf && <p className={styles.error}>PDFを選んでください</p>}
          {error && <p className={styles.error}>{error}</p>}
          {status?.state === "error" && !draft && (
            <p className={styles.error}>{status.message}</p>
          )}
          {status?.state === "stopped" && !draft && <p>{status.message}</p>}
        </div>
        <p className={styles.fine}>
          図面は社外のAIサービス（Claude）に送って処理します。入れた図面と結果は、公開するデータとは別の場所に保存します。
        </p>
      </section>

      {draft && (
        <div className={styles.projectChecks} role="dialog" aria-label="判定するページ">
          <div className={styles.pickerWindow}>
            <PagePicker
              key={draft.id}
              draft={draft}
              sending={sending}
              onStart={job.start}
              onOther={() => {
                job.cancelDraft();
                input.current?.click();
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
