/**
 * Data-fix: reconcile a training plan week's `adjustments` and `target_volume_meters`.
 *
 * Background (the Sep 14, 2026 week for CJ Tan had these problems):
 *  - `adjustments` accumulated THREE contradictory narratives: the cancelled-race
 *    restructure, an earlier "race week" version, and the base-phase entry. Only the
 *    cancelled-race narrative matches the live `planned_sessions`; the stale "race
 *    week" one directly contradicted it.
 *  - `target_volume_meters` (94,000) disagreed with the actual sessions (82,000);
 *    it reflected the superseded base-phase target, not the saved session volumes.
 *
 * Fix for the targeted week:
 *  - Rebuild `adjustments` to the current, coherent state: the latest "🤖" AI-coach
 *    narrative (front) plus the "🏋️" phase entry (kept — the training-plan route
 *    uses it for phase detection). Contradictory older "🤖" narratives are dropped.
 *  - Recompute `target_volume_meters` from the sum of `planned_sessions[].targetDistance`
 *    so the declared weekly volume always matches the actual schedule.
 *
 * Run (tsx):
 *   node --env-file=.env --import tsx scripts/fix-weekly-plan-adjustments.ts \
 *     --user <id> --weekStart 2026-09-14
 * Defaults to CJ Tan's week of 2026-09-14.
 */
import { prisma } from "../src/lib/prisma";

function parseArgs(argv: string[]): { userId: string; weekStart: string } {
  let userId = "a815a640-2dfd-4e26-8829-50d833bff3da"; // CJ Tan
  let weekStart = "2026-09-14";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--user" && argv[i + 1]) userId = argv[i + 1];
    if (argv[i] === "--weekStart" && argv[i + 1]) weekStart = argv[i + 1];
  }
  return { userId, weekStart };
}

/**
 * Rebuild the `adjustments` array to a coherent current state:
 *  - Keep the newest "🤖" AI-coach narrative at the front.
 *  - Keep every "🏋️" phase entry (needed for phase detection).
 *  - Drop any older "🤖" narratives that are superseded/contradictory.
 */
function reconcileAdjustments(adjustments: string[] | null): string[] {
  const prior = Array.isArray(adjustments) ? adjustments : [];
  const aiCoach = prior.filter((a) => a.startsWith("🤖"));
  const phase = prior.filter((a) => a.startsWith("🏋️"));

  // Keep only the newest AI-coach narrative (the front/current one). Others are
  // superseded versions of the same week and contradict it.
  const current = aiCoach.length > 0 ? [aiCoach[0]] : [];

  // Guard against pushing the identical summary back on top of itself.
  if (current.length > 0 && phase.length > 0 && current[0] === phase[0]) {
    // not expected; defensive
  }
  return [...current, ...phase];
}

async function main() {
  const { userId, weekStart } = parseArgs(process.argv.slice(2));
  const weekStartDate = new Date(`${weekStart}T00:00:00.000Z`);

  const plan = await prisma.weeklyPlan.findUnique({
    where: { userId_weekStartDate: { userId, weekStartDate } },
  });
  if (!plan) {
    console.error(`No plan found for user ${userId} in week starting ${weekStart}.`);
    process.exit(1);
  }

  const sessions = (plan.plannedSessions as Array<Record<string, unknown>> | null) ?? [];
  const sessionSumM = sessions.reduce(
    (s, x) => s + (typeof x.targetDistance === "number" ? x.targetDistance : 0),
    0
  );

  const beforeAdj = plan.adjustments ?? [];
  const afterAdj = reconcileAdjustments(beforeAdj);
  const declaredBefore = plan.targetVolumeMeters;
  const declaredAfter = sessionSumM;

  console.log(`User:      ${userId}`);
  console.log(`Week:      ${weekStartDate.toISOString().slice(0, 10)}`);
  console.log(`Sessions:  ${sessions.length}`);
  console.log(`--- target_volume_meters ---`);
  console.log(`  before:  ${declaredBefore ?? "(null)"}`);
  console.log(`  after:   ${declaredAfter}  (sum of session targetDistance)`);
  console.log(`--- adjustments ---`);
  console.log(`  before (${beforeAdj.length}):`);
  beforeAdj.forEach((a, i) => console.log(`    [${i}] ${a.slice(0, 120)}`));
  console.log(`  after (${afterAdj.length}):`);
  afterAdj.forEach((a, i) => console.log(`    [${i}] ${a.slice(0, 120)}`));

  const volumeChanged = declaredBefore !== declaredAfter;
  const adjChanged =
    (beforeAdj ?? []).length !== afterAdj.length ||
    JSON.stringify(beforeAdj) !== JSON.stringify(afterAdj);

  if (!volumeChanged && !adjChanged) {
    console.log("\nNo changes needed.");
    await prisma.$disconnect();
    return;
  }

  console.log("\nApplying fix…");
  await prisma.weeklyPlan.update({
    where: { id: plan.id },
    data: {
      targetVolumeMeters: declaredAfter,
      adjustments: afterAdj,
    },
  });
  console.log("Done.");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
