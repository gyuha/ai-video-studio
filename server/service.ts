import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildGraphFromPlan } from "../shared/buildGraph.ts";
import { GraphSchema, PlanSchema, type Graph } from "../shared/schema.ts";
import { runGraph, runNode, topoLevels } from "./engine/runGraph.ts";
import type { Providers } from "./providers/types.ts";

export class BusyError extends Error {
  constructor() {
    super("이미 실행 중입니다. 끝난 뒤 다시 시도하세요.");
  }
}

export type Service = ReturnType<typeof createService>;

/** 프로젝트 하나(그래프 + 산출물 폴더)를 관리한다. 한 번에 한 작업만 실행한다. */
export function createService(dataDir: string, providers: Providers) {
  const filesDir = join(resolve(dataDir), "files");
  const graphPath = join(resolve(dataDir), "graph.json");
  mkdirSync(filesDir, { recursive: true });

  let graph: Graph = { nodes: [], edges: [] };
  if (existsSync(graphPath)) {
    graph = GraphSchema.parse(JSON.parse(readFileSync(graphPath, "utf8")));
    // 서버가 실행 도중 꺼졌다면 running으로 남은 노드를 되돌린다.
    for (const node of graph.nodes) if (node.status === "running") node.status = "idle";
  }
  let running = false;

  const save = (next: Graph) => {
    graph = next;
    writeFileSync(graphPath, JSON.stringify(graph, null, 2));
  };
  const exclusive = async <T>(job: () => Promise<T>): Promise<T> => {
    if (running) throw new BusyError();
    running = true;
    try {
      return await job();
    } finally {
      running = false;
    }
  };
  const opts = { outDir: filesDir, onUpdate: save };

  return {
    filesDir,
    state: () => ({ graph, running }),
    setGraph(next: Graph) {
      if (running) throw new BusyError();
      save(next);
    },
    /** 영상 설명 → 기획 → 노드 그래프. */
    agent: (prompt: string) =>
      exclusive(async () => {
        const plan = PlanSchema.parse(await providers.plan(prompt));
        save(buildGraphFromPlan(plan, prompt));
        return graph;
      }),
    /** 완료되지 않은 노드를 모두 실행한다. 반환된 promise는 실행이 끝날 때 완료된다. */
    runAll() {
      topoLevels(graph); // 순환이면 시작 전에 던진다
      return exclusive(async () => save(await runGraph(graph, providers, opts)));
    },
    runNode(nodeId: string) {
      if (!graph.nodes.some((n) => n.id === nodeId)) throw new Error(`노드를 찾을 수 없습니다: ${nodeId}`);
      return exclusive(async () => save(await runNode(graph, nodeId, providers, opts)));
    },
  };
}
