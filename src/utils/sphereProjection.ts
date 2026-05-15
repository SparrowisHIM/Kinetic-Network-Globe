export type SphereCoordinate = {
  lat: number;
  lon: number;
};

export type SpherePosition = {
  x: number;
  y: number;
  z: number;
};

export type OrthographicProjectionOptions = {
  centerLon: number;
  centerLat: number;
  radius: number;
};

export type OrthographicSpherePosition = SpherePosition & {
  visible: boolean;
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

export function projectLonLatToOrthographicSphere(
  { lat, lon }: SphereCoordinate,
  { centerLon, centerLat, radius }: OrthographicProjectionOptions,
): OrthographicSpherePosition {
  const latRad = (lat * Math.PI) / 180;
  const lonRad = (lon * Math.PI) / 180;
  const centerLatRad = (centerLat * Math.PI) / 180;
  const centerLonRad = (centerLon * Math.PI) / 180;
  const deltaLon = lonRad - centerLonRad;

  // Orthographic globe projection:
  // x is the horizontal offset around the centered longitude,
  // y is the latitude-aware vertical offset, and
  // depth decides whether the point is on the visible hemisphere.
  const x = radius * Math.cos(latRad) * Math.sin(deltaLon);
  const y =
    radius *
    (Math.cos(centerLatRad) * Math.sin(latRad) -
      Math.sin(centerLatRad) * Math.cos(latRad) * Math.cos(deltaLon));
  const depth =
    Math.sin(centerLatRad) * Math.sin(latRad) +
    Math.cos(centerLatRad) * Math.cos(latRad) * Math.cos(deltaLon);

  return {
    x,
    y,
    z: radius * depth,
    visible: depth >= 0,
  };
}
