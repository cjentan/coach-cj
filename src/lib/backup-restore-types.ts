import type { Prisma } from "@prisma/client";

// ── Raw SQL row types (from $queryRawUnsafe) ──────────────────────────

export interface ActivityRow {
  id: string;
  userId: string;
  externalId: string | null;
  source: string;
  type: string;
  subType: string | null;
  name: string;
  description: string | null;
  remarks: string | null;
  coachAnalysis: string | null;
  analysisStatus: string | null;
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
  duplicateStatus: string | null;
  mergedIntoId: string | null;
  simplifiedTrackPoints: unknown;
  trackMinLat: number | null;
  trackMaxLat: number | null;
  trackMinLng: number | null;
  trackMaxLng: number | null;
  createdAt: Date;
}

export interface RawJsonRow {
  id: string;
  rawJson: unknown;
}

// ── Coach conversation with included messages and suggestions ─────────

export type CoachConversationWithRelations = Prisma.CoachConversationGetPayload<{
  include: { messages: true; suggestions: true };
}>;

// ── Serialized backup types (match JSON file structure) ───────────────

export interface BackupSettings {
  version: number;
  exportedAt: string;
  user: {
    name: string | null;
    email: string;
    settings: {
      reviewDayOfWeek: number;
      reviewTime: string;
      analysisTrigger: string;
      analysisTriggerValue: number;
      reviewDayOfMonth: number | null;
      trainingContext: string | null;
      llmProvider: string | null;
      llmBaseUrl: string | null;
      llmModel: string | null;
      llmApiKey: string | null;
      onboardingCompleted: boolean;
      dashboardPrefs: unknown;
      maxHr: number | null;
    };
  };
}

export interface SerializedActivity {
  id: string;
  externalId: string | null;
  source: string;
  type: string;
  subType: string | null;
  name: string;
  description: string | null;
  remarks: string | null;
  coachAnalysis: string | null;
  analysisStatus: string | null;
  isRace: boolean;
  startDate: string;
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
  duplicateStatus: string | null;
  mergedIntoId: string | null;
  simplifiedTrackPoints: unknown;
  trackMinLat: number | null;
  trackMaxLat: number | null;
  trackMinLng: number | null;
  trackMaxLng: number | null;
}

export interface SerializedGoal {
  id: string;
  name: string;
  raceType: string;
  targetDate: string;
  distanceMeters: number;
  elevationGainMeters: number | null;
  targetTimeSeconds: number | null;
  priority: string;
  status: string;
  notes: string | null;
  goalStatement: string | null;
  courseProfile: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface SerializedDuplicateGroup {
  id: string;
  status: string;
  resolution: string | null;
  keptActivityId: string | null;
  mergedAt: string | null;
  createdAt: string;
}

export interface SerializedBodyMetric {
  id: string;
  recordedAt: string;
  weightKg: number;
  heightCm: number | null;
  restingHr: number | null;
  notes: string | null;
  createdAt: string;
}

export interface SerializedWeeklyAssessment {
  id: string;
  weekStartDate: string;
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
  createdAt: string;
}

export interface SerializedWeeklyPlan {
  id: string;
  weekStartDate: string;
  generatedAt: string;
  targetVolumeMeters: number | null;
  targetElevationMeters: number | null;
  targetDurationSeconds: number | null;
  plannedSessions: unknown;
  adjustments: string[];
  trajectoryAssessment: string | null;
  coachNotes: string | null;
  overridesExisting: boolean;
  adjustmentHistory: unknown;
  anchorGoalId: string | null;
  createdAt: string;
}

export interface SerializedFatigueAlert {
  id: string;
  detectedAt: string;
  severity: string;
  signals: unknown;
  recommendation: string;
  recommendedRestDays: number;
  acknowledged: boolean;
  createdAt: string;
}

export interface SerializedDailyHealth {
  id: string;
  date: string;
  restingHeartRate: number | null;
  minHeartRate: number | null;
  maxHeartRate: number | null;
  sleepSeconds: number | null;
  deepSleepSeconds: number | null;
  lightSleepSeconds: number | null;
  remSleepSeconds: number | null;
  awakeSeconds: number | null;
  sleepScore: number | null;
  sleepStartLocal: string | null;
  sleepEndLocal: string | null;
  bodyBatteryMin: number | null;
  bodyBatteryMax: number | null;
  avgStress: number | null;
  maxStress: number | null;
  hrvBalance: number | null;
  hrvStatus: string | null;
  overnightHrv: number | null;
  steps: number | null;
  stepGoal: number | null;
  rawData: unknown;
}

export interface SerializedAnalysisReport {
  id: string;
  reportType: string;
  triggeredBy: string;
  inputSnapshot: unknown;
  outputContent: string | null;
  reasoning: unknown;
  metrics: unknown;
  createdAt: string;
}

export interface SerializedApiKey {
  id: string;
  name: string;
  keyHash: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface SerializedGarminSession {
  id: string;
  oauth1Token: unknown;
  oauth2Token: unknown;
  displayName: string | null;
  garminUserId: number | null;
  lastSyncAt: string | null;
  lastHealthSyncAt: string | null;
  connectedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface SerializedCorosSession {
  id: string;
  accessToken: string;
  corosUserId: string | null;
  displayName: string | null;
  lastSyncAt: string | null;
  connectedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface SerializedCoachMessage {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  suggestionId: string | null;
  tokenCount: number | null;
  createdAt: string;
}

export interface SerializedCoachSuggestion {
  id: string;
  conversationId: string;
  suggestionType: string;
  title: string;
  description: string;
  changes: unknown;
  status: string;
  createdAt: string;
  appliedAt: string | null;
}

export interface SerializedCoachConversation {
  id: string;
  title: string | null;
  status: string;
  contextSnapshot: unknown;
  createdAt: string;
  updatedAt: string;
  messages: SerializedCoachMessage[];
  suggestions: SerializedCoachSuggestion[];
}
