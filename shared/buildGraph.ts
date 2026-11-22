import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL, type Caption, type Graph, type GraphEdge, type GraphNode, type Plan } from "./schema.ts";

const COL = 340;
const ROW = 400;

export interface ModelChoice {
  image: string;
  video: string;
}

/** 기획 → plan 1 + (image, video) × 장면 수 + edit 1 + motion 1 그래프. plan 노드는 이미 완료 상태로 만든다. 모델을 주지 않으면 기본값을 쓴다. */
export function buildGraphFromPlan(plan: Plan, prompt = "", models: ModelChoice = { image: DEFAULT_IMAGE_MODEL, video: DEFAULT_VIDEO_MODEL }): Graph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const link = (source: string, target: string) => edges.push({ id: `${source}->${target}`, source, target });
  const midY = ((plan.scenes.length - 1) * ROW) / 2;

  nodes.push({ id: "plan", type: "plan", position: { x: 0, y: midY }, status: "done", data: { prompt }, output: { plan } });

  const captions: Caption[] = [];
  let t = 0;
  plan.scenes.forEach((scene, i) => {
    const n = i + 1;
    nodes.push({ id: `image-${n}`, type: "image", position: { x: COL, y: i * ROW }, status: "idle", data: { imagePrompt: scene.imagePrompt, model: models.image } });
    nodes.push({ id: `video-${n}`, type: "video", position: { x: COL * 2, y: i * ROW }, status: "idle", data: { durationSec: scene.durationSec, model: models.video } });
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
