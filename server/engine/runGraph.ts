import { join } from "node:path";
import type { Graph, GraphNode } from "../../shared/schema.ts";
import type { Providers } from "../providers/types.ts";

export interface RunOptions {
  outDir: string;
  onUpdate?: (graph: Graph) => void;
}

/** 위상 순서의 레벨 목록. 같은 레벨의 노드는 서로 의존하지 않는다. 순환이 있으면 던진다. */
export function topoLevels(graph: Graph): string[][] {
  const indegree = new Map(graph.nodes.map((n) => [n.id, 0]));
  for (const e of graph.edges) indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
  const levels: string[][] = [];
  let ready = graph.nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id);
  let seen = 0;
  while (ready.length > 0) {
    levels.push(ready);
    seen += ready.length;
    const next: string[] = [];
    for (const id of ready) {
      for (const e of graph.edges) {
        if (e.source !== id) continue;
        const d = indegree.get(e.target)! - 1;
        indegree.set(e.target, d);
        if (d === 0) next.push(e.target);
      }
    }
    ready = next;
  }
  if (seen !== graph.nodes.length) throw new Error("그래프에 순환이 있습니다");
  return levels;
}

function upstream(graph: Graph, id: string): GraphNode[] {
  return graph.edges
    .filter((e) => e.target === id)
    .map((e) => graph.nodes.find((n) => n.id === e.source)!);
}

function inputPath(ups: GraphNode[], types: GraphNode["type"][], nodeId: string): string {
  const path = ups.find((n) => types.includes(n.type))?.output?.path;
  if (!path) throw new Error(`${nodeId}: 입력이 될 ${types.join("/")} 노드가 연결되어 있지 않습니다`);
  return path;
}

async function execute(graph: Graph, node: GraphNode, providers: Providers, outDir: string): Promise<GraphNode["output"]> {
  const ups = upstream(graph, node.id);
  switch (node.type) {
    case "plan":
      return { plan: await providers.plan(node.data.prompt) };
    case "image": {
      const path = join(outDir, `${node.id}.png`);
      await providers.image(node.data.imagePrompt, path);
      return { path };
    }
    case "video": {
      const path = join(outDir, `${node.id}.mp4`);
      await providers.video(inputPath(ups, ["image"], node.id), node.data.durationSec, path);
      return { path };
    }
    case "edit": {
      const clips = ups.filter((n) => n.type === "video").map((n) => n.output!.path!);
      if (clips.length === 0) throw new Error(`${node.id}: 연결된 영상 노드가 없습니다`);
      const path = join(outDir, `${node.id}.mp4`);
      await providers.edit(clips, path);
      return { path };
    }
    case "motion": {
      const path = join(outDir, `${node.id}.mp4`);
      await providers.motion(inputPath(ups, ["edit", "video"], node.id), node.data.captions, path);
      return { path };
    }
  }
}

async function runOne(graph: Graph, node: GraphNode, providers: Providers, opts: RunOptions): Promise<void> {
  if (upstream(graph, node.id).some((n) => n.status !== "done")) {
    node.status = "error";
    node.error = "상위 노드가 완료되지 않아 실행하지 않았습니다";
    opts.onUpdate?.(graph);
    return;
  }
  node.status = "running";
  delete node.error;
  opts.onUpdate?.(graph);
  try {
    node.output = await execute(graph, node, providers, opts.outDir);
    node.status = "done";
  } catch (err) {
    node.status = "error";
    node.error = err instanceof Error ? err.message : String(err);
  }
  opts.onUpdate?.(graph);
}

/** 아직 완료되지 않은 노드를 위상 순서로 실행한다. 같은 레벨은 동시에 실행한다. 입력 그래프는 바꾸지 않는다. */
export async function runGraph(input: Graph, providers: Providers, opts: RunOptions): Promise<Graph> {
  const graph = structuredClone(input);
  for (const level of topoLevels(graph)) {
    const pending = level.map((id) => graph.nodes.find((n) => n.id === id)!).filter((n) => n.status !== "done");
    await Promise.all(pending.map((node) => runOne(graph, node, providers, opts)));
  }
  return graph;
}

/** 노드 하나를 (완료 상태여도) 다시 실행한다. */
export async function runNode(input: Graph, nodeId: string, providers: Providers, opts: RunOptions): Promise<Graph> {
  const graph = structuredClone(input);
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) throw new Error(`노드를 찾을 수 없습니다: ${nodeId}`);
  await runOne(graph, node, providers, opts);
  return graph;
}
