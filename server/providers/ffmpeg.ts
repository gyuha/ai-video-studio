import { execFile } from "node:child_process";
import { copyFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { createCanvas } from "@napi-rs/canvas";
import type { Caption } from "../../shared/schema.ts";

const exec = promisify(execFile);
export const WIDTH = 1280;
export const HEIGHT = 720;
export const FPS = 30;

async function ffmpeg(args: string[]): Promise<void> {
  try {
    await exec("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args]);
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    if (e.code === "ENOENT") throw new Error("ffmpeg를 찾을 수 없습니다. ffmpeg를 설치하세요.");
    throw new Error(`ffmpeg 실패: ${e.stderr?.trim() || e.message}`);
  }
}

/** 이미지 한 장에 천천히 확대되는 모션을 입힌 클립. */
export async function video(imagePath: string, durationSec: number, outPath: string): Promise<void> {
  const frames = Math.round(durationSec * FPS);
  const filter = [
    `scale=${WIDTH * 2}:${HEIGHT * 2}:force_original_aspect_ratio=increase`,
    `crop=${WIDTH * 2}:${HEIGHT * 2}`,
    `zoompan=z='1+0.12*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${WIDTH}x${HEIGHT}:fps=${FPS}`,
    "format=yuv420p",
  ].join(",");
  await ffmpeg(["-i", imagePath, "-vf", filter, "-frames:v", String(frames), "-c:v", "libx264", outPath]);
}

/** 같은 규격의 클립을 재인코딩 없이 이어 붙인다. */
export async function edit(clipPaths: string[], outPath: string): Promise<void> {
  const listPath = `${outPath}.txt`;
  await writeFile(listPath, clipPaths.map((p) => `file '${p.replaceAll("'", "'\\''")}'`).join("\n"));
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outPath]);
}

/** 화면 아래쪽에 자막 한 줄이 들어간 투명 PNG. (이 ffmpeg 빌드에는 drawtext 필터가 없다) */
export function renderCaption(text: string): Buffer {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");
  ctx.font = 'bold 44px "Apple SD Gothic Neo", "Noto Sans CJK KR", sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const boxW = Math.min(ctx.measureText(text).width + 64, WIDTH - 80);
  const y = HEIGHT - 90;
  ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
  ctx.beginPath();
  ctx.roundRect((WIDTH - boxW) / 2, y - 40, boxW, 80, 16);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, WIDTH / 2, y, WIDTH - 144);
  return canvas.toBuffer("image/png");
}

/** 자막을 각자의 시간 구간에만 영상 위에 얹는다. */
export async function motion(videoPath: string, captions: Caption[], outPath: string): Promise<void> {
  const shown = captions.filter((c) => c.text.trim() !== "");
  if (shown.length === 0) return copyFile(videoPath, outPath);
  const inputs: string[] = [];
  const chain: string[] = [];
  for (const [i, c] of shown.entries()) {
    const png = `${outPath}.caption-${i + 1}.png`;
    await writeFile(png, renderCaption(c.text));
    inputs.push("-i", png);
    const from = i === 0 ? "[0:v]" : `[v${i}]`;
    chain.push(`${from}[${i + 1}:v]overlay=0:0:enable='gte(t,${c.startSec})*lt(t,${c.endSec})'[v${i + 1}]`);
  }
  await ffmpeg(["-i", videoPath, ...inputs, "-filter_complex", chain.join(";"), "-map", `[v${shown.length}]`, "-c:v", "libx264", "-pix_fmt", "yuv420p", outPath]);
}

/** mock 모드용 이미지: 프롬프트마다 색이 다른 단색 그림. */
export async function mockImage(imagePrompt: string, outPath: string): Promise<void> {
  let hash = 0;
  for (const ch of imagePrompt) hash = (hash * 31 + ch.codePointAt(0)!) % 0xffffff;
  const color = `0x${hash.toString(16).padStart(6, "0")}`;
  await ffmpeg(["-f", "lavfi", "-i", `color=c=${color}:s=1536x1024`, "-frames:v", "1", outPath]);
}
