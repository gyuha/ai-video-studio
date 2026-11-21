// 서버가 쓰는 것과 같은 실제 프로바이더로 기획 1회 + 이미지 1장을 만들어 구독 CLI 연동을 확인한다.
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { selectProviders } from "../server/providers/index.ts";

const OUT = resolve(".smoke-out");
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const providers = selectProviders("real");

const plan = await providers.plan("겨울 카페 홍보 영상, 장면 3개");
await writeFile(`${OUT}/plan.json`, JSON.stringify(plan, null, 2));
console.log(`기획 OK: ${plan.title} (${plan.scenes.length}장면)`);

await providers.image(plan.scenes[0].imagePrompt, `${OUT}/scene-1.png`);
console.log("이미지 OK: .smoke-out/scene-1.png");
