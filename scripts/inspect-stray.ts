import { prisma } from "../src/lib/prisma";

async function main() {
  const row = await prisma.weeklyPlan.findUnique({
    where: { userId_weekStartDate: { userId: "962f701b-a2d2-445e-b52b-873cf9948ea8", weekStartDate: new Date("2026-08-03T00:00:00.000Z") } },
  });
  if (!row) { console.log("no 2026-08-03 row"); return; }
  console.log("coachNotes:", row.coachNotes);
  console.log("adjustments:", JSON.stringify(row.adjustments, null, 2));
  console.log("generatedAt:", row.generatedAt.toISOString());
  console.log("overridesExisting:", row.overridesExisting);
  const sessions = (row.plannedSessions as any[]) ?? [];
  console.log("plannedSessions:", sessions.length);
}

main().catch((e) => { console.error(e); process.exit(1); });
