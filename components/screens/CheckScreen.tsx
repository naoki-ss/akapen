"use client";

import { flushSync } from "react-dom";
import Skeleton from "../Skeleton";
import { ChevronDown, ChevronUp, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { Building } from "@/lib/buildings";
import { inkOf, isBlue, memberKeysOf, NOT_IN_MODEL, numbered } from "@/lib/findings";
import { floorsOf } from "@/lib/model";
import { useDecisions, type RemoveReason } from "@/lib/useDecisions";
import { useJobResult } from "@/lib/useJobResult";
import AppFrame from "../AppFrame";
import BuildingScene from "../BuildingSceneLazy";
import AnnotatedSheet from "../check/AnnotatedSheet";
import ComparePane from "../check/ComparePane";
import FindingList, { type DrawingGroup } from "../check/FindingList";
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
  confirmed,
  drawings,
  versions,
}: Building & {
  job: string;
  stale: string[];
  confirmed: { page: number; at: string }[];
  // ほかの図面の件数（図面ごとの最新の結果）
  drawings: { title: string; job: string; red: number; blue: number }[];
  // この結果の図面の版（図名 → 第何版）
  versions: Record<string, number>;
}) {
  const isSaved = job === "saved";
  const jobId = isSaved ? null : job;
  const { result: uploaded, missing } = useJobResult(jobId);
  const { excluded, remove, restore } = useDecisions(jobId);
  // 消したあとの案内。数秒で消える
  const [justRemoved, setJustRemoved] = useState<number | null>(null);
  useEffect(() => {
    if (justRemoved === null) return;
    const timer = setTimeout(() => setJustRemoved(null), 6000);
    return () => clearTimeout(timer);
  }, [justRemoved]);
  const saved = isSaved ? check : undefined;
  const jobBase = `/api/check/${jobId}/files`;
  const hasModel = model.members.length > 0;
  const floors = floorsOf(model);

  // ③から開いたときは、選んでいた指摘をそのまま選ぶ
  const [activeId, setActiveId] = useState<string | null>(
    useSearchParams().get("finding"),
  );
  const [sheetId, setSheetId] = useState<string | null>(null);
  // 開いたときは3Dで位置を示す。施工図に切り替えたら、別の指摘を選んでもその選択を保つ
  const [mode, setMode] = useState<"sheet" | "3d">(hasModel ? "3d" : "sheet");
  // 3D／施工図の枠を畳むと、比較が画面いっぱいに広がる
  const [viewerOpen, setViewerOpen] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
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

  const remaining = useMemo(
    () => allFindings.filter((f) => !excluded.has(f.number)),
    [allFindings, excluded],
  );
  const removedFindings = allFindings.filter((f) => excluded.has(f.number));
  const active = useMemo(
    () => remaining.find((f) => f.id === activeId) ?? null,
    [remaining, activeId],
  );
  const currentSheet =
    pageSheets.find(
      (sheet) => sheet.id === (sheetId ?? active?.drawing.sheet),
    ) ?? pageSheets[0];

  const highlighted = useMemo(
    () => new Set(active ? memberKeysOf(active, model) : []),
    [active, model],
  );
  const select = (finding: (typeof allFindings)[number]) => {
    setActiveId(finding.id);
    if (finding.drawing.sheet) setSheetId(finding.drawing.sheet);
  };

  const crumbs = [
    { label: "現場を選ぶ", href: "/" },
    { label: model.name, href: `/projects/${slug}` },
    { label: "なぜ問題かを見る" },
  ];

  if (!currentSheet) {
    return (
      <AppFrame crumbs={crumbs}>
        {missing ? (
          <p className={styles.noMasked} role="status">
            このチェック結果は見つかりません。
          </p>
        ) : (
          <Skeleton />
        )}
      </AppFrame>
    );
  }

  // 図面ごとのまとまり。この結果の図面は開けて、ほかの図面は別の結果へのリンクにする
  const here: DrawingGroup[] = pageSheets.map((sheet) => {
    const findings = remaining.filter((f) => f.drawing.sheet === sheet.id);
    const blue = findings.filter(isBlue).length;
    return {
      key: sheet.id,
      title: sheet.title,
      findings,
      href: null,
      red: findings.length - blue,
      blue,
    };
  });
  const titles = new Set(pageSheets.map((sheet) => sheet.title));
  const others: DrawingGroup[] = drawings
    .filter((item) => !titles.has(item.title))
    .map((item) => ({
      key: `${item.job}:${item.title}`,
      title: item.title,
      findings: null,
      href: `/projects/${slug}/check/${item.job}`,
      red: item.red,
      blue: item.blue,
    }));

  const version = versions[currentSheet.title];

  return (
    <AppFrame crumbs={crumbs}>
      <div className={styles.screen}>
        {uploaded && !noMaskedFiles && (
          <div className={styles.topBar}>
            <div className={styles.barActions}>
              <a
                className={styles.btnPrimary}
                href={`/api/check/${jobId}/export?public=${publicView ? 1 : 0}`}
                download
              >
                朱書きPDFをダウンロード
              </a>
              <div className={styles.menu}>
                <button
                  className={styles.btn}
                  aria-expanded={menuOpen}
                  aria-label="メニュー"
                  onClick={() => setMenuOpen(!menuOpen)}
                >
                  <MoreHorizontal size={16} />
                </button>
                {menuOpen && (
                  <>
                    <button
                      className={styles.menuBack}
                      aria-label="メニューを閉じる"
                      onClick={() => setMenuOpen(false)}
                    />
                    <div className={styles.menuItems} role="menu">
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
                      <Link role="menuitem" href={`/projects/${slug}?add=1`}>
                        施工図を追加
                      </Link>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        <div className={styles.banners}>
          {justRemoved !== null && (
            <p className={styles.removedToast} role="status">
              朱書きから消しました
              <button
                onClick={() => {
                  restore(justRemoved);
                  setJustRemoved(null);
                }}
              >
                元に戻す
              </button>
            </p>
          )}
          {confirmed.some((item) => item.page === currentSheet.page) && (
            <p className={styles.confirmedBanner} role="status">
              この図面は確定しています。変更できません。
            </p>
          )}
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
          {(uploaded?.suppressed?.length ?? 0) > 0 && (
            <p className={styles.suppressed} role="status">
              過去の判断により {uploaded?.suppressed?.length} 件を除外しました。
            </p>
          )}
        </div>

        {noMaskedFiles ? (
          <p className={styles.noMasked}>
            このチェック結果には、名前を塗りつぶした図面がありません。現場ごとに塗りつぶす欄の登録が必要です。社内で見るときは、右上のメニューで「公開・デモ用の表示」を外してください。
          </p>
        ) : (
          <>
            <FindingList
              groups={[...here, ...others]}
              openKey={currentSheet.id}
              removed={removedFindings}
              onRestore={restore}
              activeId={activeId}
              notes={uploaded?.notes}
              changes={saved?.changes}
              minutes={uploaded?.minutes}
              checklist={uploaded?.checklist}
              onSelect={select}
              onOpenGroup={(key) => {
                setSheetId(key);
                setActiveId(null);
              }}
            />
            <div className={styles.workspace} data-viewer={viewerOpen}>
              {!viewerOpen && (
                <button className={styles.viewerBar} onClick={() => setViewerOpen(true)}>
                  <ChevronDown size={14} /> 3D／施工図を開く
                </button>
              )}
              <section className={styles.viewer} aria-label="図面ビューア" hidden={!viewerOpen}>
                <p className={styles.viewerLabel}>
                  {mode === "sheet"
                    ? `施工図：${currentSheet.title}${version ? ` 第${version}版` : ""}`
                    : `3D：${active ? `指摘 ${active.number} の位置` : "建物全体"}`}
                </p>
                <div className={styles.viewerMode} role="group" aria-label="表示の切り替え">
                  <button aria-pressed={mode === "sheet"} onClick={() => setMode("sheet")}>
                    施工図
                  </button>
                  <button
                    aria-pressed={mode === "3d"}
                    disabled={!hasModel}
                    onClick={() => setMode("3d")}
                  >
                    3D
                  </button>
                  <button aria-label="たたむ" title="たたむ" onClick={() => setViewerOpen(false)}>
                    <ChevronUp size={14} />
                  </button>
                </div>
                {mode === "sheet" ? (
                  <AnnotatedSheet
                    sheet={currentSheet}
                    base={resultBase}
                    findings={remaining.filter(
                      (f) => f.drawing.sheet === currentSheet.id,
                    )}
                    activeId={activeId}
                    onSelect={select}
                    onClear={() => setActiveId(null)}
                  />
                ) : (
                  <div className={styles.viewer3d}>
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
                    {active && highlighted.size === 0 && (
                      <span className={styles.miniNote}>{NOT_IN_MODEL}</span>
                    )}
                  </div>
                )}
              </section>
              <ComparePane
                finding={active}
                sheet={currentSheet}
                locked={
                  !jobId ||
                  confirmed.some((item) => item.page === active?.drawing.page)
                }
                base={resultBase}
                publicView={uploaded ? publicView : true}
                onRemove={(why: RemoveReason) => {
                  if (!active) return;
                  const number = active.number;
                  const apply = () => {
                    remove(number, why);
                    setJustRemoved(number);
                    // 一覧の画面に戻る
                    setActiveId(null);
                  };
                  // 項目がすっと消える。使えないブラウザではそのまま消す
                  if (document.startViewTransition) {
                    document.startViewTransition(() => flushSync(apply));
                  } else {
                    apply();
                  }
                }}
              />
            </div>
          </>
        )}
      </div>
    </AppFrame>
  );
}
