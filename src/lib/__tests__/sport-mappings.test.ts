import { describe, it, expect } from 'vitest';
import {
  mapStravaSport,
  mapFitSport,
  inferFromName,
  STRAVA_TYPE_MAP,
  STRAVA_SUB_TYPE_MAP,
  FIT_SUB_SPORT_MAP,
} from '../sport-mappings';

describe('mapStravaSport', () => {
  it('maps common Strava sports correctly', () => {
    expect(mapStravaSport('Run')).toEqual({ type: 'run', subType: undefined });
    expect(mapStravaSport('Ride')).toEqual({ type: 'ride', subType: undefined });
    expect(mapStravaSport('Swim')).toEqual({ type: 'swim', subType: undefined });
    expect(mapStravaSport('Hike')).toEqual({ type: 'hike', subType: undefined });
    expect(mapStravaSport('Walk')).toEqual({ type: 'walk', subType: undefined });
  });

  it('maps trail run with subType', () => {
    expect(mapStravaSport('TrailRun')).toEqual({
      type: 'run',
      subType: 'trail_running',
    });
    expect(mapStravaSport('Trail Run')).toEqual({
      type: 'run',
      subType: 'trail_running',
    });
  });

  it('maps virtual activities', () => {
    expect(mapStravaSport('VirtualRun')).toEqual({
      type: 'run',
      subType: 'virtual_run',
    });
    expect(mapStravaSport('Virtual Ride')).toEqual({
      type: 'ride',
      subType: 'virtual_ride',
    });
  });

  it('maps workout subtypes', () => {
    expect(mapStravaSport('WeightTraining')).toEqual({
      type: 'workout',
      subType: 'strength_training',
    });
    expect(mapStravaSport('Yoga')).toEqual({
      type: 'workout',
      subType: 'yoga',
    });
    expect(mapStravaSport('Crossfit')).toEqual({
      type: 'workout',
      subType: 'crossfit',
    });
  });

  it('maps handcycle as ride type', () => {
    expect(mapStravaSport('Handcycle')).toEqual({
      type: 'ride',
      subType: 'handcycle',
    });
  });

  it('falls back to "other" for unknown sports', () => {
    expect(mapStravaSport('UnknownSport')).toEqual({
      type: 'other',
      subType: undefined,
    });
  });

  it('has consistent coverage across all entries', () => {
    for (const [sport] of Object.entries(STRAVA_TYPE_MAP)) {
      const result = mapStravaSport(sport);
      expect(['run', 'ride', 'swim', 'hike', 'walk', 'workout', 'other']).toContain(result.type);
    }
  });
});

describe('mapFitSport', () => {
  it('maps known sport codes', () => {
    expect(mapFitSport('running')).toEqual({ type: 'run', subType: undefined });
    expect(mapFitSport('cycling')).toEqual({ type: 'ride', subType: undefined });
    expect(mapFitSport('swimming')).toEqual({ type: 'swim', subType: undefined });
    expect(mapFitSport('hiking')).toEqual({ type: 'hike', subType: undefined });
    expect(mapFitSport('walking')).toEqual({ type: 'walk', subType: undefined });
  });

  it('maps sub_sport codes when provided', () => {
    expect(mapFitSport('running', 'trail')).toEqual({
      type: 'run',
      subType: 'trail_running',
    });
    expect(mapFitSport('cycling', 'mountain_biking')).toEqual({
      type: 'ride',
      subType: 'mountain_biking',
    });
    expect(mapFitSport('cycling', 'gravel_cycling')).toEqual({
      type: 'ride',
      subType: 'gravel_cycling',
    });
  });

  it('sport takes priority over sub_sport for type inference', () => {
    const result = mapFitSport('cycling', 'generic');
    expect(result.type).toBe('ride');
    expect(result.subType).toBeUndefined();
  });

  it('falls back to sub_sport only when sport is not in FIT_SPORT_MAP', () => {
    // 'generic' maps to 'other' in FIT_SPORT_MAP, so the fallback isn't triggered
    const result = mapFitSport('generic', 'walking');
    expect(result.type).toBe('other');
    // subType still comes from sub_sport
    expect(result.subType).toBeUndefined(); // FIT_SUB_SPORT_MAP['walking'] is undefined
  });

  it('handles undefined or empty inputs', () => {
    expect(mapFitSport(undefined, undefined)).toEqual({
      type: 'other',
      subType: undefined,
    });
    expect(mapFitSport('')).toEqual({ type: 'other', subType: undefined });
  });

  it('is case-insensitive', () => {
    expect(mapFitSport('Running', 'Trail')).toEqual({
      type: 'run',
      subType: 'trail_running',
    });
    expect(mapFitSport('CYCLING', 'MOUNTAIN_BIKING')).toEqual({
      type: 'ride',
      subType: 'mountain_biking',
    });
  });

  it('maps all known sub_sport codes', () => {
    for (const [subSport, expectedSubType] of Object.entries(FIT_SUB_SPORT_MAP)) {
      const result = mapFitSport('running', subSport);
      expect(result.type).toBe('run');
      expect(result.subType).toBe(expectedSubType);
    }
  });
});

describe('inferFromName', () => {
  it('infers run from activity names', () => {
    expect(inferFromName('Morning Run')).toEqual({
      type: 'run',
      subType: undefined,
    });
    expect(inferFromName('Easy Jog')).toEqual({
      type: 'run',
      subType: undefined,
    });
  });

  it('detects trail run from name', () => {
    const result = inferFromName('Morning Trail Run');
    expect(result.type).toBe('run');
    expect(result.subType).toBe('trail_running');
  });

  it('detects treadmill from name', () => {
    const result = inferFromName('Treadmill Intervals');
    expect(result.type).toBe('run');
    expect(result.subType).toBe('treadmill');
  });

  it('infers ride for bike/cycling keywords', () => {
    expect(inferFromName('Afternoon Ride')).toEqual({
      type: 'ride',
      subType: undefined,
    });
    expect(inferFromName('Bike Commute')).toEqual({
      type: 'ride',
      subType: undefined,
    });
    expect(inferFromName('Cycling Training')).toEqual({
      type: 'ride',
      subType: undefined,
    });
  });

  it('detects road cycling', () => {
    const result = inferFromName('Road Ride');
    expect(result.type).toBe('ride');
    expect(result.subType).toBe('road_cycling');
  });

  it('infers swim from name', () => {
    const result = inferFromName('Morning Swim');
    expect(result.type).toBe('swim');
    expect(result.subType).toBeUndefined();
  });

  it('detects lap swimming in pool', () => {
    const result = inferFromName('Pool Swim');
    expect(result.type).toBe('swim');
    expect(result.subType).toBe('lap_swimming');
  });

  it('detects open water swimming', () => {
    const result = inferFromName('Open Water Swim');
    expect(result.type).toBe('swim');
    expect(result.subType).toBe('open_water');
  });

  it('infers hike from name', () => {
    expect(inferFromName('Saturday Hike')).toEqual({
      type: 'hike',
      subType: undefined,
    });
  });

  it('infers walk from name', () => {
    expect(inferFromName('Evening Walk')).toEqual({
      type: 'walk',
      subType: undefined,
    });
  });

  it('detects indoor cycling via "indoor" subtype with ride type', () => {
    // "indoor_cycling" subtype is set, but type still needs a ride keyword
    const result = inferFromName('Indoor Cycling Session');
    expect(result.type).toBe('ride');
    expect(result.subType).toBe('indoor_cycling');
  });

  it('detects mountain biking from "mtb" keyword with ride type', () => {
    // Need "ride/bike/cycling" in name for type=ride;
    // subtype keyword "mtb" is checked after "trail" so avoid "trail"
    const result = inferFromName('MTB Ride');
    expect(result.type).toBe('ride');
    expect(result.subType).toBe('mountain_biking');
  });

  it('defaults to run when no keywords match', () => {
    expect(inferFromName('Morning Activity')).toEqual({
      type: 'run',
      subType: undefined,
    });
  });
});
