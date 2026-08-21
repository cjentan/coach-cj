/**
 * Headless benchmark for plan generation (v2 engine) — used for bottleneck
 * troubleshooting. Calls approvePlanProposalV2 directly against the real DB,
 * capturing all [plan-v2] / [llm] / [coach] console output to stdout.
 *
 * Run from repo root (so prisma loads .env):
 *   USER_ID=962f701b-a2d2-445e-b52b-873cf9948ea8 \
 *   CONVERSATION_ID=6f933db2-3d01-4ffb-8178-abaded3020b0 \
 *   npx tsx scripts/bench-plan.ts 2>&1 | tee /tmp/plan-v2-bench.log
 */

import { approvePlanProposalV2 } from "../src/lib/plan-generation-v2";

async function main(): Promise<void> {
  const userId = process.env.USER_ID;
  const conversationId = process.env.CONVERSATION_ID;
  if (!userId || !conversationId) {
    console.error("[bench] USER_ID and CONVERSATION_ID env vars required");
    process.exit(2);
  }

  const flowT0 = Date.now();
  console.log(`[bench] start conv=${conversationId} user=${userId}`);

  // Progress callback mirrors the SSE stream the UI would receive, so we can
  // see the same status/progress/tool events the frontend sees.
  const result = await approvePlanProposalV2(
    conversationId,
    userId,
    {
      onProgress: (event) => {
        console.log(`[bench:event] ${JSON.stringify(event)}`);
      },
    },
    "en",
  );

  const dur = Date.now() - flowT0;
  console.log(`[bench] RESULT: ${JSON.stringify(result)}`);
  console.log(`[bench] TOTAL ${dur}ms`);

  if ("success" in result && result.success) {
    process.exit(0);
  }
  process.exit(1);
}

main().catch((err) => {
  console.error(`[bench] THREW: ${(err as Error).message}`);
  process.exit(1);
});
