// mock 모드에서 HTTP API를 통해 에이전트 → 그래프 → 전체 실행을 돌리고 결과를 .e2e-out/에 남긴다.
import { copyFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createApp } from "../server/app.ts";
import { selectProviders } from "../server/providers/index.ts";
import { createService } from "../server/service.ts";
import type { Graph } from "../shared/schema.ts";

const OUT = ".e2e-out";
await rm(OUT, { recursive: true, force: true });
const app = createApp(createService(join(OUT, "data"), selectProviders()));

const call = async (path: string, init?: RequestInit) => {
  const res = await app.request(path, init);
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as { graph: Graph; running: boolean };
};

await call("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "겨울 카페 홍보 영상" }) });
await call("/api/run", { method: "POST" });
let state = await call("/api/graph");
while (state.running) {
  await new Promise((r) => setTimeout(r, 200));
  state = await call("/api/graph");
}

const failed = state.graph.nodes.filter((n) => n.status !== "done");
if (failed.length > 0) throw new Error(`완료되지 않은 노드: ${failed.map((n) => `${n.id}(${n.error ?? n.status})`).join(", ")}`);
const path = (type: string) => state.graph.nodes.find((n) => n.type === type)!.output!.path!;
await writeFile(join(OUT, "graph.json"), JSON.stringify(state.graph, null, 2));
await copyFile(path("edit"), join(OUT, "edit.mp4"));
await copyFile(path("motion"), join(OUT, "final.mp4"));
console.log(`OK → ${OUT}/final.mp4`);
