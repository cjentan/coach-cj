/** Inspect how rest vs workout days are typed in persisted weekly plans. */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const userId = process.env.USER_ID || "962f701b-a2d2-445e-b52b-873cf9948ea8";
  const plans = await prisma.weeklyPlan.findMany({
    where: { userId },
    select: { id: true, weekStartDate: true, plannedSessions: true },
    orderBy: { weekStartDate: "asc" },
    take: 4,
  });
  const typeCounts: Record<string, number> = {};
  let total = 0;
  for (const p of plans) {
    const sessions = (p.plannedSessions as Array<Record<string, unknown>>) ?? [];
    console.log(`\n[${p.weekStartDate.toISOString().split("T")[0]}] ${sessions.length} sessions`);
    for (const s of sessions) {
      const type = String(s.type ?? "(none)");
      const dist = s.targetDistance as number | undefined;
      typeCounts[type] = (typeCounts[type] ?? 0) + 1;
      total++;
      console.log(`  dow=${s.dayOfWeek} type=${type.padEnd(8)} dist=${dist ?? "?"}  ${String(s.description ?? "").slice(0, 60)}`);
    }
  }
  console.log(`\n=== type distribution over ${total} sessions ===`);
  for (const [t, c] of Object.entries(typeCounts)) console.log(`  ${t}: ${c}`);
}

main().then(() => prisma.$disconnect()).catch((e) => { console.error(e); process.exit(1); });
