import { vi } from 'vitest';

/**
 * Create a fully-mocked Prisma client for integration tests.
 *
 * Every model method returns a vi.fn() by default, so tests can override
 * individual methods without setting up the full object.
 */
export function createMockPrisma() {
  const modelMethods = [
    'findMany',
    'findUnique',
    'findFirst',
    'create',
    'createMany',
    'update',
    'updateMany',
    'upsert',
    'delete',
    'deleteMany',
    'count',
    'aggregate',
  ];

  const makeMockModel = () => {
    const model: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of modelMethods) {
      model[method] = vi.fn();
    }
    return model;
  };

  return {
    user: makeMockModel(),
    trainingLog: makeMockModel(),
    raceGoal: makeMockModel(),
    bodyMetric: makeMockModel(),
    weeklyAssessment: makeMockModel(),
    weeklyPlan: makeMockModel(),
    duplicateGroup: makeMockModel(),
    fatigueAlert: makeMockModel(),
    dailyHealth: makeMockModel(),
    analysisReport: makeMockModel(),
    apiKey: makeMockModel(),
    garminSession: makeMockModel(),
    corosSession: makeMockModel(),
    coachConversation: makeMockModel(),
    coachMessage: makeMockModel(),
    coachSuggestion: makeMockModel(),
    appSetting: makeMockModel(),
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  };
}
