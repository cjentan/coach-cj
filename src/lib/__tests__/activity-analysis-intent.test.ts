import { describe, it, expect } from "vitest";
import { isActivityAnalysisRequest } from "../activity-analysis-intent";

describe("isActivityAnalysisRequest", () => {
  it("matches the quick-action message", () => {
    expect(isActivityAnalysisRequest("Analyze this activity")).toBe(true);
  });

  it("matches free-form activity-analysis requests", () => {
    expect(isActivityAnalysisRequest("review my long run")).toBe(true);
    expect(isActivityAnalysisRequest("Can you analyze my 10k from last Sunday?")).toBe(true);
    expect(isActivityAnalysisRequest("how was my session?")).toBe(true);
    expect(isActivityAnalysisRequest("please assess this workout")).toBe(true);
    expect(isActivityAnalysisRequest("break down my interval session")).toBe(true);
  });

  it("matches conversational activity-analysis requests", () => {
    expect(isActivityAnalysisRequest("What did you think of my run?")).toBe(true);
    expect(isActivityAnalysisRequest("what do you think about my workout today")).toBe(true);
    expect(isActivityAnalysisRequest("was my run good?")).toBe(true);
    expect(isActivityAnalysisRequest("did my interval session go well?")).toBe(true);
    expect(isActivityAnalysisRequest("tell me about my run")).toBe(true);
    expect(isActivityAnalysisRequest("can you look at my ride")).toBe(true);
    expect(isActivityAnalysisRequest("recap my tempo session")).toBe(true);
  });

  it("does not match general training questions", () => {
    expect(isActivityAnalysisRequest("what pace should I run?")).toBe(false);
    expect(isActivityAnalysisRequest("review my training week")).toBe(false);
    expect(isActivityAnalysisRequest("how is my training plan going?")).toBe(false);
    expect(isActivityAnalysisRequest("recommend a rest day")).toBe(false);
    // Broadened phrases still require an activity reference — "my week",
    // "the plan", "a rest day" are not specific activities.
    expect(isActivityAnalysisRequest("what did you think of this week?")).toBe(false);
    expect(isActivityAnalysisRequest("tell me about the training plan")).toBe(false);
    expect(isActivityAnalysisRequest("was my week good?")).toBe(false);
    expect(isActivityAnalysisRequest("look at next week")).toBe(false);
  });

  it("handles empty / whitespace input", () => {
    expect(isActivityAnalysisRequest("")).toBe(false);
    expect(isActivityAnalysisRequest("   ")).toBe(false);
  });
});
