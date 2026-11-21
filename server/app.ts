import { readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { Hono } from "hono";
import { GraphSchema } from "../shared/schema.ts";
import { BusyError, type Service } from "./service.ts";

const MIME: Record<string, string> = { ".mp4": "video/mp4", ".png": "image/png" };

export function createApp(service: Service) {
  const app = new Hono();

  app.onError((err, c) => c.json({ error: err.message }, err instanceof BusyError ? 409 : 500));

  app.get("/api/graph", (c) => c.json(service.state()));

  app.put("/api/graph", async (c) => {
    const parsed = GraphSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "그래프 형식이 올바르지 않습니다" }, 400);
    service.setGraph(parsed.data);
    return c.json(service.state());
  });

  app.post("/api/agent", async (c) => {
    const { prompt } = await c.req.json<{ prompt?: string }>();
    if (!prompt?.trim()) return c.json({ error: "만들고 싶은 영상을 설명해 주세요" }, 400);
    await service.agent(prompt.trim());
    return c.json(service.state());
  });

  // 실행은 오래 걸리므로 시작만 하고 바로 응답한다. 진행 상황은 GET /api/graph로 본다.
  const started = (run: Promise<unknown>) => run.catch((err) => console.error(err));
  app.post("/api/run", (c) => {
    if (service.state().running) throw new BusyError();
    started(service.runAll());
    return c.json(service.state(), 202);
  });
  app.post("/api/run/:id", (c) => {
    if (service.state().running) throw new BusyError();
    started(service.runNode(c.req.param("id")));
    return c.json(service.state(), 202);
  });

  app.get("/files/:name", async (c) => {
    const name = basename(c.req.param("name"));
    const type = MIME[extname(name)];
    if (!type) return c.notFound();
    try {
      return c.body(await readFile(join(service.filesDir, name)), 200, { "Content-Type": type, "Cache-Control": "no-store" });
    } catch {
      return c.notFound();
    }
  });

  return app;
}
