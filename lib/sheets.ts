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
};

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
