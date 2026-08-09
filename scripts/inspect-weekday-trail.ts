import { prisma } from "../src/lib/prisma";

async function main() {
  const plans = await prisma.weeklyPlan.findMany({
    where: { userId: "962f701b-a2d2-445e-b52b-873cf9948ea8" },
    orderBy: { weekStartDate: "asc" },
  });
  const dowLabel = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  for (const p of plans) {
    const s = (p.plannedSessions as any[]) ?? [];
    const wkTrailRuns = s.filter((x) => {
      if (x.type !== "run") return false;         // actual run sessions only
      if (!(x.description ?? "").toLowerCase().includes("trail")) return false;
      return x.dayOfWeek >= 1 && x.dayOfWeek <= 5; // Mon-Fri
    });
    for (const t of wkTrailRuns) {
      console.log(`${p.weekStartDate.toISOString().slice(0,10)} dow=${t.dayOfWeek}(${dowLabel[t.dayOfWeek]}) ${(t.description ?? "").slice(0,110)}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
