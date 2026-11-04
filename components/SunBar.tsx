"use client";

import { useMemo } from "react";
import { compassName, SEASONS, sunPosition } from "@/lib/sun";
import styles from "./SunBar.module.css";

export type SunState = { month: number; day: number; hours: number };

export const DEFAULT_SUN: SunState = { month: 3, day: 20, hours: 12 };

const START = 4;
const END = 20;
const pad = (value: number) => String(value).padStart(2, "0");
const timeText = (hours: number) => {
  const minutes = Math.round(hours * 60);
  return `${Math.floor(minutes / 60)}:${pad(minutes % 60)}`;
};

// 画面下の日当たりのバー。スライダーの地の色で日の出ている時間を示す
export default function SunBar({
  lat,
  lon,
  value,
  note,
  onChange,
}: {
  lat: number;
  lon: number;
  value: SunState;
  note?: string;
  onChange: (next: SunState) => void;
}) {
  const sun = sunPosition(lat, lon, value.month, value.day, value.hours);
  const background = useMemo(() => {
    const stops: string[] = [];
    for (let i = 0; i <= 32; i += 1) {
      const hours = START + ((END - START) * i) / 32;
      const up = sunPosition(lat, lon, value.month, value.day, hours).altitude > 0;
      stops.push(`${up ? "#E9C46A" : "#5B6470"} ${(i / 32) * 100}%`);
    }
    return `linear-gradient(to right, ${stops.join(", ")})`;
  }, [lat, lon, value.month, value.day]);

  return (
    <div className={styles.bar} role="group" aria-label="日当たり">
      <label className={styles.date}>
        <span>日付</span>
        <input
          type="date"
          className="mono"
          value={`2026-${pad(value.month)}-${pad(value.day)}`}
          min="2026-01-01"
          max="2026-12-31"
          onChange={(e) => {
            const [, month, day] = e.target.value.split("-").map(Number);
            if (month && day) onChange({ ...value, month, day });
          }}
        />
      </label>
      <div className={styles.seasons}>
        {SEASONS.map((season) => (
          <button
            key={season.label}
            aria-pressed={
              value.month === season.month && value.day === season.day
            }
            onClick={() =>
              onChange({ ...value, month: season.month, day: season.day })
            }
          >
            {season.label}
          </button>
        ))}
      </div>
      <label className={styles.slider}>
        <span className="mono">{timeText(value.hours)}</span>
        <input
          type="range"
          aria-label="時刻"
          min={START}
          max={END}
          step={0.25}
          value={value.hours}
          style={{ background }}
          onChange={(e) =>
            onChange({ ...value, hours: Number(e.target.value) })
          }
        />
      </label>
      <div className={styles.readout}>
        {sun.altitude > 0 ? (
          <>
            <span>
              高度 <b className="mono">{sun.altitude.toFixed(0)}°</b>
            </span>
            <span>
              方位{" "}
              <b className="mono">
                {sun.azimuth.toFixed(0)}°
              </b>
              （{compassName(sun.azimuth)}）
            </span>
          </>
        ) : (
          <span>日の出前・日没後</span>
        )}
        {note && <small>{note}</small>}
      </div>
    </div>
  );
}
