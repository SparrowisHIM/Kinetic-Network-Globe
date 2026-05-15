export type SphereCoordinate = {
  lat: number;
  lon: number;
};

export type SpherePosition = {
  x: number;
  y: number;
  z: number;
};

export function projectLonLatToSphere({ lat, lon }: SphereCoordinate, radius: number): SpherePosition {
  // Latitude controls only vertical placement: -90 is the south pole,
  // 0 is the equator, and 90 is the north pole.
  const latRad = (lat * Math.PI) / 180;

  // Longitude controls horizontal rotation around the sphere. No offsets,
  // swapped values, or axis-specific scaling are applied here.
  const lonRad = (lon * Math.PI) / 180;

  const x = radius * Math.cos(latRad) * Math.sin(lonRad);
  const y = radius * Math.sin(latRad);
  const z = radius * Math.cos(latRad) * Math.cos(lonRad);

  return { x, y, z };
}

