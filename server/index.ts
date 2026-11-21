import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { selectProviders } from "./providers/index.ts";
import { createService } from "./service.ts";

const port = Number(process.env.PORT ?? 8787);
const service = createService(process.env.DATA_DIR ?? "data", selectProviders());
serve({ fetch: createApp(service).fetch, port }, () => console.log(`API http://localhost:${port} (PROVIDER_MODE=${process.env.PROVIDER_MODE ?? "real"})`));
