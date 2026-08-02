// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ImportModal from '../import-modal';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'en',
}));
vi.mock('@/lib/constants', () => ({
  ACTIVITY_TYPES: [
    { value: 'run', label: 'Run', icon: () => null },
    { value: 'ride', label: 'Ride', icon: () => null },
    { value: 'swim', label: 'Swim', icon: () => null },
  ],
  SUB_TYPE_OPTIONS: {
    run: [
      { value: 'trail', label: 'Trail' },
      { value: 'road', label: 'Road' },
    ],
  },
}));

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

describe('ImportModal', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    onImport: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders dialog when open is true', () => {
    render(<ImportModal {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows dialog title', () => {
    render(<ImportModal {...defaultProps} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('Import Activity');
  });

  it('shows validation error for empty duration on form submit', async () => {
    render(<ImportModal {...defaultProps} />);

    // Find the form inside the dialog portal and submit it directly
    const form = document.querySelector('form');
    expect(form).toBeInTheDocument();
    fireEvent.submit(form!);

    await waitFor(() => {
      const dialog = screen.getByRole('dialog');
      expect(dialog.textContent).toContain('Enter a valid duration');
    });
  });

  it('sends manual entry on submit with valid data', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    const onImport = vi.fn();
    const onOpenChange = vi.fn();

    render(<ImportModal {...defaultProps} onImport={onImport} onOpenChange={onOpenChange} />);

    await user.type(screen.getByPlaceholderText('Morning Run'), 'Test Run');
    await user.type(screen.getByPlaceholderText('Min'), '30');

    const saveBtn = screen.getByRole('button', { name: /save/i });
    await user.click(saveBtn);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(onImport).toHaveBeenCalledTimes(1);
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('shows server error on failed submit', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Server error' }),
    });

    render(<ImportModal {...defaultProps} />);
    await user.type(screen.getByPlaceholderText('Morning Run'), 'Test Run');
    await user.type(screen.getByPlaceholderText('Min'), '30');

    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      const dialog = screen.getByRole('dialog');
      expect(dialog.textContent).toContain('Server error');
    });
  });

  it('shows upload content when switching tabs', async () => {
    const user = userEvent.setup();
    render(<ImportModal {...defaultProps} />);

    const uploadTab = screen.getByRole('tab', { name: /file upload/i });
    await user.click(uploadTab);

    await waitFor(() => {
      const dialog = screen.getByRole('dialog');
      expect(dialog.textContent).toMatch(/click to select/i);
    });
  });

  it('handles network error', async () => {
    const user = userEvent.setup();
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    render(<ImportModal {...defaultProps} />);
    await user.type(screen.getByPlaceholderText('Morning Run'), 'Test Run');
    await user.type(screen.getByPlaceholderText('Min'), '30');

    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      const dialog = screen.getByRole('dialog');
      expect(dialog.textContent).toContain('Network error');
    });
  });
});
