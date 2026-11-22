import { copyFile, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runGraph, runNode, topoLevels } from "../server/engine/runGraph.ts";
import { selectProviders } from "../server/providers/index.ts";
import { MOCK_PLAN } from "../server/providers/mock.ts";
import type { Providers } from "../server/providers/types.ts";
import { buildGraphFromPlan } from "../shared/buildGraph.ts";
import { estimateCost, estimateGraphCost } from "../shared/cost.ts";
import { GraphSchema, NODE_TYPES, PlanSchema } from "../shared/schema.ts";

const outDir = () => mkdtemp(join(tmpdir(), "avs-"));

/** 외부 호출 없이 인터페이스만 만족하는 엔진 테스트용 프로바이더. */
const mockProviders: Providers = {
  plan: async () => MOCK_PLAN,
  image: (imagePrompt, outPath) => writeFile(outPath, `mock image: ${imagePrompt}`),
  drawthingsImage: (_file, imagePrompt, outPath) => writeFile(outPath, `mock image: ${imagePrompt}`),
  drawthingsVideo: async (_file, _prompt, _sec, outPath) => {
    await writeFile(outPath, "mock video");
    return undefined;
  },
  video: (imagePath, _durationSec, outPath) => copyFile(imagePath, outPath),
  edit: (clipPaths, outPath) => writeFile(outPath, clipPaths.join("\n")),
  motion: (videoPath, _captions, outPath) => copyFile(videoPath, outPath),
};

describe("기획 스키마", () => {
  it("올바른 기획을 받아들인다", () => {
    expect(PlanSchema.safeParse(MOCK_PLAN).success).toBe(true);
  });
  it("장면이 0개면 거부한다", () => {
    expect(PlanSchema.safeParse({ title: "t", scenes: [] }).success).toBe(false);
  });
  it("imagePrompt가 없으면 거부한다", () => {
    const { imagePrompt: _, ...scene } = MOCK_PLAN.scenes[0];
    expect(PlanSchema.safeParse({ title: "t", scenes: [scene] }).success).toBe(false);
  });
});

describe("buildGraphFromPlan", () => {
  const graph = buildGraphFromPlan(MOCK_PLAN, "겨울 카페 영상");

  it("3장면이면 5종 노드 9개와 엣지 8개 이상을 만든다", () => {
    expect(GraphSchema.safeParse(graph).success).toBe(true);
    expect(graph.nodes).toHaveLength(9);
    expect([...new Set(graph.nodes.map((n) => n.type))].sort()).toEqual([...NODE_TYPES].sort());
    expect(graph.edges.length).toBeGreaterThanOrEqual(8);
  });
  it("plan→image→video→edit→motion 순서로 연결한다", () => {
    const has = (s: string, t: string) => graph.edges.some((e) => e.source === s && e.target === t);
    for (const n of [1, 2, 3]) {
      expect(has("plan", `image-${n}`)).toBe(true);
      expect(has(`image-${n}`, `video-${n}`)).toBe(true);
      expect(has(`video-${n}`, "edit")).toBe(true);
    }
    expect(has("edit", "motion")).toBe(true);
  });
  it("자막 구간이 장면 길이를 따라 이어진다", () => {
    const motion = graph.nodes.find((n) => n.type === "motion")!;
    expect(motion.type === "motion" && motion.data.captions.map((c) => [c.startSec, c.endSec])).toEqual([[0, 3], [3, 6], [6, 9]]);
  });
});

describe("runGraph", () => {
  it("위상 순서로 실행하고 상위 출력을 하위 입력으로 넘긴다", async () => {
    const dir = await outDir();
    const calls: string[] = [];
    const providers: Providers = {
      ...mockProviders,
      image: async (p, out) => { calls.push("image"); await mockProviders.image(p, out); },
      video: async (i, d, out) => { calls.push("video"); await mockProviders.video(i, d, out); },
      edit: async (c, out) => { calls.push("edit"); await mockProviders.edit(c, out); },
      motion: async (v, c, out) => { calls.push("motion"); await mockProviders.motion(v, c, out); },
    };
    const input = buildGraphFromPlan(MOCK_PLAN);
    const updates: number[] = [];
    const result = await runGraph(input, providers, { outDir: dir, onUpdate: (g) => updates.push(g.nodes.filter((n) => n.status === "done").length) });

    expect(calls).toEqual(["image", "image", "image", "video", "video", "video", "edit", "motion"]);
    expect(result.nodes.every((n) => n.status === "done")).toBe(true);
    expect(input.nodes.filter((n) => n.status === "done")).toHaveLength(1); // 입력은 그대로
    expect(updates.at(-1)).toBe(9);
    // edit 입력 = 세 video 출력 경로(장면 순서), motion 출력 = edit 출력의 복사본
    const editOut = await readFile(join(dir, "edit.mp4"), "utf8");
    expect(editOut.split("\n")).toEqual([1, 2, 3].map((n) => join(dir, `video-${n}.mp4`)));
    expect(await readFile(join(dir, "motion.mp4"), "utf8")).toBe(editOut);
    expect(await readFile(join(dir, "video-2.mp4"), "utf8")).toContain(MOCK_PLAN.scenes[1].imagePrompt);
  });

  it("한 노드가 실패하면 그 하위 노드는 실행하지 않는다", async () => {
    const calls: string[] = [];
    const providers: Providers = {
      ...mockProviders,
      image: async (p, out) => { if (p === MOCK_PLAN.scenes[1].imagePrompt) throw new Error("생성 실패"); await mockProviders.image(p, out); },
      edit: async () => { calls.push("edit"); },
      motion: async () => { calls.push("motion"); },
    };
    const result = await runGraph(buildGraphFromPlan(MOCK_PLAN), providers, { outDir: await outDir() });
    const status = Object.fromEntries(result.nodes.map((n) => [n.id, n.status]));

    expect(result.nodes.find((n) => n.id === "image-2")!.error).toBe("생성 실패");
    expect(status).toMatchObject({ "image-1": "done", "video-1": "done", "image-2": "error", "video-2": "error", edit: "error", motion: "error" });
    expect(calls).toEqual([]);
  });

  it("이미 완료된 노드는 다시 실행하지 않고, runNode는 강제로 다시 실행한다", async () => {
    const dir = await outDir();
    let images = 0;
    const providers: Providers = { ...mockProviders, image: async (p, out) => { images++; await mockProviders.image(p, out); } };
    const once = await runGraph(buildGraphFromPlan(MOCK_PLAN), providers, { outDir: dir });
    await runGraph(once, providers, { outDir: dir });
    expect(images).toBe(3);
    const again = await runNode(once, "image-1", providers, { outDir: dir });
    expect(images).toBe(4);
    expect(again.nodes.find((n) => n.id === "image-1")!.status).toBe("done");
  });

  it("순환 그래프는 거부한다", () => {
    const graph = buildGraphFromPlan(MOCK_PLAN);
    graph.edges.push({ id: "loop", source: "motion", target: "image-1" });
    expect(() => topoLevels(graph)).toThrow("순환");
  });
});

describe("비용 추정", () => {
  it("5종 노드 각각의 라벨·금액·단위를 돌려준다", () => {
    expect(estimateCost({ type: "plan" })).toEqual({ label: "구독 · 0원", krw: 0, unit: "Claude 호출 1회" });
    expect(estimateCost({ type: "image" })).toEqual({ label: "구독 · 0원", krw: 0, unit: "Codex 이미지 1장" });
    for (const type of ["video", "edit", "motion"] as const) {
      expect(estimateCost({ type })).toMatchObject({ label: "로컬 · 0원", krw: 0 });
    }
  });
  it("그래프 합계와 단위별 개수를 낸다", () => {
    const total = estimateGraphCost(buildGraphFromPlan(MOCK_PLAN));
    expect(total.krw).toBe(0);
    expect(total.units).toMatchObject({ "Claude 호출 1회": 1, "Codex 이미지 1장": 3, "ffmpeg 모션 클립": 3 });
  });
});

describe("selectProviders", () => {
  it("mock 모드는 구독 CLI 호출(기획·이미지)만 대체한다", async () => {
    const mock = selectProviders("mock");
    const real = selectProviders("real");
    expect(await mock.plan("x")).toEqual(MOCK_PLAN);
    expect(mock.image).not.toBe(real.image);
    expect(mock.video).toBe(real.video);
    expect(mock.motion).toBe(real.motion);
  });
  it("기본값은 real 세트다", () => {
    const saved = process.env.PROVIDER_MODE;
    delete process.env.PROVIDER_MODE;
    try {
      expect(selectProviders()).toBe(selectProviders("real"));
    } finally {
      if (saved !== undefined) process.env.PROVIDER_MODE = saved;
    }
  });
  it("알 수 없는 모드는 거부한다", () => {
    expect(() => selectProviders("nope")).toThrow("PROVIDER_MODE");
  });
});
