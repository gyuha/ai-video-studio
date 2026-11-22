import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../server/app.ts";
import { runGraph } from "../server/engine/runGraph.ts";
import { selectProviders } from "../server/providers/index.ts";
import { MOCK_PLAN } from "../server/providers/mock.ts";
import type { Providers } from "../server/providers/types.ts";
import { createService } from "../server/service.ts";
import { buildGraphFromPlan } from "../shared/buildGraph.ts";
import { estimateCost } from "../shared/cost.ts";
import { CONNECTED_OPTIONS, GraphSchema, type Graph } from "../shared/schema.ts";

const outDir = () => mkdtemp(join(tmpdir(), "avs-models-"));

/** 호출 횟수를 세는 가짜 프로바이더. 외부 호출 없이 파일만 쓴다. */
function countingProviders() {
  const calls = { image: 0, drawthings: 0, drawthingsVideo: 0, video: 0 };
  const providers: Providers = {
    plan: async () => MOCK_PLAN,
    image: async (_prompt, outPath) => {
      calls.image++;
      await writeFile(outPath, "img");
    },
    drawthingsImage: async (_file, _prompt, outPath) => {
      calls.drawthings++;
      await writeFile(outPath, "dt-img");
    },
    drawthingsVideo: async (_file, _prompt, _sec, outPath) => {
      calls.drawthingsVideo++;
      await writeFile(outPath, "dt-vid");
      return undefined;
    },
    video: async (_in, _sec, outPath) => {
      calls.video++;
      await writeFile(outPath, "vid");
    },
    edit: async (_clips, outPath) => writeFile(outPath, "edit"),
    motion: async (_in, _caps, outPath) => writeFile(outPath, "motion"),
  };
  return { providers, calls };
}

describe("S1: 모델 필드와 기본값", () => {
  it("model이 없는 기존 그래프를 읽으면 image는 codex, video는 ffmpeg-zoom으로 채운다", () => {
    const legacy = JSON.parse(JSON.stringify(buildGraphFromPlan(MOCK_PLAN)));
    for (const node of legacy.nodes) if (node.type === "image" || node.type === "video") delete node.data.model;

    const parsed = GraphSchema.parse(legacy);
    const image = parsed.nodes.find((n) => n.type === "image")!;
    const video = parsed.nodes.find((n) => n.type === "video")!;
    expect(image.type === "image" && image.data.model).toBe("codex");
    expect(video.type === "video" && video.data.model).toBe("ffmpeg-zoom");
  });

  it("shared/models.json 목록에 없는 모델은 거부한다", () => {
    const graph = buildGraphFromPlan(MOCK_PLAN);
    const bad = structuredClone(graph);
    const image = bad.nodes.find((n) => n.type === "image")!;
    if (image.type === "image") image.data.model = "no-such-model";
    expect(GraphSchema.safeParse(bad).success).toBe(false);
  });
});

describe("표시: 미연결 모델은 목록에 없고, 비용 라벨은 실제 엔진을 따른다", () => {
  it("선택 가능한 목록은 연결된 모델만 담는다", () => {
    expect(CONNECTED_OPTIONS.image.map((m) => m.id)).toEqual(["codex", "drawthings-image"]);
    expect(CONNECTED_OPTIONS.video.map((m) => m.id)).toEqual(["ffmpeg-zoom", "drawthings-minimax-h3"]);
  });

  it("비용 라벨은 노드의 모델을 따른다", () => {
    const image = buildGraphFromPlan(MOCK_PLAN).nodes.find((n) => n.id === "image-1")!;
    expect(estimateCost(image).unit).toBe("Codex 이미지 1장");
    if (image.type === "image") image.data.model = "drawthings-image";
    expect(estimateCost(image)).toEqual({ label: "로컬 · 0원", krw: 0, unit: "Draw Things 이미지 1장" });
  });
});

describe("S2: 노드 모델로 엔진 선택, 미연결 모델은 오류로 멈춤", () => {
  it("codex 이미지 노드는 image 프로바이더를 호출한다", async () => {
    const { providers, calls } = countingProviders();
    const result = await runGraph(buildGraphFromPlan(MOCK_PLAN), providers, { outDir: await outDir() });
    expect(calls.image).toBe(3);
    expect(result.nodes.find((n) => n.id === "image-1")!.status).toBe("done");
  });

  it("드로우띵 이미지 노드는 드로우띵 프로바이더를 모델 파일과 함께 호출한다", async () => {
    const { providers, calls } = countingProviders();
    const graph = buildGraphFromPlan(MOCK_PLAN);
    for (const n of graph.nodes) if (n.type === "image" && n.id === "image-1") n.data.model = "drawthings-image";
    const result = await runGraph(graph, providers, { outDir: await outDir() });
    expect(calls.drawthings).toBe(1);
    expect(calls.image).toBe(2);
    expect(result.nodes.find((n) => n.id === "image-1")!.status).toBe("done");
  });

  it("드로우띵 영상 노드는 드로우띵 영상 프로바이더를 호출하고, 프롬프트는 장면 이미지 노드의 것을 쓴다", async () => {
    const { providers, calls } = countingProviders();
    const graph = buildGraphFromPlan(MOCK_PLAN);
    for (const n of graph.nodes) if (n.type === "video" && n.id === "video-1") n.data.model = "drawthings-minimax-h3";
    const prompts: string[] = [];
    const seen = providers.drawthingsVideo;
    providers.drawthingsVideo = async (file, prompt, sec, out) => {
      prompts.push(prompt);
      return seen(file, prompt, sec, out);
    };
    const result = await runGraph(graph, providers, { outDir: await outDir() });
    expect(calls.drawthingsVideo).toBe(1);
    expect(prompts[0]).toBe(MOCK_PLAN.scenes[0].imagePrompt);
    expect(result.nodes.find((n) => n.id === "video-1")!.status).toBe("done");
  });
});

describe("S3: 기획 시 기본 모델 지정", () => {
  it("에이전트가 받은 이미지·영상 모델을 모든 이미지·영상 노드에 기록한다", async () => {
    const app = createApp(createService(await outDir(), selectProviders("mock")));
    const res = await app.request("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "테스트", imageModel: "drawthings-image", videoModel: "drawthings-minimax-h3" }),
    });
    expect(res.status).toBe(200);
    const { graph } = (await res.json()) as { graph: Graph };
    for (const n of graph.nodes) {
      if (n.type === "image") expect(n.data.model).toBe("drawthings-image");
      if (n.type === "video") expect(n.data.model).toBe("drawthings-minimax-h3");
    }
  });

  it("목록에 없는 모델로 기획하면 400을 돌려준다", async () => {
    const app = createApp(createService(await outDir(), selectProviders("mock")));
    const res = await app.request("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "테스트", imageModel: "nope" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("S4: 모델을 바꾸면 그 노드와 뒤 노드를 idle로 되돌리고 파일은 남긴다", () => {
  it("video-1 모델을 바꾸면 video-1, edit, motion만 idle이 되고 파일은 그대로 있다", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "avs-reset-"));
    const filesDir = join(dataDir, "files");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(filesDir, { recursive: true });

    // 모두 완료된 그래프와 그 산출 파일을 미리 만든다
    const graph = buildGraphFromPlan(MOCK_PLAN);
    for (const n of graph.nodes) {
      if (n.type === "plan") continue;
      n.status = "done";
      const ext = n.type === "image" ? "png" : "mp4";
      n.output = { path: join(filesDir, `${n.id}.${ext}`) };
      await writeFile(n.output.path!, n.id);
    }
    await writeFile(join(dataDir, "graph.json"), JSON.stringify(graph));

    const service = createService(dataDir, selectProviders("mock"));
    const next = structuredClone(service.state().graph);
    const video1 = next.nodes.find((n) => n.id === "video-1")!;
    if (video1.type === "video") video1.data.model = "drawthings-minimax-h3";
    service.setGraph(next);

    const after = service.state().graph;
    const status = (id: string) => after.nodes.find((n) => n.id === id)!.status;
    expect(status("video-1")).toBe("idle");
    expect(status("edit")).toBe("idle");
    expect(status("motion")).toBe("idle");
    expect(status("image-1")).toBe("done");
    expect(status("video-2")).toBe("done");
    expect(status("image-2")).toBe("done");

    const kept = after.nodes.find((n) => n.id === "video-1")!;
    expect(kept.output?.path).toBeTruthy();
    const { access } = await import("node:fs/promises");
    await expect(access(kept.output!.path!)).resolves.toBeUndefined();
  });
});
