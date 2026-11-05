"use client";

import { flushSync } from "react-dom";
import Skeleton from "../Skeleton";
import { ChevronDown, ChevronUp, Cloud, Circle, Maximize, MoreHorizontal, MoveUpRight, Square, Type, Undo2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { Building } from "@/lib/buildings";
import { inkOf, isBlue, memberKeysOf, NO_3D_POSITION, NOT_IN_MODEL, numbered } from "@/lib/findings";
import { applyEdit, manualFinding, SHAPE_LABELS, type Ink, type ManualMark, type Shape } from "@/lib/markup";
import { useMarkup } from "@/lib/useMarkup";
import { floorsOf, memberKey } from "@/lib/model";
import { useDecisions, type RemoveReason } from "@/lib/useDecisions";
import { useJobResult } from "@/lib/useJobResult";
import AppFrame from "../AppFrame";
import BuildingScene from "../BuildingSceneLazy";
import AnnotatedSheet, { type Drawn } from "../check/AnnotatedSheet";
import ComparePane from "../check/ComparePane";
import FindingList, { type DrawingGroup } from "../check/FindingList";
import styles from "../check/check.module.css";

const ignore = () => {};

const TOOL_ICONS: Record<Shape, typeof Circle> = {
  arrow: MoveUpRight,
  ellipse: Circle,
  rect: Square,
  cloud: Cloud,
  text: Type,
};

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
  // 人が書き足した朱書きと、AI の文面の直し
  const { markup, update: updateMarkup, undo, canUndo, error: markupError } = useMarkup(jobId);
  const [tool, setTool] = useState<Shape | null>(null);
  const [ink, setInk] = useState<Ink>("red");
  const [newId, setNewId] = useState<string | null>(null);
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

  // 指摘を選んでいれば「指摘を見る」、選んでいなければ「全体を見る」の状態。③から開いたときは選んでいた指摘をそのまま選ぶ
  const initialFinding = useSearchParams().get("finding");
  const [activeId, setActiveId] = useState<string | null>(initialFinding);
  const [sheetId, setSheetId] = useState<string | null>(null);
  // 開いたときは3Dから。施工図に切り替えたら、別の指摘を選んでもその選択を保つ（開き直すと3Dに戻る）
  const [mode, setMode] = useState<"sheet" | "3d">(hasModel ? "3d" : "sheet");
  // 3D／施工図の枠を畳むと、比較が画面いっぱいに広がる
  const [viewerOpen, setViewerOpen] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  // 公開・デモ用の表示。読み込み直すと必ず塗りつぶしありに戻す
  const [publicView, setPublicView] = useState(true);

  const allFindings = useMemo(
    () => [
      ...numbered(uploaded?.findings ?? saved?.findings ?? []).map((f) => applyEdit(f, markup)),
      ...markup.items.map(manualFinding),
    ],
    [uploaded, saved, markup],
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

  // 全体を見る間は、この図面の赤の指摘の部材を全部光らせる。部材を押すとその指摘へ
  const sheetFindings = useMemo(
    () => remaining.filter((f) => f.drawing.sheet === currentSheet?.id),
    [remaining, currentSheet],
  );
  const highlighted = useMemo(
    () =>
      new Set(
        active
          ? memberKeysOf(active, model)
          : sheetFindings.filter((f) => !isBlue(f)).flatMap((f) => [...memberKeysOf(f, model)]),
      ),
    [active, model, sheetFindings],
  );
  // 閉じる動きの間も中身を残す
  const [shownFinding, setShownFinding] = useState(active);
  if (active && active !== shownFinding) setShownFinding(active);
  // 全体を見るへ戻す（Esc でも戻る）。比較を全画面で開いている間は、そちらを先に閉じる
  useEffect(() => {
    const back = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.querySelector('[data-big="true"]')) return;
      setTool(null);
      setActiveId(null);
    };
    window.addEventListener("keydown", back);
    return () => window.removeEventListener("keydown", back);
  }, []);
  // Ctrl+Z で1つ戻す。Delete で選んだ手書きの朱書きを消す（文の入力中は効かせない）
  const activeManual = active?.manual ? active.id : null;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z") {
        if (undo()) event.preventDefault();
      } else if ((event.key === "Delete" || event.key === "Backspace") && activeManual) {
        event.preventDefault();
        updateMarkup((m) => ({ ...m, items: m.items.filter((item) => item.id !== activeManual) }));
        setActiveId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, updateMarkup, activeManual]);
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
  // 朱書きを書き足せるのは、判定の結果で、確定していない図面だけ
  const editable =
    Boolean(jobId) && !confirmed.some((item) => item.page === currentSheet.page);

  const addMark = (drawn: Drawn) => {
    const number = Math.max(0, ...allFindings.map((f) => f.number)) + 1;
    const mark: ManualMark = {
      id: `m-${Date.now().toString(36)}`,
      number,
      sheet: currentSheet.id,
      page: currentSheet.page,
      ...drawn,
      at: new Date().toISOString(),
    };
    updateMarkup((m) => ({ ...m, items: [...m.items, mark] }));
    setTool(null);
    setNewId(mark.id);
  };
  const deleteMark = (id: string) => {
    updateMarkup((m) => ({ ...m, items: m.items.filter((item) => item.id !== id) }));
    setActiveId(null);
  };

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
              newId={newId}
              onOpenGroup={(key) => {
                setSheetId(key);
                setActiveId(null);
              }}
            />
            <div className={styles.workspace} data-viewer={viewerOpen} data-state={active ? "finding" : "overview"}>
              {!viewerOpen && (
                <button className={styles.viewerBar} onClick={() => setViewerOpen(true)}>
                  <ChevronDown size={14} /> 3D／施工図を開く
                </button>
              )}
              <section className={styles.viewer} aria-label="図面ビューア" hidden={!viewerOpen}>
                <p className={styles.viewerLabel}>
                  {mode === "sheet"
                    ? `施工図：${currentSheet.title}${version ? ` 第${version}版` : ""}`
                    : `3D：${active ? `指摘 ${active.number} の位置` : `${currentSheet.title}の指摘`}`}
                </p>
                {active && (
                  <button
                    className={styles.viewerOverview}
                    onClick={() => {
                      setActiveId(null);
                      setViewerOpen(true);
                    }}
                  >
                    <Maximize size={14} /> 全体を見る
                  </button>
                )}
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
                  {active && (
                    <button aria-label="たたむ" title="たたむ" onClick={() => setViewerOpen(false)}>
                      <ChevronUp size={14} />
                    </button>
                  )}
                </div>
                {mode === "sheet" && editable && (
                  <div className={styles.markupTools} role="toolbar" aria-label="朱書きを追加">
                    <b>朱書きを追加</b>
                    {(Object.keys(TOOL_ICONS) as Shape[]).map((shape) => {
                      const Icon = TOOL_ICONS[shape];
                      return (
                        <button
                          key={shape}
                          aria-pressed={tool === shape}
                          title={SHAPE_LABELS[shape]}
                          onClick={() => setTool(tool === shape ? null : shape)}
                        >
                          <Icon size={14} /> {SHAPE_LABELS[shape]}
                        </button>
                      );
                    })}
                    <span className={styles.sep} />
                    {(["red", "blue"] as Ink[]).map((color) => (
                      <button
                        key={color}
                        aria-pressed={ink === color}
                        aria-label={color === "red" ? "赤" : "青"}
                        title={color === "red" ? "赤" : "青"}
                        onClick={() => setInk(color)}
                      >
                        <span className={styles.swatch} style={{ background: color === "red" ? "var(--red)" : "var(--blue)" }} />
                        {color === "red" ? "赤" : "青"}
                      </button>
                    ))}
                    <span className={styles.sep} />
                    <button disabled={!canUndo} title="1つ戻す（Ctrl+Z）" aria-label="1つ戻す" onClick={() => undo()}>
                      <Undo2 size={14} />
                    </button>
                  </div>
                )}
                {mode === "sheet" && tool && (
                  <p className={styles.markupHint}>図面の上をドラッグして{SHAPE_LABELS[tool]}を描きます（Esc でやめる）</p>
                )}
                {markupError && <p className={styles.markupHint} role="alert">{markupError}</p>}
                {mode === "sheet" ? (
                  <AnnotatedSheet
                    sheet={currentSheet}
                    base={resultBase}
                    findings={remaining.filter(
                      (f) => f.drawing.sheet === currentSheet.id,
                    )}
                    activeId={activeId}
                    onSelect={select}
                    onClear={ignore}
                    tool={tool}
                    ink={ink}
                    editable={editable}
                    onCreate={addMark}
                    onMove={(id, box) =>
                      updateMarkup((m) => ({
                        ...m,
                        items: m.items.map((item) => (item.id === id ? { ...item, box } : item)),
                      }))
                    }
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
                      onSelect={(member) => {
                        if (!member) return;
                        const key = memberKey(member);
                        const hit = sheetFindings.find((f) => !isBlue(f) && memberKeysOf(f, model).includes(key));
                        if (!active && hit) select(hit);
                      }}
                    />
                    {active && highlighted.size === 0 && (
                      <span className={styles.miniNote}>{active.manual ? NO_3D_POSITION : NOT_IN_MODEL}</span>
                    )}
                  </div>
                )}
              </section>
              <div className={styles.compareSlot} inert={!active}>
              <ComparePane
                finding={shownFinding}
                sheet={currentSheet}
                locked={
                  !jobId ||
                  confirmed.some((item) => item.page === active?.drawing.page)
                }
                base={resultBase}
                publicView={uploaded ? publicView : true}
                onEdit={(edit) => {
                  if (!active) return;
                  if (active.manual) {
                    if (!edit) return;
                    updateMarkup((m) => ({
                      ...m,
                      items: m.items.map((item) =>
                        item.id === active.id ? { ...item, title: edit.title, comment: edit.comment } : item,
                      ),
                    }));
                    return;
                  }
                  const key = String(active.number);
                  updateMarkup((m) => {
                    const edits = { ...m.edits };
                    if (edit) edits[key] = edit;
                    else delete edits[key];
                    return { ...m, edits };
                  });
                }}
                onDelete={() => active && deleteMark(active.id)}
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
            </div>
          </>
        )}
      </div>
    </AppFrame>
  );
}
