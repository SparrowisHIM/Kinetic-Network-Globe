import { writeFile } from "node:fs/promises";
import { geoContains } from "d3-geo";
import { feature } from "topojson-client";
import land110mTopology from "world-atlas/land-110m.json" with { type: "json" };

const OUTPUT_FILE = new URL("../src/data/globeLandPoints.generated.json", import.meta.url);
const OPTIONS = {
  longitudeStep: 0.72,
  latitudeStep: 0.72,
  jitter: 0.72 * 0.09,
  minLatitude: -62,
  maxLatitude: 84,
  seed: 1917,
};

function createSeededRandom(seed) {
  let value = seed >>> 0;

  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function roundCoordinate(value) {
  return Number(value.toFixed(5));
}

function getLongitudeStepForLatitude(latitude, baseLongitudeStep) {
  const latRad = (latitude * Math.PI) / 180;

  return baseLongitudeStep / Math.max(Math.cos(latRad), 0.25);
}

function generateLandPoints() {
  const random = createSeededRandom(OPTIONS.seed);
  const landGeoJson = feature(land110mTopology, land110mTopology.objects.land);
  const points = [];

  for (let lat = OPTIONS.minLatitude; lat <= OPTIONS.maxLatitude; lat += OPTIONS.latitudeStep) {
    const lonStepForLat = getLongitudeStepForLatitude(lat, OPTIONS.longitudeStep);
    const lonJitter = Math.min(OPTIONS.jitter, lonStepForLat * 0.18);
    const latJitter = Math.min(OPTIONS.jitter, OPTIONS.latitudeStep * 0.18);

    for (let lon = -180; lon <= 180; lon += lonStepForLat) {
      const jitteredLon = lon + (random() - 0.5) * lonJitter;
      const jitteredLat = lat + (random() - 0.5) * latJitter;

      if (!geoContains(landGeoJson, [jitteredLon, jitteredLat])) continue;

      points.push([roundCoordinate(jitteredLon), roundCoordinate(jitteredLat)]);
    }
  }

  return points;
}

const startedAt = performance.now();
const points = generateLandPoints();
const payload = `${JSON.stringify(points)}\n`;

await writeFile(OUTPUT_FILE, payload, "utf8");

console.log(
  `Generated ${points.length.toLocaleString()} globe land points in ${Math.round(performance.now() - startedAt)}ms.`,
);
