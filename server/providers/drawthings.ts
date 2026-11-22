import { request } from "node:http";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ffmpeg } from "./ffmpeg.ts";

/** 드로우띵 로컬 API 주소. 앱의 설정에서 API 서버를 켜야 열린다 (기본 포트 7860). 호출할 때마다 읽는다. */
const baseUrl = () => process.env.DRAWTHINGS_URL ?? "http://localhost:7860";

/** 영상 한 번에 생성할 프레임 수. 앱 프리셋(124프레임, 24fps ≈ 5.2초)을 따른다. */
export const VIDEO_FRAMES = 124;
export const VIDEO_FPS = 24;
const VIDEO_STEPS = 50;
const HELP = "드로우띵 앱을 켜고, 설정에서 API 서버를 켠 뒤 다시 실행하세요.";

const unreachable = (err: unknown) => {
  const why = err instanceof Error ? err.message : String(err);
  return new Error(`드로우띵 API(${baseUrl()})에 연결할 수 없습니다. ${HELP} (${why})`);
};

/** Node fetch는 응답 헤더를 5분 넘게 기다리면 끊는다. 영상 생성은 그보다 오래 걸리므로 http로 시간 제한 없이 기다린다. */
function postJson(path: string, body: unknown): Promise<{ images?: string[] }> {
  const url = new URL(path, baseUrl());
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (text += chunk));
        res.on("end", () => {
          if (!res.statusCode || res.statusCode >= 400) return reject(new Error(`드로우띵 ${path} 실패: ${res.statusCode} ${text}`));
          try {
            resolve(JSON.parse(text));
          } catch {
            reject(new Error(`드로우띵 ${path} 응답을 읽을 수 없습니다`));
          }
        });
        res.on("error", reject);
      },
    );
    req.on("error", (err) => reject(unreachable(err)));
    req.end(payload);
  });
}

/** 드로우띵 이미지 모델로 장면 이미지를 만든다. 앱 프리셋(832×512, 20 steps, guidance 1)을 따른다. */
export async function drawthingsImage(file: string, imagePrompt: string, outPath: string): Promise<void> {
  const body = await postJson("/sdapi/v1/txt2img", {
    prompt: imagePrompt,
    negative_prompt: "",
    width: 832,
    height: 512,
    steps: 20,
    cfg_scale: 1.0,
    seed: -1,
    batch_size: 1,
    model: file,
  });
  const png = body.images?.[0];
  if (!png) throw new Error("드로우띵이 이미지를 돌려주지 않았습니다. 모델이 설치되어 있는지 확인하세요.");
  await writeFile(outPath, Buffer.from(png, "base64"));
}

/**
 * 프레임 PNG들을 장면 길이의 mp4로 묶는다. 클립이 장면보다 짧으면 마지막 프레임을 멈춰 채우고,
 * 길면 장면 길이에서 자른다. 멈춘 구간이 생기면 그 길이(초)를 돌려준다.
 */
export async function framesToClip(framesDir: string, durationSec: number, outPath: string, fps = VIDEO_FPS): Promise<number> {
  const count = (await readdir(framesDir)).filter((f) => f.endsWith(".png")).length;
  const clipSec = count / fps;
  const hold = Math.max(0, durationSec - clipSec);
  const filters = [
    "scale=1280:720:force_original_aspect_ratio=decrease",
    "pad=1280:720:(ow-iw)/2:(oh-ih)/2",
    "fps=30",
  ];
  if (hold > 0) filters.push(`tpad=stop_mode=clone:stop_duration=${hold.toFixed(3)}`);
  await ffmpeg([
    "-framerate", String(fps), "-i", join(framesDir, "f%04d.png"),
    "-vf", filters.join(","),
    "-t", String(durationSec),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", outPath,
  ]);
  return hold;
}

/**
 * 드로우띵 영상 모델로 장면 프롬프트에서 짧은 영상을 만든다 (텍스트→영상).
 * 프레임은 outPath 옆 폴더에 임시로 두고 mp4로 묶는다. 멈춘 구간이 있으면 안내 문구를 돌려준다.
 */
export async function drawthingsVideo(
  file: string,
  prompt: string,
  durationSec: number,
  outPath: string,
  opts: { frames?: number; steps?: number } = {},
): Promise<string | undefined> {
  const frames = opts.frames ?? VIDEO_FRAMES;
  const body = await postJson("/sdapi/v1/txt2img", {
    prompt,
    negative_prompt: "",
    width: 832,
    height: 512,
    steps: opts.steps ?? VIDEO_STEPS,
    cfg_scale: 1.0,
    seed: -1,
    batch_size: 1,
    model: file,
    num_frames: frames,
    fps: VIDEO_FPS,
  });
  if (!body.images?.length) throw new Error("드로우띵이 영상 프레임을 돌려주지 않았습니다. 영상 모델이 설치되어 있는지 확인하세요.");

  const framesDir = `${outPath}.frames`;
  await mkdir(framesDir, { recursive: true });
  await Promise.all(body.images.map((png, i) => writeFile(join(framesDir, `f${String(i).padStart(4, "0")}.png`), Buffer.from(png, "base64"))));
  const hold = await framesToClip(framesDir, durationSec, outPath);
  return hold > 0 ? `정지 구간 ${hold.toFixed(1)}초: 생성된 클립(${(frames / VIDEO_FPS).toFixed(1)}초)이 장면보다 짧아 마지막 프레임을 멈춤` : undefined;
}
