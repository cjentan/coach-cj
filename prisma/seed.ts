import { PrismaClient, SurfaceType, FacilityType } from "@prisma/client";
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

  // Create facilities
  const facilities = [
    {
      userId: user.id,
      name: "Gunung Pulai",
      type: "trail" as FacilityType,
      distanceMeters: 4500,
      elevationGainMeters: 550,
      surface: "tarmac" as SurfaceType,
      notes: "4.5km tarmac road with 550m elevation. Main hill repeat venue.",
    },
    {
      userId: user.id,
      name: "Power Trainer",
      type: "trainer" as FacilityType,
      surface: "trainer" as SurfaceType,
      notes: "Wahoo Kickr indoor trainer",
    },
    {
      userId: user.id,
      name: "Neighborhood Road Loop",
      type: "road" as FacilityType,
      distanceMeters: 5000,
      elevationGainMeters: 50,
      surface: "tarmac" as SurfaceType,
      notes: "Flat road loop for easy runs and tempo work",
    },
  ];

  const createdFacilities = await Promise.all(
    facilities.map((f) => prisma.trainingFacility.create({ data: f }))
  );
  console.log(`Created ${createdFacilities.length} facilities`);

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

  // Create availability
  const schedule = [
    { dayOfWeek: 1, startTime: "06:00", endTime: "07:30", facilityIds: [createdFacilities[2].id] },
    { dayOfWeek: 2, startTime: "18:00", endTime: "20:00", facilityIds: [createdFacilities[1].id] },
    { dayOfWeek: 3, startTime: "06:00", endTime: "07:30", facilityIds: [createdFacilities[2].id] },
    { dayOfWeek: 4, startTime: "18:00", endTime: "20:00", facilityIds: [createdFacilities[1].id] },
    { dayOfWeek: 5, startTime: "06:00", endTime: "07:30", facilityIds: [createdFacilities[2].id] },
    { dayOfWeek: 6, startTime: "05:30", endTime: "10:00", facilityIds: [createdFacilities[0].id, createdFacilities[2].id] },
  ];

  for (const s of schedule) {
    await prisma.trainingAvailability.create({
      data: { ...s, userId: user.id },
    });
  }
  console.log("Created training schedule");

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
