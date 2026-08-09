import { prisma } from "../src/lib/prisma";

async function main() {
  const plans = await prisma.weeklyPlan.findMany({
    where: { userId: "962f701b-a2d2-445e-b52b-873cf9948ea8" },
    orderBy: { weekStartDate: "asc" },
  });
  const dowLabel = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  let wedTrail = 0, weekdayNonRoller = 0, weekendTrail = 0, totalRuns = 0;
  for (const p of plans) {
    const s = (p.plannedSessions as any[]) ?? [];
    for (const x of s) {
      if (x.type !== "run") continue;
      totalRuns++;
      const d = x.dayOfWeek;
      const isTrail = /trail|Eko Flora|Gunung|Sireh|Rollercoaster/i.test(x.description ?? "");
      const isRoller = /rollercoaster/i.test(x.description ?? "");
      if (d === 3) { // Wednesday
        console.log(`${p.weekStartDate.toISOString().slice(0,10)} WED: ${(x.description ?? "").slice(0,90)}`);
        if (isTrail) wedTrail++;
      }
      if (isTrail && d >= 1 && d <= 5 && !isRoller) weekdayNonRoller++;
      if (isTrail && (d === 0 || d === 6)) weekendTrail++;
    }
  }
  console.log(`\n=== totals (21 plan weeks) ===`);
  console.log(`run sessions: ${totalRuns}`);
  console.log(`Wednesday trail runs: ${wedTrail}`);
  console.log(`weekday trail runs that are NOT Rollercoaster: ${weekdayNonRoller}`);
  console.log(`weekend trail runs (allowed): ${weekendTrail}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
