import type { Caption, Plan } from "../../shared/schema.ts";

export interface Providers {
  plan(prompt: string): Promise<Plan>;
  image(imagePrompt: string, outPath: string): Promise<void>;
  /** 드로우띵 이미지 모델. file은 드로우띵이 아는 모델 파일 이름이다. */
  drawthingsImage(file: string, imagePrompt: string, outPath: string): Promise<void>;
  /** 드로우띵 영상 모델(텍스트→영상). 멈춘 구간이 생기면 안내 문구를 돌려준다. */
  drawthingsVideo(file: string, prompt: string, durationSec: number, outPath: string): Promise<string | undefined>;
  video(imagePath: string, durationSec: number, outPath: string): Promise<void>;
  edit(clipPaths: string[], outPath: string): Promise<void>;
  motion(videoPath: string, captions: Caption[], outPath: string): Promise<void>;
}
