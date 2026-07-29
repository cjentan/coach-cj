import { test, expect } from '@playwright/test';
import { signUp } from '../../test-utils/auth';

test.describe('Sign Up → Onboarding → Dashboard', () => {
  test('complete new user flow', async ({ page }) => {
    const email = `e2e-${Date.now()}@test.coach`;

    // 1. Landing page
    await page.goto('/en/');
    await expect(page.locator('text=Coach')).toBeVisible();

    // 2. Navigate to signup
    await page.click('text=Get Started');
    await expect(page).toHaveURL(/\/en\/auth\/signup/);

    // 3. Fill signup form
    await signUp(page, {
      name: 'E2E Test User',
      email,
      password: 'TestPassword123!',
    });

    // 4. After signup, should redirect to onboarding
    await page.waitForURL(/\/en\/onboarding/, { timeout: 10000 });

    // 5. Complete onboarding (first step — set review day)
    await expect(page.locator('text=Welcome')).toBeVisible();

    // 6. Navigate through onboarding steps
    // The onboarding has multiple steps with "Next" / "Continue" buttons
    const continueBtn = page.locator('button:has-text("Continue"), button:has-text("Next"), button:has-text("Get Started")');
    for (let i = 0; i < 5; i++) {
      try {
        await continueBtn.first().click({ timeout: 2000 });
        await page.waitForTimeout(500);
      } catch {
        break; // no more steps
      }
    }

    // 7. Should land on dashboard
    await page.waitForURL(/\/en\/dashboard/, { timeout: 10000 });
    await expect(page.locator('text=Dashboard')).toBeVisible();
  });
});
