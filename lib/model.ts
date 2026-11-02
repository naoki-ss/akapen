// 建物モデルの型。座標はすべて mm（x, y は平面、z は高さ。1FSL が 0）

type MemberBase = {
  mark: string;
  grid: string;
  floor: string;
};

export type ColumnMember = MemberBase & {
  type: "column";
  x: number;
  y: number;
  z0: number;
  z1: number;
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
  z: number;
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

export type BuildingModel = {
  name: string;
  source: string;
  grid_x: Record<string, number>;
  grid_y: Record<string, number>;
  levels: Record<string, number>;
  members: Member[];
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
