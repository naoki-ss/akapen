"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { floorsOf, type BuildingModel } from "@/lib/model";
import BuildingScene from "./BuildingSceneLazy";
import styles from "./screens/screens.module.css";

// 作った画像は、一覧に戻ったときに使い回す
const images = new Map<string, string>();
// ブラウザが同時に持てる WebGL の数に限りがあるので、1枚ずつ作って3Dを閉じる
let queue: Promise<void> = Promise.resolve();

const NO_HIGHLIGHT: ReadonlySet<string> = new Set();
const ignore = () => {};

function canDraw() {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("webgl2");
  context?.getExtension("WEBGL_lose_context")?.loseContext();
  return Boolean(context);
}

// ① のカードの画像。③と同じ3Dを同じ見た目で描いて画像にする（どの物件でも同じ作り方）
export default function SceneThumb({ slug }: { slug: string }) {
  const [image, setImage] = useState(() => images.get(slug) ?? null);
  const [model, setModel] = useState<BuildingModel | null>(null);
  const finish = useRef<() => void>(ignore);

  useEffect(() => {
    if (images.has(slug) || !canDraw()) return;
    let stopped = false;
    queue = queue.then(
      () =>
        new Promise<void>((resolve) => {
          finish.current = resolve;
          if (stopped || images.has(slug)) {
            resolve();
            return;
          }
          fetch(`/api/projects/${slug}/model`)
            .then((response) => {
              if (!response.ok) throw new Error(String(response.status));
              return response.json();
            })
            .then((loaded: BuildingModel) => {
              if (stopped || images.has(slug)) resolve();
              else setModel(loaded);
            })
            .catch(() => resolve());
        }),
    );
    return () => {
      stopped = true;
      finish.current();
    };
  }, [slug]);

  const handleCapture = useCallback(
    (captured: string) => {
      images.set(slug, captured);
      setImage(captured);
      setModel(null);
      finish.current();
    },
    [slug],
  );

  if (image) {
    // data URL なので next/image の最適化は使えない
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={styles.thumbImage} src={image} alt="" />;
  }
  if (!model) return null;
  return (
    <div className={styles.thumbStage} aria-hidden>
      <BuildingScene
        model={model}
        topFloorIndex={floorsOf(model).length - 1}
        selected={null}
        highlighted={NO_HIGHLIGHT}
        onSelect={ignore}
        compact
        onCapture={handleCapture}
      />
    </div>
  );
}
