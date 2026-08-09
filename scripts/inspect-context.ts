import { gatherTrainingContext } from "../src/lib/training-context";

async function main() {
  const ctx = await gatherTrainingContext("962f701b-a2d2-445e-b52b-873cf9948ea8");
  console.log("=== trainingContext field ===");
  console.log(ctx.trainingContext ?? "(null)");
  console.log("\n=== keys ===");
  console.log(Object.keys(ctx).join(", "));
}

main().catch((e) => { console.error(e); process.exit(1); });
