import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { selectProviders } from "./providers/index.ts";
import { createService } from "./service.ts";

// 다른 앱과 자주 겹치지 않도록 흔한 포트(8787)를 피한다. PORT로 바꿀 수 있다.
const port = Number(process.env.PORT ?? 18787);
const service = createService(process.env.DATA_DIR ?? "data", selectProviders());
serve({ fetch: createApp(service).fetch, port }, () => console.log(`API http://localhost:${port} (PROVIDER_MODE=${process.env.PROVIDER_MODE ?? "real"})`));
