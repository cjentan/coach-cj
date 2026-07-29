import type {
  ActivitySource,
  ActivityType,
  ActivitySubType,
  GoalStatus,
  GoalPriority,
  DuplicateStatus,
  AlertSeverity,
} from '@prisma/client';

/** Generate a random UUID-like string for tests. */
export function testId(): string {
  return `test-${Math.random().toString(36).substring(2, 15)}-${Date.now()}`;
}

/** Build a mock User object. */
export function buildUser(overrides: Partial<{
  id: string;
  email: string;
  name: string;
  role: string;
  locale: string;
  onboardingCompleted: boolean;
}> = {}) {
  return {
    id: testId(),
    email: 'test@example.com',
    name: 'Test User',
    role: 'user',
    locale: 'en',
    onboardingCompleted: true,
    passwordHash: '$2a$10$...',
    resetToken: null,
    resetTokenExpiry: null,
    reviewDayOfWeek: 1,
    reviewTime: '18:00',
    reviewDayOfMonth: 1,
    analysisTrigger: 'weekly',
    analysisTriggerValue: 1,
    llmProvider: null,
    llmBaseUrl: null,
    llmModel: null,
    llmApiKey: null,
    trainingContext: null,
    dashboardPrefs: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** Build a mock TrainingLog object. */
export function buildTrainingLog(
  overrides: Partial<{
    id: string;
    userId: string;
    externalId: string | null;
    source: ActivitySource;
    type: ActivityType;
    subType: ActivitySubType | null;
    name: string;
    description: string | null;
    remarks: string | null;
    coachAnalysis: string | null;
    isRace: boolean;
    startDate: Date;
    durationSeconds: number;
    distanceMeters: number | null;
    elevationGainMeters: number | null;
    averageHr: number | null;
    maxHr: number | null;
    averagePower: number | null;
    normalizedPower: number | null;
    calories: number | null;
    tss: number | null;
    workoutType: string | null;
    duplicateGroupId: string | null;
    duplicateStatus: DuplicateStatus | null;
    mergedIntoId: string | null;
  }> = {},
) {
  return {
    id: testId(),
    userId: overrides.userId ?? 'test-user-id',
    externalId: null,
    source: 'garmin' as ActivitySource,
    type: 'run' as ActivityType,
    subType: null,
    name: 'Morning Run',
    description: null,
    remarks: null,
    coachAnalysis: null,
    isRace: false,
    startDate: new Date('2025-01-15'),
    durationSeconds: 3600,
    distanceMeters: 10000,
    elevationGainMeters: 100,
    averageHr: 150,
    maxHr: 175,
    averagePower: null,
    normalizedPower: null,
    calories: 500,
    tss: 100,
    workoutType: null,
    rawJson: null,
    simplifiedTrackPoints: null,
    trackMinLat: null,
    trackMaxLat: null,
    trackMinLng: null,
    trackMaxLng: null,
    duplicateGroupId: null,
    duplicateStatus: null,
    mergedIntoId: null,
    createdAt: new Date(),
    ...overrides,
  };
}

/** Build a mock RaceGoal object. */
export function buildRaceGoal(
  overrides: Partial<{
    id: string;
    userId: string;
    name: string;
    raceType: string;
    targetDate: Date;
    distanceMeters: number;
    elevationGainMeters: number | null;
    targetTimeSeconds: number | null;
    priority: GoalPriority;
    status: GoalStatus;
    notes: string | null;
    goalStatement: string | null;
    courseProfile: unknown;
  }> = {},
) {
  return {
    id: testId(),
    userId: 'test-user-id',
    name: 'Test Marathon',
    raceType: 'road_run',
    targetDate: new Date('2025-06-01'),
    distanceMeters: 42195,
    elevationGainMeters: null,
    targetTimeSeconds: 14400,
    priority: 'A' as GoalPriority,
    status: 'active' as GoalStatus,
    notes: null,
    goalStatement: null,
    courseProfile: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** Build a mock BodyMetric object. */
export function buildBodyMetric(
  overrides: Partial<{
    id: string;
    userId: string;
    recordedAt: Date;
    weightKg: number;
    heightCm: number | null;
    restingHr: number | null;
    notes: string | null;
  }> = {},
) {
  return {
    id: testId(),
    userId: 'test-user-id',
    recordedAt: new Date(),
    weightKg: 70,
    heightCm: 175,
    restingHr: 48,
    notes: null,
    createdAt: new Date(),
    ...overrides,
  };
}

/** Build a mock WeeklyAssessment object. */
export function buildWeeklyAssessment(
  overrides: Partial<{
    id: string;
    userId: string;
    weekStartDate: Date;
    acuteTrainingLoad: number | null;
    chronicTrainingLoad: number | null;
    tsb: number | null;
    readinessScore: number | null;
    fitnessScore: number | null;
    fatigueScore: number | null;
    formScore: number | null;
    weeklyVolumeMeters: number | null;
    weeklyElevationMeters: number | null;
    weeklyDurationSeconds: number | null;
    goalProgressPct: unknown;
    recommendations: string[];
    rawData: unknown;
  }> = {},
) {
  return {
    id: testId(),
    userId: 'test-user-id',
    weekStartDate: new Date('2025-01-13'),
    acuteTrainingLoad: 70,
    chronicTrainingLoad: 60,
    tsb: -10,
    readinessScore: 75,
    fitnessScore: 60,
    fatigueScore: 350,
    formScore: -10,
    weeklyVolumeMeters: 40000,
    weeklyElevationMeters: 500,
    weeklyDurationSeconds: 14400,
    goalProgressPct: null,
    recommendations: [],
    rawData: null,
    createdAt: new Date(),
    ...overrides,
  };
}

/** Build a trackpoint array for testing. */
export function buildTrackPoints(
  count: number,
  options: {
    baseHr?: number;
    basePower?: number;
    baseSpeed?: number;
  } = {},
): Array<{ hr?: number; power?: number; speed?: number; distance?: number }> {
  const { baseHr = 140, basePower = 200, baseSpeed = 3.5 } = options;
  return Array.from({ length: count }, (_, i) => ({
    hr: baseHr + Math.round(Math.sin(i / 100) * 20),
    power: basePower + Math.round(Math.sin(i / 50) * 50),
    speed: baseSpeed + Math.sin(i / 200) * 0.5,
    distance: i * 1.1,
  }));
}
