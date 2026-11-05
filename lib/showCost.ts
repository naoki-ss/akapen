// 費用の表示。記録と上限での自動停止は裏で動く。画面に出すのは開発で確かめるときだけ（既定は出さない）
export const showCost = process.env.NEXT_PUBLIC_SEKOZU_SHOW_COST === "1";

// 読み取りの要確認の一覧。開発で確かめるときだけ出す（既定は出さない）
export const showChecks = process.env.NEXT_PUBLIC_SEKOZU_SHOW_CHECKS === "1";
