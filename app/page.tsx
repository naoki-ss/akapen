import BuildingViewer from "@/components/BuildingViewer";
import type { CheckResult, EvalReport, HumanItem, RunStats } from "@/lib/check";
import type { BuildingModel } from "@/lib/model";
import type { SheetIndex } from "@/lib/sheets";
import report from "@/demo-data/sample-x/eval-report.json";
import result from "@/demo-data/sample-x/check-result.json";
import human from "@/demo-data/sample-x/human-compare.json";
import stats from "@/demo-data/sample-x/run-stats.json";
import sampleA from "@/demo-data/sample-x/model.json";
import sheetsA from "@/demo-data/sample-x/sheets.json";
import resultB from "@/demo-data/sample-b/check-result.json";
import humanB from "@/demo-data/sample-b/human-compare.json";
import sampleB from "@/demo-data/sample-b/model.json";
import sheetsB from "@/demo-data/sample-b/sheets.json";

export default function Home() {
  return (
    <BuildingViewer
      buildings={[
        {
          slug: "sample-x",
          model: sampleA as BuildingModel,
          sheets: sheetsA as unknown as SheetIndex,
          check: {
            result: result as CheckResult,
            report: report as EvalReport,
            stats: stats as RunStats,
            humanItems: human.items as HumanItem[],
          },
        },
        {
          slug: "sample-b",
          model: sampleB as BuildingModel,
          sheets: sheetsB as unknown as SheetIndex,
          check: {
            result: resultB as unknown as CheckResult,
            humanItems: humanB.items as unknown as HumanItem[],
            humanLead:
              "実際のチェック図（10/16 第1回）の朱書きを、同じ箇所の朱書き前の図面とAIの指摘に並べています。朱書きの読み取りと、AIが拾えたかの判定はClaude Codeによるもので、現場の確認はまだです。",
          },
        },
      ]}
    />
  );
}
