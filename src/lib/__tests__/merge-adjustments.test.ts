import { describe, it, expect } from "vitest";
import { mergeAdjustments } from "../ai-coach-tools";

describe("mergeAdjustments", () => {
  it("prepends the new entry and keeps 🏋️ phase entries", () => {
    const existing = ["🏋️ Base Phase W7: volume week"];
    const result = mergeAdjustments(existing, "🤖 AI Coach: weekend restructure");
    expect(result[0]).toBe("🤖 AI Coach: weekend restructure");
    expect(result).toContain("🏋️ Base Phase W7: volume week");
  });

  it("drops an older 🤖 entry that changed the same day as the new entry", () => {
    const existing = ["🤖 Friday set to rest day", "🏋️ Build Phase W1"];
    const result = mergeAdjustments(
      existing,
      "🤖 Friday updated to run: Tempo run on road",
      // dayOfWeek 5 == Friday
      [5]
    );
    // The superseded Friday rest entry is pruned; the phase entry is kept.
    expect(result).toEqual(["🤖 Friday updated to run: Tempo run on road", "🏋️ Build Phase W1"]);
  });

  it("keeps a Friday entry unchanged when the new entry touches a different day", () => {
    const existing = ["🤖 Friday updated to run: Tempo"];
    const result = mergeAdjustments(existing, "🤖 Tuesday set to rest day", [2]);
    expect(result).toEqual(["🤖 Tuesday set to rest day", "🤖 Friday updated to run: Tempo"]);
  });

  it("keeps full-week 🤖 narratives that are not single-day changes", () => {
    const existing = ["🤖 AI Coach: Reduce volume to 70km for taper"];
    const result = mergeAdjustments(existing, "🤖 AI Coach: Race week: 100km on Saturday", []);
    expect(result).toEqual([
      "🤖 AI Coach: Race week: 100km on Saturday",
      "🤖 AI Coach: Reduce volume to 70km for taper",
    ]);
  });

  it("caps the number of 🤖 entries to the configured maximum", () => {
    const existing = [
      "🤖 e1",
      "🤖 e2",
      "🤖 e3",
      "🤖 e4",
      "🤖 e5",
      "🤖 e6",
      "🤖 e7",
      "🤖 e8",
      "🤖 e9",
    ];
    const result = mergeAdjustments(existing, "🤖 newest", []);
    const aiCoachCount = result.filter((a) => a.startsWith("🤖")).length;
    expect(aiCoachCount).toBe(8); // newest + 7 oldest kept
    expect(result[0]).toBe("🤖 newest");
  });

  it("handles a null/undefined existing array (fresh plan)", () => {
    const result = mergeAdjustments(undefined, "🤖 first", [1]);
    expect(result).toEqual(["🤖 first"]);
    expect(mergeAdjustments(null, "🤖 first")).toEqual(["🤖 first"]);
  });

  it("does not duplicate an identical entry stacked on top of itself", () => {
    const existing = ["🤖 Friday updated to run: Tempo"];
    const result = mergeAdjustments(existing, "🤖 Friday updated to run: Tempo", [5]);
    expect(result).toEqual(["🤖 Friday updated to run: Tempo"]);
  });
});
