/**
 * Repro script for the "chat analysis doesn't offer to save" bug.
 * Exercises the real flow: intent detection → resolveActivityFromMessage →
 * analyzeActivity → analyzeActivityInChat, against the local DB.
 */
import { prisma } from "../src/lib/prisma";
import { isActivityAnalysisRequest } from "../src/lib/activity-analysis-intent";
import { analyzeActivity, analyzeActivityInChat } from "../src/lib/ai-coach";

async function main() {
  const user = await prisma.user.findFirst({
    select: { id: true, email: true, name: true },
  });
  if (!user) {
    console.log("NO USER FOUND");
    return;
  }
  console.log("USER:", user.email, user.id);

  const activity = await prisma.trainingLog.findFirst({
    where: { userId: user.id },
    select: { id: true, name: true, startDate: true },
    orderBy: { startDate: "desc" },
  });
  if (!activity) {
    console.log("NO ACTIVITY FOUND");
    return;
  }
  console.log("ACTIVITY:", activity.name, activity.id, activity.startDate?.toISOString());

  // 1. Intent detection
  const messages = [
    "Analyze this activity",
    "analyze my run today",
    "what did you think of my run yesterday?",
    "how was my session?",
    "review my long run",
    "tell me about my workout",
  ];
  console.log("\n-- INTENT DETECTION --");
  for (const m of messages) {
    console.log(JSON.stringify(m), "->", isActivityAnalysisRequest(m));
  }

  // 2. analyzeActivity with 4096 budget
  console.log("\n-- analyzeActivity --");
  const analysis = await analyzeActivity(user.id, activity.id, "en", { persist: false });
  if ("error" in analysis) {
    console.log("ANALYZE ERROR:", JSON.stringify(analysis));
  } else {
    console.log("OK. keys:", Object.keys(analysis), "| analysis len:", analysis.analysis?.length);
  }

  // 3. Full analyzeActivityInChat flow (activity-detail fast path)
  console.log("\n-- analyzeActivityInChat (activity-detail pageContext) --");
  const pageCtx = { page: "activity-detail" as const, activityId: activity.id };
  const conv = await prisma.coachConversation.create({
    data: { userId: user.id, status: "active" },
  });
  const chatResult = await analyzeActivityInChat(
    conv.id,
    user.id,
    "Analyze this activity",
    pageCtx,
    "en"
  );
  console.log("chat result:", JSON.stringify(chatResult).slice(0, 300));

  // 4. Same flow but WITHOUT activity-detail pageContext (e.g. user on another page)
  console.log("\n-- analyzeActivityInChat (NO pageContext — LLM resolution) --");
  const chatResult2 = await analyzeActivityInChat(
    conv.id,
    user.id,
    "Analyze this activity",
    null,
    "en"
  );
  console.log("chat result (no ctx):", JSON.stringify(chatResult2).slice(0, 300));

  // 5. Same flow with a more descriptive message
  console.log("\n-- analyzeActivityInChat (descriptive msg, no ctx) --");
  const chatResult3 = await analyzeActivityInChat(
    conv.id,
    user.id,
    `analyze my run from ${activity.startDate ? activity.startDate.toISOString().slice(0, 10) : "yesterday"}`,
    null,
    "en"
  );
  console.log("chat result (descriptive):", JSON.stringify(chatResult3).slice(0, 300));

  await prisma.coachConversation.delete({ where: { id: conv.id } });

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
