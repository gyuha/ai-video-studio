import { z } from "zod";
import models from "./models.json" with { type: "json" };

export const NODE_TYPES = ["plan", "image", "video", "edit", "motion"] as const;
export type NodeType = (typeof NODE_TYPES)[number];

// 이미지·영상 모델 목록은 shared/models.json이 단일 출처다. 기본값은 기존 동작(codex, ffmpeg 줌)과 같다.
export const DEFAULT_IMAGE_MODEL = "codex";
export const DEFAULT_VIDEO_MODEL = "ffmpeg-zoom";
const IMAGE_MODEL_IDS = models.image.map((m) => m.id);
const VIDEO_MODEL_IDS = models.video.map((m) => m.id);
export interface ModelEntry {
  id: string;
  label: string;
  connected: boolean;
  /** 어느 엔진이 실행하는지. drawthings면 file(드로우띵 모델 파일 이름)을 보낸다. */
  engine: "codex" | "ffmpeg" | "drawthings";
  file: string;
  costLabel: string;
  unit: string;
}
export const MODEL_CATALOG = models as { image: ModelEntry[]; video: ModelEntry[] };
/** 실제로 실행할 수 있는 모델만. 선택 목록에는 이것만 보인다. */
export const CONNECTED_OPTIONS = {
  image: MODEL_CATALOG.image.filter((m) => m.connected),
  video: MODEL_CATALOG.video.filter((m) => m.connected),
};
export function findModel(id: string): ModelEntry | undefined {
  return [...MODEL_CATALOG.image, ...MODEL_CATALOG.video].find((m) => m.id === id);
}
export function isConnectedModel(id: string): boolean {
  return findModel(id)?.connected ?? false;
}
export const ImageModelSchema = z.string().refine((v) => IMAGE_MODEL_IDS.includes(v), { message: "지원하지 않는 이미지 모델입니다" });
export const VideoModelSchema = z.string().refine((v) => VIDEO_MODEL_IDS.includes(v), { message: "지원하지 않는 영상 모델입니다" });

export const SceneSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  imagePrompt: z.string().min(1),
  caption: z.string().min(1),
  durationSec: z.number().positive().max(30),
});
export type Scene = z.infer<typeof SceneSchema>;

export const PlanSchema = z.object({
  title: z.string().min(1),
  scenes: z.array(SceneSchema).min(1),
});
export type Plan = z.infer<typeof PlanSchema>;

export const CaptionSchema = z.object({
  text: z.string(),
  startSec: z.number().min(0),
  endSec: z.number().positive(),
});
export type Caption = z.infer<typeof CaptionSchema>;

const base = {
  id: z.string().min(1),
  position: z.object({ x: z.number(), y: z.number() }),
  status: z.enum(["idle", "running", "done", "error"]),
  // plan 노드는 plan을, 나머지 노드는 산출 파일 경로를 남긴다.
  // note는 결과에 대한 안내(예: 영상 정지 구간)다.
  output: z.object({ path: z.string().optional(), plan: PlanSchema.optional(), note: z.string().optional() }).optional(),
  error: z.string().optional(),
};

export const NodeSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("plan"), data: z.object({ prompt: z.string() }) }),
  z.object({ ...base, type: z.literal("image"), data: z.object({ imagePrompt: z.string(), model: ImageModelSchema.default(DEFAULT_IMAGE_MODEL) }) }),
  z.object({ ...base, type: z.literal("video"), data: z.object({ durationSec: z.number().positive().max(30), model: VideoModelSchema.default(DEFAULT_VIDEO_MODEL) }) }),
  z.object({ ...base, type: z.literal("edit"), data: z.object({}) }),
  z.object({ ...base, type: z.literal("motion"), data: z.object({ captions: z.array(CaptionSchema) }) }),
]);
export type GraphNode = z.infer<typeof NodeSchema>;

export const EdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
});
export type GraphEdge = z.infer<typeof EdgeSchema>;

export const GraphSchema = z.object({
  nodes: z.array(NodeSchema),
  edges: z.array(EdgeSchema),
});
export type Graph = z.infer<typeof GraphSchema>;
