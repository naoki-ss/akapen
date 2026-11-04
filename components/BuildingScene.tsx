"use client";

import { Html, Line, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { CanvasTexture, Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import {
  floorsOf,
  memberCenter,
  memberKey,
  PROVISIONAL_SIZE as SIZE,
  type BuildingModel,
  type Member,
  type MemberType,
} from "@/lib/model";
import styles from "./BuildingScene.module.css";

const MM = 0.001;
const RED = "#C62D23";
const INK = "#1B2430";
const GRID_COLOR = "#5B6470";
// 霧がかった緑の地面
const GROUND = "#A9B79C";
const FOG = "#DDE3D6";

const COLORS: Record<MemberType, string> = {
  column: "#8a8a84",
  beam: "#a9a59a",
  wall: "#d8d3c4",
  slab: "#c9d3d6",
  pile: "#7d6a55",
};

const OPACITY: Partial<Record<MemberType, number>> = {
  slab: 0.35,
  wall: 0.6,
};

type Vec3 = [number, number, number];

// 建物座標（mm, z が上）→ three.js 座標（m, y が上）
const toScene = (x: number, y: number, z: number): Vec3 => [
  x * MM,
  z * MM,
  -y * MM,
];

type Shape = {
  position: Vec3;
  size: Vec3;
  rotation?: Vec3;
  cylinder?: boolean;
};

// 平面の幅 sx, 奥行き sy, 高さ sz（mm）の箱
const boxShape = (
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
): Shape => ({
  position: toScene(x, y, z),
  size: [sx * MM, sz * MM, sy * MM],
});

function shapeOf(m: Member): Shape {
  switch (m.type) {
    case "column": {
      const width = m.width ?? SIZE.column;
      return boxShape(
        m.x,
        m.y,
        (m.z0 + m.z1) / 2,
        width,
        width,
        m.z1 - m.z0,
      );
    }
    case "pile": {
      const radius = m.radius ?? SIZE.pileRadius;
      return {
        position: toScene(m.x, m.y, (m.z0 + m.z1) / 2),
        size: [radius * MM, (m.z1 - m.z0) * MM, radius * MM],
        cylinder: true,
      };
    }
    case "beam": {
      const plan = Math.hypot(m.x1 - m.x0, m.y1 - m.y0);
      const rise = (m.z1 ?? m.z) - m.z;
      const length = Math.hypot(plan, rise);
      const depth =
        m.depth ??
        (m.floor === "基礎" ? SIZE.foundationBeamDepth : SIZE.beamDepth);
      const width = m.width ?? SIZE.beamWidth;
      const alongX = m.y0 === m.y1;
      // 建物の y は three.js の -z なので、y 方向の梁は x 軸まわりに正の向きで傾ける
      const tilt = Math.atan2(rise, alongX ? m.x1 - m.x0 : m.y1 - m.y0);
      return {
        ...boxShape(
          (m.x0 + m.x1) / 2,
          (m.y0 + m.y1) / 2,
          m.z + rise / 2 - depth / 2,
          alongX ? length : width,
          alongX ? width : length,
          depth,
        ),
        rotation: alongX ? [0, 0, tilt] : [tilt, 0, 0],
      };
    }
    case "wall": {
      const length = Math.hypot(m.x1 - m.x0, m.y1 - m.y0);
      // 上の梁と重ならないよう、梁せい分だけ低くする
      const top = m.z1 - SIZE.beamDepth;
      return boxShape(
        (m.x0 + m.x1) / 2,
        m.y0,
        (m.z0 + top) / 2,
        length,
        SIZE.wallThickness,
        top - m.z0,
      );
    }
    case "slab": {
      const thickness = m.thickness ?? SIZE.slabThickness;
      return boxShape(
        (m.x0 + m.x1) / 2,
        (m.y0 + m.y1) / 2,
        m.z - thickness / 2,
        m.x1 - m.x0,
        m.y1 - m.y0,
        thickness,
      );
    }
  }
}

function MemberMesh({
  member,
  selected,
  glow,
  ghost,
  onSelect,
}: {
  member: Member;
  selected: boolean;
  // 指摘の該当部材を光らせる色
  glow?: string;
  // 透かしの表示
  ghost: boolean;
  onSelect: (member: Member) => void;
}) {
  const shape = useMemo(() => shapeOf(member), [member]);
  const baseOpacity = OPACITY[member.type];
  const opacity = ghost ? Math.min(baseOpacity ?? 1, 0.16) : baseOpacity;

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    // 手前の部材だけを選ぶ。ドラッグで回転した直後のクリックは無視する
    e.stopPropagation();
    if (e.delta <= 5) onSelect(member);
  };

  const accent = selected ? INK : glow;
  return (
    <mesh
      position={shape.position}
      rotation={shape.rotation}
      onClick={handleClick}
    >
      {shape.cylinder ? (
        <cylinderGeometry
          args={[shape.size[0], shape.size[0], shape.size[1], 20]}
        />
      ) : (
        <boxGeometry args={shape.size} />
      )}
      {accent ? (
        <meshStandardMaterial
          key={accent}
          color={accent}
          emissive={accent}
          emissiveIntensity={selected ? 0.2 : 0.75}
        />
      ) : (
        // 透明と不透明の切り替えを確実に反映するため、key で作り直す
        <meshStandardMaterial
          key={opacity ?? "solid"}
          color={COLORS[member.type]}
          transparent={opacity !== undefined}
          opacity={opacity ?? 1}
          depthWrite={!ghost}
        />
      )}
    </mesh>
  );
}

// 丸囲みの通り芯符号。canvas に描いて貼る
function GridLabel({ name, position }: { name: string; position: Vec3 }) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    const mono = getComputedStyle(document.documentElement).getPropertyValue(
      "--font-mono",
    );
    ctx.strokeStyle = ctx.fillStyle = GRID_COLOR;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(64, 64, 56, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = `500 50px ${mono || "monospace"}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(name, 64, 68);
    return new CanvasTexture(canvas);
  }, [name]);

  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <sprite position={position} scale={[1.6, 1.6, 1]}>
      <spriteMaterial map={texture} />
    </sprite>
  );
}

function GridLines({ model, level }: { model: BuildingModel; level: number }) {
  const xs = Object.entries(model.grid_x);
  const ys = Object.entries(model.grid_y);
  const xMax = Math.max(...xs.map(([, v]) => v));
  const yMax = Math.max(...ys.map(([, v]) => v));
  const line = (a: Vec3, b: Vec3) => (
    <Line
      points={[a, b]}
      color={GRID_COLOR}
      lineWidth={1}
      dashed
      dashSize={0.6}
      gapSize={0.3}
    />
  );

  return (
    <group>
      {xs.map(([name, v]) => (
        <group key={name}>
          {line(toScene(v, -4000, level), toScene(v, yMax + 3000, level))}
          <GridLabel name={name} position={toScene(v, -5200, level + 600)} />
        </group>
      ))}
      {ys.map(([name, v]) => (
        <group key={name}>
          {line(toScene(-3000, v, level), toScene(xMax + 3000, v, level))}
          <GridLabel name={name} position={toScene(-4200, v, level + 600)} />
        </group>
      ))}
    </group>
  );
}

export type ViewName = "oblique" | "top" | "east" | "west" | "south" | "north";
export type Display = "normal" | "noRoof" | "xray";
export type Callout = { number: number; title: string; color: string };

type Frame = { center: Vec3; size: number };

// 建物の中心と大きさ（m）から、視点ごとのカメラの位置を出す。北は建物座標の +y（three.js の -z）
function viewPosition(view: ViewName, { center, size }: Frame): Vec3 {
  const d = size * 1.75;
  const [x, y, z] = center;
  switch (view) {
    case "top":
      // 真上でも北が上になるよう、南へわずかにずらす
      return [x, y + d * 1.15, z + d * 0.03];
    case "north":
      return [x, y + d * 0.18, z - d];
    case "south":
      return [x, y + d * 0.18, z + d];
    case "east":
      return [x + d, y + d * 0.18, z];
    case "west":
      return [x - d, y + d * 0.18, z];
    case "oblique":
      return [x + d * 0.68, y + d * 0.42, z + d * 0.72];
  }
}

// 視点を切り替えると滑らかに動かす。手で動かし始めたら止める
function CameraRig({
  view,
  frame,
  focus,
}: {
  view: ViewName;
  frame: Frame;
  focus: { center: Vec3; size: number } | null;
}) {
  const camera = useThree((state) => state.camera);
  const controls = useThree(
    (state) => state.controls,
  ) as unknown as OrbitControlsImpl | null;
  const goal = useRef<{ position: Vector3; target: Vector3 } | null>(null);

  const fx = focus?.center[0];
  const fy = focus?.center[1];
  const fz = focus?.center[2];
  const fs = focus?.size;
  useEffect(() => {
    const shown =
      fx !== undefined && fy !== undefined && fz !== undefined && fs !== undefined
        ? { center: [fx, fy, fz] as Vec3, size: fs }
        : frame;
    goal.current = {
      position: new Vector3(...viewPosition(view, shown)),
      target: new Vector3(...shown.center),
    };
  }, [view, frame, fx, fy, fz, fs]);

  useEffect(() => {
    if (!controls) return;
    const stop = () => {
      goal.current = null;
    };
    controls.addEventListener("start", stop);
    return () => controls.removeEventListener("start", stop);
  }, [controls]);

  useFrame((_, delta) => {
    if (!goal.current || !controls) return;
    const k = 1 - Math.exp(-delta * 5);
    camera.position.lerp(goal.current.position, k);
    controls.target.lerp(goal.current.target, k);
    controls.update();
    if (camera.position.distanceTo(goal.current.position) < 0.02) {
      goal.current = null;
    }
  });
  return null;
}

export type SceneProps = {
  model: BuildingModel;
  topFloorIndex: number;
  selected: Member | null;
  highlighted: ReadonlySet<string>;
  // 強調の色。青（ナレッジ）の指摘は青で光らせる
  highlightColor?: string;
  onSelect: (member: Member | null) => void;
  display?: Display;
  view?: ViewName;
  // 指摘の位置に出す点線の丸と吹き出し
  callout?: Callout | null;
  // 小さな枠で使うときは、通り芯の符号を出さない
  compact?: boolean;
};

export default function BuildingScene({
  model,
  topFloorIndex,
  selected,
  highlighted,
  highlightColor = RED,
  onSelect,
  display = "normal",
  view = "oblique",
  callout,
  compact = false,
}: SceneProps) {
  const floors = floorsOf(model);
  const roofIndex = floors.findIndex((floor) => /^R/.test(floor));
  const visible = model.members.filter((m) => {
    const index = floors.indexOf(m.floor);
    if (index > topFloorIndex) return false;
    return !(display === "noRoof" && roofIndex >= 0 && index >= roofIndex);
  });

  const frame = useMemo<Frame & { groundLevel: number }>(() => {
    const xs = Object.values(model.grid_x);
    const ys = Object.values(model.grid_y);
    const heights = model.members.flatMap((m) =>
      m.type === "beam"
        ? [m.z, m.z1 ?? m.z]
        : "z" in m
          ? [m.z]
          : [m.z0, m.z1],
    );
    const zMin = Math.min(...heights);
    const zMax = Math.max(...heights);
    const xMid = (Math.min(...xs) + Math.max(...xs)) / 2;
    const yMid = (Math.min(...ys) + Math.max(...ys)) / 2;
    const plan = Math.hypot(
      Math.max(...xs) - Math.min(...xs),
      Math.max(...ys) - Math.min(...ys),
    );
    return {
      center: toScene(xMid, yMid, (zMin + zMax) / 2),
      size: Math.max(plan, zMax - zMin) * MM,
      groundLevel: zMin - 100,
    };
  }, [model]);

  // 該当部材の中心。指摘を選ぶとここへ寄る
  const focus = useMemo(() => {
    const members = model.members.filter((m) =>
      highlighted.has(memberKey(m)),
    );
    if (members.length === 0) return null;
    const points = members.map(memberCenter);
    const mid = (values: number[]) =>
      (Math.min(...values) + Math.max(...values)) / 2;
    const spread = (values: number[]) =>
      Math.max(...values) - Math.min(...values);
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const zs = points.map((p) => p[2]);
    return {
      center: toScene(mid(xs), mid(ys), mid(zs)),
      size: Math.max(frame.size * 0.45, Math.max(spread(xs), spread(ys), spread(zs)) * MM),
    };
  }, [model, highlighted, frame.size]);

  const groundY = frame.groundLevel * MM;
  const start = useMemo(() => viewPosition("oblique", frame), [frame]);

  return (
    <Canvas
      camera={{ fov: 40, near: 0.1, far: 2000, position: start }}
      onPointerMissed={() => onSelect(null)}
    >
      <color attach="background" args={[FOG]} />
      <fog attach="fog" args={[FOG, frame.size * 2.6, frame.size * 8]} />
      <hemisphereLight args={["#ffffff", "#b8b4a8", 1.1]} />
      <directionalLight position={[30, 50, 20]} intensity={1.2} />
      <OrbitControls makeDefault target={frame.center} enableDamping />
      <CameraRig view={view} frame={frame} focus={focus} />
      <mesh position={[frame.center[0], groundY, frame.center[2]]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[frame.size * 12, 64]} />
        <meshStandardMaterial color={GROUND} />
      </mesh>
      {!compact && <GridLines model={model} level={frame.groundLevel + 30} />}
      {visible.map((m) => {
        const key = memberKey(m);
        return (
          <MemberMesh
            key={key}
            member={m}
            selected={m === selected}
            glow={highlighted.has(key) ? highlightColor : undefined}
            ghost={display === "xray"}
            onSelect={onSelect}
          />
        );
      })}
      {callout && focus && (
        <Html position={focus.center} center zIndexRange={[1, 0]} pointerEvents="none">
          <div
            className={styles.callout}
            style={{ "--callout": callout.color } as CSSProperties}
          >
            <span className={styles.ring} />
            <span className={styles.bubble}>
              <b className="mono">{callout.number}</b>
              {callout.title}
            </span>
          </div>
        </Html>
      )}
    </Canvas>
  );
}
