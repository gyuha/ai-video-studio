import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const TYPES = ["plan", "image", "video", "edit", "motion"];

test("툴바에서 5종 노드를 추가하면 카드가 생기고 새로고침해도 남는다", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("agent-input")).toBeVisible();
  await expect(page.getByTestId("node")).toHaveCount(0);

  for (const type of TYPES) await page.getByTestId(`add-${type}`).click();
  await expect(page.getByTestId("node")).toHaveCount(5);
  await page.locator('[data-testid="node"][data-type="image"] textarea').fill("테스트 프롬프트");
  await page.locator('[data-testid="node"][data-type="image"] textarea').blur();

  await page.reload();
  await expect(page.getByTestId("node")).toHaveCount(5);
  for (const type of TYPES) await expect(page.locator(`[data-testid="node"][data-type="${type}"]`)).toHaveCount(1);
  await expect(page.locator('[data-testid="node"][data-type="image"] textarea')).toHaveValue("테스트 프롬프트");

  // 삭제도 저장된다
  await page.locator('[data-testid="node"][data-type="edit"]').getByTestId("delete").click();
  await expect(page.getByTestId("node")).toHaveCount(4);
  await page.reload();
  await expect(page.getByTestId("node")).toHaveCount(4);
});

test("에이전트에 설명하면 노드 그래프가 생기고, 전체 실행하면 영상이 만들어진다", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("agent-input").fill("겨울 카페 홍보 영상");
  await page.getByTestId("agent-send").click();

  // 5종 노드 9개, 엣지 8개 이상
  const nodes = page.getByTestId("node");
  await expect(nodes).toHaveCount(9);
  for (const [type, count] of [["plan", 1], ["image", 3], ["video", 3], ["edit", 1], ["motion", 1]] as const) {
    await expect(page.locator(`[data-testid="node"][data-type="${type}"]`)).toHaveCount(count);
  }
  expect(await page.locator(".react-flow__edge").count()).toBeGreaterThanOrEqual(8);
  await expect(page.getByTestId("msg-user")).toHaveText("겨울 카페 홍보 영상");
  await expect(page.getByTestId("msg-agent")).toContainText("노드 9개");

  // 모든 노드에 비용 라벨
  await expect(page.getByTestId("cost")).toHaveCount(9);
  for (const label of await page.getByTestId("cost").allTextContents()) expect(label).toMatch(/0원/);
  await expect(page.getByTestId("total-cost")).toContainText("노드 9개");

  // 전체 실행 → 모든 노드 완료
  await page.getByTestId("run-all").click();
  await expect(page.locator('[data-testid="node"][data-status="done"]')).toHaveCount(9, { timeout: 60_000 });
  await expect(page.locator('[data-testid="node"][data-status="error"]')).toHaveCount(0);
  await expect(page.getByTestId("status")).toHaveText(Array(9).fill("완료"));

  // 미리보기: 이미지 3장, 영상 5개(영상 3 + 편집 1 + 모션 1)
  await expect(page.locator('img[data-testid="preview"]')).toHaveCount(3);
  await expect(page.locator('video[data-testid="preview"]')).toHaveCount(5);

  // 모션 노드의 최종 영상이 실제 mp4로 내려온다
  const src = await page.locator('[data-testid="node"][data-type="motion"] video').getAttribute("src");
  expect(src).toBeTruthy();
  const res = await page.request.get(src!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("video/mp4");
  expect((await res.body()).byteLength).toBeGreaterThan(10_000);

  // 브라우저가 실제로 디코딩할 수 있는 영상이다
  const duration = await page.locator('[data-testid="node"][data-type="motion"] video').evaluate(
    (v: HTMLVideoElement) => new Promise<number>((resolve, reject) => {
      if (v.readyState >= 1) return resolve(v.duration);
      v.addEventListener("loadedmetadata", () => resolve(v.duration), { once: true });
      v.addEventListener("error", () => reject(new Error("video error")), { once: true });
    }),
  );
  expect(duration).toBeGreaterThan(8.5);
  expect(duration).toBeLessThan(9.5);
});
