"use client";

import { useRef, useState, type ReactNode } from "react";
import type { JobStatus } from "@/lib/useUploadJob";
import styles from "./App.module.css";

const elapsed = (seconds: number) =>
  seconds < 60
    ? `${Math.round(seconds)} 秒`
    : `${Math.floor(seconds / 60)} 分 ${Math.round(seconds % 60)} 秒`;

// 最初の画面。物件を選ぶ → 施工図を入れる → 朱書きを見る
export default function StartView({
  picker,
  status,
  error,
  running,
  onSend,
  results,
}: {
  picker: ReactNode;
  status: JobStatus | null;
  error: string | null;
  running: boolean;
  onSend: (file: File) => void;
  results: { key: string; title: string; detail: string; onOpen: () => void }[];
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [over, setOver] = useState(false);
  const [notPdf, setNotPdf] = useState(false);

  const choose = (chosen: File | undefined) => {
    if (!chosen) return;
    const isPdf = chosen.name.toLowerCase().endsWith(".pdf");
    setNotPdf(!isPdf);
    setFile(isPdf ? chosen : null);
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
        {picker}
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
            if (!running) choose(e.dataTransfer.files[0]);
          }}
        >
          <input
            ref={input}
            type="file"
            hidden
            accept="application/pdf,.pdf"
            aria-label="施工図のPDF"
            onChange={(e) => choose(e.target.files?.[0])}
          />
          {running ? (
            <div className={styles.progress} role="status">
              <b>{status?.message ?? "図面を送っています"}</b>
              <div className={styles.bar}>
                <div style={{ width: `${percent}%` }} />
              </div>
              {status && <small>経過 {elapsed(status.seconds)}</small>}
            </div>
          ) : file ? (
            <>
              <b className={styles.fileName}>{file.name}</b>
              <div className={styles.dropActions}>
                <button className={styles.primary} onClick={() => onSend(file)}>
                  チェックを始める
                </button>
                <button
                  className={styles.secondary}
                  onClick={() => input.current?.click()}
                >
                  別のPDFを選ぶ
                </button>
              </div>
              <small>1ページ 約3〜4分</small>
            </>
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
          {status?.state === "error" && (
            <p className={styles.error}>{status.message}</p>
          )}
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
          <p className={styles.fine}>チェックが終わると、ここから見られます。</p>
        )}
      </section>
    </div>
  );
}
