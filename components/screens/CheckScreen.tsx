"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import type { Building } from "@/lib/buildings";
import { inkOf, memberKeysOf, NOT_IN_MODEL, numbered } from "@/lib/findings";
import { floorsOf } from "@/lib/model";
import { ALL_LAYERS, type LayerKey } from "@/lib/sheets";
import { useDecisions } from "@/lib/useDecisions";
import { useJobResult } from "@/lib/useJobResult";
import AppFrame from "../AppFrame";
import BuildingScene from "../BuildingSceneLazy";
import Hint from "../Hint";
import LayerToggles from "../LayerToggles";
import AnnotatedSheet from "../check/AnnotatedSheet";
import BasisCard from "../check/BasisCard";
import BasisDocument from "../check/BasisDocument";
import FindingList from "../check/FindingList";
import styles from "../check/check.module.css";

const ignore = () => {};

// ④ 施工図の朱書きと根拠。一覧・朱書き・根拠・3D は同じ指摘を選んで一緒に切り替わる
export default function CheckScreen({
  slug,
  model,
  check,
  sheets,
  job,
  stale,
}: Building & { job: string; stale: string[] }) {
  const isSaved = job === "saved";
  const jobId = isSaved ? null : job;
  const { result: uploaded, missing } = useJobResult(jobId);
  const { excluded, setKept } = useDecisions(jobId);
  const saved = isSaved ? check : undefined;
  const jobBase = `/api/check/${jobId}/files`;
  const hasModel = model.members.length > 0;
  const floors = floorsOf(model);

  // ③から開いたときは、選んでいた指摘をそのまま選ぶ
  const [activeId, setActiveId] = useState<string | null>(
    useSearchParams().get("finding"),
  );
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [zoom, setZoom] = useState<"auto" | "full" | "large">("auto");
  const [menuOpen, setMenuOpen] = useState(false);
  const [visibleLayers, setVisibleLayers] = useState<ReadonlySet<LayerKey>>(
    () => new Set(ALL_LAYERS),
  );
  // 公開・デモ用の表示。読み込み直すと必ず塗りつぶしありに戻す
  const [publicView, setPublicView] = useState(true);

  const allFindings = useMemo(
    () => numbered(uploaded?.findings ?? saved?.findings ?? []),
    [uploaded, saved],
  );
  const noMaskedFiles = Boolean(uploaded && publicView && !uploaded.masked);
  const resultBase = uploaded
    ? publicView
      ? `${jobBase}/masked`
      : jobBase
    : `/demo-data/${slug}`;

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

  const shownFindings = allFindings.filter((f) =>
    visibleLayers.has(f.source_type ?? "design"),
  );
  const active = allFindings.find((f) => f.id === activeId) ?? null;
  const currentSheet =
    pageSheets.find(
      (sheet) => sheet.id === (sheetId ?? active?.drawing.sheet),
    ) ?? pageSheets[0];

  const counts = {
    design: allFindings.filter((f) => (f.source_type ?? "design") === "design")
      .length,
    minutes: allFindings.filter((f) => f.source_type === "minutes").length,
    knowledge: allFindings.filter((f) => f.source_type === "knowledge").length,
  };

  const highlighted = useMemo(
    () => new Set(active ? memberKeysOf(active, model) : []),
    [active, model],
  );
  const select = (finding: (typeof allFindings)[number]) => {
    setActiveId(finding.id);
    setZoom("auto");
    if (finding.drawing.sheet) setSheetId(finding.drawing.sheet);
  };

  const toggleLayer = (key: LayerKey) => {
    const next = new Set(visibleLayers);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setVisibleLayers(next);
  };

  const crumbs = [
    { label: "現場を選ぶ", href: "/" },
    { label: model.name, href: `/projects/${slug}` },
    { label: "なぜ問題かを見る" },
  ];

  if (!currentSheet) {
    return (
      <AppFrame crumbs={crumbs}>
        <p className={styles.noMasked} role="status">
          {missing ? "このチェック結果は見つかりません。" : "読み込み中…"}
        </p>
      </AppFrame>
    );
  }

  const scaled = zoom === "large" || (zoom === "auto" && Boolean(active));
  const modelHref = `/projects/${slug}?job=${job}${active ? `&finding=${active.id}` : ""}`;

  return (
    <AppFrame crumbs={crumbs}>
      <div className={styles.screen}>
        <div className={styles.topBar}>
          {pageSheets.length > 1 ? (
            <select
              className={styles.pageSelect}
              aria-label="図面のページ"
              value={currentSheet.id}
              onChange={(e) => {
                setSheetId(e.target.value);
                setActiveId(null);
              }}
            >
              {pageSheets.map((sheet) => (
                <option key={sheet.id} value={sheet.id}>
                  p.{sheet.page} {sheet.title}
                </option>
              ))}
            </select>
          ) : (
            <b>{currentSheet.title}</b>
          )}
          <LayerToggles
            counts={counts}
            visible={visibleLayers}
            onToggle={toggleLayer}
            noKnowledge={!uploaded?.checklist && counts.knowledge === 0}
          />
          <div className={styles.barActions}>
            {uploaded && !noMaskedFiles && (
              <a
                className={styles.btnPrimary}
                href={`/api/check/${jobId}/export?public=${publicView ? 1 : 0}`}
                download
              >
                朱書きPDFをダウンロード
              </a>
            )}
            <div className={styles.menu}>
              <button
                className={styles.btn}
                aria-expanded={menuOpen}
                aria-label="メニュー"
                onClick={() => setMenuOpen(!menuOpen)}
              >
                ⋯
              </button>
              {menuOpen && (
                <>
                  <button
                    className={styles.menuBack}
                    aria-label="メニューを閉じる"
                    onClick={() => setMenuOpen(false)}
                  />
                  <div className={styles.menuItems} role="menu">
                    <button
                      role="menuitem"
                      onClick={() => {
                        setZoom(scaled ? "full" : "large");
                        setMenuOpen(false);
                      }}
                    >
                      {scaled ? "図面の全体を見る" : "図面を拡大"}
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
                    {uploaded && (
                      <Link
                        role="menuitem"
                        href={`/projects/${slug}?add=1`}
                      >
                        施工図を追加
                      </Link>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {stale.length > 0 && (
          <p className={styles.internalBanner} role="status">
            設計図書が更新されました。再チェックが必要です（{stale.join("、")}）。
          </p>
        )}

        {!publicView && (
          <p className={styles.internalBanner}>
            社内用の表示です。名前が見えます。
          </p>
        )}

        {noMaskedFiles ? (
          <p className={styles.noMasked}>
            このチェック結果には、名前を塗りつぶした図面がありません。現場ごとに塗りつぶす欄の登録が必要です。社内で見るときは、右上のメニューで「公開・デモ用の表示」を外してください。
          </p>
        ) : (
          <>
            <Hint
              id="check"
              text="指摘を選ぶと理由が分かります。確認したら朱書きPDFを持ち帰ります。"
            />
            <FindingList
              findings={shownFindings}
              excluded={excluded}
              activeId={activeId}
              notes={uploaded?.notes}
              changes={saved?.changes}
              minutes={uploaded?.minutes}
              checklist={uploaded?.checklist}
              onSelect={select}
            />
            <section
              className={styles.sheetPane}
              data-split={Boolean(active)}
              aria-label="朱書きの図面と根拠の資料"
            >
              <AnnotatedSheet
                sheet={currentSheet}
                base={resultBase}
                findings={shownFindings.filter(
                  (f) => f.drawing.sheet === currentSheet.id,
                )}
                excluded={excluded}
                activeId={activeId}
                zoom={zoom}
                onSelect={select}
                onClear={() => setActiveId(null)}
              />
              {active && (
                <BasisDocument
                  finding={active}
                  base={resultBase}
                  publicView={uploaded ? publicView : true}
                />
              )}
            </section>
            <aside className={styles.side}>
              <BasisCard
                finding={active}
                kept={!active || !excluded.has(active.number)}
                base={resultBase}
                onKeep={(kept) => active && setKept(active.number, kept)}
              />
              <div className={styles.mini}>
                {hasModel ? (
                  <>
                    <BuildingScene
                      model={model}
                      topFloorIndex={floors.length - 1}
                      selected={null}
                      compact
                      display={highlighted.size > 0 ? "xray" : "normal"}
                      highlighted={highlighted}
                      highlightColor={active ? inkOf(active) : undefined}
                      onSelect={ignore}
                    />
                    <Link
                      className={`${styles.btn} ${styles.miniAction}`}
                      href={modelHref}
                    >
                      3Dで大きく見る
                    </Link>
                    {active && highlighted.size === 0 && (
                      <span className={styles.miniNote}>
                        {NOT_IN_MODEL}
                      </span>
                    )}
                  </>
                ) : (
                  <p className={styles.noModel}>
                    この現場は3Dなしで登録しています。
                  </p>
                )}
              </div>
            </aside>
          </>
        )}
      </div>
    </AppFrame>
  );
}
