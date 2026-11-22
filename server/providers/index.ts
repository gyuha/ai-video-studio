import { plan } from "./claude.ts";
import { image } from "./codex.ts";
import { drawthingsImage, drawthingsVideo } from "./drawthings.ts";
import { edit, ffmpeg, mockImage, motion, video } from "./ffmpeg.ts";
import { MOCK_PLAN } from "./mock.ts";
import type { Providers } from "./types.ts";

// 영상·편집·모션은 어느 모드에서나 로컬 ffmpeg다. mock 모드는 구독 CLI·드로우띵 호출을 가짜 그림으로 바꾼다.
const realProviders: Providers = { plan, image, drawthingsImage, drawthingsVideo, video, edit, motion };
const mockProviders: Providers = {
  ...realProviders,
  plan: async () => MOCK_PLAN,
  image: mockImage,
  drawthingsImage: (_file, imagePrompt, outPath) => mockImage(imagePrompt, outPath),
  drawthingsVideo: async (_file, _prompt, durationSec, outPath) => {
    await ffmpeg(["-f", "lavfi", "-i", `testsrc=size=1280x720:rate=30:duration=${durationSec}`, "-pix_fmt", "yuv420p", outPath]);
    return undefined;
  },
};

export function selectProviders(mode = process.env.PROVIDER_MODE ?? "real"): Providers {
  if (mode === "mock") return mockProviders;
  if (mode === "real") return realProviders;
  throw new Error(`알 수 없는 PROVIDER_MODE: ${mode}`);
}
