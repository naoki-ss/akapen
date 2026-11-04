"use client";

import type { ReactNode } from "react";
import type { Display, ViewName } from "./BuildingScene";
import appStyles from "./App.module.css";
import panel from "./console/console.module.css";
import styles from "./screens/screens.module.css";

const VIEWS: { key: ViewName; label: string }[] = [
  { key: "oblique", label: "斜め" },
  { key: "top", label: "真上" },
  { key: "east", label: "東" },
  { key: "west", label: "西" },
  { key: "south", label: "南" },
  { key: "north", label: "北" },
];

function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
}) {
  return (
    <>
      <h2>{label}</h2>
      <div className={panel.choice} role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.key}
            aria-pressed={value === option.key}
            onClick={() => onChange(option.key)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </>
  );
}

// 3Dの見せ方を変える右のパネル。③と⑤で共通
export default function SceneControls({
  displays,
  display,
  onDisplay,
  view,
  onView,
  floors,
  floorLimit,
  onFloorLimit,
  sunOn,
  onSun,
  hasRooms,
  showRooms,
  onRooms,
  children,
}: {
  displays: { key: Display; label: string }[];
  display: Display;
  onDisplay: (display: Display) => void;
  view: ViewName;
  onView: (view: ViewName) => void;
  floors: string[];
  floorLimit: string;
  onFloorLimit: (key: string) => void;
  sunOn: boolean;
  onSun: (on: boolean) => void;
  hasRooms: boolean;
  showRooms: boolean;
  onRooms: (on: boolean) => void;
  children?: ReactNode;
}) {
  const floorOptions = [
    { key: "all", label: "全部" },
    ...(floors.includes("2F") ? [{ key: "2F", label: "2階まで" }] : []),
    ...(floors.includes("1F") ? [{ key: "1F", label: "1階まで" }] : []),
  ];
  return (
    <aside className={`${styles.panel} ${styles.panelRight}`}>
      <Choice label="視点" options={VIEWS} value={view} onChange={onView} />
      <Choice
        label="表示"
        options={displays}
        value={display}
        onChange={onDisplay}
      />
      <Choice
        label="階"
        options={floorOptions}
        value={floorLimit}
        onChange={onFloorLimit}
      />
      <h2>日当たり</h2>
      <label className={appStyles.typeToggle}>
        <input
          type="checkbox"
          checked={sunOn}
          onChange={(e) => onSun(e.target.checked)}
        />
        太陽と影を表示
      </label>
      {hasRooms && (
        <>
          <h2>部屋</h2>
          <label className={appStyles.typeToggle}>
            <input
              type="checkbox"
              checked={showRooms}
              onChange={(e) => {
                onRooms(e.target.checked);
                // 部屋は屋根の下にあるので、屋根を外して見せる
                if (e.target.checked && display === "normal") {
                  onDisplay("noRoof");
                }
              }}
            />
            部屋名を表示
          </label>
        </>
      )}
      {children}
    </aside>
  );
}
