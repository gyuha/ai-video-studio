import { access, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../server/app.ts";
import { selectProviders } from "../server/providers/index.ts";
import { MOCK_PLAN } from "../server/providers/mock.ts";
import { createService } from "../server/service.ts";
import { buildGraphFromPlan } from "../shared/buildGraph.ts";
import type { Graph } from "../shared/schema.ts";

/** 모든 노드가 완료되고 산출 파일이 실제로 있는 워크플로우를 가진 데이터 폴더를 만든다. */
async function doneWorkspace(): Promise<{ dataDir: string; filesDir: string; graph: Graph }> {
  const dataDir = await mkdtemp(join(tmpdir(), "avs-workflow-"));
  const filesDir = join(dataDir, "files");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(filesDir, { recursive: true });
  const graph = buildGraphFromPlan(MOCK_PLAN);
  for (const n of graph.nodes) {
    if (n.type === "plan") continue;
    n.status = "done";
    const ext = n.type === "image" ? "png" : "mp4";
    n.output = { path: join(filesDir, `${n.id}.${ext}`) };
    await writeFile(n.output.path!, n.id);
  }
  await writeFile(join(dataDir, "graph.json"), JSON.stringify(graph));
  return { dataDir, filesDir, graph };
}

describe("새 워크플로우: 기존 것을 보관하고 빈 캔버스로 시작", () => {
  it("그래프와 산출 파일을 보관 폴더로 옮기고, 보관본의 경로도 그 안을 가리킨다", async () => {
    const { dataDir, filesDir } = await doneWorkspace();
    const service = createService(dataDir, selectProviders("mock"));

    service.newWorkflow();

    expect(service.state().graph).toEqual({ nodes: [], edges: [] });
    const [archiveName] = await readdir(join(dataDir, "workflows"));
    expect(archiveName).toMatch(/^\d{8}-\d{6}$/);

    const archiveDir = join(dataDir, "workflows", archiveName);
    const archived = JSON.parse(await readFile(join(archiveDir, "graph.json"), "utf8")) as Graph;
    const image = archived.nodes.find((n) => n.id === "image-1")!;
    expect(image.output?.path).toBe(join(archiveDir, "files", "image-1.png"));
    await expect(access(image.output!.path!)).resolves.toBeUndefined();

    // 원래 자리의 파일은 옮겨졌고, 새 산출 폴더는 비어 있다
    await expect(access(join(filesDir, "image-1.png"))).rejects.toThrow();
    expect(await readdir(service.filesDir)).toEqual([]);
  });

  it("빈 워크플로우는 보관하지 않는다", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "avs-workflow-empty-"));
    const service = createService(dataDir, selectProviders("mock"));
    service.newWorkflow();
    await expect(access(join(dataDir, "workflows"))).rejects.toThrow();
  });

  it("두 번 연속 보관해도 폴더 이름이 겹치지 않는다", async () => {
    const { dataDir } = await doneWorkspace();
    const service = createService(dataDir, selectProviders("mock"));
    service.newWorkflow();
    service.setGraph(buildGraphFromPlan(MOCK_PLAN));
    service.newWorkflow();
    expect(await readdir(join(dataDir, "workflows"))).toHaveLength(2);
  });

  it("HTTP: POST /api/workflow/new는 빈 그래프를 돌려준다", async () => {
    const { dataDir } = await doneWorkspace();
    const app = createApp(createService(dataDir, selectProviders("mock")));
    const res = await app.request("/api/workflow/new", { method: "POST" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { graph: Graph }).graph.nodes).toEqual([]);
  });
});
