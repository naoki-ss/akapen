"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import type {
  CheckResult,
  EvalReport,
  Finding,
  HumanItem,
  RunStats,
} from "@/lib/check";
import {
  ALL_LAYERS,
  type Box,
  type LayerKey,
  type Sheet,
  type SheetIndex,
  type SheetTarget,
} from "@/lib/sheets";
import { useUploadJob, type JobSummary } from "@/lib/useUploadJob";
import CheckPanel from "./CheckPanel";
import LayerToggles from "./LayerToggles";
import SheetCanvas from "./SheetCanvas";
import SheetViewer from "./SheetViewer";
import StartView from "./StartView";
import {
  floorsOf,
  memberKey,
  TYPE_LABELS,
  type BuildingModel,
  type Member,
  type MemberType,
} from "@/lib/model";
import styles from "./App.module.css";

// WebGL はブラウザでしか動かないので、サーバー側では描画しない
const BuildingScene = dynamic(() => import("./BuildingScene"), {
  ssr: false,
  loading: () => <p className={styles.loading}>3Dモデルを読み込み中…</p>,
});

const TOGGLEABLE: MemberType[] = ["slab", "wall", "pile"];

function levelText(m: Member) {
  const toM = (mm: number) => `${(mm / 1000).toFixed(2)}m`;
  if (!("z" in m)) return `${toM(m.z0)} 〜 ${toM(m.z1)}`;
  const end = "z1" in m ? m.z1 : undefined;
  return end === undefined || end === m.z
    ? toM(m.z)
    : `${toM(m.z)} 〜 ${toM(end)}`;
}

// 施工図チェックの結果。まだチェックしていない物件にはない
export type BuildingCheck = {
  result: CheckResult;
  report?: EvalReport;
  stats?: RunStats;
  humanItems: HumanItem[];
  humanLead?: string;
};

export type Building = {
  // demo-data の下のフォルダ名
  slug: string;
  model: BuildingModel;
  check?: BuildingCheck;
  sheets?: SheetIndex;
};

function MemberSheets({
  member,
  index,
  onOpen,
}: {
  member: Member;
  index?: SheetIndex;
  onOpen: (sheet: Sheet, bbox: Box | undefined, label: string) => void;
}) {
  if (!index) return null;
  const refs = index.member_sheets[memberKey(member)] ?? [];
  return (
    <div className={styles.sheets}>
      <h3>この部材を含む施工図（{refs.length}）</h3>
      {refs.length === 0 ? (
        <p className={styles.fine}>{index.empty_note}</p>
      ) : (
        <ul>
          {refs.map((ref) => {
            const sheet = index.sheets.find((s) => s.id === ref.sheet);
            if (!sheet) return null;
            return (
              <li key={`${ref.sheet}-${ref.reason}`}>
                <button
                  onClick={() =>
                    onOpen(sheet, ref.bbox, `${member.mark} ${member.grid}`)
                  }
                >
                  <b>
                    p.{sheet.page} {sheet.title}
                  </b>
                  <span>{ref.reason}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function MemberInfo({ member }: { member: Member }) {
  return (
    <div>
      <span className={styles.mark}>{member.mark}</span>
      <span className={styles.type}>{TYPE_LABELS[member.type]}</span>
      <dl className={styles.details}>
        <dt>階</dt>
        <dd>{member.floor}</dd>
        <dt>位置</dt>
        <dd>{member.grid}</dd>
        <dt>{"z" in member ? "レベル" : "高さ"}</dt>
        <dd>{levelText(member)}</dd>
        {member.section && (
          <>
            <dt>断面</dt>
            <dd>{member.section}</dd>
          </>
        )}
      </dl>
    </div>
  );
}

function PenLogo() {
  return (
    <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden>
      <path
        d="M6 26 L9 18 L22 5 a2.8 2.8 0 0 1 4 0 l1 1 a2.8 2.8 0 0 1 0 4 L14 23 Z"
        fill="var(--red)"
      />
      <path d="M6 26 L9 18 L14 23 Z" fill="#fff" />
      <path
        d="M4 29 H28"
        stroke="var(--red)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function pagesText(pages: JobSummary["pages"]) {
  if (pages.length === 1) {
    return `p.${pages[0].number} ${pages[0].title ?? ""}`.trim();
  }
  const numbers = pages.map((page) => page.number);
  const first = numbers[0];
  const last = numbers[numbers.length - 1];
  return last - first === numbers.length - 1
    ? `p.${first}〜p.${last}（${numbers.length} ページ）`
    : numbers.map((number) => `p.${number}`).join("、");
}

// 名前を付けた結果は、1ページのときの図面名も添える
function resultTitle(job: JobSummary) {
  if (!job.label) return pagesText(job.pages);
  const title = job.pages.length === 1 ? job.pages[0].title : null;
  return title ? `${job.label} ${title}` : job.label;
}

const dateFormat = new Intl.DateTimeFormat("ja-JP", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Tokyo",
});

function resultDetail(job: JobSummary) {
  const { design, minutes, knowledge } = job.counts;
  return [
    dateFormat.format(new Date(job.uploaded_at)),
    `指摘 ${design + minutes + knowledge} 件（設計図書 ${design}・議事録 ${minutes}・ナレッジ ${knowledge}）`,
    ...(job.stopped ? ["途中で止めた回"] : []),
    ...(job.masked ? [] : ["公開用の図面なし"]),
  ].join("・");
}

export default function BuildingViewer({
  buildings,
}: {
  buildings: Building[];
}) {
  const [name, setName] = useState(buildings[0].model.name);
  const building = buildings.find((b) => b.model.name === name) ?? buildings[0];

  const picker = (
    <select
      className={styles.picker}
      aria-label="物件"
      value={building.model.name}
      onChange={(e) => setName(e.target.value)}
    >
      {buildings.map((b) => (
        <option key={b.model.name} value={b.model.name}>
          {b.model.name}
        </option>
      ))}
    </select>
  );

  // 物件を切り替えたら、表示の状態とカメラを最初からにする
  return (
    <BuildingView key={building.model.name} {...building} picker={picker} />
  );
}

type Screen = "start" | "upload" | "saved";

function BuildingView({
  slug,
  model,
  check,
  sheets,
  picker,
}: Building & { picker: ReactNode }) {
  const savedBase = `/demo-data/${slug}`;
  const [screen, setScreen] = useState<Screen>("start");
  const showUploaded = useCallback(() => setScreen("upload"), []);
  const job = useUploadJob(slug, showUploaded);

  const floors = floorsOf(model);
  const [topFloorIndex, setTopFloorIndex] = useState(floors.length - 1);
  const [hiddenTypes, setHiddenTypes] = useState<ReadonlySet<MemberType>>(
    new Set(),
  );
  const [selected, setSelected] = useState<Member | null>(null);
  const [activeFinding, setActiveFinding] = useState<Finding | null>(null);
  const [openSheet, setOpenSheet] = useState<SheetTarget | null>(null);
  const closeSheet = useCallback(() => setOpenSheet(null), []);
  // 図面と3Dのどちらを大きく出すか
  const [focus, setFocus] = useState<"drawing" | "model">("drawing");
  const [zoomed, setZoomed] = useState(false);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [shownBox, setShownBox] = useState<Box | undefined>(undefined);
  // 朱書きの表示。一覧と図面で同じ状態を使う
  const [visibleLayers, setVisibleLayers] = useState<ReadonlySet<LayerKey>>(
    () => new Set(ALL_LAYERS),
  );
  const toggleLayer = useCallback((key: LayerKey) => {
    setVisibleLayers((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // 公開・デモ用の表示。読み込み直すと必ず塗りつぶしありに戻す
  const [publicView, setPublicView] = useState(true);

  const uploaded = screen === "upload" ? job.result : null;
  const saved = screen === "saved" ? check : undefined;
  const allFindings = uploaded?.findings ?? saved?.result.findings ?? [];
  const noMaskedFiles = Boolean(uploaded && publicView && !uploaded.masked);
  const resultBase = uploaded
    ? publicView
      ? `${job.base}/masked`
      : job.base
    : savedBase;
  const pageSheets = useMemo(() => {
    if (uploaded) {
      // 入れた施工図は、読み取った図面名で出す
      return uploaded.sheets.map((sheet) => {
        const title = uploaded.pages?.find(
          (p) => p.number === sheet.page,
        )?.title;
        return title ? { ...sheet, title } : sheet;
      });
    }
    if (saved) {
      // チェック済みの結果は、指摘のあるページだけ
      const used = new Set(saved.result.findings.map((f) => f.drawing.sheet));
      return (sheets?.sheets ?? []).filter((sheet) => used.has(sheet.id));
    }
    return [];
  }, [uploaded, saved, sheets]);
  const currentSheet =
    pageSheets.find((sheet) => sheet.id === sheetId) ?? pageSheets[0];

  const hasLayers = pageSheets.some((sheet) => sheet.layers);
  const counts = {
    design: allFindings.filter((f) => (f.source_type ?? "design") === "design")
      .length,
    minutes: allFindings.filter((f) => f.source_type === "minutes").length,
    knowledge: allFindings.filter((f) => f.source_type === "knowledge").length,
  };
  const shownFindings = hasLayers
    ? allFindings.filter(
        (f) => !f.source_type || visibleLayers.has(f.source_type),
      )
    : allFindings;

  const highlighted = useMemo(
    () => new Set(activeFinding?.model_refs ?? []),
    [activeFinding],
  );

  const showInline = (sheet: Sheet, bbox: Box | undefined) => {
    setSheetId(sheet.id);
    setShownBox(bbox);
    setFocus("drawing");
  };

  // 結果の中の図面は左の大きな枠に出す。それ以外（3Dの部材から開く別の施工図）は別の窓で開く
  const showSheet = (sheet: Sheet, bbox: Box | undefined, label: string) => {
    if (saved && pageSheets.some((s) => s.id === sheet.id)) {
      showInline(sheet, bbox);
    } else if (uploaded && pageSheets.some((s) => s.image === sheet.image)) {
      showInline(sheet, bbox);
    } else {
      setOpenSheet({ sheet, bbox, label, base: savedBase });
    }
  };

  const activateFinding = (finding: Finding | null) => {
    setActiveFinding(finding);
    setSelected(null);
    if (!finding) {
      setShownBox(undefined);
      return;
    }
    const sheet = pageSheets.find((s) => s.id === finding.drawing.sheet);
    if (sheet) showInline(sheet, finding.drawing.bbox);
    // 基礎の部材は上階に隠れるので、基礎まで表示を下げ、杭も出す
    const lowest = Math.min(
      ...finding.model_refs.map((ref) => floors.indexOf(ref.split("|")[1])),
    );
    if (Number.isFinite(lowest) && lowest >= 0) setTopFloorIndex(lowest);
    setHiddenTypes(new Set());
  };

  const goTo = (next: Screen) => {
    setScreen(next);
    setActiveFinding(null);
    setShownBox(undefined);
    setSheetId(null);
    setSelected(null);
    setZoomed(false);
    // 別の結果に前の表示を持ち越さない。塗りつぶしも必ずありに戻す
    setVisibleLayers(new Set(ALL_LAYERS));
    setPublicView(true);
    setFocus("drawing");
  };

  const toggleType = (type: MemberType, show: boolean) => {
    const next = new Set(hiddenTypes);
    if (show) next.delete(type);
    else next.add(type);
    setHiddenTypes(next);
    if (!show && selected?.type === type) setSelected(null);
  };

  const changeTopFloor = (index: number) => {
    setTopFloorIndex(index);
    if (selected && floors.indexOf(selected.floor) > index) setSelected(null);
  };

  const inResult = screen !== "start";
  const results = [
    ...job.history.map((item) => ({
      key: item.id,
      title: resultTitle(item),
      detail: resultDetail(item),
      onOpen: () => {
        goTo("upload");
        void job.open(item.id);
      },
    })),
    ...(check
      ? [
          {
            key: "saved",
            title: "チェック済みの施工図",
            detail: `指摘 ${check.result.findings.length} 件・人の朱書きとの比較あり`,
            onOpen: () => goTo("saved"),
          },
        ]
      : []),
  ];

  const steps = [
    { label: "物件を選ぶ", done: true },
    { label: "施工図を入れる", done: inResult },
    { label: "朱書きを見る", done: false },
  ];
  const activeStep = inResult ? 2 : 1;

  return (
    <div className={styles.root}>
      <nav className={styles.rail}>
        <button className={styles.logo} onClick={() => goTo("start")}>
          <PenLogo />
          アカペン
        </button>
        <ol className={styles.steps}>
          {steps.map((step, index) => {
            const isActive = index === activeStep;
            const canGo =
              index < 2 ? true : screen === "start" && results.length > 0;
            return (
              <li key={step.label}>
                <button
                  disabled={!canGo || isActive}
                  data-state={isActive ? "active" : step.done ? "done" : "todo"}
                  aria-current={isActive ? "step" : undefined}
                  onClick={() =>
                    index < 2 ? goTo("start") : results[0]?.onOpen()
                  }
                >
                  <i>{step.done && !isActive ? "✓" : index + 1}</i>
                  {step.label}
                </button>
              </li>
            );
          })}
        </ol>
        <div className={styles.railProject}>
          <small>物件</small>
          {model.name}
        </div>
      </nav>

      {!inResult || !currentSheet ? (
        <StartView picker={picker} job={job} results={results} />
      ) : (
        <main className={styles.stage} data-focus={focus}>
          <div className={styles.topBar}>
            {pageSheets.length > 1 ? (
              <select
                className={styles.pageSelect}
                aria-label="図面のページ"
                value={currentSheet.id}
                onChange={(e) => {
                  setSheetId(e.target.value);
                  setShownBox(undefined);
                }}
              >
                {pageSheets.map((sheet) => (
                  <option key={sheet.id} value={sheet.id}>
                    p.{sheet.page} {sheet.title}
                  </option>
                ))}
              </select>
            ) : (
              <b className={styles.pageTitle}>{currentSheet.title}</b>
            )}
            <LayerToggles
              counts={counts}
              visible={visibleLayers}
              onToggle={hasLayers ? toggleLayer : undefined}
            />
            <div className={styles.topActions}>
              <button
                className={styles.secondary}
                disabled={focus !== "drawing"}
                onClick={() => setZoomed(!zoomed)}
              >
                {zoomed ? "図面の全体" : "図面を拡大"}
              </button>
              {uploaded && (
                <label
                  className={styles.publicToggle}
                  data-public={publicView}
                  title="製作会社名、出図印、担当者名の欄を塗りつぶします"
                >
                  <input
                    type="checkbox"
                    checked={publicView}
                    onChange={(e) => setPublicView(e.target.checked)}
                  />
                  {publicView
                    ? "公開・デモ用の表示"
                    : "社内用（名前が見えます）"}
                </label>
              )}
              {uploaded && !noMaskedFiles && (
                <a
                  className={styles.primarySmall}
                  href={`${resultBase}/marked.pdf`}
                  download
                >
                  朱書きPDFを保存
                </a>
              )}
            </div>
          </div>

          {noMaskedFiles ? (
            <p className={styles.noMasked}>
              このチェック結果には、名前を塗りつぶした図面がありません。物件ごとに塗りつぶす欄の登録が必要です。社内で見るときは「公開・デモ用の表示」を外してください。
            </p>
          ) : (
            <>
              <section className={styles.drawingPane} aria-label="朱書きの図面">
                {focus === "model" && (
                  <button
                    className={styles.swap}
                    onClick={() => setFocus("drawing")}
                  >
                    図面を大きく
                  </button>
                )}
                <SheetCanvas
                  sheet={currentSheet}
                  base={resultBase}
                  bbox={shownBox}
                  marks={
                    hasLayers
                      ? undefined
                      : allFindings
                          .filter((f) => f.drawing.sheet === currentSheet.id)
                          .map((f) => f.drawing.bbox)
                  }
                  zoomed={zoomed && focus === "drawing"}
                  visibleLayers={
                    hasLayers ? visibleLayers : new Set(ALL_LAYERS)
                  }
                />
              </section>

              <section className={styles.listPane} aria-label="指摘の一覧">
                <CheckPanel
                  key={screen}
                  findings={shownFindings}
                  totalFindings={allFindings.length}
                  lead={saved?.result.mode}
                  notes={uploaded?.notes}
                  report={saved?.report}
                  stats={saved?.stats}
                  changes={saved?.result.changes}
                  humanItems={saved?.humanItems}
                  humanLead={saved?.humanLead}
                  minutes={uploaded?.minutes}
                  checklist={uploaded?.checklist}
                  activeId={activeFinding?.id ?? null}
                  onActivate={activateFinding}
                  base={resultBase}
                  sheets={pageSheets}
                  onOpenSheet={(sheet, bbox, label) =>
                    showSheet(sheet, bbox, label)
                  }
                />
              </section>

              <section className={styles.modelPane} aria-label="3Dモデル">
                <div className={styles.modelBar}>
                  <b>3Dモデル</b>
                  <label className={styles.floor}>
                    {floors[topFloorIndex]}
                    <input
                      type="range"
                      aria-label="表示する階"
                      min={0}
                      max={floors.length - 1}
                      value={topFloorIndex}
                      onChange={(e) => changeTopFloor(Number(e.target.value))}
                    />
                  </label>
                  {TOGGLEABLE.filter((type) =>
                    model.members.some((m) => m.type === type),
                  ).map((type) => (
                    <label key={type} className={styles.typeToggle}>
                      <input
                        type="checkbox"
                        checked={!hiddenTypes.has(type)}
                        onChange={(e) => toggleType(type, e.target.checked)}
                      />
                      {TYPE_LABELS[type]}
                    </label>
                  ))}
                  {focus === "drawing" && (
                    <button
                      className={styles.secondary}
                      onClick={() => setFocus("model")}
                    >
                      3Dを大きく
                    </button>
                  )}
                </div>
                <div className={styles.modelView}>
                  <BuildingScene
                    model={model}
                    topFloorIndex={topFloorIndex}
                    hiddenTypes={hiddenTypes}
                    selected={selected}
                    highlighted={highlighted}
                    onSelect={setSelected}
                  />
                  {selected ? (
                    <div className={styles.memberCard}>
                      <button
                        className={styles.closeMember}
                        aria-label="部材の情報を閉じる"
                        onClick={() => setSelected(null)}
                      >
                        ×
                      </button>
                      <MemberInfo member={selected} />
                      <MemberSheets
                        member={selected}
                        index={sheets}
                        onOpen={showSheet}
                      />
                    </div>
                  ) : (
                    <div className={styles.hint}>
                      ドラッグで回転・ホイールで拡大・部材をクリック
                    </div>
                  )}
                </div>
                <p className={styles.modelSource}>{model.source}</p>
              </section>
            </>
          )}
        </main>
      )}
      {openSheet && (
        <SheetViewer
          target={openSheet}
          onClose={closeSheet}
          visibleLayers={visibleLayers}
          onToggleLayer={toggleLayer}
        />
      )}
    </div>
  );
}
