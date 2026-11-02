import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import BuildingViewer, { type Building } from "@/components/BuildingViewer";
import type { CheckResult, EvalReport, HumanItem, RunStats } from "@/lib/check";
import type { BuildingModel } from "@/lib/model";
import report from "@/demo-data/sample-x/eval-report.json";
import result from "@/demo-data/sample-x/check-result.json";
import human from "@/demo-data/sample-x/human-compare.json";
import stats from "@/demo-data/sample-x/run-stats.json";
import sampleA from "@/demo-data/sample-x/model.json";

// 公開の確認が取れていない物件。git管理外のフォルダにあるときだけ、開発中の手元の画面に出す。
// 本番のビルドには入れない
function privateBuildings(): Building[] {
  if (process.env.NODE_ENV !== "development") return [];
  const file = path.join(
    process.cwd(),
    "demo-data-private/sample-b/model.json",
  );
  if (!existsSync(file)) return [];
  return [{ model: JSON.parse(readFileSync(file, "utf8")) as BuildingModel }];
}

export default function Home() {
  return (
    <BuildingViewer
      buildings={[
        {
          model: sampleA as BuildingModel,
          check: {
            result: result as CheckResult,
            report: report as EvalReport,
            stats: stats as RunStats,
            humanItems: human.items as HumanItem[],
          },
        },
        ...privateBuildings(),
      ]}
    />
  );
}
