import { findModel, type Graph, type NodeType } from "./schema.ts";

export interface Cost {
  label: string;
  krw: number;
  unit: string;
}

// 구독 CLI와 로컬 ffmpeg만 쓰므로 추가 과금은 0원이다. 대신 무엇을 소모하는지(unit)를 보여 준다.
const COSTS: Record<NodeType, Cost> = {
  plan: { label: "구독 · 0원", krw: 0, unit: "Claude 호출 1회" },
  image: { label: "구독 · 0원", krw: 0, unit: "Codex 이미지 1장" },
  video: { label: "로컬 · 0원", krw: 0, unit: "ffmpeg 모션 클립" },
  edit: { label: "로컬 · 0원", krw: 0, unit: "ffmpeg 컷 연결" },
  motion: { label: "로컬 · 0원", krw: 0, unit: "ffmpeg 자막 오버레이" },
};

/** 이미지·영상 노드는 실제 엔진(모델)의 비용·단위를 보여 준다. 그 밖의 노드는 종류별 기본값. */
export function estimateCost(node: { type: NodeType; data?: object }): Cost {
  const picked = (node.data as { model?: unknown } | undefined)?.model;
  const model = (node.type === "image" || node.type === "video") && typeof picked === "string" ? findModel(picked) : undefined;
  if (model) return { label: model.costLabel, krw: 0, unit: model.unit };
  return COSTS[node.type];
}

export function estimateGraphCost(graph: Graph): { krw: number; units: Record<string, number> } {
  const units: Record<string, number> = {};
  let krw = 0;
  for (const node of graph.nodes) {
    const cost = estimateCost(node);
    krw += cost.krw;
    units[cost.unit] = (units[cost.unit] ?? 0) + 1;
  }
  return { krw, units };
}
