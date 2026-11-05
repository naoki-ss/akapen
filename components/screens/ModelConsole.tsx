"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Building } from "@/lib/buildings";
import {
  isBlue,
  inkOf,
  memberKeysOf,
  NOT_IN_MODEL,
} from "@/lib/findings";
import { floorsOf, type Member } from "@/lib/model";
import type { DrawingResult } from "@/lib/buildings";
import type { Finding } from "@/lib/check";
import type { MinutesSummary } from "@/lib/minutes";
import type { ConfirmedSheet } from "@/lib/sheetStatus";
import type { KnowledgeApp, ProjectDocument } from "@/lib/projects";
import { ALL_LAYERS, titleKey, type LayerKey, type SheetTarget } from "@/lib/sheets";
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
const ALL_DRAWINGS = "__all__";

const countText = (items: DrawingResult[]) => {
  const all = items.flatMap((item) => item.findings);
  const blue = all.filter(isBlue).length;
  return `赤${all.length - blue}・青${blue}`;
};

// 青の出典。ナレッジの名前と、元のファイルとページ
function sourceText(finding: Finding) {
  const card = finding.checklist_card;
  if (!card) return finding.sources?.[0]?.doc ?? null;
  const file = card.source?.file
    ? `${card.source.file}${card.source.page ? ` ${card.source.page}` : ""}`
    : null;
  return [card.checklist, file].filter(Boolean).join("・");
}

// 赤か青の並び。項目を押すと、そのまま④に移る
function FindingItems({
  color,
  drawing,
  findings,
  source,
  slug,
}: {
  color: "red" | "blue";
  drawing: DrawingResult;
  findings: DrawingResult["findings"];
  source: boolean;
  slug: string;
}) {
  if (findings.length === 0) return null;
  return (
    <>
      <h4 className={panel.colorHead} data-color={color}>
        {color === "red" ? "赤" : "青"} {findings.length}
      </h4>
      <ul>
        {findings.map((finding) => (
          <li key={finding.id}>
            <Link
              className={panel.findingLink}
              href={`/projects/${slug}/check/${drawing.job}?finding=${finding.id}`}
            >
              <i className="mono" data-color={color}>
                {finding.number}
              </i>
              <span>
                {finding.title}
                {source && sourceText(finding) && (
                  <small className={panel.itemNote}>{sourceText(finding)}</small>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

// 図面ごとのまとまり。見出しに赤と青の件数を出し、開くと赤と青に分かれて並ぶ
function DrawingGroup({
  drawing,
  open,
  slug,
}: {
  drawing: DrawingResult;
  open: boolean;
  slug: string;
}) {
  const blue = drawing.findings.filter(isBlue);
  return (
    <details className={panel.group} open={open}>
      <summary>
        <b>{drawing.title}</b>
        <span className="mono">
          <em data-color="red">赤{drawing.findings.length - blue.length}</em>・
          <em data-color="blue">青{blue.length}</em>
        </span>
      </summary>
      <FindingItems
        color="red"
        drawing={drawing}
        findings={drawing.findings.filter((finding) => !isBlue(finding))}
        source={false}
        slug={slug}
      />
      <FindingItems color="blue" drawing={drawing} findings={blue} source slug={slug} />
    </details>
  );
}

export default function ModelConsole({
  slug,
  model,
  sheets,
  summary,
  projects,
  canUpload,
  knowledge,
  confirmedSheets,
  minutes,
  drawings,
  documents,
}: Building & {
  projects: { slug: string; name: string }[];
  // 公開先では施工図を入れられない（APIの費用が掛かるため）
  canUpload: boolean;
  knowledge: KnowledgeApp[];
  confirmedSheets: ConfirmedSheet[];
  minutes: MinutesSummary[];
  drawings: DrawingResult[];
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

  // 別の画面で変わった件数を、戻ってきたときに読み直す
  useEffect(() => router.refresh(), [router]);

  // 見ている施工図。「全図面」か、図面の名前
  const [drawing, setDrawing] = useState(ALL_DRAWINGS);
  const shown = useMemo(
    () =>
      drawing === ALL_DRAWINGS
        ? drawings
        : drawings.filter((item) => item.title === drawing),
    [drawing, drawings],
  );
  const staleCount = new Set(shown.flatMap((item) => item.stale)).size;
  // ④から戻ったときに、その指摘の部材を3Dで示す
  const active = useMemo(() => {
    const id = params.get("finding");
    if (!id) return null;
    const job = params.get("job") ?? "saved";
    return (
      drawings
        .find((item) => item.job === job && item.findings.some((f) => f.id === id))
        ?.findings.find((f) => f.id === id) ?? null
    );
  }, [params, drawings]);
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


  const columns = model.members.filter((m) => m.type === "column").length;
  const beams = model.members.filter((m) => m.type === "beam").length;
  const storeys = floors.filter((f) => /^\d+F$/.test(f)).length;
  const imported = knowledge.filter((app) => app.imported_at).length;
  const checksCount =
    summary?.checks.filter((c) => c.result === "要確認").length ?? 0;

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
        <Hint id="model" text="指摘を選ぶと、なぜ問題かと3Dの位置を見られます。" />

        <label className={panel.viewing}>
          <span>見ている施工図</span>
          <div className={panel.drawingRow}>
            <select
              className={panel.drawing}
              aria-label="見ている施工図"
              value={drawing}
              onChange={(e) => {
                setDrawing(e.target.value);
              }}
            >
              <option value={ALL_DRAWINGS}>
                全図面（{drawings.length}枚）{countText(drawings)}
              </option>
              {drawings.map((item) => (
                <option key={item.title} value={item.title}>
                  {item.title} {countText([item])}
                </option>
              ))}
            </select>
            {canUpload && (
              <button
                type="button"
                className={panel.add}
                aria-expanded={adding}
                onClick={() => setAdding(!adding)}
              >
                ＋ 施工図
              </button>
            )}
          </div>
        </label>
        {canUpload && adding && <UploadPanel job={job} />}
        {staleCount > 0 && (
          <p className={panel.stale} role="status">
            設計図書が更新されました。再チェックが必要です。
          </p>
        )}

        <div className={panel.findings}>
          {drawings.length === 0 && (
            <p className={panel.empty}>指摘はまだありません。</p>
          )}
          {shown.map((item) => (
            <DrawingGroup
              key={item.title}
              drawing={item}
              open={drawing !== ALL_DRAWINGS}
              slug={slug}
            />
          ))}
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
