"use client";

import Link from "next/link";
import { useState } from "react";
import MinutesRecorder from "../MinutesRecorder";
import { floorsOf, type BuildingModel } from "@/lib/model";
import { sunDirection, sunPosition } from "@/lib/sun";
import { Logo } from "../AppFrame";
import type { Display, ViewName } from "../BuildingScene";
import BuildingScene from "../BuildingSceneLazy";
import SceneControls from "../SceneControls";
import SunBar, { DEFAULT_SUN, type SunState } from "../SunBar";
import styles from "./screens.module.css";

const NO_HIGHLIGHT: ReadonlySet<string> = new Set();
const ignore = () => {};
const TOKYO = { lat: 35.69, lon: 139.69, north_deg: 0 };
const DISPLAYS: { key: Display; label: string }[] = [
  { key: "normal", label: "通常" },
  { key: "noRoof", label: "屋根を外す" },
];

// ⑤ 打ち合わせモード。③と同じ3Dから、コンソールと透かし・指摘を外して見せる
export default function MeetingScreen({
  slug,
  model,
  canRecord,
}: {
  slug: string;
  model: BuildingModel;
  canRecord: boolean;
}) {
  const floors = floorsOf(model);
  const [view, setView] = useState<ViewName>("oblique");
  const [display, setDisplay] = useState<Display>("normal");
  const [floorLimit, setFloorLimit] = useState("all");
  const [sunOn, setSunOn] = useState(true);
  const [sun, setSun] = useState<SunState>(DEFAULT_SUN);
  const [showRooms, setShowRooms] = useState(false);
  const [recording, setRecording] = useState(false);
  const site = model.site ?? TOKYO;
  const hasModel = model.members.length > 0;

  return (
    <div className={styles.full}>
      <div className={styles.scene}>
        {hasModel && (
          <BuildingScene
            model={model}
            topFloorIndex={
              floorLimit === "all"
                ? floors.length - 1
                : floors.indexOf(floorLimit)
            }
            selected={null}
            highlighted={NO_HIGHLIGHT}
            onSelect={ignore}
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
          />
        )}
      </div>
      <header className={`${styles.panel} ${styles.meetingHead}`}>
        <Logo />
        <b>{model.name}</b>
        <Link href={`/projects/${slug}`}>コンソールに戻る</Link>
        {canRecord && (
          <button
            type="button"
            className={styles.meetingAction}
            aria-expanded={recording}
            onClick={() => setRecording(!recording)}
          >
            議事録を作る
          </button>
        )}
      </header>
      {recording && (
        <MinutesRecorder slug={slug} onClose={() => setRecording(false)} />
      )}
      {hasModel && (
        <SceneControls
          displays={DISPLAYS}
          display={display}
          onDisplay={setDisplay}
          view={view}
          onView={setView}
          floors={floors}
          floorLimit={floorLimit}
          onFloorLimit={setFloorLimit}
          sunOn={sunOn}
          onSun={setSunOn}
          hasRooms={Boolean(model.architecture)}
          showRooms={showRooms}
          onRooms={setShowRooms}
        />
      )}
      {hasModel && sunOn && (
        <SunBar
          lat={site.lat}
          lon={site.lon}
          value={sun}
          note={model.site ? undefined : "建設地が未登録のため東京の値"}
          wide
          onChange={setSun}
        />
      )}
      <p className={styles.sceneNote}>
        初期検討用のイメージです。寸法の精度は保証しません。
      </p>
    </div>
  );
}
