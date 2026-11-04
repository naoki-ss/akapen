"use client";

import { useCallback, useMemo, useState } from "react";
import type { Building } from "@/lib/buildings";
import type { Finding } from "@/lib/check";
import {
  floorsOf,
  TYPE_LABELS,
  type Member,
  type MemberType,
} from "@/lib/model";
import {
  ALL_LAYERS,
  type Box,
  type LayerKey,
  type Sheet,
  type SheetTarget,
} from "@/lib/sheets";
import { useJobResult } from "@/lib/useJobResult";
import AppFrame from "../AppFrame";
import BuildingScene from "../BuildingSceneLazy";
import CheckPanel from "../CheckPanel";
import LayerToggles from "../LayerToggles";
import MemberCard from "../MemberCard";
import SheetCanvas from "../SheetCanvas";
import SheetViewer from "../SheetViewer";
import styles from "../App.module.css";

const TOGGLEABLE: MemberType[] = ["slab", "wall", "pile"];

// ④ 施工図の朱書きと根拠
export default function CheckScreen({
  slug,
  model,
  check,
  sheets,
  job,
}: Building & { job: string }) {
  const isSaved = job === "saved";
  const jobId = isSaved ? null : job;
  const { result: uploaded, missing } = useJobResult(jobId);
  const saved = isSaved ? check : undefined;
  const savedBase = `/demo-data/${slug}`;
  const jobBase = `/api/check/${jobId}/files`;
  const hasModel = model.members.length > 0;

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

  const allFindings = uploaded?.findings ?? saved?.findings ?? [];
  const noMaskedFiles = Boolean(uploaded && publicView && !uploaded.masked);
  const resultBase = uploaded
    ? publicView
      ? `${jobBase}/masked`
      : jobBase
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
      const used = new Set(saved.findings.map((f) => f.drawing.sheet));
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

  const crumbs = [
    { label: "プロジェクト一覧", href: "/" },
    { label: model.name, href: `/projects/${slug}` },
    { label: "施工図の朱書きと根拠" },
  ];

  if (!currentSheet) {
    return (
      <AppFrame crumbs={crumbs}>
        <p className={styles.loading} role="status">
          {missing ? "このチェック結果は見つかりません。" : "読み込み中…"}
        </p>
      </AppFrame>
    );
  }

  return (
    <AppFrame crumbs={crumbs}>
      <div className={styles.stage} data-focus={focus}>
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
                {publicView ? "公開・デモ用の表示" : "社内用（名前が見えます）"}
              </label>
            )}
            {uploaded && !noMaskedFiles && (
              <a
                className={styles.primarySmall}
                href={`${resultBase}/marked.pdf`}
                download
              >
                朱書きPDFをダウンロード
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
                visibleLayers={hasLayers ? visibleLayers : new Set(ALL_LAYERS)}
              />
            </section>

            <section className={styles.listPane} aria-label="指摘の一覧">
              <CheckPanel
                findings={shownFindings}
                totalFindings={allFindings.length}
                lead={saved?.mode}
                notes={uploaded?.notes}
                changes={saved?.changes}
                minutes={uploaded?.minutes}
                checklist={uploaded?.checklist}
                activeId={activeFinding?.id ?? null}
                onActivate={activateFinding}
                base={resultBase}
                sheets={pageSheets}
                onOpenSheet={showSheet}
              />
            </section>

            <section className={styles.modelPane} aria-label="3Dモデル">
              {!hasModel ? (
                <div className={styles.noModel}>
                  この物件は3Dなしで登録しています。
                  <br />
                  施工図チェックは使えます。
                </div>
              ) : (
                <>
                  <div className={styles.modelBar}>
                    <b>3Dモデル</b>
                    <label className={styles.floor}>
                      <span className="mono">{floors[topFloorIndex]}</span>
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
                      <MemberCard
                        member={selected}
                        index={sheets}
                        onClose={() => setSelected(null)}
                        onOpen={showSheet}
                      />
                    ) : (
                      <div className={styles.hint}>
                        ドラッグで回転・ホイールで拡大・部材をクリック
                      </div>
                    )}
                  </div>
                </>
              )}
            </section>
          </>
        )}
      </div>
      {openSheet && (
        <SheetViewer
          target={openSheet}
          onClose={closeSheet}
          visibleLayers={visibleLayers}
          onToggleLayer={toggleLayer}
        />
      )}
    </AppFrame>
  );
}
