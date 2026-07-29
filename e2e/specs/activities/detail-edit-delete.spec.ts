import { test, expect } from '@playwright/test';
import { signUp } from '../../test-utils/auth';

test.describe('Activity CRUD', () => {
  test('creates a manual activity, views it, and verifies it appears', async ({ page }) => {
    const email = `e2e-${Date.now()}@test.coach`;

    // Sign up first
    await signUp(page, { name: 'Test User', email, password: 'TestPassword123!' });
    await page.waitForURL(/\/en\//, { timeout: 10000 });

    // Navigate to activities via ingestion (manual entry)
    await page.goto('/en/ingestion');
    await page.waitForLoadState('networkidle');

    // Fill manual entry form
    const nameInput = page.locator('input[placeholder="Morning Run"]');
    await nameInput.fill('E2E Test Run');

    const minInput = page.locator('input[placeholder="Min"]');
    await minInput.fill('45');

    // Submit
    await page.locator('button[type="submit"]').click();

    // Wait for redirect back to activities after successful creation
    await page.waitForURL(/\/en\/activities/, { timeout: 10000 });

    // Verify the activity appears in the list
    await expect(page.locator('text=E2E Test Run')).toBeVisible({ timeout: 5000 });
  });

  test('views activity list page', async ({ page }) => {
    const email = `e2e-${Date.now()}@test.coach`;

    await signUp(page, { name: 'Test User', email, password: 'TestPassword123!' });
    await page.waitForURL(/\/en\//, { timeout: 10000 });

    // Go to activities page
    await page.goto('/en/activities');
    await page.waitForLoadState('networkidle');

    // Activity list page should render (even if empty)
    await expect(page.locator('text=Activities').or(page.locator('text=activities'))).toBeVisible();
  });
});
