// トップの表示の動き（components/SketchIntro.tsx）を、同じ回のうちに再生したかの印
export const PLAYED_KEY = "akapen-intro-played";

// 描く前に本物の画面を隠しておく（読み込み直後に一瞬見えないように）。全体の <head> で、画面が届く前に動かす
// トップ（/）は同じ回のうち1度だけ、動画用の /preview/logo は毎回
export const INTRO_SCRIPT = `(function(){try{var p=location.pathname;if(p!=="/"&&p!=="/preview/logo")return;if(matchMedia("(prefers-reduced-motion: reduce)").matches)return;if(p==="/"&&sessionStorage.getItem("${PLAYED_KEY}")==="1")return;document.documentElement.dataset.intro="pending"}catch(e){}})()`;

// 表示の動きが終わるまで待つ。重い処理（3D のサムネイル）で動きを止めないために使う
export function afterIntro() {
  return new Promise<void>((resolve) => {
    const root = document.documentElement;
    if (!root.dataset.intro) return resolve();
    const observer = new MutationObserver(() => {
      if (root.dataset.intro) return;
      observer.disconnect();
      resolve();
    });
    observer.observe(root, { attributes: true, attributeFilter: ["data-intro"] });
  });
}
