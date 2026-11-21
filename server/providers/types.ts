import type { Caption, Plan } from "../../shared/schema.ts";

export interface Providers {
  plan(prompt: string): Promise<Plan>;
  image(imagePrompt: string, outPath: string): Promise<void>;
  video(imagePath: string, durationSec: number, outPath: string): Promise<void>;
  edit(clipPaths: string[], outPath: string): Promise<void>;
  motion(videoPath: string, captions: Caption[], outPath: string): Promise<void>;
}
