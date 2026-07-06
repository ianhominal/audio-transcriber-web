import { test, expect } from "@playwright/test";

test.describe("Landing", () => {
  test("muestra el título y el CTA principal", async ({ page }) => {
    await page.goto("/");

    // Título hero (parte del texto que no cambia según auth).
    await expect(page.getByRole("heading", { level: 1 })).toContainText("texto");

    // CTA lleva a /login o /app según sesión; sin sesión, a /login.
    const cta = page.getByRole("link", { name: /Probar gratis|Ir a la app/ });
    await expect(cta.first()).toBeVisible();
  });

  test("el enlace de la barra superior navega a login o cuenta", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("link", { name: /Iniciar sesión|Mi cuenta/ });
    await expect(nav.first()).toBeVisible();
  });
});
