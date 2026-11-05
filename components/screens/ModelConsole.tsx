"use client";

import CountUp from "../CountUp";
import { ArrowRight } from "lucide-react";
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
import type { ConfirmedSheet } from "@/lib/sheetStatus";
import { ALL_LAYERS, titleKey, type LayerKey, type SheetTarget } from "@/lib/sheets";
import BuildingScene from "../BuildingSceneLazy";
import Hint from "../Hint";
import MemberCard from "../MemberCard";
import { ChecksList } from "../RegisterView";
import SheetViewer from "../SheetViewer";
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

// 赤か青の並び。項目を押すと、3Dで位置を示す
function FindingItems({
  color,
  drawing,
  findings,
  source,
  slug,
  activeKey,
  onSelect,
}: {
  color: "red" | "blue";
  drawing: DrawingResult;
  findings: DrawingResult["findings"];
  source: boolean;
  slug: string;
  activeKey: string | null;
  onSelect: (key: string | null) => void;
}) {
  if (findings.length === 0) return null;
  return (
    <>
      <h4 className={panel.colorHead} data-color={color}>
        {color === "red" ? "赤" : "青"} <CountUp value={findings.length} />
      </h4>
      <ul>
        {findings.map((finding) => {
          const key = `${drawing.job}:${finding.id}`;
          const isActive = key === activeKey;
          return (
            <li key={finding.id}>
              <button
                className={panel.findingLink}
                data-active={isActive}
                onClick={() => onSelect(isActive ? null : key)}
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
              </button>
              {isActive && (
                <div className={panel.findingOpen}>
                  <Link href={`/projects/${slug}/check/${drawing.job}?finding=${finding.id}`}>
                    なぜ問題かを見る <ArrowRight size={14} />
                  </Link>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

// 図面ごとのまとまり。見出しに赤と青の件数を出し、開くと赤と青に分かれて並ぶ
function DrawingGroup({
  drawing,
  open,
  slug,
  activeKey,
  onSelect,
}: {
  drawing: DrawingResult;
  open: boolean;
  slug: string;
  activeKey: string | null;
  onSelect: (key: string | null) => void;
}) {
  const blue = drawing.findings.filter(isBlue);
  return (
    <details className={panel.group} open={open}>
      <summary>
        <b>{drawing.title}</b>
        <span className="mono">
          <em data-color="red">赤<CountUp value={drawing.findings.length - blue.length} /></em>・
          <em data-color="blue">青<CountUp value={blue.length} /></em>
        </span>
      </summary>
      <FindingItems
        color="red"
        drawing={drawing}
        findings={drawing.findings.filter((finding) => !isBlue(finding))}
        source={false}
        slug={slug}
        activeKey={activeKey}
        onSelect={onSelect}
      />
      <FindingItems
        color="blue"
        drawing={drawing}
        findings={blue}
        source
        slug={slug}
        activeKey={activeKey}
        onSelect={onSelect}
      />
    </details>
  );
}

export default function ModelConsole({
  slug,
  model,
  sheets,
  summary,
  confirmedSheets,
  drawings,
}: Building & {
  confirmedSheets: ConfirmedSheet[];
  drawings: DrawingResult[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const hasModel = model.members.length > 0;
  const floors = floorsOf(model);

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
  // 選んだ指摘。④から来たときは、その指摘を選んでおく
  const [activeKey, setActiveKey] = useState<string | null>(
    params.get("finding") ? `${params.get("job") ?? "saved"}:${params.get("finding")}` : null,
  );
  const active = useMemo(() => {
    for (const item of drawings) {
      const found = item.findings.find((f) => `${item.job}:${f.id}` === activeKey);
      if (found) return found;
    }
    return null;
  }, [drawings, activeKey]);
  const selectFinding = (key: string | null) => {
    setActiveKey(key);
    setSelected(null);
  };
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
  const checksCount =
    summary?.checks.filter((c) => c.result === "要確認").length ?? 0;

  return (
    <div className={styles.fullTab}>
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
        <p className={panel.summaryLine}>
          {hasModel ? (
            <span className="mono">
              {storeys}階建て・柱{columns}・梁{beams}
            </span>
          ) : (
            "3Dなし"
          )}
          {hasModel && (
            <Link className={panel.meetingLink} href={`/projects/${slug}/meeting`}>
              打ち合わせで見せる
            </Link>
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
                selectFinding(null);
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
          </div>
        </label>
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
              open={drawing !== ALL_DRAWINGS || item.findings.some((f) => activeKey === `${item.job}:${f.id}`)}
              slug={slug}
              activeKey={activeKey}
              onSelect={selectFinding}
            />
          ))}
        </div>

        <div className={panel.checkButtons}>
          {summary && (
            <button className={panel.clear} onClick={() => setDialog("summary")}>
              読み取りの要確認 {checksCount} 件
            </button>
          )}
          {model.architecture && (
            <button className={panel.clear} onClick={() => setDialog("architecture")}>
              外観の要確認 {model.architecture.checks.length} 件
            </button>
          )}
        </div>
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
