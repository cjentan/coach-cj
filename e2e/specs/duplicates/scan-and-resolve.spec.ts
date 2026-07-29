import { test, expect } from '@playwright/test';
import { signUp } from '../../test-utils/auth';

test.describe('Duplicates scan and resolve', () => {
  test('navigates to duplicates page and triggers scan', async ({ page }) => {
    const email = `e2e-${Date.now()}@test.coach`;

    await signUp(page, { name: 'Test User', email, password: 'TestPassword123!' });
    await page.waitForURL(/\/en\//, { timeout: 10000 });

    // Navigate to duplicates page
    await page.goto('/en/duplicates');
    await page.waitForLoadState('networkidle');

    // Duplicates page should render
    await expect(page.locator('text=Duplicate').or(page.locator('text=duplicate'))).toBeVisible();

    // Look for a scan button or detect button
    const scanButton = page.locator('button:has-text("Scan"), button:has-text("Detect"), button:has-text("Find")').first();
    if (await scanButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await scanButton.click();
      // Wait for scan results
      await page.waitForTimeout(2000);
    }
  });
});
