import { PmcResult, computeMonotony, computeStrain } from "./pmc";

export interface FatigueSignal {
  signal: string;
  value: number;
  threshold: number;
  contribution: number; // 0-1, how much this contributes to severity
}

export type FatigueSeverity = "low" | "medium" | "high" | "critical";

export interface FatigueResult {
  severity: FatigueSeverity;
  score: number; // 0-100 (higher = more fatigued)
  signals: FatigueSignal[];
  recommendation: string;
  recommendedRestDays: number;
}

interface InputData {
  pmcResults: PmcResult[];
  dailyTss: number[];
  restingHrHistory: { date: string; value: number }[];
  weightHistory: { date: string; weightKg: number }[];
  recentAvgHr: number | null;
  baselineAvgHr: number | null;
  // Trackpoint-derived signals (optional — only when rich data is available)
  avgDecouplingPct?: number | null;
  efTrend?: { weekStart: string; ef: number }[] | null;
  intensityDistribution?: { zone1Pct: number; zone2Pct: number; zone3Pct: number; zone4Pct: number; zone5Pct: number; distributionType: string } | null;
}

export function detectFatigue(data: InputData): FatigueResult {
  const signals: FatigueSignal[] = [];
  let score = 0;

  // Signal 1: TSB Depth (current TSB value)
  const latestPmc = data.pmcResults[data.pmcResults.length - 1];
  if (latestPmc) {
    const tsb = latestPmc.tsb;
    signals.push({
      signal: "TSB Depth",
      value: Math.round(tsb * 10) / 10,
      threshold: -10,
      contribution: tsb < -30 ? 1.0 : tsb < -20 ? 0.7 : tsb < -10 ? 0.3 : 0,
    });
  }

  // Signal 2: TSB Duration (consecutive days below zero)
  let consecutiveNegativeTsb = 0;
  for (let i = data.pmcResults.length - 1; i >= 0; i--) {
    if (data.pmcResults[i].tsb < 0) consecutiveNegativeTsb++;
    else break;
  }
  signals.push({
    signal: "TSB Duration",
    value: consecutiveNegativeTsb,
    threshold: 14,
    contribution: consecutiveNegativeTsb > 21 ? 1.0 : consecutiveNegativeTsb > 14 ? 0.6 : consecutiveNegativeTsb > 7 ? 0.3 : 0,
  });

  // Signal 3: Resting HR Drift
  if (data.restingHrHistory.length >= 3) {
    const recent = data.restingHrHistory.slice(-3);
    const older = data.restingHrHistory.slice(-14, -3);
    const recentAvg = recent.reduce((a, b) => a + b.value, 0) / recent.length;
    const olderAvg = older.length > 0 ? older.reduce((a, b) => a + b.value, 0) / older.length : recentAvg;
    const drift = recentAvg - olderAvg;
    signals.push({
      signal: "Resting HR Drift",
      value: Math.round(drift * 10) / 10,
      threshold: 5,
      contribution: drift > 8 ? 1.0 : drift > 5 ? 0.6 : drift > 3 ? 0.3 : 0,
    });
  }

  // Signal 4: Exercise HR Drift
  if (data.recentAvgHr !== null && data.baselineAvgHr !== null && data.baselineAvgHr > 0) {
    const drift = data.recentAvgHr - data.baselineAvgHr;
    signals.push({
      signal: "Exercise HR Drift",
      value: Math.round(drift * 10) / 10,
      threshold: 6,
      contribution: drift > 10 ? 1.0 : drift > 6 ? 0.6 : drift > 3 ? 0.3 : 0,
    });
  }

  // Signal 5: Training Monotony
  const monotony = computeMonotony(data.dailyTss);
  signals.push({
    signal: "Training Monotony",
    value: monotony,
    threshold: 0.8,
    contribution: monotony > 1.2 ? 1.0 : monotony > 0.8 ? 0.6 : 0,
  });

  // Signal 6: Training Strain
  const strain = computeStrain(data.dailyTss);
  signals.push({
    signal: "Training Strain",
    value: strain,
    threshold: 3000,
    contribution: strain > 5000 ? 1.0 : strain > 3000 ? 0.6 : strain > 2000 ? 0.3 : 0,
  });

  // Signal 7: Weight Drift
  if (data.weightHistory.length >= 7) {
    const recent = data.weightHistory.slice(-7);
    const older = data.weightHistory.slice(-14, -7);
    if (older.length > 0) {
      const recentAvg = recent.reduce((a, b) => a + b.weightKg, 0) / recent.length;
      const olderAvg = older.reduce((a, b) => a + b.weightKg, 0) / older.length;
      const drift = olderAvg - recentAvg; // positive = losing weight
      signals.push({
        signal: "Weight Drift (7-day)",
        value: Math.round(drift * 100) / 100,
        threshold: 1.5,
        contribution: drift > 2.0 ? 0.7 : drift > 1.5 ? 0.4 : 0,
      });
    }
  }

  // Signal 8: Aerobic Decoupling (from trackpoint HR:pace drift)
  if (data.avgDecouplingPct != null) {
    const d = data.avgDecouplingPct;
    signals.push({
      signal: "HR-Pace Decoupling",
      value: Math.round(d * 10) / 10,
      threshold: 5,
      contribution: d > 10 ? 1.0 : d > 7 ? 0.6 : d > 5 ? 0.3 : 0,
    });
  }

  // Signal 9: Efficiency Factor Decline (trackpoint-derived)
  if (data.efTrend && data.efTrend.length >= 2) {
    const recent = data.efTrend.slice(-2);
    const [prev, curr] = recent;
    if (prev.ef > 0 && curr.ef > 0) {
      const decline = ((prev.ef - curr.ef) / prev.ef) * 100; // positive = getting worse
      signals.push({
        signal: "Efficiency Decline",
        value: Math.round(decline * 10) / 10,
        threshold: 5,
        contribution: decline > 10 ? 0.8 : decline > 5 ? 0.4 : decline > 3 ? 0.2 : 0,
      });
    }
  }

  // Signal 10: Intensity Distribution (too much grey zone)
  if (data.intensityDistribution) {
    const dist = data.intensityDistribution;
    const greyZonePct = dist.zone2Pct; // zone 2 = threshold/grey zone in 3-zone model
    signals.push({
      signal: "Threshold Training Load",
      value: Math.round(greyZonePct * 10) / 10,
      threshold: 25,
      contribution: greyZonePct > 35 ? 1.0 : greyZonePct > 25 ? 0.5 : 0,
    });
  }

  // Calculate weighted score
  const weights: Record<string, number> = {
    "TSB Depth": 0.22,
    "TSB Duration": 0.18,
    "Resting HR Drift": 0.15,
    "Exercise HR Drift": 0.10,
    "Training Monotony": 0.08,
    "Training Strain": 0.08,
    "Weight Drift (7-day)": 0.04,
    "HR-Pace Decoupling": 0.07,
    "Efficiency Decline": 0.05,
    "Threshold Training Load": 0.03,
  };

  score = Math.round(
    signals.reduce((sum, s) => {
      const w = weights[s.signal] || 0.05;
      return sum + s.contribution * w * 100;
    }, 0)
  );

  // Determine severity
  let severity: FatigueSeverity;
  let recommendation: string;
  let restDays: number;

  if (score >= 60) {
    severity = "critical";
    recommendation = "CRITICAL FATIGUE: Multiple signals indicate severe overtraining risk. Take a full rest week immediately. Resume with 40% volume next week. Consider consulting a sports physician if resting HR remains elevated.";
    restDays = 7;
  } else if (score >= 35) {
    severity = "high";
    recommendation = "HIGH FATIGUE: Your body is showing significant stress. Take 2-4 rest days, then resume at 50-60% of normal volume. Focus on sleep and nutrition. Re-evaluate next week.";
    restDays = 3;
  } else if (score >= 18) {
    severity = "medium";
    recommendation = "MODERATE FATIGUE: Some fatigue signals detected. Consider reducing volume by 30-40% this week. Prioritize easy efforts over intensity. Monitor how you feel.";
    restDays = 2;
  } else {
    severity = "low";
    recommendation = "Low fatigue — you're managing your training load well. Continue at current levels but stay aware of any unusual soreness or elevated morning HR.";
    restDays = 0;
  }

  return { severity, score, signals, recommendation, recommendedRestDays: restDays };
}
