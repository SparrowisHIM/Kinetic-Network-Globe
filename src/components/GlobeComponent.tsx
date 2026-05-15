import { Canvas, type ThreeEvent, useFrame } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import landTopology from "world-atlas/land-110m.json";
import {
  AdditiveBlending,
  BufferGeometry,
  Float32BufferAttribute,
  type Mesh,
  type MeshBasicMaterial,
  QuadraticBezierCurve3,
  SphereGeometry,
  TubeGeometry,
  Vector3,
  type Group,
} from "three";
import { feature } from "topojson-client";

const IDLE_ROTATION_SPEED = 0.045;
const GLOBE_DISPLAY_TILT = -0.18;
const HORIZONTAL_DRAG_SENSITIVITY = 0.006;
const VERTICAL_TILT_SENSITIVITY = 0.0024;
const MIN_INSPECTION_TILT = -0.35;
const MAX_INSPECTION_TILT = 0.35;
const MAX_HORIZONTAL_VELOCITY = 3.2;
const VELOCITY_SMOOTHING = 0.35;
const MOMENTUM_FRICTION = 0.92;
const MOMENTUM_EPSILON = 0.0025;
const TILT_SETTLE_EPSILON = 0.0015;
const TILT_RETURN_SMOOTHING = 6.8;
const IDLE_BLEND_START_VELOCITY = 0.16;
const MAX_POINTER_DELTA = 80;
const MIN_POINTER_DELTA_TIME = 16;
const MAX_POINTER_DELTA_TIME = 80;
const DESKTOP_LAND_DOT_COUNT = 7600;
const COMPACT_LAND_DOT_COUNT = 5200;
const DESKTOP_OCEAN_DOT_COUNT = 2400;
const COMPACT_OCEAN_DOT_COUNT = 1500;
const GLOBE_RADIUS = 1.62;
const LAND_DOT_POINT_SIZE = 3.15;
const OCEAN_DOT_POINT_SIZE = 2.15;
const ROUTE_RADIUS = GLOBE_RADIUS + 0.045;
const DESKTOP_ROUTE_SEGMENTS = 96;
const COMPACT_ROUTE_SEGMENTS = 72;
const ROUTE_LONGITUDE_OFFSET = 90;
const PULSE_LOOP_GAP = 0.18;
const PULSE_TRAIL_OFFSET = 0.038;
const NODE_RADIUS = ROUTE_RADIUS;
const INTERACTION_ENERGY_EASING = 5.8;
const REDUCED_MOTION_IDLE_SPEED = 0.008;
const REDUCED_MOTION_PULSE_SPEED_MULTIPLIER = 1.85;
const COMPACT_MEDIA_QUERY = "(max-width: 640px), (max-height: 620px)";

type GlobeGroupProps = {
  onDraggingChange: (isDragging: boolean) => void;
};

type InteractionState = "idle" | "dragging" | "momentum" | "settling";

type GlobeSceneProps = GlobeGroupProps & {
  onInteractionStateChange: (interactionState: InteractionState) => void;
  prefersReducedMotion: boolean;
  isCompactViewport: boolean;
};

type InteractionEnergyRef = MutableRefObject<number>;

type RouteStatus = "primary" | "active" | "quiet";

type GlobeRoute = {
  id: string;
  startName: string;
  endName: string;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  status: RouteStatus;
};

type RouteArcAsset = {
  route: GlobeRoute;
  curve: QuadraticBezierCurve3;
  geometry: TubeGeometry;
  pulseDuration: number;
  pulseDelay: number;
};

type PulseGeometries = {
  trail: SphereGeometry;
  glow: SphereGeometry;
  core: SphereGeometry;
};

type NodeGeometries = {
  glow: SphereGeometry;
  core: SphereGeometry;
};

type NetworkNode = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  status: RouteStatus;
  routeCount: number;
};

type SurfaceDotCounts = {
  land: number;
  ocean: number;
};

type SurfaceDotGeometries = {
  land: BufferGeometry;
  ocean: BufferGeometry;
};

type GeoRing = [number, number][];
type GeoPolygon = GeoRing[];

type PreparedLandPolygon = {
  rings: GeoPolygon;
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
};

const NETWORK_STATS = [
  { label: "Flow Paths", value: "08" },
  { label: "Data Packets", value: "24" },
  { label: "Latency", value: "42ms" },
];

const GLOBAL_ROUTES: GlobeRoute[] = [
  {
    id: "lagos-london",
    startName: "Lagos",
    endName: "London",
    startLat: 6.5244,
    startLng: 3.3792,
    endLat: 51.5072,
    endLng: -0.1276,
    status: "primary",
  },
  {
    id: "london-new-york",
    startName: "London",
    endName: "New York",
    startLat: 51.5072,
    startLng: -0.1276,
    endLat: 40.7128,
    endLng: -74.006,
    status: "active",
  },
  {
    id: "new-york-dubai",
    startName: "New York",
    endName: "Dubai",
    startLat: 40.7128,
    startLng: -74.006,
    endLat: 25.2048,
    endLng: 55.2708,
    status: "quiet",
  },
  {
    id: "dubai-singapore",
    startName: "Dubai",
    endName: "Singapore",
    startLat: 25.2048,
    startLng: 55.2708,
    endLat: 1.3521,
    endLng: 103.8198,
    status: "primary",
  },
  {
    id: "singapore-tokyo",
    startName: "Singapore",
    endName: "Tokyo",
    startLat: 1.3521,
    startLng: 103.8198,
    endLat: 35.6762,
    endLng: 139.6503,
    status: "active",
  },
  {
    id: "frankfurt-cape-town",
    startName: "Frankfurt",
    endName: "Cape Town",
    startLat: 50.1109,
    startLng: 8.6821,
    endLat: -33.9249,
    endLng: 18.4241,
    status: "quiet",
  },
  {
    id: "cape-town-lagos",
    startName: "Cape Town",
    endName: "Lagos",
    startLat: -33.9249,
    startLng: 18.4241,
    endLat: 6.5244,
    endLng: 3.3792,
    status: "active",
  },
];

type PointerPosition = {
  x: number;
  y: number;
  time: number;
};

type AngularVelocity = {
  y: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function dampVelocity(velocity: number, friction: number, delta: number) {
  return velocity * Math.pow(friction, delta * 60);
}

function dampValue(current: number, target: number, smoothing: number, delta: number) {
  return current + (target - current) * (1 - Math.exp(-smoothing * delta));
}

function getIdleBlend(horizontalVelocity: number) {
  const momentumWeight = clamp(Math.abs(horizontalVelocity) / IDLE_BLEND_START_VELOCITY, 0, 1);
  return 1 - momentumWeight;
}

function latLngToSpherePosition(latitude: number, longitude: number, radius = ROUTE_RADIUS) {
  const phi = ((90 - latitude) * Math.PI) / 180;
  const theta = ((longitude + ROUTE_LONGITUDE_OFFSET) * Math.PI) / 180;
  const x = -radius * Math.sin(phi) * Math.cos(theta);
  const y = radius * Math.cos(phi);
  const z = radius * Math.sin(phi) * Math.sin(theta);

  return new Vector3(x, y, z);
}

function normalizeLongitude(longitude: number) {
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

function getRingBounds(ring: GeoRing) {
  return ring.reduce(
    (bounds, [longitude, latitude]) => ({
      minLng: Math.min(bounds.minLng, longitude),
      maxLng: Math.max(bounds.maxLng, longitude),
      minLat: Math.min(bounds.minLat, latitude),
      maxLat: Math.max(bounds.maxLat, latitude),
    }),
    {
      minLng: Number.POSITIVE_INFINITY,
      maxLng: Number.NEGATIVE_INFINITY,
      minLat: Number.POSITIVE_INFINITY,
      maxLat: Number.NEGATIVE_INFINITY,
    },
  );
}

function pointInRing(longitude: number, latitude: number, ring: GeoRing) {
  let inside = false;

  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current, current += 1) {
    const [currentLng, currentLat] = ring[current];
    const [previousLng, previousLat] = ring[previous];
    const intersects =
      currentLat > latitude !== previousLat > latitude &&
      longitude < ((previousLng - currentLng) * (latitude - currentLat)) / (previousLat - currentLat) + currentLng;

    if (intersects) inside = !inside;
  }

  return inside;
}

function pointInPreparedPolygon(longitude: number, latitude: number, polygon: PreparedLandPolygon) {
  if (
    longitude < polygon.minLng ||
    longitude > polygon.maxLng ||
    latitude < polygon.minLat ||
    latitude > polygon.maxLat ||
    !pointInRing(longitude, latitude, polygon.rings[0])
  ) {
    return false;
  }

  for (let index = 1; index < polygon.rings.length; index += 1) {
    if (pointInRing(longitude, latitude, polygon.rings[index])) return false;
  }

  return true;
}

function prepareLandPolygons() {
  const topology = landTopology as {
    objects: {
      land: unknown;
    };
  };
  const landFeature = feature(landTopology as never, topology.objects.land as never) as unknown as {
    type: "FeatureCollection";
    features: Array<{
      geometry:
        | {
            type: "Polygon";
            coordinates: GeoPolygon;
          }
        | {
            type: "MultiPolygon";
            coordinates: GeoPolygon[];
          }
        | null;
    }>;
  };
  const geometries = landFeature.features.map((land) => land.geometry);
  const polygons: PreparedLandPolygon[] = [];

  geometries.forEach((geometry) => {
    if (!geometry) return;

    const polygonGroups =
      geometry.type === "Polygon"
        ? [geometry.coordinates as GeoPolygon]
        : geometry.type === "MultiPolygon"
          ? (geometry.coordinates as GeoPolygon[])
          : [];

    polygonGroups.forEach((rings) => {
      if (!rings[0]?.length) return;
      const bounds = getRingBounds(rings[0]);

      polygons.push({
        rings,
        ...bounds,
      });
    });
  });

  return polygons;
}

const LAND_POLYGONS = prepareLandPolygons();

function isLandCoordinate(longitude: number, latitude: number) {
  return LAND_POLYGONS.some((polygon) => pointInPreparedPolygon(longitude, latitude, polygon));
}

function createRouteCurve(route: GlobeRoute) {
  const start = latLngToSpherePosition(route.startLat, route.startLng);
  const end = latLngToSpherePosition(route.endLat, route.endLng);
  const angle = start.angleTo(end);
  const lift = clamp(0.07 + angle * 0.05, 0.09, 0.2);
  const middle = start.clone().add(end).normalize().multiplyScalar(ROUTE_RADIUS + lift);

  return new QuadraticBezierCurve3(start, middle, end);
}

function createRouteArcGeometry(route: GlobeRoute, curve: QuadraticBezierCurve3, routeSegments: number) {
  const tubeRadius = route.status === "primary" ? 0.0046 : route.status === "active" ? 0.0035 : 0.0024;

  return new TubeGeometry(curve, routeSegments, tubeRadius, 8, false);
}

function createRouteArcAsset(route: GlobeRoute, index: number, routeSegments: number): RouteArcAsset {
  const curve = createRouteCurve(route);

  return {
    route,
    curve,
    geometry: createRouteArcGeometry(route, curve, routeSegments),
    pulseDuration: route.status === "primary" ? 4.45 + index * 0.08 : route.status === "active" ? 5.2 : 6.1,
    pulseDelay: index * 0.34 + (route.status === "quiet" ? 0.5 : 0),
  };
}

function getStrongerRouteStatus(current: RouteStatus, next: RouteStatus) {
  const rank: Record<RouteStatus, number> = {
    quiet: 0,
    active: 1,
    primary: 2,
  };

  return rank[next] > rank[current] ? next : current;
}

function extractNetworkNodes(routes: GlobeRoute[]) {
  const nodes = new Map<string, NetworkNode>();

  routes.forEach((route) => {
    const routeNodes = [
      {
        name: route.startName,
        latitude: route.startLat,
        longitude: route.startLng,
      },
      {
        name: route.endName,
        latitude: route.endLat,
        longitude: route.endLng,
      },
    ];

    routeNodes.forEach((node) => {
      const id = node.name.toLowerCase().replace(/\s+/g, "-");
      const existingNode = nodes.get(id);

      if (existingNode) {
        existingNode.status = getStrongerRouteStatus(existingNode.status, route.status);
        existingNode.routeCount += 1;
        return;
      }

      nodes.set(id, {
        id,
        name: node.name,
        latitude: node.latitude,
        longitude: node.longitude,
        status: route.status,
        routeCount: 1,
      });
    });
  });

  return Array.from(nodes.values());
}

function getRouteOpacity(status: RouteStatus) {
  if (status === "primary") return 0.34;
  if (status === "active") return 0.24;
  return 0.14;
}

function getRouteGlowOpacity(status: RouteStatus) {
  if (status === "primary") return 0.075;
  if (status === "active") return 0.052;
  return 0.034;
}

function getPulseScale(status: RouteStatus) {
  if (status === "primary") return 0.014;
  if (status === "active") return 0.0115;
  return 0.009;
}

function getNodeScale(node: NetworkNode) {
  const connectionWeight = Math.min(node.routeCount - 1, 2) * 0.0025;

  if (node.status === "primary") return 0.024 + connectionWeight;
  if (node.status === "active") return 0.02 + connectionWeight;
  return 0.016 + connectionWeight;
}

function getMomentumEnergy(velocity: AngularVelocity) {
  const velocityStrength = Math.abs(velocity.y / MAX_HORIZONTAL_VELOCITY);
  return clamp(velocityStrength * 1.35, 0, 0.72);
}

function createSurfacePointGeometry(dotCounts: SurfaceDotCounts) {
  const candidateCount = Math.max((dotCounts.land + dotCounts.ocean) * 5, 24000);
  const landPositions = new Float32Array(dotCounts.land * 3);
  const oceanPositions = new Float32Array(dotCounts.ocean * 3);
  const landSeeds = new Float32Array(dotCounts.land);
  const oceanSeeds = new Float32Array(dotCounts.ocean);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  let landIndex = 0;
  let oceanIndex = 0;

  for (let index = 0; index < candidateCount; index += 1) {
    if (landIndex >= dotCounts.land && oceanIndex >= dotCounts.ocean) break;

    const y = 1 - (index / (candidateCount - 1)) * 2;
    const theta = index * goldenAngle;
    const latitude = (Math.asin(y) * 180) / Math.PI;
    const longitude = normalizeLongitude((theta * 180) / Math.PI);
    const position = latLngToSpherePosition(latitude, longitude, GLOBE_RADIUS + 0.006);
    const isLand = isLandCoordinate(longitude, latitude);

    if (isLand && landIndex < dotCounts.land) {
      const positionIndex = landIndex * 3;
      landPositions[positionIndex] = position.x;
      landPositions[positionIndex + 1] = position.y;
      landPositions[positionIndex + 2] = position.z;
      landSeeds[landIndex] = (index % 23) / 23;
      landIndex += 1;
    } else if (!isLand && oceanIndex < dotCounts.ocean && index % 3 === 0) {
      const positionIndex = oceanIndex * 3;
      oceanPositions[positionIndex] = position.x;
      oceanPositions[positionIndex + 1] = position.y;
      oceanPositions[positionIndex + 2] = position.z;
      oceanSeeds[oceanIndex] = (index % 19) / 19;
      oceanIndex += 1;
    }
  }

  const landGeometry = new BufferGeometry();
  const oceanGeometry = new BufferGeometry();

  landGeometry.setAttribute("position", new Float32BufferAttribute(landPositions.slice(0, landIndex * 3), 3));
  landGeometry.setAttribute("aSeed", new Float32BufferAttribute(landSeeds.slice(0, landIndex), 1));
  oceanGeometry.setAttribute("position", new Float32BufferAttribute(oceanPositions.slice(0, oceanIndex * 3), 3));
  oceanGeometry.setAttribute("aSeed", new Float32BufferAttribute(oceanSeeds.slice(0, oceanIndex), 1));

  return {
    land: landGeometry,
    ocean: oceanGeometry,
  };
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);
    const handleChange = () => setMatches(mediaQuery.matches);

    handleChange();
    mediaQuery.addEventListener("change", handleChange);

    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [query]);

  return matches;
}

function RimAtmosphere({
  interactionEnergyRef,
  prefersReducedMotion,
}: {
  interactionEnergyRef: InteractionEnergyRef;
  prefersReducedMotion: boolean;
}) {
  const shellMaterialRef = useRef<MeshBasicMaterial>(null);
  const rimUniforms = useMemo(
    () => ({
      uGlowColor: { value: [0.35, 0.78, 1] },
      uEnergy: { value: 0 },
    }),
    [],
  );

  useFrame(() => {
    const energy = prefersReducedMotion ? interactionEnergyRef.current * 0.35 : interactionEnergyRef.current;
    rimUniforms.uEnergy.value = energy;

    if (shellMaterialRef.current) {
      shellMaterialRef.current.opacity = 0.018 + energy * 0.016;
    }
  });

  return (
    <group>
      <mesh>
        <sphereGeometry args={[1.76, 128, 128]} />
        <shaderMaterial
          transparent
          depthWrite={false}
          blending={AdditiveBlending}
          uniforms={rimUniforms}
          vertexShader={`
            varying float vRim;

            void main() {
              vec3 viewNormal = normalize(normalMatrix * normal);
              vRim = 1.0 - abs(viewNormal.z);
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `}
          fragmentShader={`
            precision highp float;

            uniform vec3 uGlowColor;
            uniform float uEnergy;
            varying float vRim;

            void main() {
              float rim = smoothstep(0.34, 1.0, vRim);
              float alpha = pow(rim, 2.4) * (0.34 + uEnergy * 0.18);
              gl_FragColor = vec4(uGlowColor, alpha);
            }
          `}
        />
      </mesh>

      <mesh scale={1.08}>
        <sphereGeometry args={[1.78, 128, 128]} />
        <meshBasicMaterial
          ref={shellMaterialRef}
          color="#2f9fff"
          transparent
          opacity={0.018}
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

function DigitalGlobeSurface({
  interactionEnergyRef,
  prefersReducedMotion,
  dotCounts,
}: {
  interactionEnergyRef: InteractionEnergyRef;
  prefersReducedMotion: boolean;
  dotCounts: SurfaceDotCounts;
}) {
  const surfaceGeometries = useMemo(() => createSurfacePointGeometry(dotCounts), [dotCounts]);
  const landUniforms = useMemo(
    () => ({
      uPointSize: { value: LAND_DOT_POINT_SIZE },
      uInnerColor: { value: [0.36, 0.78, 1] },
      uOuterColor: { value: [0.82, 0.95, 1] },
      uBaseAlpha: { value: 0.13 },
      uBrightAlpha: { value: 0.86 },
      uSweepStrength: { value: 0.16 },
      uPointScale: { value: 1 },
      uEnergy: { value: 0 },
      uTime: { value: 0 },
    }),
    [],
  );
  const oceanUniforms = useMemo(
    () => ({
      uPointSize: { value: OCEAN_DOT_POINT_SIZE },
      uInnerColor: { value: [0.12, 0.38, 0.62] },
      uOuterColor: { value: [0.36, 0.62, 0.78] },
      uBaseAlpha: { value: 0.012 },
      uBrightAlpha: { value: 0.16 },
      uSweepStrength: { value: 0.035 },
      uPointScale: { value: 0.82 },
      uEnergy: { value: 0 },
      uTime: { value: 0 },
    }),
    [],
  );
  const innerShellRef = useRef<MeshBasicMaterial>(null);

  useEffect(
    () => () => {
      surfaceGeometries.land.dispose();
      surfaceGeometries.ocean.dispose();
    },
    [surfaceGeometries],
  );

  useFrame(({ clock }) => {
    const energy = prefersReducedMotion ? interactionEnergyRef.current * 0.35 : interactionEnergyRef.current;
    const time = prefersReducedMotion ? 0 : clock.elapsedTime;

    landUniforms.uEnergy.value = energy;
    landUniforms.uTime.value = time;
    oceanUniforms.uEnergy.value = energy;
    oceanUniforms.uTime.value = time;

    if (innerShellRef.current) {
      innerShellRef.current.opacity = 0.035 + energy * 0.02;
    }
  });

  const surfaceVertexShader = `
    attribute float aSeed;
    uniform float uPointSize;
    uniform float uPointScale;
    uniform float uTime;
    varying float vFacing;
    varying float vSeed;
    varying float vSweep;

    void main() {
      vec3 viewNormal = normalize(normalMatrix * normalize(position));
      vFacing = smoothstep(-0.05, 0.92, viewNormal.z);
      vSeed = aSeed;
      float latitude = position.y / ${GLOBE_RADIUS.toFixed(2)};
      float slowBand = sin(latitude * 8.4 + uTime * 0.62 + aSeed * 6.28318530718);
      vSweep = smoothstep(0.9, 1.0, slowBand * 0.5 + 0.5) * vFacing;

      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      gl_PointSize = uPointSize * uPointScale * (5.2 / -mvPosition.z) * mix(0.62, 1.18, vFacing);
    }
  `;

  const surfaceFragmentShader = `
    precision highp float;

    uniform vec3 uInnerColor;
    uniform vec3 uOuterColor;
    uniform float uBaseAlpha;
    uniform float uBrightAlpha;
    uniform float uSweepStrength;
    uniform float uEnergy;
    varying float vFacing;
    varying float vSeed;
    varying float vSweep;

    void main() {
      vec2 point = gl_PointCoord - vec2(0.5);
      float distanceFromCenter = length(point);
      float dotMask = smoothstep(0.5, 0.16, distanceFromCenter);
      float core = smoothstep(0.22, 0.0, distanceFromCenter);
      float alpha = dotMask * mix(uBaseAlpha, uBrightAlpha + uEnergy * 0.08, vFacing) * mix(0.72, 1.0, vSeed);
      alpha += dotMask * vSweep * uSweepStrength;
      vec3 color = mix(uInnerColor, uOuterColor, core * 0.76 + vFacing * 0.2 + vSweep * 0.2);

      if (alpha < 0.01) discard;
      gl_FragColor = vec4(color, alpha);
    }
  `;

  return (
    <group>
      <mesh>
        <sphereGeometry args={[1.56, 96, 96]} />
        <meshBasicMaterial color="#031021" />
      </mesh>

      <points geometry={surfaceGeometries.ocean}>
        <shaderMaterial
          transparent
          depthTest
          depthWrite={false}
          blending={AdditiveBlending}
          uniforms={oceanUniforms}
          vertexShader={surfaceVertexShader}
          fragmentShader={surfaceFragmentShader}
        />
      </points>

      <points geometry={surfaceGeometries.land}>
        <shaderMaterial
          transparent
          depthTest
          depthWrite={false}
          blending={AdditiveBlending}
          uniforms={landUniforms}
          vertexShader={surfaceVertexShader}
          fragmentShader={surfaceFragmentShader}
        />
      </points>

      <mesh>
        <sphereGeometry args={[1.69, 96, 96]} />
        <meshBasicMaterial ref={innerShellRef} color="#1f8fff" transparent opacity={0.035} depthWrite={false} />
      </mesh>

      <RimAtmosphere interactionEnergyRef={interactionEnergyRef} prefersReducedMotion={prefersReducedMotion} />
    </group>
  );
}

function OrbitalVeil({
  interactionEnergyRef,
  prefersReducedMotion,
}: {
  interactionEnergyRef: InteractionEnergyRef;
  prefersReducedMotion: boolean;
}) {
  const veilRef = useRef<Group>(null);
  const primaryMaterialRef = useRef<MeshBasicMaterial>(null);
  const secondaryMaterialRef = useRef<MeshBasicMaterial>(null);
  const tertiaryMaterialRef = useRef<MeshBasicMaterial>(null);

  useFrame((_, delta) => {
    const energy = prefersReducedMotion ? interactionEnergyRef.current * 0.35 : interactionEnergyRef.current;

    if (veilRef.current && !prefersReducedMotion) {
      veilRef.current.rotation.y += delta * 0.026;
      veilRef.current.rotation.z -= delta * 0.014;
    }

    if (primaryMaterialRef.current) primaryMaterialRef.current.opacity = 0.055 + energy * 0.018;
    if (secondaryMaterialRef.current) secondaryMaterialRef.current.opacity = 0.036 + energy * 0.014;
    if (tertiaryMaterialRef.current) tertiaryMaterialRef.current.opacity = 0.026 + energy * 0.01;
  });

  return (
    <group ref={veilRef} name="orbital-veil-layer">
      <mesh rotation={[0.55, 0.12, -0.22]}>
        <torusGeometry args={[1.83, 0.0024, 8, 220]} />
        <meshBasicMaterial
          ref={primaryMaterialRef}
          color="#9be9ff"
          transparent
          opacity={0.055}
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>
      <mesh rotation={[1.18, -0.42, 0.28]}>
        <torusGeometry args={[1.88, 0.0018, 8, 220]} />
        <meshBasicMaterial
          ref={secondaryMaterialRef}
          color="#57cfff"
          transparent
          opacity={0.036}
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>
      <mesh rotation={[-0.35, 0.64, 0.82]}>
        <torusGeometry args={[1.73, 0.0016, 8, 220]} />
        <meshBasicMaterial
          ref={tertiaryMaterialRef}
          color="#d6fbff"
          transparent
          opacity={0.026}
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

function RoutePulse({
  asset,
  interactionEnergyRef,
  pulseGeometries,
  prefersReducedMotion,
}: {
  asset: RouteArcAsset;
  interactionEnergyRef: InteractionEnergyRef;
  pulseGeometries: PulseGeometries;
  prefersReducedMotion: boolean;
}) {
  const coreRef = useRef<Mesh>(null);
  const glowRef = useRef<Mesh>(null);
  const trailRef = useRef<Mesh>(null);
  const secondTrailRef = useRef<Mesh>(null);
  const coreMaterialRef = useRef<MeshBasicMaterial>(null);
  const glowMaterialRef = useRef<MeshBasicMaterial>(null);
  const trailMaterialRef = useRef<MeshBasicMaterial>(null);
  const secondTrailMaterialRef = useRef<MeshBasicMaterial>(null);
  const baseScale = getPulseScale(asset.route.status);

  useFrame(({ clock }) => {
    const motionMultiplier = prefersReducedMotion ? REDUCED_MOTION_PULSE_SPEED_MULTIPLIER : 1;
    const energy = prefersReducedMotion ? interactionEnergyRef.current * 0.35 : interactionEnergyRef.current;
    const pulseDuration = asset.pulseDuration * motionMultiplier;
    const loopDuration = pulseDuration + PULSE_LOOP_GAP * motionMultiplier;
    const loopTime = (clock.elapsedTime + asset.pulseDelay) % loopDuration;
    const progress = clamp(loopTime / pulseDuration, 0, 1);
    const fadeIn = smoothstep(0, 0.09, progress);
    const fadeOut = 1 - smoothstep(0.84, 1, progress);
    const visibility = fadeIn * fadeOut;

    if (visibility <= 0) {
      if (coreRef.current) coreRef.current.visible = false;
      if (glowRef.current) glowRef.current.visible = false;
      if (trailRef.current) trailRef.current.visible = false;
      if (secondTrailRef.current) secondTrailRef.current.visible = false;
      return;
    }

    const pulsePosition = asset.curve.getPointAt(progress);
    const trailPosition = asset.curve.getPointAt(clamp(progress - PULSE_TRAIL_OFFSET, 0, 1));
    const secondTrailPosition = asset.curve.getPointAt(clamp(progress - PULSE_TRAIL_OFFSET * 2.15, 0, 1));
    const shimmer = 1 + Math.sin(clock.elapsedTime * 3.2 + asset.pulseDelay) * 0.045;

    if (coreRef.current) {
      coreRef.current.visible = true;
      coreRef.current.position.copy(pulsePosition);
      coreRef.current.scale.setScalar(baseScale * shimmer * (1 + energy * 0.08));
    }

    if (glowRef.current) {
      glowRef.current.visible = true;
      glowRef.current.position.copy(pulsePosition);
      glowRef.current.scale.setScalar(baseScale * 3.8 * shimmer * (1 + energy * 0.1));
    }

    if (trailRef.current) {
      trailRef.current.visible = true;
      trailRef.current.position.copy(trailPosition);
      trailRef.current.scale.setScalar(baseScale * 0.82 * visibility);
    }

    if (secondTrailRef.current) {
      secondTrailRef.current.visible = true;
      secondTrailRef.current.position.copy(secondTrailPosition);
      secondTrailRef.current.scale.setScalar(baseScale * 0.54 * visibility);
    }

    if (coreMaterialRef.current) coreMaterialRef.current.opacity = (0.72 + energy * 0.05) * visibility;
    if (glowMaterialRef.current) glowMaterialRef.current.opacity = (0.07 + energy * 0.03) * visibility;
    if (trailMaterialRef.current) trailMaterialRef.current.opacity = (0.26 + energy * 0.04) * visibility;
    if (secondTrailMaterialRef.current) secondTrailMaterialRef.current.opacity = (0.12 + energy * 0.03) * visibility;
  });

  return (
    <group>
      <mesh ref={trailRef} geometry={pulseGeometries.trail}>
        <meshBasicMaterial
          ref={trailMaterialRef}
          color="#86e7ff"
          transparent
          opacity={0.2}
          depthTest
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>
      <mesh ref={secondTrailRef} geometry={pulseGeometries.trail}>
        <meshBasicMaterial
          ref={secondTrailMaterialRef}
          color="#64c9ff"
          transparent
          opacity={0.1}
          depthTest
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>
      <mesh ref={glowRef} geometry={pulseGeometries.glow}>
        <meshBasicMaterial
          ref={glowMaterialRef}
          color="#7de4ff"
          transparent
          opacity={0.07}
          depthTest={false}
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>
      <mesh ref={coreRef} geometry={pulseGeometries.core}>
        <meshBasicMaterial
          ref={coreMaterialRef}
          color="#f1fdff"
          transparent
          opacity={0.72}
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

function NetworkNodeMarker({
  node,
  index,
  interactionEnergyRef,
  nodeGeometries,
  prefersReducedMotion,
}: {
  node: NetworkNode;
  index: number;
  interactionEnergyRef: InteractionEnergyRef;
  nodeGeometries: NodeGeometries;
  prefersReducedMotion: boolean;
}) {
  const coreRef = useRef<Mesh>(null);
  const glowRef = useRef<Mesh>(null);
  const coreMaterialRef = useRef<MeshBasicMaterial>(null);
  const glowMaterialRef = useRef<MeshBasicMaterial>(null);
  const position = useMemo(() => latLngToSpherePosition(node.latitude, node.longitude, NODE_RADIUS), [node]);
  const baseScale = getNodeScale(node);

  useFrame(({ clock }) => {
    const energy = prefersReducedMotion ? interactionEnergyRef.current * 0.35 : interactionEnergyRef.current;
    const breathing = prefersReducedMotion ? 1 : 1 + Math.sin(clock.elapsedTime * 1.25 + index) * 0.026;

    if (coreRef.current) {
      coreRef.current.scale.setScalar(baseScale * breathing * (1 + energy * 0.06));
    }

    if (glowRef.current) {
      glowRef.current.scale.setScalar(baseScale * 3.25 * breathing * (1 + energy * 0.12));
    }

    if (coreMaterialRef.current) {
      coreMaterialRef.current.opacity = (node.status === "primary" ? 0.82 : 0.64) + energy * 0.04;
    }

    if (glowMaterialRef.current) {
      glowMaterialRef.current.opacity = (node.status === "primary" ? 0.13 : 0.08) + energy * 0.035;
    }
  });

  return (
    <group position={position}>
      <mesh ref={glowRef} geometry={nodeGeometries.glow}>
        <meshBasicMaterial
          ref={glowMaterialRef}
          color="#7ddfff"
          transparent
          opacity={node.status === "primary" ? 0.13 : 0.08}
          depthTest
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>
      <mesh ref={coreRef} geometry={nodeGeometries.core}>
        <meshBasicMaterial
          ref={coreMaterialRef}
          color={node.status === "quiet" ? "#8adfff" : "#eafcff"}
          transparent
          opacity={node.status === "primary" ? 0.82 : 0.64}
          depthTest
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

function NetworkNodeLayer({
  interactionEnergyRef,
  prefersReducedMotion,
}: {
  interactionEnergyRef: InteractionEnergyRef;
  prefersReducedMotion: boolean;
}) {
  const nodes = useMemo(() => extractNetworkNodes(GLOBAL_ROUTES), []);
  const nodeGeometries = useMemo(
    () => ({
      glow: new SphereGeometry(1, 16, 16),
      core: new SphereGeometry(1, 16, 16),
    }),
    [],
  );

  useEffect(
    () => () => {
      nodeGeometries.glow.dispose();
      nodeGeometries.core.dispose();
    },
    [nodeGeometries],
  );

  return (
    <group name="global-network-node-layer">
      {nodes.map((node, index) => (
        <NetworkNodeMarker
          key={node.id}
          node={node}
          index={index}
          interactionEnergyRef={interactionEnergyRef}
          nodeGeometries={nodeGeometries}
          prefersReducedMotion={prefersReducedMotion}
        />
      ))}
    </group>
  );
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const x = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return x * x * (3 - 2 * x);
}

function RouteArcLine({
  route,
  geometry,
  interactionEnergyRef,
  prefersReducedMotion,
}: {
  route: GlobeRoute;
  geometry: TubeGeometry;
  interactionEnergyRef: InteractionEnergyRef;
  prefersReducedMotion: boolean;
}) {
  const glowMaterialRef = useRef<MeshBasicMaterial>(null);
  const coreMaterialRef = useRef<MeshBasicMaterial>(null);

  useFrame(() => {
    const energy = prefersReducedMotion ? interactionEnergyRef.current * 0.35 : interactionEnergyRef.current;

    if (glowMaterialRef.current) {
      glowMaterialRef.current.opacity = getRouteGlowOpacity(route.status) * (1 + energy * 0.9);
    }

    if (coreMaterialRef.current) {
      coreMaterialRef.current.opacity = getRouteOpacity(route.status) * (1 + energy * 0.34);
    }
  });

  return (
    <group>
      <mesh geometry={geometry}>
        <meshBasicMaterial
          ref={glowMaterialRef}
          color="#68d9ff"
          transparent
          opacity={getRouteGlowOpacity(route.status)}
          depthTest={false}
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>
      <mesh geometry={geometry}>
        <meshBasicMaterial
          ref={coreMaterialRef}
          color={route.status === "primary" ? "#c8f6ff" : "#74d8ff"}
          transparent
          opacity={getRouteOpacity(route.status)}
          depthTest
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

function RouteArcLayer({
  interactionEnergyRef,
  prefersReducedMotion,
  routeSegments,
}: {
  interactionEnergyRef: InteractionEnergyRef;
  prefersReducedMotion: boolean;
  routeSegments: number;
}) {
  const routeAssets = useMemo(
    () => GLOBAL_ROUTES.map((route, index) => createRouteArcAsset(route, index, routeSegments)),
    [routeSegments],
  );
  const pulseGeometries = useMemo(
    () => ({
      trail: new SphereGeometry(1, 10, 10),
      glow: new SphereGeometry(1, 12, 12),
      core: new SphereGeometry(1, 12, 12),
    }),
    [],
  );

  useEffect(
    () => () => {
      routeAssets.forEach((asset) => asset.geometry.dispose());
    },
    [routeAssets],
  );

  useEffect(
    () => () => {
      pulseGeometries.trail.dispose();
      pulseGeometries.glow.dispose();
      pulseGeometries.core.dispose();
    },
    [pulseGeometries],
  );

  return (
    <group name="global-route-arc-layer">
      {routeAssets.map(({ route, geometry }) => (
        <RouteArcLine
          key={route.id}
          route={route}
          geometry={geometry}
          interactionEnergyRef={interactionEnergyRef}
          prefersReducedMotion={prefersReducedMotion}
        />
      ))}
      {routeAssets.map((asset) => (
        <RoutePulse
          key={`${asset.route.id}-pulse`}
          asset={asset}
          interactionEnergyRef={interactionEnergyRef}
          pulseGeometries={pulseGeometries}
          prefersReducedMotion={prefersReducedMotion}
        />
      ))}
      <NetworkNodeLayer interactionEnergyRef={interactionEnergyRef} prefersReducedMotion={prefersReducedMotion} />
    </group>
  );
}

function GlobeGroup({
  onDraggingChange,
  onInteractionStateChange,
  prefersReducedMotion,
  isCompactViewport,
}: GlobeSceneProps) {
  const yawGroupRef = useRef<Group>(null);
  const tiltGroupRef = useRef<Group>(null);
  const isDraggingRef = useRef(false);
  const activePointerIdRef = useRef<number | null>(null);
  const activePointerTargetRef = useRef<Element | null>(null);
  const previousPointerRef = useRef<PointerPosition | null>(null);
  const angularVelocityRef = useRef<AngularVelocity>({ y: 0 });
  const interactionStateRef = useRef<InteractionState>("idle");
  const interactionEnergyRef = useRef(0);
  const surfaceDotCounts = useMemo(
    () => ({
      land: isCompactViewport ? COMPACT_LAND_DOT_COUNT : DESKTOP_LAND_DOT_COUNT,
      ocean: isCompactViewport ? COMPACT_OCEAN_DOT_COUNT : DESKTOP_OCEAN_DOT_COUNT,
    }),
    [isCompactViewport],
  );

  const setInteractionState = useCallback(
    (nextState: InteractionState) => {
      if (interactionStateRef.current === nextState) return;
      interactionStateRef.current = nextState;
      onInteractionStateChange(nextState);
    },
    [onInteractionStateChange],
  );

  useEffect(() => {
    onInteractionStateChange(interactionStateRef.current);
  }, [onInteractionStateChange]);

  useFrame((_, delta) => {
    if (!yawGroupRef.current || !tiltGroupRef.current) return;

    const velocity = angularVelocityRef.current;
    const hasMomentum = Math.abs(velocity.y) > MOMENTUM_EPSILON;

    if (isDraggingRef.current) {
      const dragEnergy = prefersReducedMotion ? 0.42 : 1;
      interactionEnergyRef.current = dampValue(interactionEnergyRef.current, dragEnergy, INTERACTION_ENERGY_EASING, delta);
      return;
    }

    const currentTilt = tiltGroupRef.current.rotation.x;
    const settlingTilt = Math.abs(currentTilt) > TILT_SETTLE_EPSILON;
    const targetEnergy = hasMomentum
      ? getMomentumEnergy(velocity) * (prefersReducedMotion ? 0.45 : 1)
      : settlingTilt
        ? clamp(Math.abs(currentTilt) / MAX_INSPECTION_TILT, 0, 1) * 0.18
        : 0;

    interactionEnergyRef.current = dampValue(
      interactionEnergyRef.current,
      targetEnergy,
      INTERACTION_ENERGY_EASING * (hasMomentum ? 0.74 : 0.48),
      delta,
    );

    if (hasMomentum) {
      setInteractionState("momentum");
    } else if (settlingTilt || interactionEnergyRef.current > 0.025) {
      setInteractionState("settling");
    } else {
      setInteractionState("idle");
    }

    if (hasMomentum) {
      yawGroupRef.current.rotation.y += velocity.y * delta;
      velocity.y = dampVelocity(velocity.y, MOMENTUM_FRICTION, delta);
    } else {
      velocity.y = 0;
    }

    tiltGroupRef.current.rotation.x = dampValue(currentTilt, 0, TILT_RETURN_SMOOTHING, delta);

    const idleSpeed = prefersReducedMotion ? REDUCED_MOTION_IDLE_SPEED : IDLE_ROTATION_SPEED;
    yawGroupRef.current.rotation.y += delta * idleSpeed * getIdleBlend(velocity.y);
  });

  const stopDrag = useCallback(() => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    if (activePointerTargetRef.current && activePointerIdRef.current !== null) {
      if (activePointerTargetRef.current.hasPointerCapture?.(activePointerIdRef.current)) {
        activePointerTargetRef.current.releasePointerCapture?.(activePointerIdRef.current);
      }
    }
    activePointerTargetRef.current = null;
    activePointerIdRef.current = null;
    previousPointerRef.current = null;
    onDraggingChange(false);
  }, [onDraggingChange]);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      if (!isDraggingRef.current) return;
      if (activePointerIdRef.current !== event.pointerId) return;
      if (!yawGroupRef.current || !tiltGroupRef.current || !previousPointerRef.current) return;

      event.preventDefault();

      const deltaX = event.clientX - previousPointerRef.current.x;
      const deltaY = event.clientY - previousPointerRef.current.y;
      const deltaTime = clamp(
        event.timeStamp - previousPointerRef.current.time,
        MIN_POINTER_DELTA_TIME,
        MAX_POINTER_DELTA_TIME,
      );
      const clampedDeltaX = clamp(deltaX, -MAX_POINTER_DELTA, MAX_POINTER_DELTA);
      const clampedDeltaY = clamp(deltaY, -MAX_POINTER_DELTA, MAX_POINTER_DELTA);

      yawGroupRef.current.rotation.y += clampedDeltaX * HORIZONTAL_DRAG_SENSITIVITY;
      tiltGroupRef.current.rotation.x = clamp(
        tiltGroupRef.current.rotation.x + clampedDeltaY * VERTICAL_TILT_SENSITIVITY,
        MIN_INSPECTION_TILT,
        MAX_INSPECTION_TILT,
      );

      const velocityScale = 1000 / deltaTime;
      const nextVelocityY = clamp(
        clampedDeltaX * HORIZONTAL_DRAG_SENSITIVITY * velocityScale,
        -MAX_HORIZONTAL_VELOCITY * (prefersReducedMotion ? 0.65 : 1),
        MAX_HORIZONTAL_VELOCITY * (prefersReducedMotion ? 0.65 : 1),
      );

      angularVelocityRef.current.y += (nextVelocityY - angularVelocityRef.current.y) * VELOCITY_SMOOTHING;

      previousPointerRef.current = {
        x: event.clientX,
        y: event.clientY,
        time: event.timeStamp,
      };
    }

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", stopDrag);
    window.addEventListener("pointercancel", stopDrag);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopDrag);
      window.removeEventListener("pointercancel", stopDrag);
    };
  }, [prefersReducedMotion, stopDrag]);

  const handlePointerDown = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
      event.nativeEvent.preventDefault();

      isDraggingRef.current = true;
      activePointerIdRef.current = event.pointerId;
      activePointerTargetRef.current = event.nativeEvent.target as Element;
      activePointerTargetRef.current.setPointerCapture?.(event.pointerId);
      angularVelocityRef.current = { y: 0 };
      setInteractionState("dragging");
      previousPointerRef.current = {
        x: event.clientX,
        y: event.clientY,
        time: event.nativeEvent.timeStamp,
      };
      onDraggingChange(true);
    },
    [onDraggingChange],
  );

  return (
    <group
      name="main-globe-orientation-group"
      rotation={[GLOBE_DISPLAY_TILT, 0, 0]}
      onPointerDown={handlePointerDown}
    >
      <group ref={yawGroupRef} name="main-globe-yaw-group">
        <group ref={tiltGroupRef} name="main-globe-temporary-tilt-group">
          <DigitalGlobeSurface
            interactionEnergyRef={interactionEnergyRef}
            prefersReducedMotion={prefersReducedMotion}
            dotCounts={surfaceDotCounts}
          />
          <OrbitalVeil interactionEnergyRef={interactionEnergyRef} prefersReducedMotion={prefersReducedMotion} />
          <RouteArcLayer
            interactionEnergyRef={interactionEnergyRef}
            prefersReducedMotion={prefersReducedMotion}
            routeSegments={isCompactViewport ? COMPACT_ROUTE_SEGMENTS : DESKTOP_ROUTE_SEGMENTS}
          />
        </group>
      </group>
    </group>
  );
}

function GlobeScene({
  onDraggingChange,
  onInteractionStateChange,
  prefersReducedMotion,
  isCompactViewport,
}: GlobeSceneProps) {
  return (
    <>
      <ambientLight intensity={0.42} />
      <directionalLight position={[4, 3, 5]} intensity={1.8} color="#8bc3ff" />
      <pointLight position={[-3, -1.5, 3]} intensity={2.1} color="#2b6dff" />
      <pointLight position={[0, 2.5, -4]} intensity={1} color="#2de8ff" />
      <GlobeGroup
        onDraggingChange={onDraggingChange}
        onInteractionStateChange={onInteractionStateChange}
        prefersReducedMotion={prefersReducedMotion}
        isCompactViewport={isCompactViewport}
      />
    </>
  );
}

export function GlobeComponent() {
  const [isDragging, setIsDragging] = useState(false);
  const [interactionState, setInteractionState] = useState<InteractionState>("idle");
  const prefersReducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const isCompactViewport = useMediaQuery(COMPACT_MEDIA_QUERY);
  const canvasDpr = useMemo<[number, number]>(
    () => (prefersReducedMotion || isCompactViewport ? [1, 1.3] : [1, 1.75]),
    [isCompactViewport, prefersReducedMotion],
  );

  return (
    <section
      className={`globe-section is-${interactionState}${isDragging ? " is-dragging" : ""}`}
      aria-labelledby="globe-title"
      aria-describedby="globe-description"
    >
      <div className="globe-ambient" aria-hidden="true" />
      <div className="globe-overlay">
        <div className="globe-copy">
          <div className="globe-status">
            <span className="globe-status-dot" />
            Live signal mesh
          </div>
          <h1 id="globe-title">Orbital Signal Mesh</h1>
          <p id="globe-description">
            A calm spatial interface for watching live data paths drift across a connected global surface.
          </p>
        </div>

        <div className="globe-stats">
          {NETWORK_STATS.map((stat) => (
            <div className="globe-stat" key={stat.label}>
              <span>{stat.value}</span>
              <small>{stat.label}</small>
            </div>
          ))}
          <div className="globe-stat globe-stat-wide">
            <span>Stable</span>
            <small>Mesh Health</small>
          </div>
        </div>
      </div>
      <div className="globe-stage">
        <Canvas
          className="globe-canvas"
          camera={{ position: [0, 0, 5.2], fov: 42 }}
          dpr={canvasDpr}
          gl={{ antialias: true, alpha: true }}
        >
          <GlobeScene
            onDraggingChange={setIsDragging}
            onInteractionStateChange={setInteractionState}
            prefersReducedMotion={prefersReducedMotion}
            isCompactViewport={isCompactViewport}
          />
        </Canvas>
      </div>
    </section>
  );
}
