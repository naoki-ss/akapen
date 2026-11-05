// 素材の種類ごとの色と質感の対応表。物件ごとに色を手で決めない。
// 種類は図面の仕上げの文字から決める（scripts/check/architecture_read.py の MATERIAL_RULES）

export type Pattern = "ribs" | "lap" | "joints" | "tile" | "grating" | "board" | "folded";

export type MaterialSpec = {
  label: string;
  color: string;
  metalness: number;
  roughness: number;
  // 模様と、その1枚の大きさ（m）
  pattern?: Pattern;
  tile?: number;
};

export const MATERIALS: Record<string, MaterialSpec> = {
  aluminum_curtain_wall: { label: "アルミカーテンウォール", color: "#C9CDD0", metalness: 0.85, roughness: 0.35 },
  aluminum_panel: { label: "アルミパネル", color: "#B9BEC2", metalness: 0.8, roughness: 0.42 },
  aluminum_cap: { label: "アルミ笠木", color: "#C4C8CB", metalness: 0.85, roughness: 0.38 },
  metal_louver: { label: "金属ルーバー・鋼板パネル", color: "#7E858B", metalness: 0.7, roughness: 0.5, pattern: "ribs", tile: 0.35 },
  metal_roof: { label: "金属屋根", color: "#8A8F92", metalness: 0.6, roughness: 0.55, pattern: "folded", tile: 0.6 },
  steel_grating: { label: "鋼製グレーチング", color: "#8F959A", metalness: 0.7, roughness: 0.5, pattern: "grating", tile: 0.5 },
  extruded_cement: { label: "押出成形セメント板", color: "#B8B6B0", metalness: 0, roughness: 0.85, pattern: "joints", tile: 0.6 },
  alc: { label: "ALC", color: "#D2D0C9", metalness: 0, roughness: 0.9, pattern: "joints", tile: 0.6 },
  spray_tile: { label: "吹付タイル", color: "#D9D5CB", metalness: 0, roughness: 0.92 },
  tile: { label: "タイル", color: "#A9A59C", metalness: 0, roughness: 0.7, pattern: "tile", tile: 0.2 },
  concrete: { label: "コンクリート", color: "#B4B2AC", metalness: 0, roughness: 0.88, pattern: "board", tile: 1.8 },
  concrete_light: { label: "コンクリート（壁・床）", color: "#C5C3BC", metalness: 0, roughness: 0.9, pattern: "board", tile: 1.8 },
  concrete_dark: { label: "コンクリート（杭）", color: "#8F8D87", metalness: 0, roughness: 0.92 },
  steel: { label: "鉄骨", color: "#5F6870", metalness: 0.75, roughness: 0.42 },
  steel_deck: { label: "デッキプレート", color: "#90969A", metalness: 0.6, roughness: 0.5, pattern: "folded", tile: 0.3 },
  roof_membrane: { label: "防水屋根", color: "#A8A8A4", metalness: 0, roughness: 0.92 },
  floor_plate: { label: "床", color: "#E4E1D8", metalness: 0, roughness: 0.85 },
  metal_siding: { label: "金属サイディング", color: "#9EA3A6", metalness: 0.55, roughness: 0.5, pattern: "lap", tile: 0.4 },
  siding: { label: "窯業系サイディング", color: "#C9C5BB", metalness: 0, roughness: 0.8, pattern: "lap", tile: 0.9 },
  mortar: { label: "モルタル", color: "#BDBBB4", metalness: 0, roughness: 0.92 },
  painted_wall: { label: "塗装の外壁", color: "#D6D3CB", metalness: 0, roughness: 0.85 },
  // 読めなかったところに使う
  standard_wall: { label: "標準の外壁", color: "#CFCDC6", metalness: 0, roughness: 0.85 },
};

export const GLASS = {
  color: "#86B6D8",
  metalness: 0.95,
  roughness: 0.05,
  opacity: 0.8,
  envMapIntensity: 1.5,
};

export const GROUND_COLOR = "#ABAAA6";

// 構造の種類ごとの標準（意匠図がない物件）
const STRUCTURE_MEMBERS: Record<
  "RC" | "S",
  Record<"column" | "beam" | "wall" | "slab" | "pile", string>
> = {
  RC: {
    column: "concrete",
    beam: "concrete",
    wall: "concrete_light",
    slab: "concrete_light",
    pile: "concrete_dark",
  },
  S: {
    column: "steel",
    beam: "steel",
    wall: "extruded_cement",
    slab: "steel_deck",
    pile: "concrete_dark",
  },
};

export const memberMaterial = (
  structure: string | undefined,
  name: string,
  type: "column" | "beam" | "wall" | "slab" | "pile",
) => {
  const text = structure ?? name;
  // 「RC」があればRC造、「S造」があればS造。分からなければコンクリートにする
  const kind = /S造/.test(text) && !/RC|SRC/.test(text) ? "S" : "RC";
  return STRUCTURE_MEMBERS[kind][type];
};
