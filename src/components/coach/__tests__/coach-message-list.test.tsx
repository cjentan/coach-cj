// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CoachMessageList from '../coach-message-list';

// Mock scrollIntoView (not available in jsdom)
Element.prototype.scrollIntoView = vi.fn();

// Mock heavy deps
vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));
vi.mock('remark-gfm', () => ({
  default: () => {},
}));
vi.mock('@/components/coach/plan-proposal-card', () => ({
  default: () => <div data-testid="plan-proposal">Plan Proposal</div>,
}));
vi.mock('@/components/coach/training-plan-summary-card', () => ({
  default: () => <div data-testid="plan-summary">Plan Summary</div>,
}));
vi.mock('next-intl', () => require('@/test/mocks/next-intl'));

/**
 * The CoachMessageList component only renders the message area (including
 * suggestions, proposal, summary, and loading indicator) when messages.length > 0
 * OR when loading is true.
 */
describe('CoachMessageList', () => {
  const t = (key: string, values?: Record<string, string | number | boolean | Date | null | undefined>) => {
    // Mock t function that the component receives via props
    const translations: Record<string, string> = {
      apply: 'Apply',
      dismiss: 'Dismiss',
      conversationSummary: 'Earlier conversation summarized',
      trainingPlanProgress: 'Training Plan Progress',
      phase: 'Phase {phaseOrder}',
      weeksCount: '{count} weeks',
      sessionsCount: '{count} sessions',
      thinking: 'Thinking...',
      processing: 'Processing...',
      activity: 'Activity',
    };
    const val = translations[key] ?? key;
    if (values) {
      if (typeof values.count === 'number') {
        return val.replace('{count}', String(values.count));
      }
      if (typeof values.phaseOrder === 'number') {
        return val.replace('{phaseOrder}', String(values.phaseOrder));
      }
    }
    return val;
  };

  const sampleMessage = { id: 'm1', role: 'user' as const, content: 'Hello', createdAt: new Date().toISOString() };

  const defaultProps = {
    variant: 'default' as const,
    messages: [],
    suggestions: [],
    hasExistingPlan: false,
    currentProposal: null,
    completedPhases: [],
    loading: false,
    interviewStarting: false,
    phaseProgress: [],
    statusFeed: [],
    saveProgress: null,
    error: null,
    feedback: null,
    t,
    onApplySuggestion: vi.fn(),
    onDismissSuggestion: vi.fn(),
    onProposalChange: vi.fn(),
    onApproveProposal: vi.fn(),
    onAdjustProposal: vi.fn(),
  };

  it('renders nothing when no messages and not loading', () => {
    const { container } = render(<CoachMessageList {...defaultProps} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders user message on the right', () => {
    render(<CoachMessageList {...defaultProps} messages={[{ ...sampleMessage, content: 'Hello coach' }]} />);
    expect(screen.getByText('Hello coach')).toBeInTheDocument();
    const msg = screen.getByText('Hello coach').closest('.flex');
    expect(msg?.className).toContain('justify-end');
  });

  it('renders assistant message on the left', () => {
    render(<CoachMessageList {...defaultProps} messages={[{ ...sampleMessage, id: 'a1', role: 'assistant', content: 'Advice' }]} />);
    expect(screen.getByText('Advice')).toBeInTheDocument();
    const msg = screen.getByText('Advice').closest('.flex');
    expect(msg?.className).toContain('justify-start');
  });

  it('renders summary message with special styling', () => {
    render(<CoachMessageList {...defaultProps} messages={[{ ...sampleMessage, id: 'summary', role: 'assistant', content: 'Summary' }]} />);
    expect(screen.getByText('Summary')).toBeInTheDocument();
    expect(screen.getByText('Earlier conversation summarized')).toBeInTheDocument();
  });

  it('shows loading indicator when loading and no messages', () => {
    render(<CoachMessageList {...defaultProps} loading={true} />);
    expect(screen.getByText('Thinking...')).toBeInTheDocument();
  });

  it('shows error message', () => {
    render(<CoachMessageList {...defaultProps} error="An error occurred" />);
    expect(screen.getByText('An error occurred')).toBeInTheDocument();
  });

  it('shows feedback message', () => {
    render(<CoachMessageList {...defaultProps} feedback="Done!" />);
    expect(screen.getByText('Done!')).toBeInTheDocument();
  });

  it('renders suggestion cards when there are messages and existing plan', () => {
    render(<CoachMessageList
      {...defaultProps}
      messages={[{ ...sampleMessage, content: 'Plan updated' }]}
      hasExistingPlan={true}
      suggestions={[{ id: 's1', type: 'increase_volume', title: 'Increase Volume', description: 'More miles', status: 'pending' }]}
    />);
    expect(screen.getByText('Increase Volume')).toBeInTheDocument();
    expect(screen.getByText('More miles')).toBeInTheDocument();
  });

  it('calls onApplySuggestion when Apply is clicked', () => {
    const onApply = vi.fn();
    render(<CoachMessageList
      {...defaultProps}
      messages={[{ ...sampleMessage, content: 'Plan updated' }]}
      hasExistingPlan={true}
      suggestions={[{ id: 's1', type: 'increase_volume', title: 'Title', description: 'Desc', status: 'pending' }]}
      onApplySuggestion={onApply}
    />);
    fireEvent.click(screen.getByText('Apply'));
    expect(onApply).toHaveBeenCalledWith('s1');
  });

  it('calls onDismissSuggestion when Dismiss is clicked', () => {
    const onDismiss = vi.fn();
    render(<CoachMessageList
      {...defaultProps}
      messages={[{ ...sampleMessage, content: 'Plan updated' }]}
      hasExistingPlan={true}
      suggestions={[{ id: 's1', type: 'increase_volume', title: 'Title', description: 'Desc', status: 'pending' }]}
      onDismissSuggestion={onDismiss}
    />);
    fireEvent.click(screen.getByText('Dismiss'));
    expect(onDismiss).toHaveBeenCalledWith('s1');
  });

  it('renders plan proposal card when not loading and messages exist', () => {
    render(<CoachMessageList
      {...defaultProps}
      messages={[{ ...sampleMessage, content: 'Proposal ready' }]}
      currentProposal={{ proposedStartDate: '2025-01-01', phases: [], peakVolume: 80, goalRaceName: 'Marathon' }}
    />);
    expect(screen.getByTestId('plan-proposal')).toBeInTheDocument();
  });

  it('renders completed phases summary in floating mode with messages', () => {
    render(<CoachMessageList
      {...defaultProps}
      variant="floating"
      messages={[{ ...sampleMessage, content: 'Plan built' }]}
      completedPhases={[{ name: 'Phase 1', weekCount: 4, sessionCount: 16 }]}
    />);
    expect(screen.getByTestId('plan-summary')).toBeInTheDocument();
  });

  it('renders phase progress when loading', () => {
    render(<CoachMessageList
      {...defaultProps}
      loading={true}
      phaseProgress={[{
        phaseName: 'Base',
        phaseOrder: 1,
        phaseGoal: 'Build base',
        weekCount: 4,
        sessionsCount: 12,
        weeks: ['1', '2', '3', '4'],
      }]}
    />);
    expect(screen.getByText('Base')).toBeInTheDocument();
    expect(screen.getByText('Build base')).toBeInTheDocument();
  });

  it('renders save progress when loading', () => {
    render(<CoachMessageList
      {...defaultProps}
      loading={true}
      saveProgress={{ phaseName: 'Build', weekCurrent: 2, weekTotal: 4, message: 'Saving...' }}
    />);
    expect(screen.getByText('Saving...')).toBeInTheDocument();
    expect(screen.getByText('2/4')).toBeInTheDocument();
  });

  it('renders status feed entries when loading', () => {
    render(<CoachMessageList
      {...defaultProps}
      loading={true}
      statusFeed={[{ id: 1, text: 'Gathering data...', timestamp: 1000 }]}
    />);
    expect(screen.getByText('Gathering data...')).toBeInTheDocument();
  });
});
