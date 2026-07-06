import { test, expect } from "@playwright/test";

test.describe("Protección de rutas", () => {
  test("/app redirige a /login cuando no hay sesión", async ({ page }) => {
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);
  });

  test("una transcripción concreta también exige sesión", async ({ page }) => {
    await page.goto("/app/t/00000000-0000-0000-0000-000000000000");
    await expect(page).toHaveURL(/\/login/);
  });
});
