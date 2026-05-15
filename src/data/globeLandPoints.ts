import { geoContains, type GeoPermissibleObjects } from "d3-geo";
import { feature } from "topojson-client";
import type { GeometryObject, Topology } from "topojson-specification";
import land110mTopology from "world-atlas/land-110m.json";

export type LandPoint = {
  lon: number;
  lat: number;
};

export type LandPointOptions = {
  longitudeStep?: number;
  latitudeStep?: number;
  jitter?: number;
  minLatitude?: number;
  maxLatitude?: number;
  seed?: number;
};

export const LAND_TOPOLOGY_SOURCE = "world-atlas/land-110m.json";

const DEFAULT_OPTIONS = {
  longitudeStep: 1.55,
  latitudeStep: 1.55,
  jitter: 0.22,
  minLatitude: -85,
  maxLatitude: 85,
  seed: 1917,
} satisfies Required<LandPointOptions>;

const landTopology = land110mTopology as unknown as Topology;
const landObject = landTopology.objects.land as GeometryObject;
// Convert world-atlas TopoJSON once, then sample against the real land polygons.
const landGeoJson = feature(landTopology, landObject) as GeoPermissibleObjects;
const landPointCache = new Map<string, LandPoint[]>();

function createSeededRandom(seed: number) {
  let value = seed >>> 0;

  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function roundCoordinate(value: number) {
  return Number(value.toFixed(5));
}

function getLongitudeStepForLatitude(latitude: number, baseLongitudeStep: number) {
  const latRad = (latitude * Math.PI) / 180;

  return baseLongitudeStep / Math.max(Math.cos(latRad), 0.25);
}

function getLandPointCacheKey(options: Required<LandPointOptions>) {
  return JSON.stringify(options);
}

export function generateLandPoints(options: LandPointOptions = {}): LandPoint[] {
  const {
    longitudeStep,
    latitudeStep,
    jitter,
    minLatitude,
    maxLatitude,
    seed,
  } = {
    ...DEFAULT_OPTIONS,
    ...options,
  };
  const cacheKey = getLandPointCacheKey({
    longitudeStep,
    latitudeStep,
    jitter,
    minLatitude,
    maxLatitude,
    seed,
  });
  const cachedPoints = landPointCache.get(cacheKey);

  if (cachedPoints) return cachedPoints;

  const random = createSeededRandom(seed);
  const points: LandPoint[] = [];

  for (let lat = minLatitude; lat <= maxLatitude; lat += latitudeStep) {
    // Wider longitude spacing near the poles keeps the dotted matrix even on a sphere.
    const lonStepForLat = getLongitudeStepForLatitude(lat, longitudeStep);
    const lonJitter = Math.min(jitter, lonStepForLat * 0.18);
    const latJitter = Math.min(jitter, latitudeStep * 0.18);

    for (let lon = -180; lon <= 180; lon += lonStepForLat) {
      const jitteredLon = lon + (random() - 0.5) * lonJitter;
      const jitteredLat = lat + (random() - 0.5) * latJitter;

      if (!geoContains(landGeoJson, [jitteredLon, jitteredLat])) continue;

      points.push({
        lon: roundCoordinate(jitteredLon),
        lat: roundCoordinate(jitteredLat),
      });
    }
  }

  landPointCache.set(cacheKey, points);

  return points;
}
