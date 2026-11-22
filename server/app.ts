import { readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { Hono } from "hono";
import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL, GraphSchema, ImageModelSchema, VideoModelSchema } from "../shared/schema.ts";
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
    const { prompt, imageModel, videoModel } = await c.req.json<{ prompt?: string; imageModel?: string; videoModel?: string }>();
    if (!prompt?.trim()) return c.json({ error: "만들고 싶은 영상을 설명해 주세요" }, 400);
    const models = {
      image: imageModel ?? DEFAULT_IMAGE_MODEL,
      video: videoModel ?? DEFAULT_VIDEO_MODEL,
    };
    const checked = ImageModelSchema.safeParse(models.image).success && VideoModelSchema.safeParse(models.video).success;
    if (!checked) return c.json({ error: "지원하지 않는 모델입니다" }, 400);
    await service.agent(prompt.trim(), models);
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

  // 현재 워크플로우를 보관하고 빈 캔버스로 시작한다. 실행 중이면 409.
  app.post("/api/workflow/new", (c) => {
    service.newWorkflow();
    return c.json(service.state());
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
