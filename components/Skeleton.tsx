// 読み込み中の表示。待ち時間も整って見えるように、灰色の棒を並べる
export default function Skeleton() {
  return (
    <div className="skeleton" role="status" aria-label="読み込み中">
      <i />
      <i />
      <i />
      <i />
      <i />
      <i />
    </div>
  );
}
