import { geoContains } from "d3-geo";
import landTopology from "world-atlas/land-110m.json";
import { feature } from "topojson-client";

export type LandDot = {
  x: number;
  y: number;
  z: number;
  seed: number;
};

type LandFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: {
      type: "Polygon" | "MultiPolygon";
      coordinates: unknown;
    } | null;
    properties: unknown;
  }>;
};

type GenerateLandDotsOptions = {
  radius?: number;
  longitudeStep?: number;
  latitudeStep?: number;
  jitter?: number;
  minLatitude?: number;
  maxLatitude?: number;
};

const DEFAULT_RADIUS = 2.4;
const DEFAULT_LONGITUDE_STEP = 2.15;
const DEFAULT_LATITUDE_STEP = 2.15;
const DEFAULT_JITTER = 0.28;
const DEFAULT_MIN_LATITUDE = -55;
const DEFAULT_MAX_LATITUDE = 85;
const generatedDotsCache = new Map<string, LandDot[]>();
let cachedLandGeoJson: LandFeatureCollection | null = null;

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

function getLandGeoJson() {
  if (cachedLandGeoJson) return cachedLandGeoJson;

  const topology = landTopology as {
    objects: {
      land: unknown;
    };
  };

  cachedLandGeoJson = feature(landTopology as never, topology.objects.land as never) as unknown as LandFeatureCollection;

  return cachedLandGeoJson;
}

export function generateLandDots({
  radius = DEFAULT_RADIUS,
  longitudeStep = DEFAULT_LONGITUDE_STEP,
  latitudeStep = DEFAULT_LATITUDE_STEP,
  jitter = DEFAULT_JITTER,
  minLatitude = DEFAULT_MIN_LATITUDE,
  maxLatitude = DEFAULT_MAX_LATITUDE,
}: GenerateLandDotsOptions = {}) {
  const cacheKey = [radius, longitudeStep, latitudeStep, jitter, minLatitude, maxLatitude].join(":");
  const cachedDots = generatedDotsCache.get(cacheKey);

  if (cachedDots) return cachedDots;

  const landGeoJson = getLandGeoJson();
  const random = createSeededRandom(1917);
  const dots: LandDot[] = [];

  for (let lat = minLatitude; lat <= maxLatitude; lat += latitudeStep) {
    for (let lon = -180; lon <= 180; lon += longitudeStep) {
      const jitteredLon = lon + (random() - 0.5) * jitter;
      const jitteredLat = lat + (random() - 0.5) * jitter;

      if (!geoContains(landGeoJson as Parameters<typeof geoContains>[0], [jitteredLon, jitteredLat])) continue;

      // Project longitude/latitude onto the 3D sphere. Keeping this direct
      // conversion avoids map-projection stretching and preserves real geography.
      const latRad = (jitteredLat * Math.PI) / 180;
      const lonRad = (jitteredLon * Math.PI) / 180;
      const x = radius * Math.cos(latRad) * Math.sin(lonRad);
      const y = radius * Math.sin(latRad);
      const z = radius * Math.cos(latRad) * Math.cos(lonRad);

      dots.push({
        x,
        y,
        z,
        seed: random(),
      });
    }
  }

  generatedDotsCache.set(cacheKey, dots);

  return dots;
}
