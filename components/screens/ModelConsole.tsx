"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import type { Building } from "@/lib/buildings";
import {
  floorsOf,
  TYPE_LABELS,
  type Member,
  type MemberType,
} from "@/lib/model";
import { ALL_LAYERS, type LayerKey, type SheetTarget } from "@/lib/sheets";
import { useUploadJob } from "@/lib/useUploadJob";
import { Logo } from "../AppFrame";
import BuildingScene from "../BuildingSceneLazy";
import MemberCard from "../MemberCard";
import { ChecksList } from "../RegisterView";
import SheetViewer from "../SheetViewer";
import UploadPanel from "../UploadPanel";
import appStyles from "../App.module.css";
import styles from "./screens.module.css";

const TOGGLEABLE: MemberType[] = ["slab", "wall", "pile"];
const NO_HIGHLIGHT: ReadonlySet<string> = new Set();

// ③ 3Dモデル＋コンソール
export default function ModelConsole({
  slug,
  model,
  check,
  sheets,
  summary,
}: Building) {
  const router = useRouter();
  const hasModel = model.members.length > 0;
  const floors = floorsOf(model);
  const [topFloorIndex, setTopFloorIndex] = useState(floors.length - 1);
  const [hiddenTypes, setHiddenTypes] = useState<ReadonlySet<MemberType>>(
    new Set(),
  );
  const [selected, setSelected] = useState<Member | null>(null);
  const [openSheet, setOpenSheet] = useState<SheetTarget | null>(null);
  const [showChecks, setShowChecks] = useState(false);
  const [visibleLayers, setVisibleLayers] = useState<ReadonlySet<LayerKey>>(
    () => new Set(ALL_LAYERS),
  );
  const closeSheet = useCallback(() => setOpenSheet(null), []);
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

  const toggleable = TOGGLEABLE.filter((type) =>
    model.members.some((m) => m.type === type),
  );

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
    <div className={styles.full}>
      <div className={styles.scene}>
        {hasModel ? (
          <BuildingScene
            model={model}
            topFloorIndex={topFloorIndex}
            hiddenTypes={hiddenTypes}
            selected={selected}
            highlighted={NO_HIGHLIGHT}
            onSelect={setSelected}
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
        <div className={styles.projectName}>
          <Link href="/">← プロジェクト一覧</Link>
          <b>{model.name}</b>
          {summary && (
            <button
              className={appStyles.secondary}
              onClick={() => setShowChecks(true)}
            >
              {hasModel ? "3D あり" : "3D なし"}・要確認{" "}
              {summary.checks.filter((c) => c.result === "要確認").length} 件
            </button>
          )}
        </div>
        {hasModel && (
          <Link className={styles.action} href={`/projects/${slug}/meeting`}>
            打ち合わせモードで見せる
          </Link>
        )}
        <UploadPanel slug={slug} job={job} savedCount={check?.findings.length} />
      </aside>

      {hasModel && (
        <aside className={`${styles.panel} ${styles.panelRight}`}>
          <h2>階</h2>
          <label className={appStyles.floor}>
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
          {toggleable.length > 0 && <h2>表示</h2>}
          {toggleable.map((type) => (
            <label key={type} className={appStyles.typeToggle}>
              <input
                type="checkbox"
                checked={!hiddenTypes.has(type)}
                onChange={(e) => toggleType(type, e.target.checked)}
              />
              {TYPE_LABELS[type]}
            </label>
          ))}
        </aside>
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
