/**
 * Global admin toggle for which training-plan generation engine the coach uses.
 *
 * Stored as an `AppSetting` row keyed `plan_generation_engine` (values "v1" |
 * "v2"). Read on every plan approval so the admin flip takes effect immediately
 * (no cache). "v1" (the original one-call-per-phase engine) is the default.
 */

import { prisma } from "./prisma";

export const PLAN_GENERATION_ENGINE_KEY = "plan_generation_engine";

export type PlanGenerationEngine = "v1" | "v2";

export async function resolvePlanGenerationEngine(): Promise<PlanGenerationEngine> {
  const row = await prisma.appSetting.findUnique({ where: { key: PLAN_GENERATION_ENGINE_KEY } });
  return row?.value === "v2" ? "v2" : "v1";
}
