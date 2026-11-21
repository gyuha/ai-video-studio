import { plan } from "./claude.ts";
import { image } from "./codex.ts";
import { edit, mockImage, motion, video } from "./ffmpeg.ts";
import { MOCK_PLAN } from "./mock.ts";
import type { Providers } from "./types.ts";

// 영상·편집·모션은 어느 모드에서나 로컬 ffmpeg다. mock 모드는 구독 CLI 호출(기획·이미지)만 대체한다.
const realProviders: Providers = { plan, image, video, edit, motion };
const mockProviders: Providers = { ...realProviders, plan: async () => MOCK_PLAN, image: mockImage };

export function selectProviders(mode = process.env.PROVIDER_MODE ?? "real"): Providers {
  if (mode === "mock") return mockProviders;
  if (mode === "real") return realProviders;
  throw new Error(`알 수 없는 PROVIDER_MODE: ${mode}`);
}
