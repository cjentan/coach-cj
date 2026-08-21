import { describe, it, expect, afterEach } from "vitest";
import {
  cn,
  formatDistance,
  formatDuration,
  formatPace,
  formatElevation,
  formatHeight,
  formatWeight,
  getActivityIcon,
  getCurrentUnits,
  getWeekStart,
  getWeekEnd,
  weekStartPlusDay,
  getMonthStart,
  getMonthEnd,
  haversine,
  inferEffort,
  inferSurface,
  setDefaultUnits,
  defaultDistanceUnit,
  defaultElevationUnit,
  distanceToMeters,
  metersToDistance,
  elevationToMeters,
  metersToElevation,
} from "../utils";

describe("cn", () => {
  it("merges class names", () => {
    expect(cn("px-4", "py-2")).toBe("px-4 py-2");
  });

  it("handles conditional classes", () => {
    expect(cn("base", false && "hidden", "visible")).toBe("base visible");
  });

  it("handles tailwind conflicts (last wins)", () => {
    const result = cn("px-4", "px-6");
    expect(result).not.toContain("px-4");
  });
});

describe("formatDistance", () => {
  it("formats swim in meters regardless of distance", () => {
    expect(formatDistance(3000, "swim")).toContain("3000 m");
    expect(formatDistance(3000, "swim", "en")).toContain("3000 m");
  });

  it("formats >= 1000m as km", () => {
    expect(formatDistance(10000)).toBe("10.0 km");
    expect(formatDistance(42195)).toBe("42.2 km");
  });

  it("formats < 1000m as meters", () => {
    expect(formatDistance(800)).toBe("800 m");
    expect(formatDistance(0)).toBe("0 m");
  });

  it("localizes unit labels", () => {
    const zhCN = formatDistance(10000, undefined, "zh-CN");
    expect(zhCN).toContain("公里");

    const zhTW = formatDistance(10000, undefined, "zh-TW");
    expect(zhTW).toContain("公里");
  });
});

describe("formatDistance (imperial)", () => {
  it("formats >= 1 mi as miles with 1 decimal", () => {
    expect(formatDistance(10000, undefined, "en", "imperial")).toBe("6.2 mi");
    expect(formatDistance(42195, undefined, "en", "imperial")).toBe("26.2 mi");
  });

  it("formats 0.25–1 mi as miles with 2 decimals", () => {
    expect(formatDistance(800, undefined, "en", "imperial")).toBe("0.50 mi");
    expect(formatDistance(500, undefined, "en", "imperial")).toBe("0.31 mi");
  });

  it("formats < 0.25 mi as feet", () => {
    expect(formatDistance(100, undefined, "en", "imperial")).toBe("328 ft");
  });

  it("formats swims in yards", () => {
    expect(formatDistance(3000, "swim", "en", "imperial")).toBe("3281 yd");
  });

  it("localizes imperial unit labels", () => {
    expect(formatDistance(10000, undefined, "zh-TW", "imperial")).toContain("英里");
  });
});

describe("formatDuration", () => {
  it("formats durations under 1 hour", () => {
    expect(formatDuration(1800)).toBe("30m");
    expect(formatDuration(3661)).toBe("1h 1m");
  });

  it("formats durations over 1 hour", () => {
    expect(formatDuration(3600)).toBe("1h 0m");
    expect(formatDuration(7260)).toBe("2h 1m");
  });

  it("handles 0 seconds", () => {
    expect(formatDuration(0)).toBe("0m");
  });

  it("localizes unit labels", () => {
    const zhCN = formatDuration(3600, "zh-CN");
    expect(zhCN).toContain("小时");

    const zhTW = formatDuration(3600, "zh-TW");
    expect(zhTW).toContain("小時");
  });
});

describe("formatPace", () => {
  it("formats run pace as min/km", () => {
    // 4 m/s → 4:10 min/km (1000/4/60 = 4.166 → 4:10)
    const pace = formatPace(4);
    expect(pace).toMatch(/\d+:\d+/);
    expect(pace).toContain("/km");
  });

  it("formats ride pace as km/h", () => {
    // 10 m/s → 36 km/h
    const pace = formatPace(10, "ride");
    expect(pace).toContain("36.0");
    expect(pace).toContain("km/h");
  });

  it("formats swim pace as min/100m", () => {
    // 1.5 m/s → 1:06 /100m
    const pace = formatPace(1.5, "swim");
    expect(pace).toContain("/100m");
  });

  it('returns "--:--" for 0 pace', () => {
    expect(formatPace(0)).toBe("--:--");
  });

  it("localizes unit labels", () => {
    const zhCN = formatPace(4, "run", "zh-CN");
    expect(zhCN).toContain("/公里");
  });
});

describe("formatPace (imperial)", () => {
  it("formats run pace as min/mi", () => {
    // 4 m/s → 6:42 min/mi (1609.344/4/60 = 6.7056)
    const pace = formatPace(4, "run", "en", "imperial");
    expect(pace).toMatch(/\d+:\d+/);
    expect(pace).toContain("/mi");
  });

  it("formats ride pace as mph", () => {
    // 10 m/s → 22.4 mph
    const pace = formatPace(10, "ride", "en", "imperial");
    expect(pace).toContain("22.4");
    expect(pace).toContain("mph");
  });

  it("formats swim pace as min/100yd", () => {
    // 1.5 m/s → 1:01 /100yd
    const pace = formatPace(1.5, "swim", "en", "imperial");
    expect(pace).toContain("/100yd");
  });

  it('still returns "--:--" for 0 pace', () => {
    expect(formatPace(0, "run", "en", "imperial")).toBe("--:--");
  });
});

describe("formatElevation", () => {
  it("formats < 1000m as meters", () => {
    expect(formatElevation(450)).toBe("450m");
  });

  it("always uses meters (never km) for elevation", () => {
    expect(formatElevation(450)).toBe("450m");
    expect(formatElevation(1200)).toBe("1200m");
    expect(formatElevation(5000)).toBe("5000m");
  });

  it("formats as feet in imperial", () => {
    expect(formatElevation(450, "imperial")).toBe("1476ft");
    expect(formatElevation(1200, "imperial")).toBe("3937ft");
    expect(formatElevation(5000, "imperial")).toBe("16404ft");
  });

  it("returns empty string for null/undefined/zero/negative", () => {
    expect(formatElevation(null)).toBe("");
    expect(formatElevation(undefined)).toBe("");
    expect(formatElevation(0)).toBe("");
    expect(formatElevation(-5)).toBe("");
  });
});

describe("getActivityIcon", () => {
  it("returns correct icon names for each type", () => {
    expect(getActivityIcon("run")).toBe("Footprints");
    expect(getActivityIcon("ride")).toBe("Bike");
    expect(getActivityIcon("swim")).toBe("Waves");
    expect(getActivityIcon("workout")).toBe("Dumbbell");
    expect(getActivityIcon("hike")).toBe("Mountain");
    expect(getActivityIcon("rest")).toBe("Moon");
  });

  it('defaults to "Activity" for unknown types', () => {
    expect(getActivityIcon("unknown")).toBe("Activity");
    expect(getActivityIcon("")).toBe("Activity");
  });

  it("is case-insensitive", () => {
    expect(getActivityIcon("Run")).toBe("Footprints");
    expect(getActivityIcon("RIDE")).toBe("Bike");
  });
});

describe("haversine", () => {
  it("returns 0 for same coordinates", () => {
    expect(haversine(0, 0, 0, 0)).toBe(0);
  });

  it("calculates approximately 111km per degree of latitude", () => {
    const distance = haversine(0, 0, 1, 0);
    expect(distance).toBeGreaterThan(110000);
    expect(distance).toBeLessThan(112000);
  });

  it("calculates known distances", () => {
    // London to Paris (roughly 344 km)
    const distance = haversine(51.5074, -0.1278, 48.8566, 2.3522);
    expect(distance).toBeGreaterThan(300000);
    expect(distance).toBeLessThan(400000);
  });

  it("handles antipodal points", () => {
    // North pole to south pole
    const distance = haversine(0, 0, 0, 180);
    expect(distance).toBeGreaterThan(20000000); // ~20k km
    expect(distance).toBeLessThan(21000000);
  });
});

describe("getWeekStart / getWeekEnd", () => {
  it("getWeekStart returns the Monday of the week", () => {
    // Wednesday Jan 15, 2025 → Monday Jan 13
    const result = getWeekStart(new Date("2025-01-15"));
    expect(result.getUTCDay()).toBe(1); // Monday
    expect(result.getUTCDate()).toBe(13);
  });

  it("weekStartPlusDay maps the Sunday slot to the real Sunday, not the Monday", () => {
    // Regression: the week Monday 2026-08-17 .. Sunday 2026-08-23. The Sunday
    // slot (0) must resolve to Aug 23, never to the week's Monday (Aug 17).
    const monday = getWeekStart(new Date("2026-08-23"));
    expect(monday.getUTCDate()).toBe(17);
    const sunday = weekStartPlusDay(monday, 0);
    expect(sunday.getUTCDate()).toBe(23);
    expect(sunday.getUTCDay()).toBe(0); // Sunday
  });

  it("weekStartPlusDay maps each slot 0..6 to its weekday offset from Monday", () => {
    // Monday Aug 17: slot 0=Sun(+6), 1=Mon(+0), 2=Tue(+1) ... 6=Sat(+5)
    const monday = getWeekStart(new Date("2026-08-17"));
    const expectedDates = [23, 17, 18, 19, 20, 21, 22]; // Sun..Sat
    [0, 1, 2, 3, 4, 5, 6].forEach((dow) => {
      expect(weekStartPlusDay(monday, dow).getUTCDate()).toBe(expectedDates[dow]);
    });
  });

  it("weekStartPlusDay leaves the input date unchanged", () => {
    const monday = getWeekStart(new Date("2026-08-17"));
    const before = monday.getTime();
    weekStartPlusDay(monday, 6);
    expect(monday.getTime()).toBe(before);
  });

  it("getWeekEnd returns 6 days after start", () => {
    const start = getWeekStart(new Date("2025-01-15"));
    const end = getWeekEnd(new Date("2025-01-15"));
    const diffDays = (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBeGreaterThanOrEqual(6);
    expect(diffDays).toBeLessThan(7);
  });

  it("getMonthStart returns first of month", () => {
    const result = getMonthStart(new Date("2025-01-15"));
    expect(result.getUTCDate()).toBe(1);
    expect(result.getUTCMonth()).toBe(0); // January
  });

  it("getMonthEnd returns last day of month", () => {
    const result = getMonthEnd(new Date("2025-01-15"));
    expect(result.getUTCDate()).toBe(31);
  });
});

describe("inferEffort", () => {
  it('returns "rest" for rest type', () => {
    expect(inferEffort("rest")).toBe("rest");
  });

  it('returns "hard" for interval keywords', () => {
    expect(inferEffort("run", "5x1000m intervals")).toBe("hard");
    expect(inferEffort("run", "VO2max session")).toBe("hard");
    expect(inferEffort("run", "Hill repeats")).toBe("hard");
    expect(inferEffort("run", "Race pace effort")).toBe("hard");
  });

  it('returns "moderate" for tempo keywords', () => {
    expect(inferEffort("run", "Tempo run")).toBe("moderate");
    expect(inferEffort("run", "Threshold session")).toBe("moderate");
    expect(inferEffort("run", "Long run")).toBe("moderate");
    expect(inferEffort("run", "Steady pace")).toBe("moderate");
  });

  it('returns "easy" for recovery keywords', () => {
    expect(inferEffort("run", "Easy recovery")).toBe("easy");
    expect(inferEffort("run", "Zone 2 run")).toBe("easy");
    expect(inferEffort("run", "Recovery jog")).toBe("easy");
    expect(inferEffort("run", "Conversation pace")).toBe("easy");
  });

  it("falls back based on activity type", () => {
    expect(inferEffort("workout")).toBe("moderate");
    expect(inferEffort("hike")).toBe("moderate");
    expect(inferEffort("ride")).toBe("moderate");
    expect(inferEffort("swim")).toBe("moderate");
    expect(inferEffort("run")).toBe("easy");
  });
});

describe("inferSurface", () => {
  it("detects trail", () => {
    expect(inferSurface("Trail run in the woods")).toBe("trail");
  });

  it("detects track", () => {
    expect(inferSurface("Track workout")).toBe("track");
  });

  it("detects indoor/treadmill", () => {
    expect(inferSurface("Treadmill easy run")).toBe("indoor");
    expect(inferSurface("Indoor cycling")).toBe("indoor");
  });

  it("detects road", () => {
    expect(inferSurface("Road ride")).toBe("road");
    expect(inferSurface("Path running")).toBe("road");
    expect(inferSurface("Pavement jog")).toBe("road");
  });

  it("returns null for no description", () => {
    expect(inferSurface()).toBeNull();
    expect(inferSurface(undefined)).toBeNull();
  });

  it("returns null for ambiguous descriptions", () => {
    expect(inferSurface("Morning exercise")).toBeNull();
  });
});

describe("formatWeight", () => {
  it("formats in kg by default", () => {
    expect(formatWeight(75.5)).toBe("75.5 kg");
    expect(formatWeight(75.5, "metric")).toBe("75.5 kg");
  });

  it("formats in lb for imperial", () => {
    expect(formatWeight(75.5, "imperial")).toBe("166.4 lb");
  });

  it("returns empty string for null/zero", () => {
    expect(formatWeight(null)).toBe("");
    expect(formatWeight(undefined)).toBe("");
    expect(formatWeight(0)).toBe("");
  });
});

describe("formatHeight", () => {
  it("formats in cm by default", () => {
    expect(formatHeight(175)).toBe("175 cm");
    expect(formatHeight(175, "metric")).toBe("175 cm");
  });

  it("formats as ft/in for imperial", () => {
    expect(formatHeight(175, "imperial")).toBe(`5'9"`);
    expect(formatHeight(183, "imperial")).toBe(`6'0"`);
  });

  it("carries 12 inches up to the next foot", () => {
    // 181.9 cm ≈ 71.6 in → 5'11.6" rounds up to 6'0"
    expect(formatHeight(181.9, "imperial")).toBe(`6'0"`);
  });

  it("returns empty string for null/zero", () => {
    expect(formatHeight(null)).toBe("");
    expect(formatHeight(undefined)).toBe("");
    expect(formatHeight(0)).toBe("");
  });
});

describe("goal unit converters", () => {
  it("converts distances to meters", () => {
    expect(distanceToMeters(42, "m")).toBe(42);
    expect(distanceToMeters(42.2, "km")).toBeCloseTo(42200, 5);
    expect(distanceToMeters(26.2, "mi")).toBeCloseTo(42164.81, 2);
  });

  it("converts meters to distances", () => {
    expect(metersToDistance(42195, "m")).toBe(42195);
    expect(metersToDistance(42195, "km")).toBeCloseTo(42.195, 3);
    expect(metersToDistance(42195, "mi")).toBeCloseTo(26.219, 3);
  });

  it("converts elevation to/from meters", () => {
    expect(elevationToMeters(100, "m")).toBe(100);
    expect(elevationToMeters(328.084, "ft")).toBeCloseTo(100, 5);
    expect(metersToElevation(100, "m")).toBe(100);
    expect(metersToElevation(100, "ft")).toBeCloseTo(328.084, 3);
  });

  it("defaults input units to match the app-wide setting", () => {
    expect(defaultDistanceUnit("metric")).toBe("km");
    expect(defaultDistanceUnit("imperial")).toBe("mi");
    expect(defaultElevationUnit("metric")).toBe("m");
    expect(defaultElevationUnit("imperial")).toBe("ft");
  });
});

describe("default units", () => {
  afterEach(() => {
    setDefaultUnits("metric");
  });

  it("defaults to metric", () => {
    expect(getCurrentUnits()).toBe("metric");
    expect(formatDistance(10000)).toBe("10.0 km");
  });

  it("setDefaultUnits flips the formatters without explicit units args", () => {
    setDefaultUnits("imperial");
    expect(getCurrentUnits()).toBe("imperial");
    expect(formatDistance(10000)).toBe("6.2 mi");
    expect(formatPace(10, "ride")).toContain("mph");
    expect(formatWeight(75.5)).toBe("166.4 lb");
    expect(formatHeight(175)).toBe(`5'9"`);
    // Restore metric so the module default stays clean for other tests.
    setDefaultUnits("metric");
  });
});
