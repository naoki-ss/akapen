"use client";

import Image from "next/image";
import { useRef, useState, type ReactNode } from "react";
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

// 最初の画面。物件を選ぶ → 施工図を入れる → 朱書きを見る
export default function StartView({
  picker,
  job,
  results,
  onRegister,
  projectNote,
}: {
  picker: ReactNode;
  onRegister?: () => void;
  projectNote?: ReactNode;
  job: ReturnType<typeof useUploadJob>;
  results: { key: string; title: string; detail: string; onOpen: () => void }[];
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
    <div className={styles.start}>
      <div className={styles.hero}>
        <h1>施工図に、朱書きを。</h1>
        <p>
          施工図を設計図書・議事録・社内チェックリストと照らし合わせ、朱書きを付けて返します。
        </p>
      </div>

      <section className={styles.startStep}>
        <h2>
          <i>1</i>物件を選ぶ
        </h2>
        <div className={styles.registerRow}>
          {picker}
          {onRegister && (
            <button className={styles.secondary} onClick={onRegister}>
              ＋ 新しい物件を登録
            </button>
          )}
          {projectNote}
        </div>
      </section>

      <section className={`${styles.startStep} ${styles.grow}`}>
        <h2>
          <i>2</i>施工図を入れる
        </h2>
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
          ) : draft ? (
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
          ) : sending ? (
            <b role="status">PDFを読み込んでいます…</b>
          ) : (
            <>
              <span>施工図のPDFをここに置く</span>
              <button
                className={styles.primary}
                onClick={() => input.current?.click()}
              >
                PDFを選ぶ
              </button>
              <small>1ページ 約3〜4分</small>
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

      <section className={styles.startStep}>
        <h2>
          <i>3</i>朱書きを見る
        </h2>
        {results.length > 0 ? (
          <div className={styles.results}>
            {results.map((item) => (
              <button key={item.key} onClick={item.onOpen}>
                <b>{item.title}</b>
                <span>{item.detail}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className={styles.fine}>
            チェックが終わると、ここから見られます。
          </p>
        )}
      </section>
    </div>
  );
}
