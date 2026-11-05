// 施工図のページと、部材からページを引く索引の型。demo-data/*/sheets.json に対応する

export type Box = [number, number, number, number];

export type Sheet = {
  id: string;
  doc: string;
  page: number;
  title: string;
  image: string;
  width: number;
  height: number;
  note?: string;
  // アップロードの判定：朱書きのない図面と、種類ごとの透明な朱書き（重ねて表示する）
  base_image?: string;
  layers?: { key: LayerKey; image: string }[];
};

export type LayerKey = "design" | "minutes" | "knowledge";

export const LAYER_LABELS: Record<LayerKey, string> = {
  design: "設計図書",
  minutes: "議事録",
  knowledge: "ナレッジ",
};

export const ALL_LAYERS: LayerKey[] = ["design", "minutes", "knowledge"];

export type MemberSheetRef = {
  sheet: string;
  reason: string;
  bbox?: Box;
};

export type SheetIndex = {
  sheets: Sheet[];
  // キーは memberKey
  member_sheets: Record<string, MemberSheetRef[]>;
  // 索引がない部材に出す説明
  empty_note: string;
};

// ビューアに渡す、開くページと赤枠
export type SheetTarget = {
  sheet: Sheet;
  base: string;
  bbox?: Box;
  label?: string;
};

// 図名を比べる形。縮尺と記号と空白の違いは同じとみなす（drawing_ledger.py の title_key と同じ）
export const titleKey = (title: string) =>
  title
    .normalize("NFKC")
    .replace(/\d+\/\d+/g, "")
    .replace(/[\s\-‐－ー・･_]/g, "");
