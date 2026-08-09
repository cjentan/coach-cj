import { prisma } from "../src/lib/prisma";

async function main() {
  const plans = await prisma.weeklyPlan.findMany({
    where: { userId: "962f701b-a2d2-445e-b52b-873cf9948ea8" },
    orderBy: { weekStartDate: "asc" },
  });
  const dowLabel = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  for (const p of plans) {
    const s = (p.plannedSessions as any[]) ?? [];
    const wkRuns = s.filter(x => x.type === "run" && x.dayOfWeek >= 1 && x.dayOfWeek <= 5 && /trail|Eko Flora|Gunung|Sireh|Rollercoaster/i.test(x.description ?? ""));
    for (const t of wkRuns) {
      const isRoller = /rollercoaster/i.test(t.description ?? "");
      console.log(`${p.weekStartDate.toISOString().slice(0,10)} dow=${t.dayOfWeek}(${dowLabel[t.dayOfWeek]}) ${isRoller ? "[ALLOWED-Rollercoaster]" : "[VIOLATION?]"} ${(t.description ?? "").slice(0, 150)}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
