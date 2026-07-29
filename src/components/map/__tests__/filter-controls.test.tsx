// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FilterControls from '../filter-controls';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'en',
}));

describe('FilterControls', () => {
  const defaultFilters = { type: 'all', dateFrom: '', dateTo: '' };
  const defaultProps = {
    filters: defaultFilters,
    onChange: vi.fn(),
    activityCount: 10,
    needsBackfill: 0,
    building: false,
    onBuildHeatmap: vi.fn(),
    loading: false,
  };

  it('renders title and activity count', () => {
    render(<FilterControls {...defaultProps} />);
    // The translation mock returns the key: t('title') = 'title'
    expect(screen.getByText('title')).toBeInTheDocument();
    // Activity count is split across multiple text nodes: "10", " activity", "ies"
    // Use a function matcher to find the combined text
    expect(screen.getByText((content) => content.includes('10') && content.includes('activity'))).toBeInTheDocument();
  });

  it('renders singular activity count', () => {
    render(<FilterControls {...defaultProps} activityCount={1} />);
    expect(screen.getByText(/1 activity/)).toBeInTheDocument();
  });

  it('shows backfill prompt when needsBackfill > 0', () => {
    render(<FilterControls {...defaultProps} needsBackfill={5} />);
    expect(screen.getByText(/5 activity/)).toBeInTheDocument();
    // Button text is t('build') = 'build' with the key-returning mock
    expect(screen.getByRole('button', { name: 'build' })).toBeInTheDocument();
  });

  it('calls onBuildHeatmap when build button is clicked', () => {
    const onBuildHeatmap = vi.fn();
    render(<FilterControls {...defaultProps} needsBackfill={5} onBuildHeatmap={onBuildHeatmap} />);
    fireEvent.click(screen.getByRole('button', { name: 'build' }));
    expect(onBuildHeatmap).toHaveBeenCalledTimes(1);
  });

  it('disables build button when building', () => {
    render(<FilterControls {...defaultProps} needsBackfill={5} building={true} />);
    // When building, the button shows a spinner with 'Building heatmap…' text
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
  });

  it('shows loading spinner when loading is true', () => {
    const { container } = render(<FilterControls {...defaultProps} loading={true} />);
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('renders label text from translation keys', () => {
    render(<FilterControls {...defaultProps} />);
    // t('activityType') returns 'activityType' with key-returning mock
    expect(screen.getByText('activityType')).toBeInTheDocument();
  });

  it('does not render filter details when activityCount is 0', () => {
    render(<FilterControls {...defaultProps} activityCount={0} />);
    expect(screen.queryByText('activityType')).not.toBeInTheDocument();
  });
});
