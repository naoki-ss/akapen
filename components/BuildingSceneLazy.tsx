"use client";

import dynamic from "next/dynamic";
import styles from "./App.module.css";

// WebGL はブラウザでしか動かないので、サーバー側では描画しない
const BuildingSceneLazy = dynamic(() => import("./BuildingScene"), {
  ssr: false,
  loading: () => <p className={styles.loading}>3Dモデルを読み込み中…</p>,
});

export default BuildingSceneLazy;
