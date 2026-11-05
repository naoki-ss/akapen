"use client";

import { Check, FileUp, Mic, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FileMeeting, Minutes, MinutesMethod } from "@/lib/minutes";
import MinutesEditor from "./MinutesEditor";
import styles from "./Minutes.module.css";

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type RecognitionEvent = {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
};

const recognitionClass = () => {
  const scope = window as unknown as {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
};

const ERROR_TEXT: Record<string, string> = {
  "not-allowed": "マイクの使用が許可されていません。ブラウザの設定を確かめるか、貼り付けで作ってください。",
  "service-not-allowed": "この環境では音声認識を使えません。貼り付けで作ってください。",
  network: "音声認識のサービスに接続できません。貼り付けで作ってください。",
  "audio-capture": "マイクが見つかりません。貼り付けで作ってください。",
};

const today = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());

type Stage = "input" | "organizing" | "pick" | "edit" | "saved";

type Draft = Omit<Minutes, "id">;
type FileReply = { id: string; file: string; transcript: string; meetings: FileMeeting[] };

// 回ごとの候補を、音声や貼り付けと同じ確認の画面に渡す形にする
const toDraft = (reply: FileReply, meeting: FileMeeting): Draft => ({
  title: meeting.title,
  date: meeting.date,
  method: "ファイル",
  transcript: reply.transcript,
  source: { import: reply.id, file: reply.file },
  decisions: meeting.decisions.map((row) => ({ ...row, id: "" })),
  todos: meeting.todos.map((row) => ({ ...row, id: "" })),
});

// ⑤の議事録づくり。音声（Web Speech API）または貼り付けの文章をClaudeで整理し、直して保存する
export default function MinutesRecorder({
  slug,
  inline = false,
  onClose,
  onSaved,
}: {
  slug: string;
  // 議事録のタブでは、画面の中に置く（⑤では3Dの上に重ねる）
  inline?: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [stage, setStage] = useState<Stage>("input");
  // 音声認識が使えないブラウザでは、最初から貼り付けにする
  const [supported] = useState(() => recognitionClass() !== null);
  const [mode, setMode] = useState<MinutesMethod>(supported ? "音声" : "貼り付け");
  const [recording, setRecording] = useState(false);
  const [finalText, setFinalText] = useState("");
  const [interim, setInterim] = useState("");
  const [pasted, setPasted] = useState("");
  const [error, setError] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  // ファイルから作るときの候補。1つのファイルに複数回の打ち合わせがあれば回ごとに分かれる
  const [candidates, setCandidates] = useState<Draft[]>([]);
  const [editing, setEditing] = useState(0);
  const [savedIndexes, setSavedIndexes] = useState<ReadonlySet<number>>(new Set());
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const engine = useRef<Recognition | null>(null);
  const keepGoing = useRef(false);

  useEffect(
    () => () => {
      keepGoing.current = false;
      engine.current?.stop();
    },
    [],
  );

  useEffect(() => {
    if (stage !== "organizing") return;
    const started = Date.now();
    const timer = setInterval(
      () => setSeconds(Math.round((Date.now() - started) / 1000)),
      500,
    );
    return () => clearInterval(timer);
  }, [stage]);

  const startRecording = () => {
    const Engine = recognitionClass();
    if (!Engine) return;
    setError("");
    const recognition = new Engine();
    recognition.lang = "ja-JP";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let pending = "";
      let confirmed = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) confirmed += `${result[0].transcript}\n`;
        else pending += result[0].transcript;
      }
      if (confirmed) setFinalText((text) => text + confirmed);
      setInterim(pending);
    };
    recognition.onerror = (event) => {
      // 無音が続いただけのときは、そのまま続ける
      if (event.error === "no-speech" || event.error === "aborted") return;
      keepGoing.current = false;
      setError(ERROR_TEXT[event.error] ?? `音声認識が止まりました（${event.error}）。貼り付けで作ってください。`);
    };
    recognition.onend = () => {
      // ブラウザは無音が続くと認識を止めるので、録音中はつなぎ直す
      if (keepGoing.current) recognition.start();
      else setRecording(false);
    };
    engine.current = recognition;
    keepGoing.current = true;
    recognition.start();
    setRecording(true);
  };

  const stopRecording = () => {
    keepGoing.current = false;
    engine.current?.stop();
    setRecording(false);
    setInterim("");
  };

  const organize = async (text: string, method: MinutesMethod) => {
    setError("");
    setSeconds(0);
    setStage("organizing");
    const response = await fetch(`/api/projects/${slug}/minutes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "organize", text }),
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error);
      setStage("input");
      return;
    }
    setDraft({
      title: body.title,
      date: today(),
      method,
      transcript: text,
      decisions: body.decisions.map((row: Minutes["decisions"][number]) => ({ ...row, id: "" })),
      todos: body.todos.map((text: string) => ({ id: "", text })),
    });
    setStage("edit");
  };

  const openCandidate = (list: Draft[], index: number) => {
    setEditing(index);
    setDraft(list[index]);
    setStage("edit");
  };

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    setSeconds(0);
    setStage("organizing");
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(`/api/projects/${slug}/minutes/import`, {
      method: "POST",
      body: form,
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error);
      setStage("input");
      return;
    }
    const list = (body as FileReply).meetings.map((meeting) => toDraft(body, meeting));
    if (list.length === 0) {
      setError("ファイルから打ち合わせの内容を読み取れませんでした");
      setStage("input");
      return;
    }
    setCandidates(list);
    setSavedIndexes(new Set());
    if (list.length === 1) openCandidate(list, 0);
    else setStage("pick");
  };

  const voiceText = finalText.trim();

  return (
    <aside
      className={inline ? styles.recorderInline : styles.recorder}
      aria-label="議事録を作る"
    >
      <header>
        <b>議事録を作る</b>
        <button type="button" className={styles.remove} aria-label="閉じる" onClick={onClose}>
          <X size={14} />
        </button>
      </header>
      {stage === "input" && (
        <>
          <div className={styles.tabs}>
            <button
              type="button"
              aria-pressed={mode === "音声"}
              disabled={!supported}
              onClick={() => setMode("音声")}
            >
              音声
            </button>
            <button
              type="button"
              aria-pressed={mode === "貼り付け"}
              onClick={() => {
                stopRecording();
                setMode("貼り付け");
              }}
            >
              テキストを貼り付け
            </button>
            <button
              type="button"
              aria-pressed={mode === "ファイル"}
              onClick={() => {
                stopRecording();
                setMode("ファイル");
              }}
            >
              ファイルから
            </button>
          </div>
          {!supported && (
            <p className={styles.note}>
              このブラウザは音声認識に対応していません。Chromeで開くか、テキストを貼り付けて作ってください。
            </p>
          )}
          {mode === "ファイル" ? (
            <div
              className={styles.fileDrop}
              data-over={over}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                void readFile(e.dataTransfer.files[0]);
              }}
            >
              <input
                ref={fileInput}
                type="file"
                hidden
                accept=".pdf,.docx,.txt"
                aria-label="議事録のファイル"
                onChange={(e) => {
                  void readFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <span>議事録のファイルをここに置く</span>
              <button type="button" className={styles.secondary} onClick={() => fileInput.current?.click()}>
                <FileUp size={14} /> ファイルを選ぶ
              </button>
              <small className={styles.note}>
                PDF・Word（.docx）・テキスト。日付と題名はファイルから読み取ります。複数回の打ち合わせは回ごとに分けます。
              </small>
            </div>
          ) : mode === "音声" ? (
            <>
              <div className={styles.transcript} aria-live="polite">
                {finalText || interim ? (
                  <>
                    {finalText}
                    <span className={styles.interim}>{interim}</span>
                  </>
                ) : (
                  <span className={styles.note}>録音を始めると、ここに文字が出ます。</span>
                )}
              </div>
              <div className={styles.actions}>
                {recording ? (
                  <>
                    <button type="button" className={styles.stop} onClick={stopRecording}>
                      <Square size={12} fill="currentColor" /> 録音を止める
                    </button>
                    <span className={styles.wave} aria-hidden>
                      <i /><i /><i /><i /><i /><i /><i />
                    </span>
                  </>
                ) : (
                  <button type="button" className={styles.secondary} onClick={startRecording}>
                    <Mic size={14} /> 録音を始める
                  </button>
                )}
                <button
                  type="button"
                  className={styles.primary}
                  disabled={recording || !voiceText}
                  onClick={() => organize(voiceText, "音声")}
                >
                  議事録に整理する
                </button>
              </div>
            </>
          ) : (
            <>
              <textarea
                className={styles.paste}
                aria-label="打ち合わせの文章"
                rows={12}
                placeholder="打ち合わせのメモや文字起こしを貼り付けてください"
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
              />
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.primary}
                  disabled={!pasted.trim()}
                  onClick={() => organize(pasted.trim(), "貼り付け")}
                >
                  議事録に整理する
                </button>
              </div>
            </>
          )}
          {error && <p className={styles.error}>{error}</p>}
        </>
      )}
      {stage === "organizing" && (
        <p>
          Claudeが決定事項と宿題に整理しています… <span className="mono">{seconds} 秒</span>
        </p>
      )}
      {stage === "pick" && (
        <>
          <p>
            {candidates[0]?.source?.file} に {candidates.length} 回分の打ち合わせがありました。1回ずつ確かめて保存してください。
          </p>
          <ul className={styles.candidates}>
            {candidates.map((row, index) => (
              <li key={index}>
                <span className="mono">{row.date || "日付なし"}</span>
                <b>{row.title}</b>
                <small className="mono">
                  決定 {row.decisions.length}・宿題 {row.todos.length}
                </small>
                {savedIndexes.has(index) ? (
                  <small>
                    <Check size={13} /> 保存しました
                  </small>
                ) : (
                  <button type="button" className={styles.secondary} onClick={() => openCandidate(candidates, index)}>
                    確かめて保存する
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {stage === "edit" && draft && (
        <MinutesEditor
          key={`${stage}-${editing}`}
          initial={draft}
          saving={saving}
          error={error}
          saveLabel="この物件の議事録として保存する"
          onSave={async (edited) => {
            setSaving(true);
            setError("");
            const response = await fetch(`/api/projects/${slug}/minutes`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(edited),
            });
            setSaving(false);
            if (response.ok) {
              const done = new Set(savedIndexes).add(editing);
              setSavedIndexes(done);
              setStage(candidates.length > 1 && done.size < candidates.length ? "pick" : "saved");
              onSaved?.();
            }
            else setError((await response.json()).error);
          }}
        />
      )}
      {stage === "saved" && (
        <p>
          保存しました。これからの施工図のチェックで、この議事録と照らし合わせます。議事録のタブの履歴から見られます。
        </p>
      )}
    </aside>
  );
}
