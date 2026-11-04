// 建物モデルの型。座標はすべて mm（x, y は平面、z は高さ。1FSL が 0）

type MemberBase = {
  mark: string;
  grid: string;
  floor: string;
  // 部材リストから読んだ断面の表記
  section?: string;
};

export type ColumnMember = MemberBase & {
  type: "column";
  x: number;
  y: number;
  z0: number;
  z1: number;
  width?: number;
};

export type PileMember = MemberBase & {
  type: "pile";
  x: number;
  y: number;
  z0: number;
  z1: number;
  radius?: number;
};

export type BeamMember = MemberBase & {
  type: "beam";
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  // 梁天端の高さ。勾配のある梁は z が始点、z1 が終点
  z: number;
  z1?: number;
  width?: number;
  depth?: number;
};

export type WallMember = MemberBase & {
  type: "wall";
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  z0: number;
  z1: number;
};

export type SlabMember = MemberBase & {
  type: "slab";
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  z: number;
  thickness?: number;
};

// 同じ部材を指すキー。指摘の model_refs と突き合わせる
export const memberKey = (m: Member) => `${m.type}|${m.floor}|${m.grid}`;

export type Member =
  | ColumnMember
  | PileMember
  | BeamMember
  | WallMember
  | SlabMember;

export type MemberType = Member["type"];

// 部材の中心（mm）。x, y は平面、z は高さ
export function memberCenter(m: Member): [number, number, number] {
  switch (m.type) {
    case "column":
    case "pile":
      return [m.x, m.y, (m.z0 + m.z1) / 2];
    case "beam":
      return [(m.x0 + m.x1) / 2, (m.y0 + m.y1) / 2, (m.z + (m.z1 ?? m.z)) / 2];
    case "wall":
      return [(m.x0 + m.x1) / 2, (m.y0 + m.y1) / 2, (m.z0 + m.z1) / 2];
    case "slab":
      return [(m.x0 + m.x1) / 2, (m.y0 + m.y1) / 2, m.z];
  }
}

// 意匠図から読んだ外観と部屋（物件Bのみ）。座標は mm
export type ArchOpening = {
  side: "north" | "south" | "east" | "west";
  kind: string;
  fixed: number;
  from: number;
  to: number;
  along: "x" | "y";
  z0: number;
  z1: number;
};

export type ArchRoom = {
  name: string;
  area_m2: number | null;
  x: number;
  y: number;
  status: string;
};

export type ArchFloor = {
  floor: string;
  z0: number;
  z1: number;
  outline: [number, number][];
  openings: ArchOpening[];
  rooms: ArchRoom[];
};

export type Architecture = {
  floors: ArchFloor[];
  roofs: { floor: string; z: number; outline: [number, number][] }[];
  checks: { kind: string; result: string; message: string }[];
  source: string;
};

export type BuildingModel = {
  name: string;
  source: string;
  grid_x: Record<string, number>;
  grid_y: Record<string, number>;
  levels: Record<string, number>;
  // 下から順の階名。省略すると FLOORS を使う
  floors?: string[];
  members: Member[];
  architecture?: Architecture;
  // 建設地の代表点と、図面の上が真北から時計回りに何度か
  site?: { lat: number; lon: number; north_deg: number };
};

export const TYPE_LABELS: Record<MemberType, string> = {
  column: "柱",
  beam: "梁",
  wall: "壁",
  slab: "スラブ",
  pile: "杭",
};

// 下から順の階名。階スライダーと表示判定に使う
export const FLOORS = [
  "基礎",
  "1F",
  "2F",
  "3F",
  "4F",
  "5F",
  "6F",
  "7F",
  "8F",
  "9F",
  "10F",
  "RF",
];

export const floorsOf = (model: BuildingModel) => model.floors ?? FLOORS;

// 試作からの仮の寸法。柱リスト・梁リストから取れるようになったら部材ごとの値に置き換える
export const PROVISIONAL_SIZE = {
  column: 800,
  beamWidth: 450,
  beamDepth: 700,
  foundationBeamDepth: 2000,
  wallThickness: 200,
  slabThickness: 150,
  pileRadius: 750,
};
