import { describe, it, expect } from 'vitest';
import {
  cn,
  formatDistance,
  formatDuration,
  formatPace,
  formatElevation,
  getActivityIcon,
  getWeekStart,
  getWeekEnd,
  getMonthStart,
  getMonthEnd,
  haversine,
  inferEffort,
  inferSurface,
} from '../utils';

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('px-4', 'py-2')).toBe('px-4 py-2');
  });

  it('handles conditional classes', () => {
    expect(cn('base', false && 'hidden', 'visible')).toBe('base visible');
  });

  it('handles tailwind conflicts (last wins)', () => {
    const result = cn('px-4', 'px-6');
    expect(result).not.toContain('px-4');
  });
});

describe('formatDistance', () => {
  it('formats swim in meters regardless of distance', () => {
    expect(formatDistance(3000, 'swim')).toContain('3000 m');
    expect(formatDistance(3000, 'swim', 'en')).toContain('3000 m');
  });

  it('formats >= 1000m as km', () => {
    expect(formatDistance(10000)).toBe('10.0 km');
    expect(formatDistance(42195)).toBe('42.2 km');
  });

  it('formats < 1000m as meters', () => {
    expect(formatDistance(800)).toBe('800 m');
    expect(formatDistance(0)).toBe('0 m');
  });

  it('localizes unit labels', () => {
    const zhCN = formatDistance(10000, undefined, 'zh-CN');
    expect(zhCN).toContain('公里');

    const zhTW = formatDistance(10000, undefined, 'zh-TW');
    expect(zhTW).toContain('公里');
  });
});

describe('formatDuration', () => {
  it('formats durations under 1 hour', () => {
    expect(formatDuration(1800)).toBe('30m');
    expect(formatDuration(3661)).toBe('1h 1m');
  });

  it('formats durations over 1 hour', () => {
    expect(formatDuration(3600)).toBe('1h 0m');
    expect(formatDuration(7260)).toBe('2h 1m');
  });

  it('handles 0 seconds', () => {
    expect(formatDuration(0)).toBe('0m');
  });

  it('localizes unit labels', () => {
    const zhCN = formatDuration(3600, 'zh-CN');
    expect(zhCN).toContain('小时');

    const zhTW = formatDuration(3600, 'zh-TW');
    expect(zhTW).toContain('小時');
  });
});

describe('formatPace', () => {
  it('formats run pace as min/km', () => {
    // 4 m/s → 4:10 min/km (1000/4/60 = 4.166 → 4:10)
    const pace = formatPace(4);
    expect(pace).toMatch(/\d+:\d+/);
    expect(pace).toContain('/km');
  });

  it('formats ride pace as km/h', () => {
    // 10 m/s → 36 km/h
    const pace = formatPace(10, 'ride');
    expect(pace).toContain('36.0');
    expect(pace).toContain('km/h');
  });

  it('formats swim pace as min/100m', () => {
    // 1.5 m/s → 1:06 /100m
    const pace = formatPace(1.5, 'swim');
    expect(pace).toContain('/100m');
  });

  it('returns "--:--" for 0 pace', () => {
    expect(formatPace(0)).toBe('--:--');
  });

  it('localizes unit labels', () => {
    const zhCN = formatPace(4, 'run', 'zh-CN');
    expect(zhCN).toContain('/公里');
  });
});

describe('formatElevation', () => {
  it('formats < 1000m as meters', () => {
    expect(formatElevation(450)).toBe('450m');
  });

  it('formats >= 1000m as km', () => {
    expect(formatElevation(1200)).toBe('1.2km');
  });

  it('returns empty string for null/undefined/zero/negative', () => {
    expect(formatElevation(null)).toBe('');
    expect(formatElevation(undefined)).toBe('');
    expect(formatElevation(0)).toBe('');
    expect(formatElevation(-5)).toBe('');
  });
});

describe('getActivityIcon', () => {
  it('returns correct icon names for each type', () => {
    expect(getActivityIcon('run')).toBe('Footprints');
    expect(getActivityIcon('ride')).toBe('Bike');
    expect(getActivityIcon('swim')).toBe('Waves');
    expect(getActivityIcon('workout')).toBe('Dumbbell');
    expect(getActivityIcon('hike')).toBe('Mountain');
    expect(getActivityIcon('rest')).toBe('Moon');
  });

  it('defaults to "Activity" for unknown types', () => {
    expect(getActivityIcon('unknown')).toBe('Activity');
    expect(getActivityIcon('')).toBe('Activity');
  });

  it('is case-insensitive', () => {
    expect(getActivityIcon('Run')).toBe('Footprints');
    expect(getActivityIcon('RIDE')).toBe('Bike');
  });
});

describe('haversine', () => {
  it('returns 0 for same coordinates', () => {
    expect(haversine(0, 0, 0, 0)).toBe(0);
  });

  it('calculates approximately 111km per degree of latitude', () => {
    const distance = haversine(0, 0, 1, 0);
    expect(distance).toBeGreaterThan(110000);
    expect(distance).toBeLessThan(112000);
  });

  it('calculates known distances', () => {
    // London to Paris (roughly 344 km)
    const distance = haversine(51.5074, -0.1278, 48.8566, 2.3522);
    expect(distance).toBeGreaterThan(300000);
    expect(distance).toBeLessThan(400000);
  });

  it('handles antipodal points', () => {
    // North pole to south pole
    const distance = haversine(0, 0, 0, 180);
    expect(distance).toBeGreaterThan(20000000); // ~20k km
    expect(distance).toBeLessThan(21000000);
  });
});

describe('getWeekStart / getWeekEnd', () => {
  it('getWeekStart returns the Monday of the week', () => {
    // Wednesday Jan 15, 2025 → Monday Jan 13
    const result = getWeekStart(new Date('2025-01-15'));
    expect(result.getDay()).toBe(1); // Monday
    expect(result.getDate()).toBe(13);
  });

  it('getWeekEnd returns 6 days after start', () => {
    const start = getWeekStart(new Date('2025-01-15'));
    const end = getWeekEnd(new Date('2025-01-15'));
    const diffDays = (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBeGreaterThanOrEqual(6);
    expect(diffDays).toBeLessThan(7);
  });

  it('getMonthStart returns first of month', () => {
    const result = getMonthStart(new Date('2025-01-15'));
    expect(result.getDate()).toBe(1);
    expect(result.getMonth()).toBe(0); // January
  });

  it('getMonthEnd returns last day of month', () => {
    const result = getMonthEnd(new Date('2025-01-15'));
    expect(result.getDate()).toBe(31);
  });
});

describe('inferEffort', () => {
  it('returns "rest" for rest type', () => {
    expect(inferEffort('rest')).toBe('rest');
  });

  it('returns "hard" for interval keywords', () => {
    expect(inferEffort('run', '5x1000m intervals')).toBe('hard');
    expect(inferEffort('run', 'VO2max session')).toBe('hard');
    expect(inferEffort('run', 'Hill repeats')).toBe('hard');
    expect(inferEffort('run', 'Race pace effort')).toBe('hard');
  });

  it('returns "moderate" for tempo keywords', () => {
    expect(inferEffort('run', 'Tempo run')).toBe('moderate');
    expect(inferEffort('run', 'Threshold session')).toBe('moderate');
    expect(inferEffort('run', 'Long run')).toBe('moderate');
    expect(inferEffort('run', 'Steady pace')).toBe('moderate');
  });

  it('returns "easy" for recovery keywords', () => {
    expect(inferEffort('run', 'Easy recovery')).toBe('easy');
    expect(inferEffort('run', 'Zone 2 run')).toBe('easy');
    expect(inferEffort('run', 'Recovery jog')).toBe('easy');
    expect(inferEffort('run', 'Conversation pace')).toBe('easy');
  });

  it('falls back based on activity type', () => {
    expect(inferEffort('workout')).toBe('moderate');
    expect(inferEffort('hike')).toBe('moderate');
    expect(inferEffort('ride')).toBe('moderate');
    expect(inferEffort('swim')).toBe('moderate');
    expect(inferEffort('run')).toBe('easy');
  });
});

describe('inferSurface', () => {
  it('detects trail', () => {
    expect(inferSurface('Trail run in the woods')).toBe('trail');
  });

  it('detects track', () => {
    expect(inferSurface('Track workout')).toBe('track');
  });

  it('detects indoor/treadmill', () => {
    expect(inferSurface('Treadmill easy run')).toBe('indoor');
    expect(inferSurface('Indoor cycling')).toBe('indoor');
  });

  it('detects road', () => {
    expect(inferSurface('Road ride')).toBe('road');
    expect(inferSurface('Path running')).toBe('road');
    expect(inferSurface('Pavement jog')).toBe('road');
  });

  it('returns null for no description', () => {
    expect(inferSurface()).toBeNull();
    expect(inferSurface(undefined)).toBeNull();
  });

  it('returns null for ambiguous descriptions', () => {
    expect(inferSurface('Morning exercise')).toBeNull();
  });
});
