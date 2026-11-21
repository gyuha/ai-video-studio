import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { PlanSchema, type Plan } from "../../shared/schema.ts";

const exec = promisify(execFile);

const PLAN_JSON_SCHEMA = JSON.stringify({
  type: "object",
  required: ["title", "scenes"],
  properties: {
    title: { type: "string" },
    scenes: {
      type: "array",
      minItems: 2,
      items: {
        type: "object",
        required: ["id", "description", "imagePrompt", "caption", "durationSec"],
        properties: {
          id: { type: "string" },
          description: { type: "string" },
          imagePrompt: { type: "string" },
          caption: { type: "string" },
          durationSec: { type: "number" },
        },
      },
    },
  },
});

const INSTRUCTIONS = `너는 짧은 영상의 기획자다. 아래 설명으로 영상 기획을 만들어라.
- 장면은 3~6개, 장면마다 durationSec은 2~5초.
- imagePrompt: 그 장면의 정지 이미지를 생성할 영어 프롬프트. 16:9 가로 구도, 화면 안에 글자 없음.
- caption: 화면 아래에 넣을 한국어 자막, 18자 이내.
- description: 장면 설명(한국어 한 문장).
- 사용자가 장면 수나 길이를 지정하면 그것을 따른다.

영상 설명: `;

/** `claude -p --output-format json` 출력에서 기획을 꺼내 검증한다. */
export function extractPlan(stdout: string): Plan {
  let envelope: { is_error?: boolean; result?: unknown; structured_output?: unknown };
  try {
    envelope = JSON.parse(stdout);
  } catch {
    throw new Error(`claude 출력이 JSON이 아닙니다: ${stdout.slice(0, 200)}`);
  }
  if (envelope.is_error) throw new Error(`claude 오류: ${String(envelope.result)}`);
  let candidate = envelope.structured_output;
  if (candidate === undefined || candidate === null) {
    // 구조화 출력이 없으면 본문에서 JSON 객체(코드펜스 포함)를 찾는다.
    const text = String(envelope.result ?? "");
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    try {
      candidate = JSON.parse(json);
    } catch {
      throw new Error(`claude 응답에서 기획 JSON을 찾지 못했습니다: ${text.slice(0, 200)}`);
    }
  }
  const parsed = PlanSchema.safeParse(candidate);
  if (!parsed.success) throw new Error(`기획 형식이 올바르지 않습니다: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
  return parsed.data;
}

/** Claude Code 구독으로 기획을 만든다. 프로젝트 설정의 영향을 받지 않도록 임시 디렉터리에서 도구 없이 실행한다. */
export async function plan(prompt: string): Promise<Plan> {
  try {
    const { stdout } = await exec(
      "claude",
      ["-p", INSTRUCTIONS + prompt, "--output-format", "json", "--tools", "", "--strict-mcp-config", "--json-schema", PLAN_JSON_SCHEMA],
      { cwd: tmpdir(), timeout: 180_000, maxBuffer: 16 * 1024 * 1024 },
    );
    return extractPlan(stdout);
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    if (e.code === "ENOENT") throw new Error("claude CLI를 찾을 수 없습니다. Claude Code를 설치하고 로그인하세요.");
    if (e.stdout || e.stderr) throw new Error(`claude 실행 실패(로그인 상태를 확인하세요): ${(e.stderr || e.stdout)!.trim().slice(0, 300)}`);
    throw e;
  }
}
