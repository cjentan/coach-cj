/**
 * Web Mercator tile math utilities for server-side heatmap tile rendering.
 *
 * Tiles use the Slippy Map tilenames convention (OSM/Google standard).
 *   https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames
 */

const EARTH_CIRCUMFERENCE = 40075016.686; // meters (WGS84 equator)

/** Project latitude [-85.05, 85.05] to Web Mercator y [0, 1] */
function latToY(lat: number): number {
  const rad = (lat * Math.PI) / 180;
  return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2;
}

/** Project longitude [-180, 180] to Web Mercator x [0, 1] */
function lngToX(lng: number): number {
  return (lng + 180) / 360;
}

/** Inverse: Web Mercator y [0, 1] → latitude */
function yToLat(y: number): number {
  const rad = Math.atan(Math.sinh(Math.PI * (1 - 2 * y)));
  return (rad * 180) / Math.PI;
}

/** Inverse: Web Mercator x [0, 1] → longitude */
function xToLng(x: number): number {
  return x * 360 - 180;
}

export interface TileBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

/**
 * Compute the bounding box of a tile in decimal degrees.
 * TMS (Tile Map Service): y increases southward.
 * OSM/Slippy Map: y increases northward. This function uses Slippy Map convention.
 */
export function tileToBounds(z: number, x: number, y: number): TileBounds {
  const n = Math.pow(2, z);
  return {
    north: yToLat(y / n),
    south: yToLat((y + 1) / n),
    west: xToLng(x / n),
    east: xToLng((x + 1) / n),
  };
}

/** Pixel coordinates of a lat/lng within a tile (0–256). */
export function latLngToTilePixel(
  lat: number,
  lng: number,
  z: number,
  tileX: number,
  tileY: number,
): { px: number; py: number } {
  const n = Math.pow(2, z);
  const worldX = lngToX(lng) * n * 256;
  const worldY = latToY(lat) * n * 256;
  return {
    px: worldX - tileX * 256,
    py: worldY - tileY * 256,
  };
}

/**
 * Approximate degrees-per-pixel at a given latitude and zoom.
 * Useful for setting hover hit-test thresholds.
 */
export function degreesPerPixel(lat: number, zoom: number): number {
  const circumference = EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180);
  return circumference / (256 * Math.pow(2, zoom)) * (360 / EARTH_CIRCUMFERENCE);
}
