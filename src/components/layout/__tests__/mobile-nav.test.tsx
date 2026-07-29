// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MobileNav } from '../mobile-nav';

const mocks = vi.hoisted(() => ({
  nextIntl: {
    useTranslations: () => (key: string) => key,
    useLocale: () => 'en',
  },
  nextAuth: { useSession: vi.fn(), signOut: vi.fn() },
  navigation: { usePathname: () => '/' },
}));

vi.mock('next-intl', () => mocks.nextIntl);
vi.mock('next-auth/react', () => mocks.nextAuth);
vi.mock('next/navigation', () => mocks.navigation);

describe('MobileNav', () => {
  it('returns null when no session', () => {
    mocks.nextAuth.useSession.mockReturnValue({ data: null, status: 'unauthenticated' });
    const { container } = render(<MobileNav />);
    expect(container.innerHTML).toBe('');
  });

  it('renders bottom nav items when authenticated', () => {
    mocks.nextAuth.useSession.mockReturnValue({
      data: { user: { id: 'u1', role: 'user' } },
      status: 'authenticated',
    });
    render(<MobileNav />);
    expect(screen.getByText('activities')).toBeInTheDocument();
    expect(screen.getByText('dashboard')).toBeInTheDocument();
    expect(screen.getByText('more')).toBeInTheDocument();
  });

  it('opens more menu when More is clicked', () => {
    mocks.nextAuth.useSession.mockReturnValue({
      data: { user: { id: 'u1', role: 'user' } },
      status: 'authenticated',
    });
    render(<MobileNav />);
    fireEvent.click(screen.getByText('more'));
    expect(screen.getByText('trainingPlan')).toBeInTheDocument();
    expect(screen.getByText('import')).toBeInTheDocument();
    expect(screen.getByText('settings')).toBeInTheDocument();
  });

  it('shows admin in more menu for admin users', () => {
    mocks.nextAuth.useSession.mockReturnValue({
      data: { user: { id: 'u1', role: 'admin' } },
      status: 'authenticated',
    });
    render(<MobileNav />);
    fireEvent.click(screen.getByText('more'));
    expect(screen.getByText('admin')).toBeInTheDocument();
  });

  it('hides admin in more menu for regular users', () => {
    mocks.nextAuth.useSession.mockReturnValue({
      data: { user: { id: 'u1', role: 'user' } },
      status: 'authenticated',
    });
    render(<MobileNav />);
    fireEvent.click(screen.getByText('more'));
    expect(screen.queryByText('admin')).not.toBeInTheDocument();
  });

  it('calls signOut when sign out is clicked in more menu', () => {
    mocks.nextAuth.useSession.mockReturnValue({
      data: { user: { id: 'u1', role: 'user' } },
      status: 'authenticated',
    });
    render(<MobileNav />);
    fireEvent.click(screen.getByText('more'));
    fireEvent.click(screen.getByText('signOut'));
    expect(mocks.nextAuth.signOut).toHaveBeenCalledWith({ redirectTo: '/' });
  });
});
