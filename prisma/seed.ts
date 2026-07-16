import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  // Create demo user
  const passwordHash = await hash("password123", 12);
  const user = await prisma.user.upsert({
    where: { email: "demo@coach.app" },
    update: {},
    create: {
      email: "demo@coach.app",
      name: "Alex Tan",
      passwordHash,
      role: "admin",
    },
  });

  console.log(`Created user: ${user.email}`);

  // Create a race goal
  await prisma.raceGoal.create({
    data: {
      userId: user.id,
      name: "Ultra Trail 100km",
      raceType: "trail_run",
      targetDate: new Date("2026-10-15"),
      distanceMeters: 100000,
      elevationGainMeters: 6000,
      priority: "A",
      notes: "Goal race for 2026. Need strong elevation legs and nutrition plan.",
    },
  });

  console.log("Created race goal");

  // Create body metrics
  const metrics = [
    { recordedAt: new Date("2026-06-01"), weightKg: 72.5, restingHr: 52 },
    { recordedAt: new Date("2026-06-08"), weightKg: 72.2, restingHr: 51 },
    { recordedAt: new Date("2026-06-15"), weightKg: 71.8, restingHr: 53 },
    { recordedAt: new Date("2026-06-22"), weightKg: 71.5, restingHr: 50 },
    { recordedAt: new Date("2026-06-29"), weightKg: 71.3, restingHr: 51 },
    { recordedAt: new Date("2026-07-06"), weightKg: 71.0, restingHr: 54 },
  ];

  for (const m of metrics) {
    await prisma.bodyMetric.create({
      data: { ...m, userId: user.id },
    });
  }
  console.log("Created body metrics");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
