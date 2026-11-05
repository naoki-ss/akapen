"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import type { Building } from "@/lib/buildings";
import {
  colorName,
  inkOf,
  memberKeysOf,
  NOT_IN_MODEL,
  numbered,
} from "@/lib/findings";
import { jobOption } from "@/lib/jobNames";
import { floorsOf, type Member } from "@/lib/model";
import type { MinutesSummary } from "@/lib/minutes";
import type { ConfirmedSheet } from "@/lib/sheetStatus";
import type { KnowledgeApp, ProjectDocument } from "@/lib/projects";
import { ALL_LAYERS, titleKey, type LayerKey, type SheetTarget } from "@/lib/sheets";
import { useJobResult } from "@/lib/useJobResult";
import { useUploadJob } from "@/lib/useUploadJob";
import { Logo } from "../AppFrame";
import BuildingScene from "../BuildingSceneLazy";
import Hint from "../Hint";
import MemberCard from "../MemberCard";
import { ChecksList } from "../RegisterView";
import SheetViewer from "../SheetViewer";
import UploadPanel from "../UploadPanel";
import appStyles from "../App.module.css";
import panel from "../console/console.module.css";
import styles from "./screens.module.css";

// ③ どこに問題があるかを見る
export default function ModelConsole({
  slug,
  model,
  check,
  sheets,
  summary,
  projects,
  canUpload,
  knowledge,
  confirmedSheets,
  minutes,
  documents,
}: Building & {
  projects: { slug: string; name: string }[];
  // 公開先では施工図を入れられない（APIの費用が掛かるため）
  canUpload: boolean;
  knowledge: KnowledgeApp[];
  confirmedSheets: ConfirmedSheet[];
  minutes: MinutesSummary[];
  documents: ProjectDocument[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const hasModel = model.members.length > 0;
  const floors = floorsOf(model);

  const [adding, setAdding] = useState(params.get("add") === "1");
  const [roofOff, setRoofOff] = useState(false);
  const [floorLimit, setFloorLimit] = useState("all");
  const [selected, setSelected] = useState<Member | null>(null);
  const [openSheet, setOpenSheet] = useState<SheetTarget | null>(null);
  const [dialog, setDialog] = useState<"summary" | "architecture" | null>(null);
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

  // 開いている図面。選ばれていなければ先頭の結果を開く
  const [chosen, setChosen] = useState<string | null>(params.get("job"));
  const rowKey =
    chosen ?? job.history[0]?.id ?? (check ? "saved" : null);
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

  // 指摘を選んでいる間は、該当部材が隠れないよう自動で透かしにして全部の階を出す
  const topFloorIndex =
    floorLimit === "all" || active
      ? floors.length - 1
      : floors.indexOf(floorLimit);
  const display = active ? "xray" : roofOff ? "noRoof" : "normal";

  const selectFinding = (id: string | null) => {
    setActiveId(id);
    setSelected(null);
  };

  const columns = model.members.filter((m) => m.type === "column").length;
  const beams = model.members.filter((m) => m.type === "beam").length;
  const storeys = floors.filter((f) => /^\d+F$/.test(f)).length;
  const imported = knowledge.filter((app) => app.imported_at).length;
  const checksCount =
    summary?.checks.filter((c) => c.result === "要確認").length ?? 0;
  const loading = Boolean(jobId && !result && !missing);

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
            showRooms={Boolean(model.architecture)}
            insetLeft={352}
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
            この現場は3Dなしで登録しています。
            <br />
            施工図のチェックは使えます。
          </div>
        )}
      </div>

      <aside className={`${styles.panel} ${styles.panelLeft}`}>
        <Logo />
        <select
          className={panel.select}
          aria-label="現場"
          value={slug}
          onChange={(e) => router.push(`/projects/${e.target.value}`)}
        >
          {projects.map((project) => (
            <option key={project.slug} value={project.slug}>
              {project.name}
            </option>
          ))}
        </select>
        <p className={panel.summaryLine}>
          {hasModel ? (
            <span className="mono">
              {storeys}階建て・柱{columns}・梁{beams}
            </span>
          ) : (
            "3Dなし"
          )}
          {hasModel && (
            <Link href={`/projects/${slug}/meeting`}>打ち合わせで見せる</Link>
          )}
        </p>
        <Hint id="model" text="指摘を選ぶと、3Dで場所を示します。" />

        <div className={panel.drawingRow}>
          {rowKey ? (
            <select
              className={panel.drawing}
              aria-label="図面"
              value={rowKey}
              onChange={(e) => {
                setChosen(e.target.value);
                selectFinding(null);
              }}
            >
              {job.history.map((item) => (
                <option key={item.id} value={item.id}>
                  {jobOption(item)}
                </option>
              ))}
              {check && <option value="saved">チェック済みの施工図</option>}
            </select>
          ) : (
            <span className={panel.empty}>指摘はまだありません。</span>
          )}
          {canUpload && (
            <button
              className={panel.add}
              aria-expanded={adding}
              onClick={() => setAdding(!adding)}
            >
              ＋ 施工図
            </button>
          )}
        </div>
        {canUpload && adding && <UploadPanel job={job} />}
        {(job.history.find((item) => item.id === jobId)?.stale.length ?? 0) > 0 && (
          <p className={panel.stale} role="status">
            設計図書が更新されました。再チェックが必要です。
          </p>
        )}

        <div className={panel.findings}>
          {loading && <p className={panel.empty}>読み込み中…</p>}
          <ul>
            {findings.map((finding) => {
              const isActive = finding.id === activeId;
              return (
                <li key={finding.id}>
                  <button
                    data-active={isActive}
                    onClick={() =>
                      selectFinding(isActive ? null : finding.id)
                    }
                  >
                    <i className="mono" data-color={colorName(finding)}>
                      {finding.number}
                    </i>
                    <span>{finding.title}</span>
                  </button>
                  {isActive && (
                    <div className={panel.findingOpen}>
                      {highlighted.size === 0 && (
                        <p className={panel.empty}>{NOT_IN_MODEL}</p>
                      )}
                      <Link
                        href={`/projects/${slug}/check/${rowKey}?finding=${finding.id}`}
                      >
                        なぜ問題かを見る →
                      </Link>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <details className={panel.sources}>
          <summary>資料</summary>
          <div>
            <Link className={panel.addKnowledge} href={`/projects/${slug}/drawings`}>
              図面台帳を開く
            </Link>
            <h3>設計図書</h3>
            {documents.length === 0 ? (
              <p className={panel.empty}>登録済みの設計図書はありません。</p>
            ) : (
              <ul className={panel.rows}>
                {documents.filter((document) => document.kind !== "議事録").map((document) => (
                  <li key={document.kind} data-on>
                    <span>{document.kind}</span>
                    <small>{document.count} 件</small>
                  </li>
                ))}
              </ul>
            )}
            <h3>議事録の履歴</h3>
            {minutes.length === 0 ? (
              <p className={panel.empty}>
                議事録はまだありません。「打ち合わせで見せる」から作れます。
              </p>
            ) : (
              <ul className={panel.rows}>
                {minutes.map((row) => (
                  <li key={row.id} data-on>
                    <Link href={`/projects/${slug}/minutes/${row.id}`}>
                      {row.date} {row.title}
                    </Link>
                    <small>
                      決定事項 {row.decisionCount} 件・{row.method}
                    </small>
                  </li>
                ))}
              </ul>
            )}
            <h3>
              ナレッジ
              {knowledge.length > 0 && (
                <small>
                  {" "}
                  {knowledge.length} アプリ中 {imported} 取り込み済み
                </small>
              )}
            </h3>
            {canUpload && (
              <Link className={panel.addKnowledge} href="/knowledge">
                ナレッジを開く（全物件で共通）
              </Link>
            )}
            {knowledge.length === 0 ? (
              <p className={panel.empty}>
                チェックリストがありません。青の指摘は「該当なし」になります。
              </p>
            ) : (
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
            )}
            {summary && (
              <button
                className={panel.clear}
                onClick={() => setDialog("summary")}
              >
                読み取りの要確認 {checksCount} 件
              </button>
            )}
            {model.architecture && (
              <button
                className={panel.clear}
                onClick={() => setDialog("architecture")}
              >
                外観の要確認 {model.architecture.checks.length} 件
              </button>
            )}
          </div>
        </details>
      </aside>

      {hasModel && (
        <aside className={`${styles.panel} ${styles.panelRight}`}>
          <label className={appStyles.typeToggle}>
            <input
              type="checkbox"
              checked={roofOff}
              disabled={Boolean(active)}
              onChange={(e) => setRoofOff(e.target.checked)}
            />
            屋根を外す
          </label>
          <label className={panel.floorSelect}>
            <span>階</span>
            <select
              value={floorLimit}
              disabled={Boolean(active)}
              onChange={(e) => {
                const key = e.target.value;
                setFloorLimit(key);
                if (
                  key !== "all" &&
                  selected &&
                  floors.indexOf(selected.floor) > floors.indexOf(key)
                ) {
                  setSelected(null);
                }
              }}
            >
              <option value="all">全部</option>
              {[...floors]
                .filter((floor) => /^\d+F$/.test(floor))
                .reverse()
                .map((floor) => (
                  <option key={floor} value={floor}>
                    {floor.replace("F", "階")}まで
                  </option>
                ))}
            </select>
          </label>
        </aside>
      )}

      {hasModel && active && highlighted.size === 0 && (
        <p className={styles.sceneToast}>{NOT_IN_MODEL}</p>
      )}

      {selected && (
        <div className={styles.memberSlot}>
          <MemberCard
            member={selected}
            index={sheets}
            confirmed={new Set(confirmedSheets.map((item) => titleKey(item.title)))}
            onClose={() => setSelected(null)}
            onOpen={(sheet, bbox, label) => {
              // 確定版があれば、それを開く
              const final = confirmedSheets.find(
                (item) => titleKey(item.title) === titleKey(sheet.title),
              );
              setOpenSheet(
                final
                  ? { sheet: final.sheet, bbox, label, base: final.base }
                  : { sheet, bbox, label, base: `/demo-data/${slug}` },
              );
            }}
          />
        </div>
      )}

      {hasModel && (
        <p className={styles.sceneNote}>
          初期検討用のイメージです。寸法の精度は保証しません。
        </p>
      )}

      {dialog && (
        <div
          className={appStyles.projectChecks}
          role="dialog"
          aria-label="要確認"
          onClick={() => setDialog(null)}
        >
          <div onClick={(e) => e.stopPropagation()}>
            {dialog === "summary" && summary && (
              <ChecksList summary={summary} />
            )}
            {dialog === "architecture" && model.architecture && (
              <div className={appStyles.checks}>
                <h3>外観の要確認 {model.architecture.checks.length} 件</h3>
                <p className={appStyles.fine}>{model.architecture.source}</p>
                <ul>
                  {model.architecture.checks.map((item, index) => (
                    <li key={index}>
                      <b>{item.kind}</b> {item.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <button
              className={appStyles.secondary}
              onClick={() => setDialog(null)}
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
