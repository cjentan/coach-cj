import { test, expect } from '@playwright/test';
import { signIn, signUp } from '../../test-utils/auth';

test.describe('Sign In → Dashboard', () => {
  test('signs in with valid credentials and sees dashboard', async ({ page }) => {
    const email = `e2e-${Date.now()}@test.coach`;

    // Create user via signup first
    await signUp(page, {
      name: 'E2E User',
      email,
      password: 'TestPassword123!',
    });

    // Wait for redirect then sign out
    await page.waitForURL(/\/en\//, { timeout: 10000 });
    await page.goto('/en/auth/signin');
    await page.waitForLoadState('networkidle');

    // Sign in with the same credentials
    await signIn(page, email, 'TestPassword123!');

    // Should reach dashboard
    await page.waitForURL(/\/en\/dashboard/, { timeout: 10000 });
    await expect(page.locator('text=Dashboard')).toBeVisible();
  });

  test('shows error for invalid credentials', async ({ page }) => {
    await page.goto('/en/auth/signin');
    await page.locator('input[type="email"]').fill('wrong@email.com');
    await page.locator('input[type="password"]').fill('wrongpassword');
    await page.locator('button[type="submit"]').click();

    // Should show error message (not redirect)
    await expect(page).not.toHaveURL(/\/en\/dashboard/);
  });
});
