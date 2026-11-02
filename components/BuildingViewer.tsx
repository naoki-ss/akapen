"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import type {
  CheckResult,
  EvalReport,
  Finding,
  HumanItem,
  RunStats,
} from "@/lib/check";
import CheckPanel from "./CheckPanel";
import {
  FLOORS,
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
  return "z" in m ? toM(m.z) : `${toM(m.z0)} 〜 ${toM(m.z1)}`;
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
      </dl>
    </div>
  );
}

export default function BuildingViewer({
  model,
  result,
  report,
  stats,
  humanItems,
}: {
  model: BuildingModel;
  result: CheckResult;
  report: EvalReport;
  stats: RunStats;
  humanItems: HumanItem[];
}) {
  const [topFloorIndex, setTopFloorIndex] = useState(FLOORS.length - 1);
  const [hiddenTypes, setHiddenTypes] = useState<ReadonlySet<MemberType>>(
    new Set(),
  );
  const [selected, setSelected] = useState<Member | null>(null);
  const [activeFinding, setActiveFinding] = useState<Finding | null>(null);

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
      ...finding.model_refs.map((ref) => FLOORS.indexOf(ref.split("|")[1])),
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
    if (selected && FLOORS.indexOf(selected.floor) > index) setSelected(null);
  };

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <h1>{model.name}</h1>
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
            表示する階：<b>{FLOORS[topFloorIndex]}</b>
          </div>
          <input
            className={styles.range}
            type="range"
            aria-label="表示する階"
            min={0}
            max={FLOORS.length - 1}
            value={topFloorIndex}
            onChange={(e) => changeTopFloor(Number(e.target.value))}
          />
          {TOGGLEABLE.map((type) => (
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
        </aside>
        <aside className={styles.check}>
          <CheckPanel
            result={result}
            report={report}
            stats={stats}
            humanItems={humanItems}
            activeId={activeFinding?.id ?? null}
            onActivate={activateFinding}
          />
        </aside>
      </main>
    </div>
  );
}
