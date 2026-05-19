import generatedLandPoints from "./globeLandPoints.generated.json";

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

export const LAND_TOPOLOGY_SOURCE = "precomputed world-atlas/land-110m.json";

const DEFAULT_OPTIONS = {
  longitudeStep: 0.72,
  latitudeStep: 0.72,
  jitter: 0.72 * 0.09,
  minLatitude: -62,
  maxLatitude: 84,
  seed: 1917,
} satisfies Required<LandPointOptions>;

const landPointCache = new Map<string, LandPoint[]>();
const precomputedLandPoints = (generatedLandPoints as [number, number][]).map(([lon, lat]) => ({ lon, lat }));

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

  if (cacheKey !== getLandPointCacheKey(DEFAULT_OPTIONS)) {
    throw new Error("Custom land point sampling is not available in the browser build. Regenerate the static land points instead.");
  }

  landPointCache.set(cacheKey, precomputedLandPoints);

  return precomputedLandPoints;
}
