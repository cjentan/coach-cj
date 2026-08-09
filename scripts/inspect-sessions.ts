import { prisma } from "../src/lib/prisma";

async function main() {
  const plans = await prisma.weeklyPlan.findMany({
    where: { userId: "962f701b-a2d2-445e-b52b-873cf9948ea8" },
    orderBy: { weekStartDate: "asc" },
    take: 3,
  });
  for (const p of plans) {
    console.log(`\n===== WEEK ${p.weekStartDate.toISOString().slice(0,10)} =====`);
    for (const s of (p.plannedSessions as any[]) ?? []) {
      const desc = (s.description ?? "").toLowerCase();
      const isTrail = desc.includes("trail");
      const dowLabel = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][s.dayOfWeek ?? -1];
      console.log(`dow=${s.dayOfWeek}(${dowLabel}) type=${s.type} dist=${s.targetDistance}m${isTrail ? " [TRAIL]" : ""}`);
      console.log(`   ${(s.description ?? "").slice(0, 200)}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
