import BuildingViewer from "@/components/BuildingViewer";
import type { CheckResult, EvalReport, HumanItem } from "@/lib/check";
import type { BuildingModel } from "@/lib/model";
import report from "@/demo-data/sample-x/eval-report.json";
import result from "@/demo-data/sample-x/check-result.json";
import human from "@/demo-data/sample-x/human-compare.json";
import sampleA from "@/demo-data/sample-x/model.json";

export default function Home() {
  return (
    <BuildingViewer
      model={sampleA as BuildingModel}
      result={result as CheckResult}
      report={report as EvalReport}
      humanItems={human.items as HumanItem[]}
    />
  );
}
