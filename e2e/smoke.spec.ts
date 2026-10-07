import { test, expect } from '@playwright/test';

test('first-run setup creates the profile, then the app shell loads', async ({ page, request }) => {
  const setup = await request.post('/api/auth/setup', {
    data: { name: 'Tester', gender: 'male', simLabel: 'lab', password: 'pass1234' },
  });
  expect([200, 409]).toContain(setup.status());
  await page.goto('/');
  await expect(page).toHaveTitle(/ModemDeck/i);
  await expect(page.getByRole('button', { name: /Overview$/ })).toBeVisible();
  await expect(page.getByText('Recent messages')).toBeVisible();
  await page.getByRole('button', { name: /Capabilities$/ }).click();
  await expect(page.getByText('Runtime configuration')).toBeVisible();
  await expect(page.locator('script[src^="/assets/"]')).toHaveCount(1);
});

test('sidebar fills the remaining viewport height with and without the warning', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  const sidebar = page.locator('.sidebar');
  const bounds = () =>
    sidebar.evaluate((element) => {
      const { top, bottom } = element.getBoundingClientRect();
      return { top, bottom };
    });
  const warning = page.getByRole('note');
  await expect(warning).toBeVisible();
  const withWarning = await bounds();
  expect(withWarning.top).toBeGreaterThan(0);
  expect(Math.round(withWarning.bottom)).toBe(800);

  await warning.getByRole('button', { name: 'Dismiss' }).click();
  await expect(warning).toHaveCount(0);
  const withoutWarning = await bounds();
  expect(withoutWarning.top).toBe(0);
  expect(Math.round(withoutWarning.bottom)).toBe(800);
});

test('configuration suggests detected ports and dial-up profiles without restricting manual entry', async ({
  page,
}) => {
  await page.route('**/api/ports', (route) =>
    route.fulfill({ json: [{ path: 'COM7', label: 'USB modem' }] }),
  );
  await page.route('**/api/data', (route) =>
    route.fulfill({
      json: {
        configured: false,
        on: false,
        candidates: [
          { method: 'ras-ppp', control: 'controllable', name: 'Modem data', connected: false },
          { method: 'mbim', control: 'detectable-only', name: 'Other adapter', connected: false },
        ],
      },
    }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: /Capabilities$/ }).click();
  await expect(page.locator('#available-modem-ports option')).toHaveAttribute('value', 'COM7');
  await expect(page.locator('#dialup-profiles option')).toHaveCount(1);
  await expect(page.locator('#dialup-profiles option')).toHaveAttribute('value', 'Modem data');
  await page.getByRole('combobox', { name: 'Modem port' }).fill('COM9');
  await expect(page.getByRole('combobox', { name: 'Modem port' })).toHaveValue('COM9');
});

test('serves health and readiness from the running backend', async ({ request }) => {
  await expect((await request.get('/health')).ok()).toBeTruthy();
  await expect((await request.get('/ready')).ok()).toBeTruthy();
});
