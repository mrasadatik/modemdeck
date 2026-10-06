import { test, expect } from '@playwright/test';

test('loads the protected application shell and navigates through the GUI', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/ModemDeck/i);
  await expect(page.getByRole('button', { name: /Overview$/ })).toBeVisible();
  await expect(page.getByText('Recent messages')).toBeVisible();
  await page.getByRole('button', { name: /Capabilities$/ }).click();
  await expect(page.getByText('Runtime configuration')).toBeVisible();
  await expect(page.locator('script[src^="/assets/"]')).toHaveCount(1);
});

test('serves health and readiness from the running backend', async ({ request }) => {
  await expect((await request.get('/health')).ok()).toBeTruthy();
  await expect((await request.get('/ready')).ok()).toBeTruthy();
});
