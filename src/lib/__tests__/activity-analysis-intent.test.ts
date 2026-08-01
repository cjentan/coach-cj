import { describe, it, expect } from 'vitest';
import { isActivityAnalysisRequest } from '../activity-analysis-intent';

describe('isActivityAnalysisRequest', () => {
  it('matches the quick-action message', () => {
    expect(isActivityAnalysisRequest('Analyze this activity')).toBe(true);
  });

  it('matches free-form activity-analysis requests', () => {
    expect(isActivityAnalysisRequest('review my long run')).toBe(true);
    expect(isActivityAnalysisRequest('Can you analyze my 10k from last Sunday?')).toBe(true);
    expect(isActivityAnalysisRequest('how was my session?')).toBe(true);
    expect(isActivityAnalysisRequest('please assess this workout')).toBe(true);
    expect(isActivityAnalysisRequest('break down my interval session')).toBe(true);
  });

  it('does not match general training questions', () => {
    expect(isActivityAnalysisRequest('what pace should I run?')).toBe(false);
    expect(isActivityAnalysisRequest('review my training week')).toBe(false);
    expect(isActivityAnalysisRequest('how is my training plan going?')).toBe(false);
    expect(isActivityAnalysisRequest('recommend a rest day')).toBe(false);
  });

  it('handles empty / whitespace input', () => {
    expect(isActivityAnalysisRequest('')).toBe(false);
    expect(isActivityAnalysisRequest('   ')).toBe(false);
  });
});
