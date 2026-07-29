import { vi } from 'vitest';

/**
 * Mock the `auth()` function from NextAuth for testing API routes.
 *
 * Use this in route tests:
 *
 *   vi.mock('@/lib/auth');
 *   mockAuth();                 // default: user is authenticated
 *   mockAuth(null);             // user is unauthenticated
 *   mockAuth('custom-id', 'admin');
 */
export function mockAuth(
  userId: string | null = 'test-user-id',
  role = 'user',
) {
  const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));

  if (userId === null) {
    auth.mockResolvedValue(null);
  } else {
    auth.mockResolvedValue({
      user: {
        id: userId,
        role,
        name: 'Test User',
        email: 'test@example.com',
      },
    });
  }

  return auth;
}
