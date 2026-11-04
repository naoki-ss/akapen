"use client";

import Link from "next/link";
import type { BuildingModel } from "@/lib/model";
import { floorsOf } from "@/lib/model";
import BuildingScene from "../BuildingSceneLazy";
import styles from "./screens.module.css";

const NO_HIGHLIGHT: ReadonlySet<string> = new Set();
const ignore = () => {};

// ⑤ 打ち合わせモード。③と同じ3Dから、チェック用の情報を外して見せる
export default function MeetingScreen({
  slug,
  model,
}: {
  slug: string;
  model: BuildingModel;
}) {
  return (
    <div className={styles.full}>
      <div className={styles.scene}>
        {model.members.length > 0 && (
          <BuildingScene
            model={model}
            topFloorIndex={floorsOf(model).length - 1}
            selected={null}
            highlighted={NO_HIGHLIGHT}
            onSelect={ignore}
          />
        )}
      </div>
      <div className={`${styles.panel} ${styles.meetingHead}`}>
        <b>{model.name}</b>
        <Link href={`/projects/${slug}`}>コンソールに戻る</Link>
      </div>
      <p className={styles.sceneNote}>
        初期検討用のイメージです。寸法の精度は保証しません。
      </p>
    </div>
  );
}
