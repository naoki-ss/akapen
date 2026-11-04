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
import CheckPanel from "./CheckPanel";
import SheetViewer from "./SheetViewer";
import {
  floorsOf,
  memberKey,
  TYPE_LABELS,
  type BuildingModel,
  type Member,
  type MemberType,
} from "@/lib/model";
import styles from "./BuildingViewer.module.css";

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
        <p className={styles.empty}>{index.empty_note}</p>
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

function MemberInfo({ member }: { member: Member | null }) {
  if (!member) {
    return (
      <p className={styles.empty}>
        3Dモデルの柱・梁・壁などをクリックすると、ここに部材情報が表示されます。
      </p>
    );
  }
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

export default function BuildingViewer({
  buildings,
}: {
  buildings: Building[];
}) {
  const [name, setName] = useState(buildings[0].model.name);
  const building =
    buildings.find((b) => b.model.name === name) ?? buildings[0];

  const picker =
    buildings.length > 1 ? (
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
    ) : (
      <h1>{building.model.name}</h1>
    );

  // 物件を切り替えたら、表示の状態とカメラを最初からにする
  return (
    <BuildingView key={building.model.name} {...building} title={picker} />
  );
}

function BuildingView({
  slug,
  model,
  check,
  sheets,
  title,
}: Building & { title: ReactNode }) {
  const base = `/demo-data/${slug}`;
  const floors = floorsOf(model);
  const [topFloorIndex, setTopFloorIndex] = useState(floors.length - 1);
  const [hiddenTypes, setHiddenTypes] = useState<ReadonlySet<MemberType>>(
    new Set(),
  );
  const [selected, setSelected] = useState<Member | null>(null);
  const [activeFinding, setActiveFinding] = useState<Finding | null>(null);
  const [openSheet, setOpenSheet] = useState<SheetTarget | null>(null);
  const closeSheet = useCallback(() => setOpenSheet(null), []);
  // アップロードの判定の朱書きの表示。一覧と図面で同じ状態を使う
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
  const showSheet = (
    sheet: Sheet,
    bbox: Box | undefined,
    label: string,
    sheetBase?: string,
  ) => setOpenSheet({ sheet, bbox, label, base: sheetBase ?? base });

  const highlighted = useMemo(
    () => new Set(activeFinding?.model_refs ?? []),
    [activeFinding],
  );

  const activateFinding = (finding: Finding | null) => {
    setActiveFinding(finding);
    setSelected(null);
    if (!finding) return;
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

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        {title}
        <span>{model.source}</span>
      </header>
      <main className={styles.main}>
        <div className={styles.view}>
          <BuildingScene
            model={model}
            topFloorIndex={topFloorIndex}
            hiddenTypes={hiddenTypes}
            selected={selected}
            highlighted={highlighted}
            onSelect={setSelected}
          />
          <div className={styles.hint}>
            ドラッグで回転・ホイールで拡大・部材をクリック
          </div>
        </div>
        <aside className={styles.side}>
          <h2>表示</h2>
          <div className={styles.control}>
            表示する階：<b>{floors[topFloorIndex]}</b>
          </div>
          <input
            className={styles.range}
            type="range"
            aria-label="表示する階"
            min={0}
            max={floors.length - 1}
            value={topFloorIndex}
            onChange={(e) => changeTopFloor(Number(e.target.value))}
          />
          {TOGGLEABLE.filter((type) =>
            model.members.some((m) => m.type === type),
          ).map((type) => (
            <label key={type} className={styles.control}>
              <input
                type="checkbox"
                checked={!hiddenTypes.has(type)}
                onChange={(e) => toggleType(type, e.target.checked)}
              />
              {TYPE_LABELS[type]}
            </label>
          ))}
          <h2>選択した部材</h2>
          <MemberInfo member={selected} />
          {selected && (
            <MemberSheets
              member={selected}
              index={sheets}
              onOpen={showSheet}
            />
          )}
        </aside>
        <aside className={styles.check}>
          {check ? (
            <CheckPanel
              {...check}
              activeId={activeFinding?.id ?? null}
              onActivate={activateFinding}
              base={base}
              slug={slug}
              sheets={sheets?.sheets ?? []}
              onOpenSheet={showSheet}
              visibleLayers={visibleLayers}
              onToggleLayer={toggleLayer}
            />
          ) : (
            <p className={styles.noCheck}>
              この物件の施工図チェックはまだ行っていません。
            </p>
          )}
        </aside>
      </main>
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
