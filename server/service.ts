import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { buildGraphFromPlan, type ModelChoice } from "../shared/buildGraph.ts";
import { GraphSchema, PlanSchema, type Graph } from "../shared/schema.ts";
import { runGraph, runNode, topoLevels } from "./engine/runGraph.ts";
import type { Providers } from "./providers/types.ts";

export class BusyError extends Error {
  constructor() {
    super("이미 실행 중입니다. 끝난 뒤 다시 시도하세요.");
  }
}

export type Service = ReturnType<typeof createService>;

/**
 * 모델이 바뀐 이미지·영상 노드와 그 뒤 노드를 idle로 되돌린다. 산출 파일은 지우지 않는다(옛 결과 보존).
 * 같은 id의 노드만 비교한다. 새로 추가된 노드는 원래 idle이므로 건드리지 않는다.
 */
export function invalidateChangedModels(prev: Graph, next: Graph): Graph {
  const before = new Map(prev.nodes.map((n) => [n.id, n]));
  const stale = new Set<string>();
  for (const node of next.nodes) {
    const old = before.get(node.id);
    if (!old || (node.type !== "image" && node.type !== "video")) continue;
    if (old.type === node.type && old.data.model !== node.data.model) stale.add(node.id);
  }
  let grew = stale.size > 0;
  while (grew) {
    grew = false;
    for (const e of next.edges) {
      if (stale.has(e.source) && !stale.has(e.target)) {
        stale.add(e.target);
        grew = true;
      }
    }
  }
  if (stale.size === 0) return next;
  return {
    ...next,
    nodes: next.nodes.map((n) => (stale.has(n.id) ? { ...n, status: "idle" as const, error: undefined } : n)),
  };
}

/** 프로젝트 하나(그래프 + 산출물 폴더)를 관리한다. 한 번에 한 작업만 실행한다. */
export function createService(dataDir: string, providers: Providers) {
  const root = resolve(dataDir);
  let filesDir = join(root, "files");
  const graphPath = join(root, "graph.json");
  const workflowsDir = join(root, "workflows");
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
  const opts = () => ({ outDir: filesDir, onUpdate: save });

  /** 현재 워크플로우를 보관 폴더로 옮기고 빈 캔버스로 시작한다. 산출 파일도 함께 옮겨 옛 미리보기가 깨지지 않게 한다. */
  const archive = () => {
    if (graph.nodes.length === 0) return;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-"); // 20261122-193000 (UTC)
    let dir = join(workflowsDir, stamp);
    for (let n = 2; existsSync(dir); n++) dir = join(workflowsDir, `${stamp}-${n}`);
    const movedFiles = join(dir, "files");
    const archived: Graph = {
      ...graph,
      nodes: graph.nodes.map((n) => {
        const path = n.output?.path;
        if (!path) return n;
        return { ...n, output: { ...n.output, path: join(movedFiles, relative(filesDir, path)) } };
      }),
    };
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "graph.json"), JSON.stringify(archived, null, 2));
    renameSync(filesDir, movedFiles);
    mkdirSync(filesDir, { recursive: true });
  };

  return {
    get filesDir() {
      return filesDir;
    },
    state: () => ({ graph, running }),
    /** 새 워크플로우: 현재 그래프를 보관하고 빈 그래프로 시작한다. */
    newWorkflow() {
      if (running) throw new BusyError();
      archive();
      save({ nodes: [], edges: [] });
    },
    setGraph(next: Graph) {
      if (running) throw new BusyError();
      save(invalidateChangedModels(graph, next));
    },
    /** 영상 설명 → 기획 → 노드 그래프. models가 없으면 노드 기본 모델을 쓴다. */
    agent: (prompt: string, models?: ModelChoice) =>
      exclusive(async () => {
        const plan = PlanSchema.parse(await providers.plan(prompt));
        save(buildGraphFromPlan(plan, prompt, models));
        return graph;
      }),
    /** 완료되지 않은 노드를 모두 실행한다. 반환된 promise는 실행이 끝날 때 완료된다. */
    runAll() {
      topoLevels(graph); // 순환이면 시작 전에 던진다
      return exclusive(async () => save(await runGraph(graph, providers, opts())));
    },
    runNode(nodeId: string) {
      if (!graph.nodes.some((n) => n.id === nodeId)) throw new Error(`노드를 찾을 수 없습니다: ${nodeId}`);
      return exclusive(async () => save(await runNode(graph, nodeId, providers, opts())));
    },
  };
}
