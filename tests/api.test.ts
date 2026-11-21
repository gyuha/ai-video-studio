import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../server/app.ts";
import { selectProviders } from "../server/providers/index.ts";
import { createService } from "../server/service.ts";
import type { Graph } from "../shared/schema.ts";

type State = { graph: Graph; running: boolean };
const json = (body: unknown, method = "POST") => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

async function setup() {
  const dataDir = await mkdtemp(join(tmpdir(), "avs-api-"));
  const app = createApp(createService(dataDir, selectProviders("mock")));
  const state = async () => (await (await app.request("/api/graph")).json()) as State;
  const settle = async () => {
    let s = await state();
    while (s.running) {
      await new Promise((r) => setTimeout(r, 100));
      s = await state();
    }
    return s;
  };
  return { app, dataDir, state, settle };
}

describe("HTTP API (mock 모드, ffmpeg는 실제 실행)", () => {
  it("에이전트 → 전체 실행 → 최종 mp4 제공", async () => {
    const { app, dataDir, settle } = await setup();

    expect((await app.request("/api/agent", json({ prompt: " " }))).status).toBe(400);
    const made = (await (await app.request("/api/agent", json({ prompt: "겨울 카페 홍보 영상" }))).json()) as State;
    expect(made.graph.nodes).toHaveLength(9);
    expect(made.graph.nodes.find((n) => n.type === "plan")).toMatchObject({ status: "done", data: { prompt: "겨울 카페 홍보 영상" } });

    const run = await app.request("/api/run", { method: "POST" });
    expect(run.status).toBe(202);
    expect((await app.request("/api/run", { method: "POST" })).status).toBe(409); // 실행 중 중복 요청
    expect((await app.request("/api/graph", json(made.graph, "PUT"))).status).toBe(409); // 실행 중 수정

    const done = await settle();
    expect(done.graph.nodes.map((n) => [n.id, n.status, n.error]).filter(([, s]) => s !== "done")).toEqual([]);

    const file = await app.request("/files/motion.mp4");
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("video/mp4");
    expect((await file.arrayBuffer()).byteLength).toBeGreaterThan(10_000);
    expect((await app.request("/files/image-1.png")).headers.get("content-type")).toBe("image/png");
    expect((await app.request("/files/nope.mp4")).status).toBe(404);
    expect((await app.request("/files/graph.json")).status).toBe(404);

    // 저장된 그래프는 서비스를 새로 만들어도 유지된다
    const again = createApp(createService(dataDir, selectProviders("mock")));
    const kept = (await (await again.request("/api/graph")).json()) as State;
    expect(kept.graph.nodes.every((n) => n.status === "done")).toBe(true);
  }, 120_000);

  it("그래프 수정 저장, 형식 검증, 단일 노드 실행", async () => {
    const { app, state, settle } = await setup();
    const { graph } = (await (await app.request("/api/agent", json({ prompt: "테스트" }))).json()) as State;

    expect((await app.request("/api/graph", json({ nodes: [{ id: "x" }], edges: [] }, "PUT"))).status).toBe(400);
    const node = graph.nodes.find((n) => n.id === "image-1")!;
    if (node.type === "image") node.data.imagePrompt = "바뀐 프롬프트";
    expect((await app.request("/api/graph", json(graph, "PUT"))).status).toBe(200);
    expect((await state()).graph.nodes.find((n) => n.id === "image-1")).toMatchObject({ data: { imagePrompt: "바뀐 프롬프트" } });

    expect((await app.request("/api/run/image-1", { method: "POST" })).status).toBe(202);
    const after = await settle();
    expect(after.graph.nodes.find((n) => n.id === "image-1")!.status).toBe("done");
    expect(after.graph.nodes.find((n) => n.id === "image-2")!.status).toBe("idle");

    // 상위(image-2)가 끝나지 않은 노드를 실행하면 오류 상태가 된다
    await app.request("/api/run/video-2", { method: "POST" });
    expect((await settle()).graph.nodes.find((n) => n.id === "video-2")).toMatchObject({ status: "error" });
    expect((await app.request("/api/run/ghost", { method: "POST" })).status).toBe(500);
  }, 60_000);
});
