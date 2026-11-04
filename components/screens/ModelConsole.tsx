"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import type { Building } from "@/lib/buildings";
import { inkOf, memberKeysOf, numbered } from "@/lib/findings";
import { floorsOf, type Member } from "@/lib/model";
import type { KnowledgeApp, ProjectDocument } from "@/lib/projects";
import { ALL_LAYERS, type LayerKey, type SheetTarget } from "@/lib/sheets";
import { useJobResult } from "@/lib/useJobResult";
import { sunDirection, sunPosition } from "@/lib/sun";
import { useUploadJob } from "@/lib/useUploadJob";
import { Logo } from "../AppFrame";
import type { Display, ViewName } from "../BuildingScene";
import BuildingScene from "../BuildingSceneLazy";
import MemberCard from "../MemberCard";
import SceneControls from "../SceneControls";
import SunBar, { DEFAULT_SUN, type SunState } from "../SunBar";
import { ChecksList } from "../RegisterView";
import SheetViewer from "../SheetViewer";
import UploadPanel from "../UploadPanel";
import SheetsTab, { rowOfJob, type SheetRow } from "../console/SheetsTab";
import appStyles from "../App.module.css";
import panel from "../console/console.module.css";
import styles from "./screens.module.css";

type Tab = "sheets" | "knowledge" | "documents";

const TOKYO = { lat: 35.69, lon: 139.69, north_deg: 0 };

const DISPLAYS: { key: Display; label: string }[] = [
  { key: "normal", label: "通常" },
  { key: "noRoof", label: "屋根を外す" },
  { key: "xray", label: "透かし" },
];

// ③ 3Dモデル＋コンソール
export default function ModelConsole({
  slug,
  model,
  check,
  sheets,
  summary,
  projects,
  canUpload,
  knowledge,
  documents,
}: Building & {
  projects: { slug: string; name: string }[];
  // 公開先では施工図を入れられない（APIの費用が掛かるため）
  canUpload: boolean;
  knowledge: KnowledgeApp[];
  documents: ProjectDocument[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const hasModel = model.members.length > 0;
  const floors = floorsOf(model);

  const [tab, setTab] = useState<Tab>("sheets");
  const [adding, setAdding] = useState(params.get("add") === "1");
  const [view, setView] = useState<ViewName>("oblique");
  const [display, setDisplay] = useState<Display>(
    params.get("finding") ? "xray" : "normal",
  );
  const [floorLimit, setFloorLimit] = useState("all");
  const [selected, setSelected] = useState<Member | null>(null);
  const [openSheet, setOpenSheet] = useState<SheetTarget | null>(null);
  const [showChecks, setShowChecks] = useState(false);
  const [showArchChecks, setShowArchChecks] = useState(false);
  const [showRooms, setShowRooms] = useState(false);
  const [sunOn, setSunOn] = useState(false);
  const [sun, setSun] = useState<SunState>(DEFAULT_SUN);
  const [visibleLayers, setVisibleLayers] = useState<ReadonlySet<LayerKey>>(
    () => new Set(ALL_LAYERS),
  );
  const closeSheet = () => setOpenSheet(null);
  const toggleLayer = useCallback((key: LayerKey) => {
    setVisibleLayers((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const showResult = useCallback(
    (jobId: string) => router.push(`/projects/${slug}/check/${jobId}`),
    [router, slug],
  );
  const job = useUploadJob(slug, showResult);

  // 施工図の一覧。デモ用に固定した結果は最後に置く
  const rows = useMemo<SheetRow[]>(() => {
    const saved: SheetRow[] = check
      ? [
          {
            key: "saved",
            title: "チェック済みの施工図",
            detail: "デモ用に固定した結果",
            red: check.findings.filter((f) => f.source_type !== "knowledge")
              .length,
            blue: check.findings.filter((f) => f.source_type === "knowledge")
              .length,
          },
        ]
      : [];
    return [...job.history.map(rowOfJob), ...saved];
  }, [job.history, check]);

  // 開いている施工図。選ばれていなければ一覧の先頭を開く
  const [chosenRow, setChosenRow] = useState<string | null>(params.get("job"));
  const rowKey = chosenRow ?? rows[0]?.key ?? null;
  const jobId = rowKey && rowKey !== "saved" ? rowKey : null;
  const { result, missing } = useJobResult(jobId);
  const findings = useMemo(
    () =>
      numbered(
        rowKey === "saved" ? (check?.findings ?? []) : (result?.findings ?? []),
      ),
    [rowKey, check, result],
  );
  const [activeId, setActiveId] = useState<string | null>(params.get("finding"));
  const active = findings.find((f) => f.id === activeId) ?? null;
  const highlighted = useMemo(
    () => new Set(active ? memberKeysOf(active, model) : []),
    [active, model],
  );

  // 指摘を見ている間は、該当部材が隠れないよう全部の階を出す
  const topFloorIndex =
    floorLimit === "all" || active
      ? floors.length - 1
      : floors.indexOf(floorLimit);

  const selectFinding = (id: string | null) => {
    setActiveId(id);
    setSelected(null);
    setDisplay(id ? "xray" : "normal");
    setView("oblique");
  };

  // 建設地がない物件は東京の値で計算する（画面に注記する）
  const site = model.site ?? TOKYO;
  const counts = {
    columns: model.members.filter((m) => m.type === "column").length,
    beams: model.members.filter((m) => m.type === "beam").length,
  };
  const imported = knowledge.filter((app) => app.imported_at).length;

  return (
    <div className={styles.full}>
      <div className={styles.scene}>
        {hasModel ? (
          <BuildingScene
            model={model}
            topFloorIndex={topFloorIndex}
            selected={selected}
            highlighted={highlighted}
            highlightColor={active ? inkOf(active) : undefined}
            onSelect={setSelected}
            display={display}
            view={view}
            showRooms={showRooms}
            sun={
              sunOn
                ? sunDirection(
                    sunPosition(site.lat, site.lon, sun.month, sun.day, sun.hours),
                    site.north_deg,
                  )
                : null
            }
            callout={
              active
                ? {
                    number: active.number,
                    title: active.title,
                    color: inkOf(active),
                  }
                : null
            }
          />
        ) : (
          <div className={appStyles.noModel}>
            この物件は3Dなしで登録しています。
            <br />
            施工図チェックは使えます。
          </div>
        )}
      </div>

      <aside className={`${styles.panel} ${styles.panelLeft}`}>
        <Logo />
        <select
          className={panel.select}
          aria-label="プロジェクト"
          value={slug}
          onChange={(e) => router.push(`/projects/${e.target.value}`)}
        >
          {projects.map((project) => (
            <option key={project.slug} value={project.slug}>
              {project.name}
            </option>
          ))}
        </select>
        {hasModel ? (
          <dl className={panel.summary} aria-label="概要">
            <div>
              <dt>階</dt>
              <dd className="mono">{floors.filter((f) => /^\d+F$/.test(f)).length}</dd>
            </div>
            <div>
              <dt>通り</dt>
              <dd className="mono">
                {Object.keys(model.grid_x).length}×
                {Object.keys(model.grid_y).length}
              </dd>
            </div>
            <div>
              <dt>柱</dt>
              <dd className="mono">{counts.columns}</dd>
            </div>
            <div>
              <dt>梁</dt>
              <dd className="mono">{counts.beams}</dd>
            </div>
          </dl>
        ) : (
          <p className={panel.empty}>3Dなしで登録しています。</p>
        )}
        {summary && (
          <button
            className={appStyles.secondary}
            onClick={() => setShowChecks(true)}
          >
            要確認{" "}
            {summary.checks.filter((c) => c.result === "要確認").length} 件を見る
          </button>
        )}
        {hasModel && (
          <Link className={styles.action} href={`/projects/${slug}/meeting`}>
            打ち合わせモードで見せる
          </Link>
        )}
        <div className={panel.tabs} role="tablist">
          {(
            [
              ["sheets", "施工図"],
              ["knowledge", "ナレッジ"],
              ["documents", "設計図書"],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className={panel.tabBody}>
          {tab === "sheets" && (
            <>
              {canUpload &&
                (adding ? (
                  <UploadPanel job={job} />
                ) : (
                  <button className={panel.add} onClick={() => setAdding(true)}>
                    ＋ 施工図を追加
                  </button>
                ))}
              {active && (
                <button className={panel.clear} onClick={() => selectFinding(null)}>
                  選択を外す
                </button>
              )}
              <SheetsTab
                slug={slug}
                rows={rows}
                rowKey={rowKey}
                findings={findings}
                loading={Boolean(jobId && !result && !missing)}
                activeId={activeId}
                onRow={(key) => {
                  setChosenRow(key);
                  selectFinding(null);
                }}
                onFinding={(finding) =>
                  selectFinding(finding.id === activeId ? null : finding.id)
                }
              />
            </>
          )}
          {tab === "knowledge" &&
            (knowledge.length === 0 ? (
              <p className={panel.empty}>
                チェックリストがありません。青の指摘は「該当なし」になります。
              </p>
            ) : (
              <>
                <p className={panel.empty}>
                  施工図チェックリスト {knowledge.length} アプリ（うち取り込み済み{" "}
                  {imported}）
                </p>
                <ul className={panel.rows}>
                  {knowledge.map((app) => (
                    <li key={app.id} data-on={Boolean(app.imported_at)}>
                      <span>{app.name}</span>
                      <small>
                        {app.imported_at
                          ? `kintoneから取り込み済み（${app.imported_at.slice(5).replace("-", "/")}）・${app.items}項目`
                          : "未取り込み"}
                      </small>
                    </li>
                  ))}
                </ul>
              </>
            ))}
          {tab === "documents" &&
            (documents.length === 0 ? (
              <p className={panel.empty}>登録済みの設計図書はありません。</p>
            ) : (
              <ul className={panel.rows}>
                {documents.map((document) => (
                  <li key={document.kind} data-on>
                    <span>{document.kind}</span>
                    <small>{document.count} 件・登録済み</small>
                  </li>
                ))}
              </ul>
            ))}
        </div>
      </aside>

      {hasModel && (
        <SceneControls
          displays={DISPLAYS}
          display={display}
          onDisplay={setDisplay}
          view={view}
          onView={setView}
          floors={floors}
          floorLimit={floorLimit}
          onFloorLimit={(key) => {
            setFloorLimit(key);
            if (
              key !== "all" &&
              selected &&
              floors.indexOf(selected.floor) > floors.indexOf(key)
            ) {
              setSelected(null);
            }
          }}
          sunOn={sunOn}
          onSun={setSunOn}
          hasRooms={Boolean(model.architecture)}
          showRooms={showRooms}
          onRooms={setShowRooms}
        >
          {model.architecture && (
            <button
              className={panel.clear}
              onClick={() => setShowArchChecks(true)}
            >
              外観の要確認 {model.architecture.checks.length} 件
            </button>
          )}
        </SceneControls>
      )}

      {selected && (
        <div className={styles.memberSlot}>
          <MemberCard
            member={selected}
            index={sheets}
            onClose={() => setSelected(null)}
            onOpen={(sheet, bbox, label) =>
              setOpenSheet({ sheet, bbox, label, base: `/demo-data/${slug}` })
            }
          />
        </div>
      )}

      {hasModel && sunOn && (
        <SunBar
          lat={site.lat}
          lon={site.lon}
          value={sun}
          note={model.site ? undefined : "建設地が未登録のため東京の値"}
          onChange={setSun}
        />
      )}

      {hasModel && (
        <p className={styles.sceneNote}>
          初期検討用のイメージです。寸法の精度は保証しません。
        </p>
      )}

      {showChecks && summary && (
        <div
          className={appStyles.projectChecks}
          role="dialog"
          aria-label="検算の結果"
          onClick={() => setShowChecks(false)}
        >
          <div onClick={(e) => e.stopPropagation()}>
            <ChecksList summary={summary} />
            <button
              className={appStyles.secondary}
              onClick={() => setShowChecks(false)}
            >
              閉じる
            </button>
          </div>
        </div>
      )}
      {showArchChecks && model.architecture && (
        <div
          className={appStyles.projectChecks}
          role="dialog"
          aria-label="外観の要確認"
          onClick={() => setShowArchChecks(false)}
        >
          <div onClick={(e) => e.stopPropagation()}>
            <div className={appStyles.checks}>
              <h3>外観の要確認 {model.architecture.checks.length} 件</h3>
              <p className={appStyles.fine}>{model.architecture.source}</p>
              <ul>
                {model.architecture.checks.map((check, index) => (
                  <li key={index}>
                    <b>{check.kind}</b> {check.message}
                  </li>
                ))}
              </ul>
            </div>
            <button
              className={appStyles.secondary}
              onClick={() => setShowArchChecks(false)}
            >
              閉じる
            </button>
          </div>
        </div>
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
