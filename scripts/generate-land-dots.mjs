import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { geoContains } from "d3-geo";
import landTopology from "world-atlas/land-110m.json" with { type: "json" };
import { feature } from "topojson-client";

const OUTPUT_PATH = resolve("src/data/landDots.json");
const RADIUS = 2.4;
const LONGITUDE_STEP = 1.55;
const LATITUDE_STEP = 1.55;
const JITTER = 0.28;
const MIN_LATITUDE = -55;
const MAX_LATITUDE = 85;

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

function round(value) {
  return Number(value.toFixed(5));
}

const landGeoJson = feature(landTopology, landTopology.objects.land);
const random = createSeededRandom(1917);
const dots = [];

for (let lat = MIN_LATITUDE; lat <= MAX_LATITUDE; lat += LATITUDE_STEP) {
  for (let lon = -180; lon <= 180; lon += LONGITUDE_STEP) {
    const jitteredLon = lon + (random() - 0.5) * JITTER;
    const jitteredLat = lat + (random() - 0.5) * JITTER;

    if (!geoContains(landGeoJson, [jitteredLon, jitteredLat])) continue;

    // Project longitude/latitude directly onto the 3D sphere.
    // This avoids 2D map stretching and keeps continent proportions geographic.
    const latRad = (jitteredLat * Math.PI) / 180;
    const lonRad = (jitteredLon * Math.PI) / 180;
    const x = RADIUS * Math.cos(latRad) * Math.sin(lonRad);
    const y = RADIUS * Math.sin(latRad);
    const z = RADIUS * Math.cos(latRad) * Math.cos(lonRad);

    dots.push([round(x), round(y), round(z), round(random())]);
  }
}

const payload = {
  radius: RADIUS,
  source: "world-atlas/land-110m.json",
  longitudeStep: LONGITUDE_STEP,
  latitudeStep: LATITUDE_STEP,
  minLatitude: MIN_LATITUDE,
  maxLatitude: MAX_LATITUDE,
  dots,
};

await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify(payload)}\n`);

console.log(`Generated ${dots.length} land dots at ${OUTPUT_PATH}`);
