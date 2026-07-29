import { Page } from '@playwright/test';

const LOCAL = 'en';

export function localeUrl(path: string): string {
  return `/${LOCAL}${path}`;
}

export async function signUp(
  page: Page,
  user: { name: string; email: string; password: string },
) {
  await page.goto(localeUrl('/auth/signup'));
  await page.locator('input[name="name"]').fill(user.name);
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(user.password);
  await page.locator('button[type="submit"]').click();
}

export async function signIn(page: Page, email: string, password: string) {
  await page.goto(localeUrl('/auth/signin'));
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
}
