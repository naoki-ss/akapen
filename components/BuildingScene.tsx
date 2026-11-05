"use client";

import { showChecks } from "@/lib/showCost";
import { Line, OrbitControls } from "@react-three/drei";
import {
  Canvas,
  invalidate,
  useFrame,
  useThree,
  type ThreeEvent,
} from "@react-three/fiber";
import {
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type RefObject,
} from "react";
import {
  ACESFilmicToneMapping,
  Color,
  type MeshStandardMaterial,
  type BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  type DirectionalLight,
  ExtrudeGeometry,
  PCFShadowMap,
  Shape as OutlineShape,
  Vector2,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { GROUND_COLOR, memberMaterial } from "@/lib/materials";
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
} from "@/lib/model";
import styles from "./BuildingScene.module.css";
import { glassFor, HORIZON, makeSky, materialFor, meterBox } from "./sceneLook";

const MM = 0.001;
const RED = "#C62D23";
const INK = "#1B2430";
const GRID_COLOR = "#5B6470";
const WALL_THICKNESS = 200;
const GLASS_THICKNESS = 30;
const MULLION_SPACING = 1200;
const NO_RAYCAST = () => null;
const WORLD_UP = new Vector3(0, 1, 0);
const MIN_EYE = 0.5;

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

// 部材の形。模様が伸びないようにメートルでUVを付ける
function memberGeometry(shape: Shape): BufferGeometry {
  if (shape.cylinder) {
    return new CylinderGeometry(shape.size[0], shape.size[0], shape.size[1], 20);
  }
  return meterBox(shape.size);
}

const FLY_MS = 1000;
const GLOW_MS = 500;
const GLOW_START = new Color("#8d949c");

const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// 指摘の部材の赤を、ふわっと点灯させる
function GlowMaterial({ color, intensity }: { color: string; intensity: number }) {
  const material = useRef<MeshStandardMaterial>(null);
  const started = useRef<number | null>(null);
  const goal = useMemo(() => new Color(color), [color]);
  useFrame(() => {
    if (!material.current) return;
    const now = performance.now();
    started.current ??= now;
    const t = reducedMotion() ? 1 : Math.min(1, (now - started.current) / GLOW_MS);
    if (material.current.userData.done) return;
    const eased = 1 - (1 - t) ** 2;
    material.current.color.lerpColors(GLOW_START, goal, eased);
    material.current.emissive.copy(goal);
    material.current.emissiveIntensity = intensity * eased;
    if (t >= 1) material.current.userData.done = true;
    invalidate();
  });
  return <meshStandardMaterial ref={material} color={GLOW_START} emissive={color} emissiveIntensity={0} />;
}

function MemberMesh({
  member,
  materialKey,
  selected,
  glow,
  ghost,
  onSelect,
}: {
  member: Member;
  materialKey: string;
  selected: boolean;
  // 指摘の該当部材を光らせる色
  glow?: string;
  // 透かしの表示
  ghost: boolean;
  onSelect: (member: Member) => void;
}) {
  const shape = useMemo(() => shapeOf(member), [member]);
  const geometry = useMemo(() => memberGeometry(shape), [shape]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    // 手前の部材だけを選ぶ。ドラッグで回転した直後のクリックは無視する
    e.stopPropagation();
    if (e.delta <= 5) onSelect(member);
  };

  const accent = selected ? INK : glow;
  return (
    <mesh
      geometry={geometry}
      material={accent ? undefined : materialFor(materialKey, ghost)}
      position={shape.position}
      rotation={shape.rotation}
      onClick={handleClick}
      castShadow={!ghost}
      receiveShadow={!ghost}
    >
      {accent && <GlowMaterial key={accent} color={accent} intensity={selected ? 0.2 : 0.75} />}
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
      <spriteMaterial map={texture} toneMapped={false} />
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

export type ViewName = "oblique" | "front" | "top" | "east" | "west" | "south" | "north";

// デモ動画の冒頭。正面の写真から切り替えるので、正面の画角を合わせ、斜めへゆっくり回る
export type ShotSettings = { fov?: number; eye?: number; dist?: number; flyMs: number };
export type Display = "normal" | "noRoof" | "xray";
export type Callout = { number: number; title: string; color: string };

// 建物の大きさと、正面の向き。視点はここから自動で決める
type Frame = {
  center: Vec3;
  size: number;
  width: number;
  depth: number;
  height: number;
  // 正面から見て、カメラを置く向き（three.js の平面上の単位ベクトル）
  front: [number, number];
  // 地上に見えている範囲の角。視点を合わせるときに画面へ収める
  corners: Vec3[];
};

const FOV = 38;
// 建物が見える範囲に占める割合
const FILL = 0.84;

// 見える範囲（パネルを除いた部分）の中央に建物が収まるよう、カメラと注視点を動かす。
// 向きは変えずに、横にずらして、距離を変える。keepEye は目の高さを保つ（見上げる視点）
function fitView(
  position: Vector3,
  target: Vector3,
  corners: Vec3[],
  aspect: number,
  keepEye: boolean,
) {
  const eye = position.clone();
  const look = target.clone();
  const halfY = Math.tan((FOV / 2) * (Math.PI / 180)) * FILL;
  const halfX = halfY * aspect;
  const forward = new Vector3();
  const right = new Vector3();
  const up = new Vector3();
  const point = new Vector3();
  // 遠近があるので、1回では合わない。少しずつ合わせる
  for (let step = 0; step < 10; step += 1) {
    forward.subVectors(look, eye).normalize();
    right.crossVectors(forward, WORLD_UP).normalize();
    up.crossVectors(right, forward);
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const corner of corners) {
      point.set(...corner).sub(eye);
      const depth = Math.max(point.dot(forward), 0.1);
      const sx = point.dot(right) / depth;
      const sy = point.dot(up) / depth;
      x0 = Math.min(x0, sx);
      x1 = Math.max(x1, sx);
      y0 = Math.min(y0, sy);
      y1 = Math.max(y1, sy);
    }
    const distance = eye.distanceTo(look);
    const across = ((x0 + x1) / 2) * distance;
    eye.addScaledVector(right, across);
    look.addScaledVector(right, across);
    // 見上げる視点は注視点だけを動かす。それ以外は向きを保ったまま平行に動かす
    const lift = ((y0 + y1) / 2) * distance;
    look.addScaledVector(up, lift);
    if (!keepEye) eye.addScaledVector(up, lift);
    const scale = Math.max((x1 - x0) / (2 * halfX), (y1 - y0) / (2 * halfY));
    const height = eye.y;
    eye.sub(look).multiplyScalar(scale).add(look);
    if (keepEye) eye.y = height;
  }
  return { position: eye, target: look };
}

// 正面の向き。frame.front は斜めの視点の向きなので、近いほうの軸にそろえて面に直角にする
function facing({ front }: Frame): [number, number] {
  return Math.abs(front[0]) > Math.abs(front[1]) ? [Math.sign(front[0]), 0] : [0, Math.sign(front[1])];
}

function viewPosition(view: ViewName, frame: Frame): Vec3 {
  const { center, size } = frame;
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
    case "front": {
      const [nx, nz] = facing(frame);
      const distance = frame.size * 2;
      return [x + nx * distance, Math.max(1.6, frame.height * 0.1), z + nz * distance];
    }
    case "oblique": {
      // 距離は fitView で決める
      const distance = frame.size * 2;
      // 人の目の高さに近いところから、建物を少し見上げる
      const eye = Math.max(1.6, frame.height * 0.1);
      return [x + frame.front[0] * distance, eye, z + frame.front[1] * distance];
    }
  }
}

// 指摘の部材に寄るときの視点。正面の向きのまま、見下ろして寄る
function focusPosition(
  center: Vec3,
  size: number,
  front: [number, number],
): Vec3 {
  const d = size * 1.75;
  return [
    center[0] + front[0] * d,
    center[1] + d * 0.42,
    center[2] + front[1] * d,
  ];
}

// 視点を切り替えると滑らかに動かす。手で動かし始めたら止める
function CameraRig({
  view,
  frame,
  focus,
  insetLeft,
  looksInside,
  underground,
  shot,
}: {
  shot?: ShotSettings;
  view: ViewName;
  frame: Frame;
  focus: { center: Vec3; size: number } | null;
  insetLeft: number;
  // 屋根を外しているときは、中が見えるよう見下ろす
  looksInside: boolean;
  // 透かしのときは地面の下からも見られる
  underground: boolean;
}) {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const controls = useThree(
    (state) => state.controls,
  ) as unknown as OrbitControlsImpl | null;
  const goal = useRef<{
    position: Vector3;
    target: Vector3;
    from?: { position: Vector3; target: Vector3; at: number };
  } | null>(null);
  // 開いた直後は動かさず、最初から収まった視点で見せる
  const opening = useRef(true);
  const visibleAspect =
    size.width > insetLeft && size.height > 0
      ? (size.width - insetLeft) / size.height
      : 0;

  // 画面の中心を、左のパネルを除いた見える範囲の中心へずらす
  useEffect(() => {
    if (!insetLeft || !("setViewOffset" in camera)) return;
    camera.setViewOffset(
      size.width,
      size.height,
      -insetLeft / 2,
      0,
      size.width,
      size.height,
    );
    invalidate();
    return () => camera.clearViewOffset();
  }, [camera, insetLeft, size.width, size.height]);

  const fx = focus?.center[0];
  const fy = focus?.center[1];
  const fz = focus?.center[2];
  const fs = focus?.size;
  useEffect(() => {
    const focused =
      fx !== undefined && fy !== undefined && fz !== undefined && fs !== undefined;
    if (!focused && !visibleAspect) return;
    const inside = looksInside && view === "oblique";
    // 動画の正面：距離と目の高さを指定できる（写真に合わせる）
    const shotFront =
      !focused && view === "front" && shot?.dist
        ? {
            position: new Vector3(
              frame.center[0] + facing(frame)[0] * shot.dist,
              shot.eye ?? 1.6,
              frame.center[2] + facing(frame)[1] * shot.dist,
            ),
            target: new Vector3(...frame.center),
          }
        : null;
    goal.current = shotFront ?? (focused
      ? {
          position: new Vector3(...focusPosition([fx, fy, fz], fs, frame.front)),
          target: new Vector3(fx, fy, fz),
        }
      : fitView(
          new Vector3(
            ...(inside
              ? focusPosition(frame.center, frame.size * 0.95, frame.front)
              : viewPosition(view, frame)),
          ),
          new Vector3(...frame.center),
          frame.corners,
          visibleAspect,
          view === "oblique" && !inside,
        ));
    invalidate();
  }, [view, frame, fx, fy, fz, fs, looksInside, visibleAspect, shot]);

  useEffect(() => {
    if (!controls) return;
    const stop = () => {
      goal.current = null;
    };
    controls.addEventListener("start", stop);
    return () => controls.removeEventListener("start", stop);
  }, [controls]);

  useFrame((state) => {
    const orbit = state.controls as unknown as OrbitControlsImpl | null;
    if (!orbit) return;
    // 見上げられるようにしつつ、カメラが地面より下に行かないようにする
    const reach = camera.position.distanceTo(orbit.target);
    const above = (orbit.target.y - MIN_EYE) / Math.max(reach, 0.01);
    orbit.maxPolarAngle = underground
      ? Math.PI
      : Math.PI / 2 + Math.asin(Math.min(1, Math.max(0, above)));
    if (!goal.current) return;
    // 始めと終わりをゆるやかにして、1秒で飛ぶ。開いた直後と、動きを減らす設定のときは飛ばない
    const now = performance.now();
    goal.current.from ??= { position: camera.position.clone(), target: orbit.target.clone(), at: now };
    const { from } = goal.current;
    const t = opening.current || reducedMotion() ? 1 : Math.min(1, (now - from.at) / (shot?.flyMs ?? FLY_MS));
    opening.current = false;
    const k = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
    if (shot) {
      // 動画の冒頭は建物の周りを回る（まっすぐ動くと建物に近づいてしまう）
      const to = goal.current;
      const fromSide = from.position.clone().sub(to.target);
      const toSide = to.position.clone().sub(to.target);
      const a0 = Math.atan2(fromSide.x, fromSide.z);
      const a1 = Math.atan2(toSide.x, toSide.z);
      const turn = Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0));
      const angle = a0 + turn * k;
      const r0 = Math.hypot(fromSide.x, fromSide.z);
      const radius = r0 + (Math.hypot(toSide.x, toSide.z) - r0) * k;
      camera.position.set(
        to.target.x + Math.sin(angle) * radius,
        from.position.y + (to.position.y - from.position.y) * k,
        to.target.z + Math.cos(angle) * radius,
      );
    } else {
      camera.position.lerpVectors(from.position, goal.current.position, k);
    }
    orbit.target.lerpVectors(from.target, goal.current.target, k);
    orbit.update();
    if (t >= 1) goal.current = null;
    invalidate();
  });
  return null;
}

// 空：背景と映り込み。トーンマッピングは Canvas に設定する
function SkySetup() {
  const get = useThree((state) => state.get);
  useEffect(() => {
    const sky = makeSky();
    const { scene } = get();
    scene.background = sky;
    scene.environment = sky;
    invalidate();
    return () => {
      scene.background = null;
      scene.environment = null;
      sky.dispose();
    };
  }, [get]);
  return null;
}

// 影は表示が変わったときだけ描き直す（回している間は描かない）
function ShadowUpdater({ stamp }: { stamp: string }) {
  const get = useThree((state) => state.get);
  useEffect(() => {
    const redraw = () => {
      get().gl.shadowMap.needsUpdate = true;
      invalidate();
    };
    redraw();
    const later = requestAnimationFrame(redraw);
    return () => cancelAnimationFrame(later);
  }, [get, stamp]);
  return null;
}

// 描き上がった絵を画像にして渡す（① の小さな画像）。カメラと影が落ち着くまで数フレーム待つ
function Capture({ onCapture }: { onCapture: (image: string) => void }) {
  const get = useThree((state) => state.get);
  useEffect(() => {
    let frames = 0;
    let request = 0;
    const tick = () => {
      invalidate();
      frames += 1;
      if (frames < 5) {
        request = requestAnimationFrame(tick);
        return;
      }
      const { gl, scene, camera } = get();
      gl.shadowMap.needsUpdate = true;
      gl.render(scene, camera);
      onCapture(gl.domElement.toDataURL("image/jpeg", 0.88));
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [get, onCapture]);
  return null;
}

// 壁とガラスと枠の形を、素材ごとに1つにまとめる（描く回数を減らして滑らかに回す）
type Pieces = Map<string, BufferGeometry[]>;
const GLASS_KEY = "glass";

function addPiece(pieces: Pieces, key: string, geometry: BufferGeometry) {
  const list = pieces.get(key);
  if (list) list.push(geometry);
  else pieces.set(key, [geometry]);
}

function wallMaterial(
  architecture: Architecture,
  side: ArchOpening["side"],
  along: number,
  z: number,
) {
  const zones = architecture.materials?.wall_zones ?? [];
  const hits = zones.filter(
    (zone) =>
      zone.side === side &&
      zone.from <= along &&
      along <= zone.to &&
      zone.z0 <= z &&
      z <= zone.z1,
  );
  // 狭い範囲の指定を優先する
  hits.sort(
    (a, b) => (a.to - a.from) * (a.z1 - a.z0) - (b.to - b.from) * (b.z1 - b.z0),
  );
  return hits[0]?.material ?? "standard_wall";
}

const CURTAIN_RATIO = 0.72;

function floorPieces(floor: ArchFloor, architecture: Architecture): Pieces {
  const pieces: Pieces = new Map();
  const points = floor.outline;
  const edges = points.map((p, i) => [p, points[(i + 1) % points.length]]);
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const midX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const midY = (Math.min(...ys) + Math.max(...ys)) / 2;
  const box = (
    a: number,
    b: number,
    fixed: number,
    alongX: boolean,
    z0: number,
    z1: number,
    thick: number,
    key: string,
  ) => {
    if (b - a < 1 || z1 - z0 < 1) return;
    const mid = (a + b) / 2;
    const center = alongX
      ? toScene(mid, fixed, (z0 + z1) / 2)
      : toScene(fixed, mid, (z0 + z1) / 2);
    const size: Vec3 = alongX
      ? [(b - a) * MM, (z1 - z0) * MM, thick * MM]
      : [thick * MM, (z1 - z0) * MM, (b - a) * MM];
    addPiece(pieces, key, meterBox(size, center));
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
      const outer =
        opening.side === "north" || opening.side === "east" ? value : -value;
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
    const side: ArchOpening["side"] = alongX
      ? fixed <= midY
        ? "south"
        : "north"
      : fixed <= midX
        ? "west"
        : "east";
    const a = Math.min(alongX ? p[0] : p[1], alongX ? q[0] : q[1]);
    const b = Math.max(alongX ? p[0] : p[1], alongX ? q[0] : q[1]);
    // 壁は素材の範囲の境目を越えないよう、1m ごとに素材を見てつなぐ
    const wall = (from: number, to: number, z0: number, z1: number) => {
      if (to - from < 1 || z1 - z0 < 1) return;
      const height = (z0 + z1) / 2;
      let start = from;
      let current = wallMaterial(architecture, side, from + 1, height);
      for (let at = from + 1000; at < to; at += 1000) {
        const key = wallMaterial(architecture, side, at, height);
        if (key !== current) {
          box(start, at, fixed, alongX, z0, z1, WALL_THICKNESS, current);
          start = at;
          current = key;
        }
      }
      box(start, to, fixed, alongX, z0, z1, WALL_THICKNESS, current);
    };
    const openings = (onEdge.get(index) ?? []).sort((m, n) => m.from - n.from);
    const frameKey =
      architecture.materials?.glass[side] ?? "aluminum_curtain_wall";
    let cursor = a;
    for (const opening of openings) {
      const from = Math.max(opening.from, cursor);
      const to = Math.min(opening.to, b);
      if (to <= from) continue;
      wall(cursor, from, floor.z0, floor.z1);
      // 階の高さの大半を占める幅の広い開口（カーテンウォールなど）の腰壁と垂れ壁は、外壁の仕上げではなく開口の枠と同じ素材にする
      const curtain = (opening.z1 - opening.z0) / (floor.z1 - floor.z0) >= CURTAIN_RATIO;
      if (to - from >= 3000 && curtain) {
        box(from, to, fixed, alongX, floor.z0, opening.z0, WALL_THICKNESS, frameKey);
        box(from, to, fixed, alongX, opening.z1, floor.z1, WALL_THICKNESS, frameKey);
      } else {
        wall(from, to, floor.z0, opening.z0);
        wall(from, to, opening.z1, floor.z1);
      }
      box(from, to, fixed, alongX, opening.z0, opening.z1, GLASS_THICKNESS, GLASS_KEY);
      // 枠：上下と、幅の広い開口の縦桟
      const frame = (x0: number, x1: number, z0: number, z1: number) =>
        box(x0, x1, fixed, alongX, z0, z1, 110, frameKey);
      frame(from, to, opening.z0, opening.z0 + 50);
      frame(from, to, opening.z1 - 50, opening.z1);
      const count = Math.max(1, Math.round((to - from) / MULLION_SPACING));
      for (let i = 0; i <= count; i += 1) {
        const at = from + ((to - from) * i) / count;
        frame(at - 25, at + 25, opening.z0, opening.z1);
      }
      cursor = to;
    }
    wall(cursor, b, floor.z0, floor.z1);
  });
  return pieces;
}

// 庇やキャノピー：読んだ範囲と出から、素材の板と先端の枠を作る
function projectionPieces(
  projection: NonNullable<Architecture["materials"]>["projections"][number],
  outline: [number, number][],
): Pieces {
  const pieces: Pieces = new Map();
  const xs = outline.map((p) => p[0]);
  const ys = outline.map((p) => p[1]);
  const { side, from, to, depth, z, thickness, material } = projection;
  const rect =
    side === "south"
      ? [from, Math.min(...ys) - depth, to, Math.min(...ys)]
      : side === "north"
        ? [from, Math.max(...ys), to, Math.max(...ys) + depth]
        : side === "west"
          ? [Math.min(...xs) - depth, from, Math.min(...xs), to]
          : [Math.max(...xs), from, Math.max(...xs) + depth, to];
  const [x0, y0, x1, y1] = rect;
  const add = (
    ax: number,
    ay: number,
    bx: number,
    by: number,
    zMin: number,
    zMax: number,
    key: string,
  ) => {
    addPiece(
      pieces,
      key,
      meterBox(
        [(bx - ax) * MM, (zMax - zMin) * MM, (by - ay) * MM],
        toScene((ax + bx) / 2, (ay + by) / 2, (zMin + zMax) / 2),
      ),
    );
  };
  if (projection.kind === "庇") {
    // 網の板と、先端の枠、腕木
    add(x0, y0, x1, y1, z - 50, z, material);
    const frame = "steel";
    const alongX = side === "south" || side === "north";
    if (alongX) {
      const edge = side === "south" ? y0 : y1 - 80;
      add(x0, edge, x1, edge + 80, z - thickness, z, frame);
    } else {
      const edge = side === "west" ? x0 : x1 - 80;
      add(edge, y0, edge + 80, y1, z - thickness, z, frame);
    }
    const length = alongX ? x1 - x0 : y1 - y0;
    const arms = Math.max(1, Math.round(length / 3000));
    for (let i = 0; i <= arms; i += 1) {
      const at = (alongX ? x0 : y0) + ((length - 60) * i) / arms;
      if (alongX) add(at, y0, at + 60, y1, z - thickness, z - 50, frame);
      else add(x0, at, x1, at + 60, z - thickness, z - 50, frame);
    }
  } else {
    add(x0, y0, x1, y1, z - thickness, z, material);
  }
  return pieces;
}

// 屋根の縁の笠木
function capPieces(
  outline: [number, number][],
  z: number,
  key: string,
): Pieces {
  const pieces: Pieces = new Map();
  outline.forEach((p, i) => {
    const q = outline[(i + 1) % outline.length];
    const alongX = p[1] === q[1];
    if (!alongX && p[0] !== q[0]) return;
    const length = alongX ? Math.abs(q[0] - p[0]) : Math.abs(q[1] - p[1]);
    const center = toScene((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, z + 40);
    const size: Vec3 = alongX
      ? [(length + 260) * MM, 0.08, 0.26]
      : [0.26, 0.08, (length + 260) * MM];
    addPiece(pieces, key, meterBox(size, center));
  });
  return pieces;
}

function mergePieces(pieces: Pieces) {
  return [...pieces.entries()].map(([key, list]) => ({
    key,
    geometry: mergeGeometries(list, false),
  }));
}

function MergedPieces({
  pieces,
  ghost,
}: {
  pieces: Pieces;
  ghost: boolean;
}) {
  const merged = useMemo(() => mergePieces(pieces), [pieces]);
  useEffect(
    () => () => merged.forEach((item) => item.geometry.dispose()),
    [merged],
  );
  return (
    <>
      {merged.map(({ key, geometry }) => (
        <mesh
          key={key}
          geometry={geometry}
          material={key === GLASS_KEY ? glassFor(ghost) : materialFor(key, ghost)}
          raycast={NO_RAYCAST}
          castShadow={!ghost && key !== GLASS_KEY}
          receiveShadow={!ghost && key !== GLASS_KEY}
        />
      ))}
    </>
  );
}

// 平面の外形を板にする
function Plate({
  outline,
  z,
  thickness,
  materialKey,
}: {
  outline: [number, number][];
  z: number;
  thickness: number;
  materialKey: string;
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
      material={materialFor(materialKey)}
      position={[0, z * MM, 0]}
      raycast={NO_RAYCAST}
      castShadow
      receiveShadow
    />
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

function FloorShell({
  floor,
  architecture,
  ghost,
}: {
  floor: ArchFloor;
  architecture: Architecture;
  ghost: boolean;
}) {
  const pieces = useMemo(
    () => floorPieces(floor, architecture),
    [floor, architecture],
  );
  return <MergedPieces pieces={pieces} ghost={ghost} />;
}

function Cap({ floor, material }: { floor: ArchFloor; material: string }) {
  const pieces = useMemo(
    () => capPieces(floor.outline, floor.z1, material),
    [floor, material],
  );
  return <MergedPieces pieces={pieces} ghost={false} />;
}

function Projection({
  projection,
  outline,
}: {
  projection: NonNullable<Architecture["materials"]>["projections"][number];
  outline: [number, number][];
}) {
  const pieces = useMemo(
    () => projectionPieces(projection, outline),
    [projection, outline],
  );
  return <MergedPieces pieces={pieces} ghost={false} />;
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
  const materials = architecture.materials;
  // 主屋根の外形を、庇の出の基準にする
  const mainOutline = architecture.floors.find(
    (floor) => floor.rooms.length > 0 && floor.floor !== "PH",
  )?.outline;
  // 庇は外壁から出る。屋上階の庇の基準は、塔屋ではなく主屋根の外形
  const levelOutline = (name: string) =>
    (name === "PH"
      ? architecture.roofs[0]?.outline
      : architecture.floors.find(
          (floor) => floor.floor === name && floor.rooms.length > 0,
        )?.outline) ?? mainOutline;
  return (
    <group>
      {visible
        .filter((floor) => !(floor.floor === "PH" && !everything))
        .map((floor, index) => (
          <FloorShell
            key={index}
            floor={floor}
            architecture={architecture}
            ghost={ghost}
          />
        ))}
      {!ghost &&
        visible
          .filter((floor) => floor.floor !== "PH" && floor.rooms.length > 0)
          .map((floor) => (
            <Plate
              key={floor.floor}
              outline={floor.outline}
              z={floor.z0 - 60}
              thickness={120}
              materialKey="floor_plate"
            />
          ))}
      {!ghost &&
        materials?.projections
          .filter(
            (projection) =>
              floorIndexOf(floors, projection.floor) <= topFloorIndex &&
              (projection.floor !== "PH" || roofOn),
          )
          .map((projection, index) => {
            const outline = levelOutline(projection.floor);
            return outline ? (
              <Projection key={index} projection={projection} outline={outline} />
            ) : null;
          })}
      {architecture.roofs
        .filter(() => roofOn)
        .map((roof, index) => (
          <Plate
            key={index}
            outline={roof.outline}
            z={roof.z}
            thickness={200}
            materialKey={
              (roof.floor === "PH" ? materials?.roofs.PH : materials?.roofs.main) ??
              "roof_membrane"
            }
          />
        ))}
      {roofOn &&
        architecture.floors
          .filter(
            (floor) =>
              floor.floor === "PH" ||
              (floor.rooms.length > 0 && floor.z1 > (architecture.roofs[0]?.z ?? 0)),
          )
          .map((floor) => (
            <Cap
              key={floor.floor}
              floor={floor}
              material={materials?.cap ?? "aluminum_cap"}
            />
          ))}
      {!ghost && !roofOn && topMain && (
        <Plate
          outline={topMain.outline}
          z={topMain.z0}
          thickness={30}
          materialKey="floor_plate"
        />
      )}
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
    // カメラを動かしたフレームでも部材からずれないよう、先に行列を更新する
    camera.updateMatrixWorld();
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

// 太陽の光と柔らかい影。日当たりを見せないときは、正面を明るく照らす向きに置く
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
      intensity={up ? 1.1 + 1.9 * direction.z : 0}
      color="#FFF6E6"
      castShadow={up}
      shadow-mapSize={[2048, 2048]}
      shadow-bias={-0.0004}
      shadow-normalBias={0.03}
      shadow-radius={6}
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
  shot?: ShotSettings;
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
  // 左のパネルで隠れる幅（px）。その分だけ建物を右に寄せる
  insetLeft?: number;
  // 渡すと、描き上がった絵を画像にして返す
  onCapture?: (image: string) => void;
};

// 正面を決める：開口の面積が一番広い面。読めなければ南。
// カメラは正面から斜めに振る。建物の高い部分のある側へ振って、全体の形が見えるようにする
function frontOf(model: BuildingModel, xMid: number): [number, number] {
  const totals: Record<string, number> = { north: 0, south: 0, east: 0, west: 0 };
  for (const floor of model.architecture?.floors ?? []) {
    for (const opening of floor.openings) {
      totals[opening.side] += (opening.to - opening.from) * (opening.z1 - opening.z0);
    }
  }
  const side = Object.entries(totals).reduce(
    (best, entry) => (entry[1] > best[1] ? entry : best),
    ["south", 0] as [string, number],
  )[0];
  const towers = model.architecture?.floors.filter(
    (floor) => floor.floor === "PH",
  );
  const towerX = towers?.[0]
    ? towers[0].outline.reduce((sum, p) => sum + p[0], 0) /
      towers[0].outline.length
    : xMid + 1;
  const swing = (towerX >= xMid ? 1 : -1) * 0.56;
  const base: Record<string, number> = {
    south: 0,
    east: Math.PI / 2,
    north: Math.PI,
    west: -Math.PI / 2,
  };
  const angle = base[side] + swing;
  return [Math.sin(angle), Math.cos(angle)];
}

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
  insetLeft = 0,
  onCapture,
  shot,
}: SceneProps) {
  const floors = floorsOf(model);
  const roofIndex = floors.findIndex((floor) => /^R/.test(floor));
  const xray = display === "xray";
  const visible = model.members.filter((m) => {
    const index = floors.indexOf(m.floor);
    if (index > topFloorIndex) return false;
    // 外観がある物件は、通常は外観だけ、屋根を外すと柱だけ、透かしで骨組み全部を見せる
    if (model.architecture && display === "normal" && !highlighted.size) return false;
    if (model.architecture && display === "noRoof" && m.type !== "column") return false;
    return !(display === "noRoof" && roofIndex >= 0 && index >= roofIndex);
  });

  const frame = useMemo<Frame & { zMin: number }>(() => {
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
    const zMax = Math.max(
      ...heights,
      ...(model.architecture?.floors.map((floor) => floor.z1) ?? []),
    );
    const xMid = (Math.min(...xs) + Math.max(...xs)) / 2;
    const yMid = (Math.min(...ys) + Math.max(...ys)) / 2;
    const width = (Math.max(...xs) - Math.min(...xs)) * MM;
    const depth = (Math.max(...ys) - Math.min(...ys)) * MM;
    // 視点は地上の部分で決める（杭や基礎は地面の下）
    const height = zMax * MM;
    // 外周の壁や庇は通り芯の外に出るので、合わせて範囲に入れる
    const architecture = model.architecture;
    const plan = [
      ...xs.flatMap((x) => ys.map((y) => [x, y] as [number, number])),
      ...(architecture?.floors.flatMap((floor) => floor.outline) ?? []),
    ];
    const reach = (side: ArchOpening["side"]) =>
      Math.max(
        0,
        ...(architecture?.materials?.projections
          .filter((p) => p.side === side)
          .map((p) => p.depth) ?? []),
      );
    const planX = plan.map((p) => p[0]);
    const planY = plan.map((p) => p[1]);
    const corners: Vec3[] = [
      Math.min(...planX) - reach("west"),
      Math.max(...planX) + reach("east"),
    ].flatMap((x) =>
      [
        Math.min(...planY) - reach("south"),
        Math.max(...planY) + reach("north"),
      ].flatMap((y) => [toScene(x, y, 0), toScene(x, y, zMax)]),
    );
    return {
      center: toScene(xMid, yMid, zMax * 0.45),
      size: Math.max(Math.hypot(width, depth), height),
      width,
      depth,
      height,
      front: frontOf(model, xMid),
      corners,
      zMin,
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

  // 地面は設計GLのあたり。透かしのときだけ、杭や基礎が見えるよう下げる
  const groundLevel = xray ? frame.zMin - 100 : -40;
  const start = useMemo(() => viewPosition("oblique", frame), [frame]);

  // 日当たりを見せないときの光。カメラ側の斜め上から正面を照らす
  const light = sun ?? {
    x: frame.front[0] * 0.5 + frame.front[1] * 0.45,
    y: -(frame.front[1] * 0.5 - frame.front[0] * 0.45),
    z: 0.72,
  };

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
      frameloop="demand"
      dpr={onCapture ? 2 : [1, 1.5]}
      shadows={{ type: PCFShadowMap, autoUpdate: false }}
      gl={{ toneMapping: ACESFilmicToneMapping, toneMappingExposure: 0.82 }}
      camera={{ fov: shot?.fov ?? FOV, near: 0.1, far: 2500, position: start }}
      onPointerMissed={() => onSelect(null)}
    >
      <SkySetup />
      {onCapture && <Capture onCapture={onCapture} />}
      <fog attach="fog" args={[HORIZON, frame.size * 7, frame.size * 26]} />
      <hemisphereLight args={["#D3E3F4", "#8E9093", sun && sun.z <= 0 ? 0.2 : 0.45]} />
      <SunLight direction={light} frame={frame} />
      <ShadowUpdater
        stamp={[display, topFloorIndex, highlighted.size, light.x, light.y, light.z].join()}
      />
      <OrbitControls
        makeDefault
        target={frame.center}
        enableDamping
      />
      <CameraRig
        shot={shot}
        view={view}
        frame={frame}
        focus={focus}
        insetLeft={insetLeft}
        underground={xray}
        looksInside={
          !compact &&
          Boolean(model.architecture) &&
          (display === "noRoof" || topFloorIndex < floors.length - 1)
        }
      />
      <mesh
        position={[frame.center[0], groundLevel * MM, frame.center[2]]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        raycast={NO_RAYCAST}
      >
        <circleGeometry args={[frame.size * 30, 64]} />
        <meshStandardMaterial color={GROUND_COLOR} roughness={0.95} metalness={0} />
      </mesh>
      {!compact && display !== "normal" && (
        <GridLines model={model} level={groundLevel + 30} />
      )}
      {visible.map((m) => {
        const key = memberKey(m);
        return (
          <MemberMesh
            key={key}
            member={m}
            materialKey={memberMaterial(model.structure, model.name, m.type)}
            selected={m === selected}
            glow={highlighted.has(key) ? highlightColor : undefined}
            ghost={xray}
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
            {showChecks && room.status === "要確認" && <small>要確認</small>}
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
