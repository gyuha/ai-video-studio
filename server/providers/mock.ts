import type { Plan } from "../../shared/schema.ts";

export const MOCK_PLAN: Plan = {
  title: "겨울 카페 홍보 영상",
  scenes: [
    { id: "s1", description: "눈 내리는 거리의 카페 외관", imagePrompt: "snowy street cafe exterior at dusk, warm lights", caption: "눈 내리는 저녁, 따뜻한 한 잔", durationSec: 3 },
    { id: "s2", description: "창가 자리의 따뜻한 음료", imagePrompt: "hot latte on a wooden table by a snowy window", caption: "창가에서 즐기는 겨울 라떼", durationSec: 3 },
    { id: "s3", description: "카페 로고와 마무리", imagePrompt: "cozy cafe interior with a glowing sign", caption: "오늘, 카페에서 만나요", durationSec: 3 },
  ],
};
