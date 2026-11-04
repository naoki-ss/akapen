"use client";

import { Line, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import {
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type RefObject,
} from "react";
import {
  CanvasTexture,
  type DirectionalLight,
  ExtrudeGeometry,
  Shape as OutlineShape,
  Vector2,
  Vector3,
} from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import {
  floorsOf,
  memberCenter,
  memberKey,
  PROVISIONAL_SIZE as SIZE,
  type ArchFloor,
  type ArchOpening,
  type ArchRoom,
  type Architecture,
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
const WALL = "#D8D4CA";
const GLASS = "#8FA6B2";
const ROOF = "#B7B4AB";
const WALL_THICKNESS = 200;
const GLASS_THICKNESS = 40;

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
      castShadow={!ghost}
      receiveShadow={!ghost}
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

// 外周の壁。開口のところは腰と垂れ壁だけにして、ガラスを入れる
type WallBox = { center: Vec3; size: Vec3; glass: boolean };

function wallBoxes(floor: ArchFloor): WallBox[] {
  const boxes: WallBox[] = [];
  const points = floor.outline;
  const edges = points.map((p, i) => [p, points[(i + 1) % points.length]]);
  const box = (
    a: number,
    b: number,
    fixed: number,
    alongX: boolean,
    z0: number,
    z1: number,
    glass: boolean,
  ) => {
    if (b - a < 1 || z1 - z0 < 1) return;
    const mid = (a + b) / 2;
    const thick = glass ? GLASS_THICKNESS : WALL_THICKNESS;
    boxes.push({
      center: alongX
        ? toScene(mid, fixed, (z0 + z1) / 2)
        : toScene(fixed, mid, (z0 + z1) / 2),
      size: alongX
        ? [(b - a) * MM, (z1 - z0) * MM, thick * MM]
        : [thick * MM, (z1 - z0) * MM, (b - a) * MM],
      glass,
    });
  };
  // 開口を、その面の側で範囲が重なる一番外の壁に割り当てる
  const onEdge = new Map<number, ArchOpening[]>();
  for (const opening of floor.openings) {
    const alongX = opening.along === "x";
    let best = -1;
    let bestValue = 0;
    edges.forEach(([p, q], index) => {
      const edgeAlongX = p[1] === q[1];
      if (edgeAlongX !== alongX || (!edgeAlongX && p[0] !== q[0])) return;
      const [a, b] = alongX
        ? [Math.min(p[0], q[0]), Math.max(p[0], q[0])]
        : [Math.min(p[1], q[1]), Math.max(p[1], q[1])];
      if (opening.to <= a || opening.from >= b) return;
      const value = alongX ? p[1] : p[0];
      const outer = opening.side === "north" || opening.side === "east" ? value : -value;
      if (best < 0 || outer > bestValue) {
        best = index;
        bestValue = outer;
      }
    });
    if (best >= 0) onEdge.set(best, [...(onEdge.get(best) ?? []), opening]);
  }
  edges.forEach(([p, q], index) => {
    const alongX = p[1] === q[1];
    if (!alongX && p[0] !== q[0]) return;
    const fixed = alongX ? p[1] : p[0];
    const a = Math.min(alongX ? p[0] : p[1], alongX ? q[0] : q[1]);
    const b = Math.max(alongX ? p[0] : p[1], alongX ? q[0] : q[1]);
    const openings = (onEdge.get(index) ?? []).sort((m, n) => m.from - n.from);
    let cursor = a;
    for (const opening of openings) {
      const from = Math.max(opening.from, cursor);
      const to = Math.min(opening.to, b);
      if (to <= from) continue;
      box(cursor, from, fixed, alongX, floor.z0, floor.z1, false);
      box(from, to, fixed, alongX, floor.z0, opening.z0, false);
      box(from, to, fixed, alongX, opening.z1, floor.z1, false);
      box(from, to, fixed, alongX, opening.z0, opening.z1, true);
      cursor = to;
    }
    box(cursor, b, fixed, alongX, floor.z0, floor.z1, false);
  });
  return boxes;
}

const NO_RAYCAST = () => null;

// 平面の外形を板にする
function Plate({
  outline,
  z,
  thickness,
  color,
}: {
  outline: [number, number][];
  z: number;
  thickness: number;
  color: string;
}) {
  const geometry = useMemo(() => {
    const shape = new OutlineShape(outline.map(([x, y]) => new Vector2(x * MM, y * MM)));
    const extruded = new ExtrudeGeometry(shape, {
      depth: thickness * MM,
      bevelEnabled: false,
    });
    extruded.rotateX(-Math.PI / 2);
    return extruded;
  }, [outline, thickness]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh
      geometry={geometry}
      position={[0, z * MM, 0]}
      raycast={NO_RAYCAST}
      castShadow
      receiveShadow
    >
      <meshStandardMaterial color={color} />
    </mesh>
  );
}

function FloorWalls({ floor, ghost }: { floor: ArchFloor; ghost: boolean }) {
  const boxes = useMemo(() => wallBoxes(floor), [floor]);
  return (
    <group>
      {boxes.map((item, index) => (
        <mesh
          key={index}
          position={item.center}
          raycast={NO_RAYCAST}
          castShadow={!ghost && !item.glass}
          receiveShadow={!item.glass}
        >
          <boxGeometry args={item.size} />
          <meshStandardMaterial
            key={`${item.glass}-${ghost}`}
            color={item.glass ? GLASS : WALL}
            transparent={ghost || item.glass}
            opacity={ghost ? 0.07 : item.glass ? 0.42 : 1}
            depthWrite={!ghost && !item.glass}
          />
        </mesh>
      ))}
    </group>
  );
}

// 部屋名が重ならないよう、近いものを上下にずらす（表示の位置だけで、データは変えない）
function spreadLabels(rooms: ArchRoom[]) {
  const CHAR = 900;
  const HEIGHT = 1300;
  const placed: ArchRoom[] = [];
  for (const room of [...rooms].sort((a, b) => b.y - a.y)) {
    const width = (name: string) => name.length * CHAR;
    let y = room.y;
    for (let moved = true, tries = 0; moved && tries < 20; tries += 1) {
      moved = false;
      for (const other of placed) {
        const close =
          Math.abs(other.x - room.x) < (width(other.name) + width(room.name)) / 2 &&
          Math.abs(other.y - y) < HEIGHT;
        if (close) {
          y = other.y - HEIGHT;
          moved = true;
        }
      }
    }
    placed.push({ ...room, y });
  }
  return placed;
}

// PHは RF の階に立つ塔屋
const floorIndexOf = (floors: string[], name: string) =>
  floors.indexOf(name === "PH" ? "RF" : name);

// 部屋名を出す階（表示している一番上の階）
function labeledFloor(
  architecture: Architecture,
  floors: string[],
  topFloorIndex: number,
) {
  return architecture.floors
    .filter(
      (floor) =>
        floor.floor !== "PH" &&
        floor.rooms.length > 0 &&
        floorIndexOf(floors, floor.floor) <= topFloorIndex,
    )
    .reduce<ArchFloor | null>(
      (top, floor) => (!top || floor.z0 > top.z0 ? floor : top),
      null,
    );
}

function Exterior({
  architecture,
  floors,
  topFloorIndex,
  display,
}: {
  architecture: Architecture;
  floors: string[];
  topFloorIndex: number;
  display: Display;
}) {
  const ghost = display === "xray";
  const visible = architecture.floors.filter(
    (floor) => floorIndexOf(floors, floor.floor) <= topFloorIndex,
  );
  const everything = topFloorIndex >= floors.length - 1;
  const roofOn = everything && display === "normal";
  const topMain = labeledFloor(architecture, floors, topFloorIndex);
  return (
    <group>
      {visible
        .filter((floor) => !(floor.floor === "PH" && !everything))
        .map((floor, index) => (
          <FloorWalls key={index} floor={floor} ghost={ghost} />
        ))}
      {!ghost && topMain && !roofOn && (
        <Plate outline={topMain.outline} z={topMain.z0} thickness={60} color="#EFEBE2" />
      )}
      {architecture.roofs
        .filter(() => roofOn)
        .map((roof, index) => (
          <Plate
            key={index}
            outline={roof.outline}
            z={roof.z}
            thickness={200}
            color={ROOF}
          />
        ))}
    </group>
  );
}

// 3Dの位置を画面の位置に写し、部屋名や吹き出しを動かす（カメラが動いても部材からずれない）
function Projector({
  points,
  nodes,
}: {
  points: Vec3[];
  nodes: RefObject<(HTMLDivElement | null)[]>;
}) {
  const vector = useMemo(() => new Vector3(), []);
  useFrame(({ camera, size }) => {
    points.forEach((point, index) => {
      const node = nodes.current[index];
      if (!node) return;
      vector.set(...point).project(camera);
      const x = ((vector.x + 1) / 2) * size.width;
      const y = ((1 - vector.y) / 2) * size.height;
      node.style.transform = `translate(${x}px, ${y}px)`;
      node.style.visibility = vector.z < 1 ? "visible" : "hidden";
    });
  });
  return null;
}

// 太陽の光と影。sun がなければ、見やすさのための固定の光にする
function SunLight({
  direction,
  frame,
}: {
  direction: { x: number; y: number; z: number };
  frame: Frame;
}) {
  const light = useRef<DirectionalLight>(null);
  const [cx, cy, cz] = frame.center;
  const distance = frame.size * 3;
  useEffect(() => {
    if (!light.current) return;
    light.current.target.position.set(cx, cy, cz);
    light.current.target.updateMatrixWorld();
  }, [cx, cy, cz]);
  const reach = frame.size * 1.6;
  const up = direction.z > 0;
  return (
    <directionalLight
      ref={light}
      position={[
        cx + direction.x * distance,
        cy + direction.z * distance,
        cz - direction.y * distance,
      ]}
      intensity={up ? 0.8 + 2 * direction.z : 0}
      color="#FFF4DF"
      castShadow={up}
      shadow-mapSize={[2048, 2048]}
      shadow-bias={-0.0005}
      shadow-camera-left={-reach}
      shadow-camera-right={reach}
      shadow-camera-top={reach}
      shadow-camera-bottom={-reach}
      shadow-camera-near={0.1}
      shadow-camera-far={distance * 2.5}
    />
  );
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
  // 部屋名を出す（屋根を外しているとき）
  showRooms?: boolean;
  // 太陽のある向き（建物の座標）。日当たりを見せるときだけ渡す
  sun?: { x: number; y: number; z: number } | null;
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
  showRooms = false,
  sun = null,
}: SceneProps) {
  const floors = floorsOf(model);
  const roofIndex = floors.findIndex((floor) => /^R/.test(floor));
  const visible = model.members.filter((m) => {
    const index = floors.indexOf(m.floor);
    if (index > topFloorIndex) return false;
    // 外観がある物件は、通常は外観だけ、屋根を外すと柱だけ、透かしで骨組み全部を見せる
    if (model.architecture && display === "normal" && !highlighted.size) return false;
    if (model.architecture && display === "noRoof" && m.type !== "column") return false;
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

  // 丸は光らせた部材のうち、まとまりの中心に一番近いものの中心に置く（部材のないところを指さない）
  const marker = useMemo(() => {
    if (!focus) return null;
    const lit = model.members.filter((m) => highlighted.has(memberKey(m)));
    const centers = lit.map((m) => shapeOf(m).position);
    const distance = (p: Vec3) =>
      Math.hypot(
        p[0] - focus.center[0],
        p[1] - focus.center[1],
        p[2] - focus.center[2],
      );
    return centers.reduce((best, p) =>
      distance(p) < distance(best) ? p : best,
    );
  }, [model, highlighted, focus]);

  const topLabeled = model.architecture
    ? labeledFloor(model.architecture, floors, topFloorIndex)
    : null;
  const roofOff = display !== "normal" || topFloorIndex < floors.length - 1;
  const roomLabels =
    showRooms && roofOff && display !== "xray" && topLabeled
      ? spreadLabels(topLabeled.rooms)
      : [];
  const labelPoints: Vec3[] = [
    ...roomLabels.map((room) =>
      toScene(room.x, room.y, (topLabeled?.z0 ?? 0) + 300),
    ),
    ...(callout && marker ? [marker] : []),
  ];
  const labelNodes = useRef<(HTMLDivElement | null)[]>([]);

  return (
    <div className={styles.stage}>
    <Canvas
      shadows
      camera={{ fov: 40, near: 0.1, far: 2000, position: start }}
      onPointerMissed={() => onSelect(null)}
    >
      <color attach="background" args={[FOG]} />
      <fog attach="fog" args={[FOG, frame.size * 2.6, frame.size * 8]} />
      <hemisphereLight
        args={["#ffffff", "#b8b4a8", sun ? (sun.z > 0 ? 0.75 : 0.35) : 1.1]}
      />
      {sun ? (
        <SunLight direction={sun} frame={frame} />
      ) : (
        <directionalLight position={[30, 50, 20]} intensity={1.2} />
      )}
      <OrbitControls makeDefault target={frame.center} enableDamping />
      <CameraRig view={view} frame={frame} focus={focus} />
      <mesh
        position={[frame.center[0], groundY, frame.center[2]]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
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
      {model.architecture && (
        <Exterior
          architecture={model.architecture}
          floors={floors}
          topFloorIndex={topFloorIndex}
          display={display}
        />
      )}
      <Projector points={labelPoints} nodes={labelNodes} />
    </Canvas>
    <div className={styles.overlay}>
      {roomLabels.map((room, index) => (
        <div
          key={room.name}
          ref={(node) => {
            labelNodes.current[index] = node;
          }}
          className={styles.anchor}
        >
          <div className={styles.room} data-status={room.status}>
            {room.name}
            {room.area_m2 !== null && (
              <small className="mono">{room.area_m2}㎡</small>
            )}
            {room.status === "要確認" && <small>要確認</small>}
          </div>
        </div>
      ))}
      {callout && marker && (
        <div
          ref={(node) => {
            labelNodes.current[roomLabels.length] = node;
          }}
          className={styles.anchor}
        >
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
        </div>
      )}
    </div>
    </div>
  );
}
