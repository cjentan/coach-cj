import { prisma } from "../src/lib/prisma";

async function main() {
  const plans = await prisma.weeklyPlan.findMany({
    where: { userId: "962f701b-a2d2-445e-b52b-873cf9948ea8" },
    orderBy: { weekStartDate: "asc" },
    select: { weekStartDate: true, coachNotes: true, plannedSessions: true },
  });
  console.log(`total: ${plans.length}`);
  for (const p of plans) {
    const notes = (p.coachNotes ?? "").slice(0, 60);
    const s = (p.plannedSessions as any[]) ?? [];
    const trailWeekday = s.filter(x => x.type === "run" && x.dayOfWeek >= 1 && x.dayOfWeek <= 5 && /trail|Eko Flora|Gunung|Sireh|Rollercoaster/i.test(x.description ?? ""));
    console.log(`${p.weekStartDate.toISOString().slice(0,10)} | sessions=${s.length} | weekdayTrailRuns=${trailWeekday.length} | ${notes}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
