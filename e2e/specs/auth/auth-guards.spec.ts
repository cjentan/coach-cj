import { test, expect } from '@playwright/test';

test.describe('Auth guards — protected routes redirect to signin', () => {
  const protectedRoutes = [
    '/en/dashboard',
    '/en/activities',
    '/en/ingestion',
    '/en/settings',
    '/en/duplicates',
    '/en/training-plan',
  ];

  for (const route of protectedRoutes) {
    test(`redirects unauthenticated users from ${route} to signin`, async ({ page }) => {
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      // Should be redirected to signin page (with locale prefix)
      expect(page.url()).toContain('/auth/signin');
    });
  }

  test('allows access to landing page without auth', async ({ page }) => {
    await page.goto('/en/');
    await expect(page.locator('text=Coach')).toBeVisible();
    // Should NOT redirect to signin
    expect(page.url()).not.toContain('/auth/signin');
  });

  test('allows access to signin page without redirect loop', async ({ page }) => {
    await page.goto('/en/auth/signin');
    await expect(page.locator('input[type="email"]')).toBeVisible();
    // Should NOT redirect away from signin
    expect(page.url()).toContain('/auth/signin');
  });

  test('allows access to signup page without redirect loop', async ({ page }) => {
    await page.goto('/en/auth/signup');
    await expect(page.locator('button[type="submit"]')).toBeVisible();
    expect(page.url()).toContain('/auth/signup');
  });
});
