// 費用の表示。記録と上限での自動停止は裏で動く。画面に出すのは開発で確かめるときだけ（既定は出さない）
export const showCost = process.env.NEXT_PUBLIC_SEKOZU_SHOW_COST === "1";
