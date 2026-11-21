import { execFile } from "node:child_process";
import { copyFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const exists = (path: string) => stat(path).then(() => true, () => false);

/** dir 아래에서 since(ms) 이후에 만들어진 가장 최근 PNG. 없으면 undefined. */
export async function findNewestImage(dir: string, since: number): Promise<string | undefined> {
  const entries = await readdir(dir, { recursive: true }).catch(() => [] as string[]);
  let newest: { path: string; mtime: number } | undefined;
  for (const entry of entries) {
    if (!entry.endsWith(".png")) continue;
    const path = join(dir, entry);
    const mtime = (await stat(path)).mtimeMs;
    if (mtime >= since && (!newest || mtime > newest.mtime)) newest = { path, mtime };
  }
  return newest?.path;
}

/** Codex가 파일을 outPath에 두지 않았으면 Codex의 생성 폴더에서 찾아 복사한다. */
export async function collectImage(outPath: string, generatedDir: string, since: number): Promise<void> {
  if (await exists(outPath)) return;
  const found = await findNewestImage(generatedDir, since);
  if (!found) throw new Error("Codex가 이미지를 만들지 못했습니다. `codex login status`와 ChatGPT 플랜의 이미지 생성 한도를 확인하세요.");
  await copyFile(found, outPath);
}

/** ChatGPT 구독(Codex CLI의 내장 image_gen)으로 이미지를 만든다. */
export async function image(imagePrompt: string, outPath: string): Promise<void> {
  const since = Date.now();
  const task = `Use the built-in image_gen tool to generate exactly one image.
Prompt: ${JSON.stringify(imagePrompt)}
Size: 1536x1024 (landscape).
Then copy the generated image file to './${basename(outPath)}' in the current directory. Do nothing else.`;
  try {
    const run = exec(
      "codex",
      ["exec", task, "-s", "workspace-write", "-c", 'model_reasoning_effort="low"', "--skip-git-repo-check"],
      { cwd: dirname(outPath), timeout: 420_000, maxBuffer: 16 * 1024 * 1024 },
    );
    run.child.stdin?.end(); // 닫지 않으면 codex가 표준입력을 기다리며 멈춘다
    await run;
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    if (e.code === "ENOENT") throw new Error("codex CLI를 찾을 수 없습니다. `npm i -g @openai/codex` 후 `codex login`을 실행하세요.");
    throw new Error(`codex 실행 실패(\`codex login status\`를 확인하세요): ${(e.stderr || e.stdout || e.message).trim().slice(-300)}`);
  }
  await collectImage(outPath, join(homedir(), ".codex", "generated_images"), since);
}
