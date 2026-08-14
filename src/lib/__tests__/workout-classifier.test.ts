import { describe, it, expect } from 'vitest';
import { classifyWorkoutType } from '../workout-classifier';
import { buildTrackPoints } from '@/test/factories';

describe('classifyWorkoutType', () => {
  describe('non-run/ride activities', () => {
    it('classifies swim as cross_training', () => {
      expect(
        classifyWorkoutType({
          type: 'swim',
          durationSeconds: 3600,
        }),
      ).toBe('cross_training');
    });

    it('classifies hike as cross_training', () => {
      expect(
        classifyWorkoutType({
          type: 'hike',
          durationSeconds: 5400,
        }),
      ).toBe('cross_training');
    });

    it('classifies walk as cross_training', () => {
      expect(
        classifyWorkoutType({
          type: 'walk',
          durationSeconds: 1800,
        }),
      ).toBe('cross_training');
    });

    it('classifies workout as cross_training', () => {
      expect(
        classifyWorkoutType({
          type: 'workout',
          durationSeconds: 3600,
        }),
      ).toBe('cross_training');
    });
  });

  describe('summary-based classification (no trackpoints)', () => {
    it('classifies short runs as recovery', () => {
      expect(
        classifyWorkoutType({
          type: 'run',
          durationSeconds: 1200, // 20 min
        }),
      ).toBe('recovery');
    });

    it('classifies runs > 75 min as long_run', () => {
      expect(
        classifyWorkoutType({
          type: 'run',
          durationSeconds: 4800, // 80 min
        }),
      ).toBe('long_run');
    });

    it('classifies medium runs as easy when no HR data', () => {
      expect(
        classifyWorkoutType({
          type: 'run',
          durationSeconds: 2400,
        }),
      ).toBe('easy');
    });

    it('classifies as race when HR ratio >= 0.90', () => {
      expect(
        classifyWorkoutType({
          type: 'run',
          durationSeconds: 3600,
          averageHr: 171,
          maxHr: 190,
        }),
      ).toBe('race');
    });

    it('classifies as tempo when HR ratio >= 0.84', () => {
      expect(
        classifyWorkoutType({
          type: 'run',
          durationSeconds: 3600,
          averageHr: 162,
          maxHr: 190,
        }),
      ).toBe('tempo');
    });

    it('classifies as fartlek when HR ratio >= 0.75', () => {
      expect(
        classifyWorkoutType({
          type: 'run',
          durationSeconds: 3600,
          averageHr: 150,
          maxHr: 190,
        }),
      ).toBe('fartlek');
    });

    it('classifies low HR run as easy', () => {
      expect(
        classifyWorkoutType({
          type: 'run',
          durationSeconds: 3600,
          averageHr: 130,
          maxHr: 190,
        }),
      ).toBe('easy');
    });

    it('classifies long rides as long_run', () => {
      expect(
        classifyWorkoutType({
          type: 'ride',
          durationSeconds: 9000, // 2.5 hrs
        }),
      ).toBe('long_run');
    });

    it('classifies short rides as easy', () => {
      expect(
        classifyWorkoutType({
          type: 'ride',
          durationSeconds: 2700,
        }),
      ).toBe('easy');
    });
  });

  describe('trackpoint-based classification', () => {
    it('classifies very low intensity runs as easy', () => {
      // HR entirely in Z1-Z2, not short enough for recovery
      const trackPoints = buildTrackPoints(900, { baseHr: 110 });
      expect(
        classifyWorkoutType({
          type: 'run',
          durationSeconds: 2700,
          trackPoints,
          maxHr: 180,
        }),
      ).toBe('easy');
    });

    it('classifies as long_run with moderate HR and long duration', () => {
      // HR centered at 142 with maxHr=180 keeps most points in Z2 (67%)
      // with some Z3 (33%) and virtually no Z4+, for 90 minutes
      const trackPoints = buildTrackPoints(6000, { baseHr: 142 });
      expect(
        classifyWorkoutType({
          type: 'run',
          durationSeconds: 5400,
          trackPoints,
          maxHr: 180,
        }),
      ).toBe('long_run');
    });

    it('falls back to summary when insufficient trackpoints', () => {
      const result = classifyWorkoutType({
        type: 'run',
        durationSeconds: 900, // 15 min → recovery
        trackPoints: [{ hr: 130 }, { hr: 140 }], // only 2 points
      });
      expect(result).toBe('recovery');
    });

    it('returns a valid type for moderate HR trackpoints', () => {
      const trackPoints = buildTrackPoints(3600, { baseHr: 125 });
      expect(
        classifyWorkoutType({
          type: 'run',
          durationSeconds: 3600,
          trackPoints,
          maxHr: 185,
        }),
      ).not.toBeNull();
    });

    it('reclassifies a fixed effort lower under Karvonen', () => {
      // Flat 135 bpm for 45 min, maxHr=180:
      //   %maxHR: 135 is in Z3 (126–144) → tempo
      //   Karvonen (rest 50): 135 is in Z2 (128–141) → easy
      const trackPoints = Array.from({ length: 2700 }, () => ({ hr: 135 }));
      const byMaxHr = classifyWorkoutType({
        type: 'run',
        durationSeconds: 2700,
        trackPoints,
        maxHr: 180,
      });
      expect(byMaxHr).toBe('tempo');

      const karvonen = classifyWorkoutType({
        type: 'run',
        durationSeconds: 2700,
        trackPoints,
        maxHr: 180,
        restHr: 50,
      });
      expect(karvonen).toBe('easy');
    });
  });

  describe('edge cases', () => {
    it('handles zero duration', () => {
      const result = classifyWorkoutType({
        type: 'run',
        durationSeconds: 0,
      });
      expect(result).toBe('recovery');
    });

    it('handles null trackpoints', () => {
      const result = classifyWorkoutType({
        type: 'run',
        durationSeconds: 5400,
        trackPoints: null,
      });
      expect(result).toBe('long_run');
    });

    it('handles NaN HR values gracefully', () => {
      const result = classifyWorkoutType({
        type: 'run',
        durationSeconds: 3600,
        averageHr: NaN,
        maxHr: 190,
      });
      expect(result).not.toBeNull();
    });
  });
});
