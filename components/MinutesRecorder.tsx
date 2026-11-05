"use client";

import { Mic, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Minutes, MinutesMethod } from "@/lib/minutes";
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

type Stage = "input" | "organizing" | "edit" | "saved";

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
  const [draft, setDraft] = useState<Omit<Minutes, "id"> | null>(null);
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
          </div>
          {!supported && (
            <p className={styles.note}>
              このブラウザは音声認識に対応していません。Chromeで開くか、テキストを貼り付けて作ってください。
            </p>
          )}
          {mode === "音声" ? (
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
      {stage === "edit" && draft && (
        <MinutesEditor
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
              setStage("saved");
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
