"use client";

import { Line, OrbitControls } from "@react-three/drei";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { CanvasTexture } from "three";
import {
  floorsOf,
  memberKey,
  PROVISIONAL_SIZE as SIZE,
  type BuildingModel,
  type Member,
  type MemberType,
} from "@/lib/model";

const MM = 0.001;
const GRID_LEVEL = -2000;
const RED = "#C62D23";
// カメラの距離の基準にする建物の大きさ（mm）
const CAMERA_BASE_SIZE = 45000;

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
  onSelect,
}: {
  member: Member;
  selected: boolean;
  onSelect: (member: Member) => void;
}) {
  const shape = useMemo(() => shapeOf(member), [member]);
  const opacity = OPACITY[member.type];

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    // 手前の部材だけを選ぶ。ドラッグで回転した直後のクリックは無視する
    e.stopPropagation();
    if (e.delta <= 5) onSelect(member);
  };

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
      {selected ? (
        <meshStandardMaterial key="selected" color={RED} emissive="#5a1006" />
      ) : (
        // 透明と不透明の切り替えを確実に反映するため、key で作り直す
        <meshStandardMaterial
          key="normal"
          color={COLORS[member.type]}
          transparent={opacity !== undefined}
          opacity={opacity ?? 1}
        />
      )}
    </mesh>
  );
}

// 丸囲みの通り芯符号。外部フォントに頼らないよう canvas に描いて貼る
function GridLabel({ name, position }: { name: string; position: Vec3 }) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    ctx.strokeStyle = ctx.fillStyle = RED;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(64, 64, 56, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = "bold 52px sans-serif";
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

function GridLines({ model }: { model: BuildingModel }) {
  const xs = Object.entries(model.grid_x);
  const ys = Object.entries(model.grid_y);
  const xMax = Math.max(...xs.map(([, v]) => v));
  const yMax = Math.max(...ys.map(([, v]) => v));
  const line = (a: Vec3, b: Vec3) => (
    <Line points={[a, b]} color={RED} dashed dashSize={0.6} gapSize={0.3} />
  );

  return (
    <group>
      {xs.map(([name, v]) => (
        <group key={name}>
          {line(
            toScene(v, -4000, GRID_LEVEL),
            toScene(v, yMax + 3000, GRID_LEVEL),
          )}
          <GridLabel name={name} position={toScene(v, -5200, GRID_LEVEL)} />
        </group>
      ))}
      {ys.map(([name, v]) => (
        <group key={name}>
          {line(
            toScene(-3000, v, GRID_LEVEL),
            toScene(xMax + 3000, v, GRID_LEVEL),
          )}
          <GridLabel name={name} position={toScene(-4200, v, GRID_LEVEL)} />
        </group>
      ))}
    </group>
  );
}

export type SceneProps = {
  model: BuildingModel;
  topFloorIndex: number;
  hiddenTypes: ReadonlySet<MemberType>;
  selected: Member | null;
  highlighted: ReadonlySet<string>;
  onSelect: (member: Member | null) => void;
};

export default function BuildingScene({
  model,
  topFloorIndex,
  hiddenTypes,
  selected,
  highlighted,
  onSelect,
}: SceneProps) {
  const floors = floorsOf(model);
  const visible = model.members.filter(
    (m) =>
      floors.indexOf(m.floor) <= topFloorIndex && !hiddenTypes.has(m.type),
  );

  const xMax = Math.max(...Object.values(model.grid_x));
  const yMax = Math.max(...Object.values(model.grid_y));
  // 一番下の部材から屋上までの中央を見る。建物の大きさに合わせて引く
  const heights = model.members.flatMap((m) =>
    m.type === "beam"
      ? [m.z, m.z1 ?? m.z]
      : "z" in m
        ? [m.z]
        : [m.z0, m.z1],
  );
  const zMin = Math.min(...heights);
  const zMax = Math.max(...heights);
  const target = toScene(xMax / 2, yMax / 2, (zMin + zMax) / 2);
  // 高い建物は高さで、平たい建物は平面の対角で距離を決める
  const zoom =
    Math.max(1.15 * Math.hypot(xMax, yMax), zMax - zMin) / CAMERA_BASE_SIZE;
  const cameraPosition: Vec3 = [
    target[0] + 50 * zoom,
    target[1] + 14 * zoom,
    target[2] + 54 * zoom,
  ];

  return (
    <Canvas
      camera={{ fov: 40, near: 0.1, far: 1000, position: cameraPosition }}
      onPointerMissed={() => onSelect(null)}
    >
      <color attach="background" args={["#F6F4EE"]} />
      <hemisphereLight args={["#ffffff", "#b8b4a8", 1.1]} />
      <directionalLight position={[30, 50, 20]} intensity={1.2} />
      <OrbitControls makeDefault target={target} enableDamping />
      <GridLines model={model} />
      {visible.map((m) => (
        <MemberMesh
          key={memberKey(m)}
          member={m}
          selected={m === selected || highlighted.has(memberKey(m))}
          onSelect={onSelect}
        />
      ))}
    </Canvas>
  );
}
