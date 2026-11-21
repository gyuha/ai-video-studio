import type { Caption, Graph, GraphEdge, GraphNode, Plan } from "./schema.ts";

const COL = 340;
const ROW = 400;

/** 기획 → plan 1 + (image, video) × 장면 수 + edit 1 + motion 1 그래프. plan 노드는 이미 완료 상태로 만든다. */
export function buildGraphFromPlan(plan: Plan, prompt = ""): Graph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const link = (source: string, target: string) => edges.push({ id: `${source}->${target}`, source, target });
  const midY = ((plan.scenes.length - 1) * ROW) / 2;

  nodes.push({ id: "plan", type: "plan", position: { x: 0, y: midY }, status: "done", data: { prompt }, output: { plan } });

  const captions: Caption[] = [];
  let t = 0;
  plan.scenes.forEach((scene, i) => {
    const n = i + 1;
    nodes.push({ id: `image-${n}`, type: "image", position: { x: COL, y: i * ROW }, status: "idle", data: { imagePrompt: scene.imagePrompt } });
    nodes.push({ id: `video-${n}`, type: "video", position: { x: COL * 2, y: i * ROW }, status: "idle", data: { durationSec: scene.durationSec } });
    link("plan", `image-${n}`);
    link(`image-${n}`, `video-${n}`);
    link(`video-${n}`, "edit");
    captions.push({ text: scene.caption, startSec: t, endSec: t + scene.durationSec });
    t += scene.durationSec;
  });

  nodes.push({ id: "edit", type: "edit", position: { x: COL * 3, y: midY }, status: "idle", data: {} });
  nodes.push({ id: "motion", type: "motion", position: { x: COL * 4, y: midY }, status: "idle", data: { captions } });
  link("edit", "motion");
  return { nodes, edges };
}
