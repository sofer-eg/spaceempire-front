import { expect, test } from '@playwright/test';

// Smoke e2e (phase 8.9): a fresh player registers, lands in the sector view,
// and the canvas renders. Run requires the dev stack up and Playwright
// browsers installed (see e2e/README.md). Selectors mirror src/auth/LoginPage.
test('register → sector canvas renders', async ({ page }) => {
  const login = `e2e_${Date.now()}`;

  await page.goto('/login');
  // Switch to the register tab.
  await page.getByRole('button', { name: /Зарегистрироваться/ }).click();
  await page.locator('input[type="text"]').fill(login);
  await page.locator('input[type="password"]').fill('e2e-password');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();

  // Lands on the sector view; the map canvas is present.
  await expect(page).toHaveURL(/\/sector/, { timeout: 15_000 });
  await expect(page.locator('canvas')).toBeVisible();

  // Clicking the canvas issues a move command (no crash; ship stays rendered).
  await page.locator('canvas').click({ position: { x: 200, y: 150 } });
  await expect(page.locator('canvas')).toBeVisible();
});
