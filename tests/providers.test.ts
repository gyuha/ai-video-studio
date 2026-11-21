import { execFile } from "node:child_process";
import { mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { extractPlan } from "../server/providers/claude.ts";
import { collectImage, findNewestImage } from "../server/providers/codex.ts";
import { edit, mockImage, motion, video } from "../server/providers/ffmpeg.ts";
import { MOCK_PLAN } from "../server/providers/mock.ts";

const exec = promisify(execFile);
const tmp = () => mkdtemp(join(tmpdir(), "avs-"));

async function probe(path: string) {
  const { stdout } = await exec("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height:format=duration", "-of", "json", path]);
  const { streams, format } = JSON.parse(stdout);
  return { ...streams[0], duration: Number(format.duration) } as { codec_name: string; width: number; height: number; duration: number };
}

async function ssim(a: string, b: string): Promise<number> {
  const { stderr } = await exec("ffmpeg", ["-i", a, "-i", b, "-lavfi", "ssim", "-f", "null", "-"]);
  return Number(/All:([0-9.]+)/.exec(stderr)![1]);
}

describe("ffmpeg 프로바이더", () => {
  it("이미지 → 지정 길이의 720p h264 클립, 이어 붙이면 길이가 합쳐지고, 자막이 프레임을 바꾼다", async () => {
    const dir = await tmp();
    const clips: string[] = [];
    for (const [i, prompt] of ["a", "b", "c"].entries()) {
      const img = join(dir, `${i}.png`);
      const clip = join(dir, `${i}.mp4`);
      await mockImage(prompt, img);
      await video(img, 2, clip);
      clips.push(clip);
    }
    const one = await probe(clips[0]);
    expect(one).toMatchObject({ codec_name: "h264", width: 1280, height: 720 });
    expect(Math.abs(one.duration - 2)).toBeLessThan(0.2);

    const joined = join(dir, "edit.mp4");
    await edit(clips, joined);
    expect(Math.abs((await probe(joined)).duration - 6)).toBeLessThan(0.3);

    const final = join(dir, "final.mp4");
    await motion(joined, [{ text: "첫 자막", startSec: 0, endSec: 2 }, { text: "둘째 자막", startSec: 2, endSec: 4 }], final);
    const out = await probe(final);
    expect(out).toMatchObject({ codec_name: "h264", width: 1280, height: 720 });
    expect(Math.abs(out.duration - 6)).toBeLessThan(0.3);
    expect(await ssim(joined, final)).toBeLessThan(0.999);

    // 자막이 없으면 영상은 그대로다
    const same = join(dir, "same.mp4");
    await motion(joined, [], same);
    expect(await ssim(joined, same)).toBe(1);
  }, 60_000);
});

describe("extractPlan (claude 출력 해석)", () => {
  const envelope = (fields: object) => JSON.stringify({ type: "result", is_error: false, ...fields });

  it("structured_output을 우선 사용한다", () => {
    expect(extractPlan(envelope({ result: "무시", structured_output: MOCK_PLAN }))).toEqual(MOCK_PLAN);
  });
  it("structured_output이 없으면 본문의 코드펜스 JSON을 읽는다", () => {
    const result = `기획입니다.\n\`\`\`json\n${JSON.stringify(MOCK_PLAN)}\n\`\`\`\n끝.`;
    expect(extractPlan(envelope({ result }))).toEqual(MOCK_PLAN);
  });
  it("불량 JSON·스키마 위반·오류 응답을 구분해 거부한다", () => {
    expect(() => extractPlan("not json")).toThrow("JSON이 아닙니다");
    expect(() => extractPlan(envelope({ result: "죄송합니다, 못 만들겠어요" }))).toThrow("찾지 못했습니다");
    expect(() => extractPlan(envelope({ structured_output: { title: "t", scenes: [] } }))).toThrow("형식이 올바르지 않습니다");
    expect(() => extractPlan(JSON.stringify({ is_error: true, result: "Not logged in" }))).toThrow("Not logged in");
  });
});

describe("Codex 이미지 수거", () => {
  it("since 이후의 가장 최근 PNG를 하위 폴더까지 찾는다", async () => {
    const dir = await tmp();
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, "s1"));
    await mkdir(join(dir, "s2"));
    const now = Date.now();
    const at = async (name: string, ms: number, body: string) => {
      await writeFile(join(dir, name), body);
      await utimes(join(dir, name), ms / 1000, ms / 1000);
    };
    await at("s1/old.png", now - 60_000, "old");
    await at("s1/a.png", now + 1_000, "a");
    await at("s2/b.png", now + 2_000, "b");
    await at("s2/note.txt", now + 3_000, "txt");

    expect(await findNewestImage(dir, now)).toBe(join(dir, "s2/b.png"));
    expect(await findNewestImage(dir, now + 10_000)).toBeUndefined();
    expect(await findNewestImage(join(dir, "missing"), now)).toBeUndefined();
  });

  it("outPath에 파일이 없을 때만 생성 폴더에서 복사하고, 어디에도 없으면 오류를 낸다", async () => {
    const gen = await tmp();
    const out = await tmp();
    const now = Date.now();
    await writeFile(join(gen, "ig.png"), "generated");

    await writeFile(join(out, "kept.png"), "already here");
    await collectImage(join(out, "kept.png"), gen, now - 1_000);
    expect(await readFile(join(out, "kept.png"), "utf8")).toBe("already here");

    await collectImage(join(out, "copied.png"), gen, now - 1_000);
    expect(await readFile(join(out, "copied.png"), "utf8")).toBe("generated");

    await expect(collectImage(join(out, "none.png"), gen, now + 60_000)).rejects.toThrow("이미지를 만들지 못했습니다");
  });
});
