/**
 * Shared mock for next-intl.
 * Usage: add `vi.mock('next-intl', () => require('@/test/mocks/next-intl'));`
 * to any component test file.
 */

const t = (key: string, values?: Record<string, string | number | boolean | Date | null | undefined>) => {
  // Return a sensible default for known keys
  const known: Record<string, string> = {
    'nav.dashboard': 'Dashboard',
    'nav.trainingPlan': 'Training Plan',
    'nav.activities': 'Activities',
    'nav.duplicates': 'Duplicates',
    'nav.import': 'Import',
    'nav.settings': 'Settings',
    'nav.admin': 'Admin',
    'nav.signOut': 'Sign Out',
    'nav.signIn': 'Sign In',
    'nav.getStarted': 'Get Started',
    'nav.more': 'More',
    'coach.loading': 'Loading...',
    'coach.title': 'Coach',
    'coach.placeholder': 'Type your message...',
    'coach.sendHint': 'Press Enter to send, Shift+Enter for new line',
    'coach.thinking': 'Thinking...',
    'coach.processing': 'Processing...',
    'coach.activity': 'Activity',
    'coach.analyze': 'Analyze',
    'coach.analyzing': 'Analyzing...',
    'coach.summarize': 'Summarize',
    'coach.summarizeTitle': 'Summarize conversation',
    'coach.analyzeTitle': 'Get coach analysis',
    'coach.apply': 'Apply',
    'coach.dismiss': 'Dismiss',
    'coach.conversationSummary': 'Earlier conversation summarized',
    'coach.trainingPlanProgress': 'Training Plan Progress',
    'coach.phase': 'Phase {phaseOrder}',
    'coach.weeksCount': '{count} weeks',
    'coach.sessionsCount': '{count} sessions',
    'coach.applied': 'Applied!',
    'training.activityName': 'Activity Name',
    'training.activityType': 'Type',
    'training.subType': 'Sub-type',
    'training.date': 'Date & Time',
    'training.duration': 'Duration',
    'training.distance': 'Distance (m)',
    'training.elevation': 'Elevation (m)',
    'training.description': 'Description',
    'training.save': 'Save',
    'activities.detail.elevationProfile': 'Elevation',
    'activities.detail.split': 'Split',
    'activities.detail.cumTime': 'Cum. Time',
    'activities.detail.pace': 'Pace',
    'activities.detail.gain': 'Gain',
    'activities.detail.loss': 'Loss',
    'activities.detail.seriesElevation': 'Elevation',
  };
  const val = known[key] ?? key;
  if (values && typeof values.count === 'number') {
    return values.count === 1 ? val.replace('{count}', '1').replace(/s$/, '') : val.replace('{count}', String(values.count));
  }
  if (values && typeof values.phaseOrder === 'number') {
    return val.replace('{phaseOrder}', String(values.phaseOrder));
  }
  return val;
};

module.exports = {
  useTranslations: () => t,
  useLocale: () => 'en',
  NextIntlClientProvider: ({ children }: { children: React.ReactNode }) => children,
};
