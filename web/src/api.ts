import type { Graph } from "../../shared/schema.ts";

export interface State {
  graph: Graph;
  running: boolean;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function call(path: string, method = "GET", body?: unknown): Promise<State> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ error: "서버에 연결할 수 없습니다" }));
  if (!res.ok) throw new ApiError(data.error ?? res.statusText, res.status);
  return data;
}

export const api = {
  state: () => call("/api/graph"),
  save: (graph: Graph) => call("/api/graph", "PUT", graph),
  agent: (prompt: string, models: { image: string; video: string }) =>
    call("/api/agent", "POST", { prompt, imageModel: models.image, videoModel: models.video }),
  runAll: () => call("/api/run", "POST"),
  newWorkflow: () => call("/api/workflow/new", "POST"),
  runNode: (id: string) => call(`/api/run/${encodeURIComponent(id)}`, "POST"),
};

/** 서버가 남긴 산출물 경로 → 브라우저에서 열 수 있는 주소. */
export const fileUrl = (path: string) => `/files/${path.split("/").pop()}`;
