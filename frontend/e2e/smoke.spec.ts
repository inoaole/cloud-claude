import { expect, test } from '@playwright/test';

test('unauth surface: unlock renders, keypad works, routes stay gated', async ({ page }) => {
  // Cold load → the unlock screen (not the app) is what an unauthenticated visitor sees.
  await page.goto('/');
  await expect(page.getByText('Enter PIN to unlock')).toBeVisible();
  await expect(page.getByRole('button', { name: '1' })).toBeVisible();

  // Keypad fills a dot per digit.
  await page.getByRole('button', { name: '0' }).click();
  await page.getByRole('button', { name: '9' }).click();
  const filled = page.locator('[data-testid="pin-dots"] [data-filled="true"]');
  await expect(filled).toHaveCount(2);

  // Deep-linking to a protected route while unauthed still shows the gate, not the app.
  await page.goto('/growth');
  await expect(page.getByText('Enter PIN to unlock')).toBeVisible();

  // A hard refresh keeps us gated (no client-only route state leaking through).
  await page.reload();
  await expect(page.getByText('Enter PIN to unlock')).toBeVisible();
});
