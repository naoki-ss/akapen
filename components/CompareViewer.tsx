"use client";

import Image from "next/image";
import { useEffect } from "react";
import styles from "./SheetViewer.module.css";

export type CompareTarget = {
  title: string;
  left: { label: string; src: string };
  right: { label: string; src: string };
};

// 同じ箇所の2枚の図面を、画面いっぱいに横に並べる
export default function CompareViewer({
  target,
  onClose,
}: {
  target: CompareTarget;
  onClose: () => void;
}) {
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  return (
    <div className={styles.backdrop} role="dialog" aria-label={target.title}>
      <div className={styles.window}>
        <header className={styles.head}>
          <b>{target.title}</b>
          <div className={styles.actions}>
            <button onClick={onClose}>閉じる</button>
          </div>
        </header>
        <div className={`${styles.scroller} ${styles.compare}`}>
          {[target.left, target.right].map((side) => (
            <figure key={side.src}>
              <figcaption>{side.label}</figcaption>
              <Image
                src={side.src}
                alt={side.label}
                width={1000}
                height={700}
                unoptimized
              />
            </figure>
          ))}
        </div>
      </div>
    </div>
  );
}
