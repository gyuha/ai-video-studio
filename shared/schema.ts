import { z } from "zod";

export const NODE_TYPES = ["plan", "image", "video", "edit", "motion"] as const;
export type NodeType = (typeof NODE_TYPES)[number];

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
  output: z.object({ path: z.string().optional(), plan: PlanSchema.optional() }).optional(),
  error: z.string().optional(),
};

export const NodeSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("plan"), data: z.object({ prompt: z.string() }) }),
  z.object({ ...base, type: z.literal("image"), data: z.object({ imagePrompt: z.string() }) }),
  z.object({ ...base, type: z.literal("video"), data: z.object({ durationSec: z.number().positive().max(30) }) }),
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
