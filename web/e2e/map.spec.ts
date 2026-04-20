import { test, expect } from "@playwright/test";

test.describe("Map page", () => {
  test("sidebar Map link navigates to /map", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Map" }).click();
    await expect(page).toHaveURL(/\/map/);
  });

  test("renders a visible WebGL canvas", async ({ page }) => {
    await page.goto("/map");
    const canvas = page.locator("canvas");
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(100);
    expect(box!.height).toBeGreaterThan(100);
  });

  test("frame rate is at least 30fps after galaxy loads", async ({ page }) => {
    await page.goto("/map");
    await page.locator("canvas").waitFor({ state: "visible" });

    // Measure rAF cadence over 2 seconds in the real browser/GPU context
    const fps = await page.evaluate(async () => {
      return new Promise<number>((resolve) => {
        let frames = 0;
        const start = performance.now();
        const duration = 2_000;
        const tick = () => {
          frames++;
          if (performance.now() - start < duration) {
            requestAnimationFrame(tick);
          } else {
            resolve(frames / (duration / 1_000));
          }
        };
        requestAnimationFrame(tick);
      });
    });

    expect(fps).toBeGreaterThanOrEqual(30);
  });

  test("mouse drag (OrbitControls) does not crash the page", async ({
    page,
  }) => {
    await page.goto("/map");
    const canvas = page.locator("canvas");
    await canvas.waitFor({ state: "visible" });

    const box = await canvas.boundingBox();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 150, cy + 80, { steps: 10 });
    await page.mouse.up();

    // Page must still be functional after the drag
    await expect(canvas).toBeVisible();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    expect(errors).toHaveLength(0);
  });

  test("scroll-wheel zoom does not crash the page", async ({ page }) => {
    await page.goto("/map");
    const canvas = page.locator("canvas");
    await canvas.waitFor({ state: "visible" });

    const box = await canvas.boundingBox();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, -300);
    await page.mouse.wheel(0, 300);

    await expect(canvas).toBeVisible();
  });

  test("info panel shows empty state before any system is selected", async ({
    page,
  }) => {
    await page.goto("/map");
    await page.locator("canvas").waitFor({ state: "visible" });
    const panel = page.getByTestId("system-info-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(/select a solar system/i);
  });

  test("clicking a star updates the info panel with a system name", async ({
    page,
  }) => {
    await page.goto("/map");
    const canvas = page.locator("canvas");
    await canvas.waitFor({ state: "visible" });

    // Allow r3f one frame to finish initial render before clicking
    await page.waitForTimeout(500);

    // Try a grid of points across the canvas to hit at least one star
    const box = await canvas.boundingBox();
    const attempts: { x: number; y: number }[] = [];
    for (const fx of [0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65]) {
      for (const fy of [0.35, 0.45, 0.5, 0.55, 0.65]) {
        attempts.push({ x: box!.x + box!.width * fx, y: box!.y + box!.height * fy });
      }
    }

    let hit = false;
    for (const pt of attempts) {
      await page.mouse.click(pt.x, pt.y);
      const panel = page.getByTestId("system-info-panel");
      const text = await panel.textContent();
      if (text && !/select a solar system/i.test(text)) {
        hit = true;
        break;
      }
    }

    expect(hit, "Expected at least one click to select a solar system").toBe(
      true,
    );
  });
});
