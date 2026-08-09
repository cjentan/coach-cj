import { prisma } from "../src/lib/prisma";

async function main() {
  const plans = await prisma.weeklyPlan.findMany({
    where: { userId: "962f701b-a2d2-445e-b52b-873cf9948ea8" },
    orderBy: { weekStartDate: "asc" },
  });
  console.log(`total weekly plans: ${plans.length}`);
  for (const p of plans) {
    const s = (p.plannedSessions as any[]) ?? [];
    const trail = s.filter((x) => (x.description ?? "").toLowerCase().includes("trail"));
    const weekdayTrail = trail.filter((x) => {
      const dow = x.dayOfWeek;
      // 1=Mon..5=Fri weekdays; 0=Sun,6=Sat weekend
      return dow >= 1 && dow <= 5;
    });
    const runByDow: Record<number, number> = {};
    for (const x of s) runByDow[x.dayOfWeek] = (runByDow[x.dayOfWeek] ?? 0) + 1;
    console.log(`${p.weekStartDate.toISOString().slice(0,10)} | sessions=${s.length} | trail=${trail.length} (weekday-trail=${weekdayTrail.length}) | runs per dow: ${JSON.stringify(runByDow)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
