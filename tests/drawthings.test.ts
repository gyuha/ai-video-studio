import { execFile } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { drawthingsImage, framesToClip } from "../server/providers/drawthings.ts";

const exec = promisify(execFile);
const probeSeconds = async (file: string) => {
  const { stdout } = await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  return Number(stdout.trim());
};

const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** 드로우띵 API 흉내: 요청을 기록하고, 정해진 응답을 돌려준다. 실제 앱 대신 로컬에서 돈다. */
async function fakeDrawthings(reply: (body: unknown) => { status?: number; json: unknown } | "close") {
  const seen: unknown[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      seen.push(JSON.parse(raw));
      const r = reply(JSON.parse(raw));
      if (r === "close") return req.socket.destroy();
      res.writeHead(r.status ?? 200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(r.json));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  process.env.DRAWTHINGS_URL = `http://127.0.0.1:${port}`;
  return { seen, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

afterEach(() => {
  delete process.env.DRAWTHINGS_URL;
});

describe("드로우띵 이미지 프로바이더", () => {
  it("txt2img에 모델 파일과 프롬프트를 보내고, 돌려받은 PNG를 저장한다", async () => {
    const fake = await fakeDrawthings(() => ({ json: { images: [PNG_1x1.toString("base64")] } }));
    const out = join(await mkdtemp(join(tmpdir(), "avs-dt-")), "image-1.png");
    try {
      await drawthingsImage("qwen_image_2.1_turbo_q6p.ckpt", "a red apple", out);
    } finally {
      await fake.close();
    }
    expect(fake.seen[0]).toMatchObject({ model: "qwen_image_2.1_turbo_q6p.ckpt", prompt: "a red apple", width: 832, height: 512 });
    expect(await readFile(out)).toEqual(PNG_1x1);
  });

  it("앱이 꺼져 있으면 무엇을 켜야 하는지 알려 준다", async () => {
    const fake = await fakeDrawthings(() => "close");
    await fake.close();
    const out = join(await mkdtemp(join(tmpdir(), "avs-dt-")), "x.png");
    await expect(drawthingsImage("m.ckpt", "p", out)).rejects.toThrow("드로우띵 앱을 켜고, 설정에서 API 서버를 켠 뒤");
  });

  it("이미지가 없는 응답이면 모델 설치를 확인하라고 알려 준다", async () => {
    const fake = await fakeDrawthings(() => ({ json: {} }));
    const out = join(await mkdtemp(join(tmpdir(), "avs-dt-")), "x.png");
    try {
      await expect(drawthingsImage("m.ckpt", "p", out)).rejects.toThrow("모델이 설치되어 있는지");
    } finally {
      await fake.close();
    }
  });
});

describe("프레임 → 장면 길이 클립 (실제 ffmpeg)", () => {
  it("클립이 장면보다 짧으면 마지막 프레임을 멈춰 길이를 맞추고, 멈춘 초를 돌려준다", async () => {
    const dir = await mkdtemp(join(tmpdir(), "avs-frames-"));
    const frames = join(dir, "frames");
    await mkdir(frames);
    for (let i = 0; i < 8; i++) await writeFile(join(frames, `f${String(i).padStart(4, "0")}.png`), PNG_1x1);
    const out = join(dir, "clip.mp4");

    const hold = await framesToClip(frames, 2, out); // 8프레임 @24fps ≈ 0.33초 → 2초로 맞춤

    expect(hold).toBeCloseTo(2 - 8 / 24, 2);
    expect(await probeSeconds(out)).toBeCloseTo(2, 0);
  });
});
