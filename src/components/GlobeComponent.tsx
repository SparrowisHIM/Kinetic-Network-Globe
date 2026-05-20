import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject } from "react";
import { generateLandPoints, type LandPoint } from "../data/globeLandPoints";
import {
  NETWORK_COUNTRIES,
  NETWORK_ROUTES,
  type NetworkCountry,
  type NetworkCountryId,
  type NetworkRoute,
} from "../data/globeRoutes";
import { projectLonLatToSphere } from "../utils/sphereProjection";
import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  LinearFilter,
  Line,
  LineBasicMaterial,
  MeshBasicMaterial,
  NormalBlending,
  QuadraticBezierCurve3,
  Vector3,
  type Group,
} from "three";

const GLOBE_DEBUG_MODE = false;
const SHOW_NETWORK_LAYER = true;
const IDLE_ROTATION_SPEED = 0.045;
const CENTER_LONGITUDE = 17;
const CENTER_LATITUDE = 8;
const DOT_SPACING = 0.72;
const DOT_JITTER = DOT_SPACING * 0.09;
const DOT_SIZE = 1.16;
const LAND_MIN_LATITUDE = -62;
const LAND_MAX_LATITUDE = 84;
// A tiny presentation pitch matches the reference framing: northern land stays readable
// while Africa sits slightly below visual center. Drag still returns the globe upright.
const DEFAULT_ROTATION_X = -0.095;
const DEFAULT_ROTATION_Y = -(CENTER_LONGITUDE * Math.PI) / 180;
const DEFAULT_ROTATION_Z = 0;
const HORIZONTAL_DRAG_SENSITIVITY = 0.0032;
const VERTICAL_DRAG_SENSITIVITY = 0.00165;
// Vertical drag is part of the main globe rotation, so a drag direction maps
// consistently wherever the user grabs the sphere.
const MIN_VERTICAL_ROTATION = -0.72;
const MAX_VERTICAL_ROTATION = 0.72;
const MAX_HORIZONTAL_VELOCITY = 2.2;
const MAX_VERTICAL_VELOCITY = 1.65;
const VELOCITY_SMOOTHING = 0.28;
const MOMENTUM_FRICTION = 0.88;
const MOMENTUM_EPSILON = 0.0025;
const AUTO_ROTATION_RESUME_DELAY = 0.65;
const IDLE_BLEND_START_VELOCITY = 0.16;
const VERTICAL_RETURN_STIFFNESS = 18;
const VERTICAL_RETURN_DAMPING = 7.8;
const REDUCED_MOTION_VERTICAL_RETURN_STIFFNESS = 9;
const REDUCED_MOTION_VERTICAL_RETURN_DAMPING = 6.2;
const VERTICAL_RETURN_EPSILON = 0.0015;
const VERTICAL_RETURN_VELOCITY_EPSILON = 0.002;
const MAX_POINTER_DELTA = 80;
const MIN_POINTER_DELTA_TIME = 16;
const MAX_POINTER_DELTA_TIME = 80;
const GLOBE_RADIUS = 2.4;
const LAND_DOT_POINT_SIZE = DOT_SIZE;
const INTERACTION_ENERGY_EASING = 5.8;
const REDUCED_MOTION_IDLE_SPEED = 0.008;
const COMPACT_MEDIA_QUERY = "(max-width: 640px), (max-height: 620px)";
const GLOBE_SPHERE_SEGMENTS = 64;
const GLOBE_DETAIL_SEGMENTS = 48;
const SURFACE_GRID_LAT_STEP = 20;
const SURFACE_GRID_LON_STEP = 20;
const SURFACE_GRID_SEGMENT_STEP = 2;
const ROUTE_SURFACE_RADIUS = GLOBE_RADIUS + 0.05;
const ROUTE_CURVE_SEGMENTS = 80;
const ROUTE_LINE_RADIUS = 0.0042;
const ROUTE_PULSE_SPEED = 0.115;
const ROUTE_PULSE_RADIUS = 0.023;
const ROUTE_NODE_RADIUS = 0.019;
const ROUTE_PULSE_SEGMENTS = 12;
const ROUTE_CORE_OPACITY = 0.54;
const ROUTE_GLOW_OPACITY = 0.06;
const ROUTE_HORIZON_FADE_START = -0.08;
const ROUTE_HORIZON_FADE_END = 0.34;
const ROUTE_BACKFACE_HIDE_THRESHOLD = -0.18;
const ROUTE_ENDPOINT_FADE_START = 0;
const ROUTE_ENDPOINT_FADE_END = 0.14;
const DESKTOP_BADGE_COUNTRY_IDS: NetworkCountryId[] = [
  "australia",
  "nigeria",
  "palestine",
  "china",
  "germany",
  "canada",
  "russia",
  "norway",
  "brazil",
  "usa",
  "japan",
  "spain",
];
const COMPACT_BADGE_COUNTRY_IDS: NetworkCountryId[] = [
  "australia",
  "nigeria",
  "palestine",
  "china",
  "germany",
  "canada",
  "russia",
  "brazil",
  "usa",
  "japan",
  "spain",
];
const FLAG_PIN_TEXTURE_SIZE = 256;

const FLAG_BORDER_COLORS: Record<NetworkCountryId, string[]> = {
  australia: ["#012169", "#ffffff", "#e4002b"],
  nigeria: ["#008751", "#ffffff", "#008751", "#ffffff", "#008751"],
  palestine: ["#000000", "#ffffff", "#007a3d", "#ce1126"],
  china: ["#de2910", "#ffde00", "#de2910"],
  germany: ["#1a1a1a", "#dd0000", "#ffce00"],
  canada: ["#d52b1e", "#ffffff", "#d52b1e"],
  russia: ["#ffffff", "#0039a6", "#d52b1e"],
  norway: ["#ba0c2f", "#ffffff", "#00205b"],
  brazil: ["#009c3b", "#ffdf00", "#002776"],
  usa: ["#b22234", "#ffffff", "#3c3b6e"],
  japan: ["#ffffff", "#bc002d", "#ffffff"],
  spain: ["#aa151b", "#f1bf00", "#aa151b"],
};

const FLAG_PIN_TEXTURE_FPS = 24;

type GlobeGroupProps = {
  onDraggingChange: (isDragging: boolean) => void;
};

type InteractionState = "idle" | "dragging" | "momentum" | "settling";
type GlobeTheme = "dark" | "light";

type GlobeControlsState = {
  theme: GlobeTheme;
  rotationSpeed: number;
  continentIntensity: number;
};

type GlobeSceneProps = GlobeGroupProps & {
  onInteractionStateChange: (interactionState: InteractionState) => void;
  prefersReducedMotion: boolean;
  isCompactViewport: boolean;
  controls: GlobeControlsState;
};

type GlobeInteractionProps = GlobeGroupProps & {
  onInteractionStateChange: (interactionState: InteractionState) => void;
  prefersReducedMotion: boolean;
  isCompactViewport: boolean;
  controls: GlobeControlsState;
};

type PointerPosition = {
  x: number;
  y: number;
  time: number;
};

type AngularVelocity = {
  x: number;
  y: number;
};

type RouteCurveModel = {
  route: NetworkRoute;
  curve: QuadraticBezierCurve3;
};

type FlagPinTextureModel = {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  flagImage: HTMLImageElement;
  texture: CanvasTexture;
  borderColors: string[];
};

const DEFAULT_GLOBE_CONTROLS: GlobeControlsState = {
  theme: "dark",
  rotationSpeed: 1,
  continentIntensity: 1,
};

const DARK_CONTINENT_INTENSITY_GAIN = 1.65;
const LIGHT_CONTINENT_INTENSITY_GAIN = 1.18;

const GLOBE_THEME_PALETTES = {
  dark: {
    oceanCore: "#020915",
    oceanVeil: "#1f8fff",
    oceanVeilOpacity: 0.032,
    oceanBase: [0.04, 0.16, 0.28],
    oceanGlow: [0.22, 0.68, 1],
    rimGlow: [0.48, 0.84, 1],
    rimSoft: [0.18, 0.48, 1],
    rimIntensity: 1,
    landInner: [0.84, 0.97, 1],
    landOuter: [0.96, 0.99, 1],
  },
  light: {
    oceanCore: "#e8eff3",
    oceanVeil: "#ffffff",
    oceanVeilOpacity: 0.18,
    oceanBase: [0.72, 0.82, 0.88],
    oceanGlow: [0.35, 0.62, 0.76],
    rimGlow: [0.48, 0.68, 0.86],
    rimSoft: [0.78, 0.9, 0.98],
    rimIntensity: 1.74,
    landInner: [0.04, 0.11, 0.24],
    landOuter: [0.06, 0.2, 0.42],
  },
} satisfies Record<
  GlobeTheme,
  {
    oceanCore: string;
    oceanVeil: string;
    oceanVeilOpacity: number;
    oceanBase: [number, number, number];
    oceanGlow: [number, number, number];
    rimGlow: [number, number, number];
    rimSoft: [number, number, number];
    rimIntensity: number;
    landInner: [number, number, number];
    landOuter: [number, number, number];
  }
>;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function dampVelocity(velocity: number, friction: number, delta: number) {
  return velocity * Math.pow(friction, delta * 60);
}

function dampValue(current: number, target: number, smoothing: number, delta: number) {
  return current + (target - current) * (1 - Math.exp(-smoothing * delta));
}

function stepSpring(current: number, velocity: number, target: number, stiffness: number, damping: number, delta: number) {
  const springForce = (target - current) * stiffness;
  const dampingForce = velocity * damping;
  const nextVelocity = velocity + (springForce - dampingForce) * delta;

  return {
    nextValue: current + nextVelocity * delta,
    nextVelocity,
  };
}

function getIdleBlend(horizontalVelocity: number) {
  const momentumWeight = clamp(Math.abs(horizontalVelocity) / IDLE_BLEND_START_VELOCITY, 0, 1);
  return 1 - momentumWeight;
}

function landPointToSpherePosition(point: LandPoint, radius = GLOBE_RADIUS) {
  return projectLonLatToSphere(point, radius);
}

function sphereCoordinateToVector(point: LandPoint, radius = ROUTE_SURFACE_RADIUS) {
  const position = projectLonLatToSphere(point, radius);

  return new Vector3(position.x, position.y, position.z);
}

function createRouteCurve(from: LandPoint, to: LandPoint, liftOverride?: number) {
  const start = sphereCoordinateToVector(from);
  const end = sphereCoordinateToVector(to);
  const angle = start.angleTo(end);
  const highLatitudeBias = clamp((Math.max(Math.abs(from.lat), Math.abs(to.lat)) - 45) / 30, 0, 1);
  const defaultLift = clamp(angle * 0.42, 0.24, 0.82);
  const arcLift = liftOverride ?? defaultLift * (1 - highLatitudeBias * 0.34);
  const controlPoint = start
    .clone()
    .add(end)
    .normalize()
    .multiplyScalar(ROUTE_SURFACE_RADIUS + arcLift);

  return new QuadraticBezierCurve3(start, controlPoint, end);
}

function getCountryMap() {
  return new Map(NETWORK_COUNTRIES.map((country) => [country.id, country]));
}

function drawRoundedRect(context: CanvasRenderingContext2D, width: number, height: number, radius: number) {
  context.beginPath();
  context.moveTo(radius, 0);
  context.lineTo(width - radius, 0);
  context.quadraticCurveTo(width, 0, width, radius);
  context.lineTo(width, height - radius);
  context.quadraticCurveTo(width, height, width - radius, height);
  context.lineTo(radius, height);
  context.quadraticCurveTo(0, height, 0, height - radius);
  context.lineTo(0, radius);
  context.quadraticCurveTo(0, 0, radius, 0);
  context.closePath();
}

function colorWithAlpha(hexColor: string, alpha: number) {
  const normalized = hexColor.replace("#", "");
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function drawImageCover(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const imageRatio = image.naturalWidth && image.naturalHeight ? image.naturalWidth / image.naturalHeight : 1.5;
  const targetRatio = width / height;
  const drawWidth = imageRatio > targetRatio ? height * imageRatio : width;
  const drawHeight = imageRatio > targetRatio ? height : width / imageRatio;
  const drawX = x + (width - drawWidth) / 2;
  const drawY = y + (height - drawHeight) / 2;

  context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
}

function loadFlagImage(flagCode: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = `/flags/${flagCode}.svg`;
  });
}

function drawFlagPinTexture(pinTexture: FlagPinTextureModel, rotation: number) {
  const { canvas, context, flagImage, texture, borderColors } = pinTexture;
  const size = canvas.width;
  const center = size / 2;
  const glowRadius = 112;
  const ringRadius = 84;
  const flagRadius = 58;
  const flagDiameter = flagRadius * 2;
  const ringColors = [...borderColors, borderColors[0]];

  context.clearRect(0, 0, size, size);
  context.setTransform(1, 0, 0, 1, 0, 0);

  const glow = context.createRadialGradient(center, center + 10, flagRadius * 0.42, center, center + 10, glowRadius);
  glow.addColorStop(0, colorWithAlpha(borderColors[0], 0.38));
  glow.addColorStop(0.45, colorWithAlpha(borderColors[Math.floor(borderColors.length / 2)], 0.13));
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = glow;
  context.beginPath();
  context.arc(center, center + 10, glowRadius, 0, Math.PI * 2);
  context.fill();

  context.save();
  context.shadowColor = colorWithAlpha(borderColors[0], 0.56);
  context.shadowBlur = 15;
  context.lineWidth = 10.5;
  const ringGradient = context.createConicGradient(rotation, center, center);
  ringColors.forEach((color, index) => {
    ringGradient.addColorStop(index / Math.max(1, ringColors.length - 1), colorWithAlpha(color, 0.98));
  });
  context.strokeStyle = ringGradient;
  context.beginPath();
  context.arc(center, center, ringRadius, 0, Math.PI * 2);
  context.stroke();
  context.restore();

  context.lineWidth = 3;
  context.strokeStyle = "rgba(3, 9, 21, 0.9)";
  context.beginPath();
  context.arc(center, center, ringRadius - 10, 0, Math.PI * 2);
  context.stroke();

  const coinFill = context.createRadialGradient(center - 26, center - 30, 8, center, center, flagRadius + 18);
  coinFill.addColorStop(0, "rgba(255, 255, 255, 0.18)");
  coinFill.addColorStop(0.48, "rgba(6, 14, 29, 0.72)");
  coinFill.addColorStop(1, "rgba(1, 5, 13, 0.92)");
  context.fillStyle = coinFill;
  context.beginPath();
  context.arc(center, center, flagRadius + 11, 0, Math.PI * 2);
  context.fill();

  context.save();
  context.beginPath();
  context.arc(center, center, flagRadius, 0, Math.PI * 2);
  context.clip();
  drawImageCover(context, flagImage, center - flagRadius, center - flagRadius, flagDiameter, flagDiameter);
  context.restore();

  const innerRim = context.createLinearGradient(center - flagRadius, center - flagRadius, center + flagRadius, center + flagRadius);
  innerRim.addColorStop(0, "rgba(255, 255, 255, 0.78)");
  innerRim.addColorStop(0.55, colorWithAlpha(borderColors[Math.floor(borderColors.length / 2)], 0.35));
  innerRim.addColorStop(1, "rgba(0, 0, 0, 0.55)");
  context.lineWidth = 3.25;
  context.strokeStyle = innerRim;
  context.beginPath();
  context.arc(center, center, flagRadius, 0, Math.PI * 2);
  context.stroke();

  context.fillStyle = "rgba(255, 255, 255, 0.17)";
  context.beginPath();
  context.ellipse(center - 18, center - 24, 32, 13, -0.35, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = colorWithAlpha(borderColors[0], 0.46);
  context.beginPath();
  context.arc(center, center + ringRadius + 18, 11, 0, Math.PI * 2);
  context.fill();

  texture.needsUpdate = true;
}

async function createFlagPinTexture(country: NetworkCountry) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  canvas.width = FLAG_PIN_TEXTURE_SIZE;
  canvas.height = FLAG_PIN_TEXTURE_SIZE;

  if (!context) return null;

  const flagImage = await loadFlagImage(country.flagCode);
  const texture = new CanvasTexture(canvas);
  const pinTexture = {
    canvas,
    context,
    flagImage,
    texture,
    borderColors: FLAG_BORDER_COLORS[country.id],
  };

  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  drawFlagPinTexture(pinTexture, 0);

  return pinTexture;
}

function getLandPointSeed(point: LandPoint) {
  const lonSeed = Math.round((point.lon + 180) * 1000);
  const latSeed = Math.round((point.lat + 90) * 1000);
  const mixed = Math.imul(lonSeed ^ 0x9e3779b9, 2654435761) ^ Math.imul(latSeed, 1597334677);

  return ((mixed >>> 0) % 10000) / 10000;
}

function roundDebugValue(value: number) {
  return Number(value.toFixed(5));
}

function logLandDotYBounds(minY: number, maxY: number, yTotal: number, count: number) {
  if (!import.meta.env.DEV || count === 0) return;

  console.info("[globe] land dot y distribution", {
    minY: roundDebugValue(minY),
    maxY: roundDebugValue(maxY),
    averageY: roundDebugValue(yTotal / count),
    count,
  });
}

function createLandDotGeometry(landPoints: LandPoint[]) {
  const positions = new Float32Array(landPoints.length * 3);
  const seeds = new Float32Array(landPoints.length);
  const geometry = new BufferGeometry();
  let minY = Infinity;
  let maxY = -Infinity;
  let yTotal = 0;

  landPoints.forEach((point, index) => {
    const position = landPointToSpherePosition(point);

    const positionIndex = index * 3;
    positions[positionIndex] = position.x;
    positions[positionIndex + 1] = position.y;
    positions[positionIndex + 2] = position.z;
    seeds[index] = getLandPointSeed(point);
    minY = Math.min(minY, position.y);
    maxY = Math.max(maxY, position.y);
    yTotal += position.y;
  });

  logLandDotYBounds(minY, maxY, yTotal, landPoints.length);

  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("aSeed", new Float32BufferAttribute(seeds, 1));

  return geometry;
}

function getMomentumEnergy(velocity: AngularVelocity) {
  const normalizedX = Math.abs(velocity.x / MAX_VERTICAL_VELOCITY);
  const normalizedY = Math.abs(velocity.y / MAX_HORIZONTAL_VELOCITY);
  const velocityStrength = Math.hypot(normalizedX, normalizedY);
  return clamp(velocityStrength * 1.35, 0, 0.72);
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

function RimAtmosphere({ theme }: { theme: GlobeTheme }) {
  const palette = GLOBE_THEME_PALETTES[theme];
  const rimUniforms = useMemo(
    () => ({
      uGlowColor: { value: palette.rimGlow },
      uSoftGlowColor: { value: palette.rimSoft },
      uRimIntensity: { value: palette.rimIntensity },
    }),
    [palette],
  );

  return (
    <group>
      <mesh>
        <sphereGeometry args={[GLOBE_RADIUS * 1.055, GLOBE_SPHERE_SEGMENTS, GLOBE_SPHERE_SEGMENTS]} />
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
            uniform vec3 uSoftGlowColor;
            uniform float uRimIntensity;
            varying float vRim;

            void main() {
              float rim = smoothstep(0.18, 1.0, vRim);
              float fineEdge = pow(rim, 3.15) * 0.2;
              float softHalo = pow(rim, 1.35) * 0.045;
              vec3 color = mix(uSoftGlowColor, uGlowColor, smoothstep(0.52, 1.0, rim));

              gl_FragColor = vec4(color, (fineEdge + softHalo) * uRimIntensity);
            }
          `}
        />
      </mesh>
    </group>
  );
}

function GlassyOceanIllumination({ theme }: { theme: GlobeTheme }) {
  const palette = GLOBE_THEME_PALETTES[theme];
  const uniforms = useMemo(
    () => ({
      uBaseColor: { value: palette.oceanBase },
      uGlowColor: { value: palette.oceanGlow },
    }),
    [palette],
  );

  return (
    <mesh>
      <sphereGeometry args={[GLOBE_RADIUS * 1.002, GLOBE_DETAIL_SEGMENTS, GLOBE_DETAIL_SEGMENTS]} />
      <shaderMaterial
        transparent
        depthWrite={false}
        blending={AdditiveBlending}
        uniforms={uniforms}
        vertexShader={`
          varying float vFacing;
          varying float vRim;

          void main() {
            vec3 viewNormal = normalize(normalMatrix * normal);
            vFacing = clamp(viewNormal.z, 0.0, 1.0);
            vRim = 1.0 - vFacing;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={`
          precision highp float;

          uniform vec3 uBaseColor;
          uniform vec3 uGlowColor;
          varying float vFacing;
          varying float vRim;

          void main() {
            float centerGlow = smoothstep(0.08, 1.0, vFacing);
            float rimGlow = pow(smoothstep(0.16, 1.0, vRim), 2.8);
            float alpha = 0.012 + centerGlow * 0.022 + rimGlow * 0.018;
            vec3 color = mix(uBaseColor, uGlowColor, centerGlow * 0.3 + rimGlow * 0.24);

            gl_FragColor = vec4(color, alpha);
          }
        `}
      />
    </mesh>
  );
}

function DigitalGlobeSurface({
  theme,
  continentIntensity,
}: {
  theme: GlobeTheme;
  continentIntensity: number;
}) {
  const palette = GLOBE_THEME_PALETTES[theme];
  const shaderIntensity =
    continentIntensity * (theme === "dark" ? DARK_CONTINENT_INTENSITY_GAIN : LIGHT_CONTINENT_INTENSITY_GAIN);
  const pointSizeGain = theme === "dark" ? 0.2 : 0.07;
  const pointSize = LAND_DOT_POINT_SIZE * (1 + Math.log2(Math.max(shaderIntensity, 1)) * pointSizeGain);
  const landGeometry = useMemo(() => {
    const landPoints = generateLandPoints({
      longitudeStep: DOT_SPACING,
      latitudeStep: DOT_SPACING,
      jitter: DOT_JITTER,
      minLatitude: LAND_MIN_LATITUDE,
      maxLatitude: LAND_MAX_LATITUDE,
    });

    return createLandDotGeometry(landPoints);
  }, []);
  const landUniforms = useMemo(
    () => ({
      uPointSize: { value: pointSize },
      uInnerColor: { value: palette.landInner },
      uOuterColor: { value: palette.landOuter },
      uIntensity: { value: shaderIntensity },
      uLightTheme: { value: theme === "light" ? 1 : 0 },
    }),
    [palette, pointSize, shaderIntensity, theme],
  );

  useEffect(() => () => landGeometry.dispose(), [landGeometry]);

  const surfaceVertexShader = `
    attribute float aSeed;
    uniform float uPointSize;
    varying float vFacing;
    varying float vEdgeFade;
    varying float vNorthLight;
    varying float vSeed;

    void main() {
      vec3 sphereNormal = normalize(position);
      vec3 viewNormal = normalize(normalMatrix * sphereNormal);
      // viewNormal.z is strongest at the camera-facing center of the sphere.
      // It lets front dots read brightly while rim/back dots fall away.
      vFacing = smoothstep(-0.12, 0.58, viewNormal.z);
      vEdgeFade = smoothstep(-0.28, 0.04, viewNormal.z);
      vNorthLight = smoothstep(0.02, 0.78, sphereNormal.y);
      vSeed = aSeed;

      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      gl_PointSize = uPointSize * (6.0 / -mvPosition.z) * mix(0.5, 1.08, vFacing);
    }
  `;

  const surfaceFragmentShader = `
    precision highp float;

    uniform vec3 uInnerColor;
    uniform vec3 uOuterColor;
    uniform float uIntensity;
    uniform float uLightTheme;
    varying float vFacing;
    varying float vEdgeFade;
    varying float vNorthLight;
    varying float vSeed;

    void main() {
      vec2 point = gl_PointCoord - vec2(0.5);
      float distanceFromCenter = length(point);
      float dotMask = smoothstep(0.5, 0.16, distanceFromCenter);
      float core = smoothstep(0.22, 0.0, distanceFromCenter);
      float frontLight = smoothstep(0.02, 1.0, vFacing);
      float topLandLift = vNorthLight * 0.26;
      float visibleSideLight = mix(0.76, 1.5 + topLandLift, frontLight);
      float intensityAlpha = 1.0 + log2(max(uIntensity, 1.0)) * 0.72;
      float lightThemeAlpha = dotMask * vEdgeFade * mix(0.62, 1.18 + topLandLift * 0.2, frontLight) * mix(0.92, 1.0, vSeed) * (0.84 + log2(max(uIntensity, 1.0)) * 0.2);
      float darkThemeAlpha = dotMask * vEdgeFade * visibleSideLight * mix(0.95, 1.0, vSeed) * intensityAlpha;
      vec3 edgeColor = uInnerColor * 0.98;
      vec3 lightThemeColor = mix(edgeColor, uOuterColor, core * 0.82 + frontLight * 0.3 + topLandLift * 0.5);
      vec3 darkThemeColor = mix(edgeColor, mix(uInnerColor, uOuterColor, core * 0.9 + frontLight * 0.48 + topLandLift) * mix(0.82, 3.2, clamp(log2(max(uIntensity, 1.0)) / 6.4, 0.0, 1.0)), frontLight);
      float alpha = mix(darkThemeAlpha, lightThemeAlpha, uLightTheme);
      vec3 color = mix(darkThemeColor, lightThemeColor, uLightTheme);

      if (alpha < 0.008) discard;
      gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
    }
  `;

  return (
    <group>
      <mesh>
        <sphereGeometry args={[GLOBE_RADIUS * 0.985, GLOBE_DETAIL_SEGMENTS, GLOBE_DETAIL_SEGMENTS]} />
        <meshBasicMaterial color={palette.oceanCore} depthWrite />
      </mesh>

      <GlassyOceanIllumination theme={theme} />

      <SurfaceGrid />

      <points geometry={landGeometry}>
        <shaderMaterial
          transparent
          depthTest
          depthWrite={false}
          blending={theme === "dark" ? AdditiveBlending : NormalBlending}
          uniforms={landUniforms}
          vertexShader={surfaceVertexShader}
          fragmentShader={surfaceFragmentShader}
        />
      </points>

      <mesh>
        <sphereGeometry args={[GLOBE_RADIUS * 1.01, GLOBE_DETAIL_SEGMENTS, GLOBE_DETAIL_SEGMENTS]} />
        <meshBasicMaterial color={palette.oceanVeil} transparent opacity={palette.oceanVeilOpacity} depthWrite={false} />
      </mesh>

      <RimAtmosphere theme={theme} />
    </group>
  );
}

function NetworkRouteLayer({
  prefersReducedMotion,
  isCompactViewport,
}: {
  prefersReducedMotion: boolean;
  isCompactViewport: boolean;
}) {
  const countryById = useMemo(getCountryMap, []);
  const badgeCountryIds = useMemo(
    () => new Set(isCompactViewport ? COMPACT_BADGE_COUNTRY_IDS : DESKTOP_BADGE_COUNTRY_IDS),
    [isCompactViewport],
  );
  const countryPositions = useMemo(
    () =>
      NETWORK_COUNTRIES.map((country) => ({
        country,
        position: sphereCoordinateToVector(country),
      })),
    [],
  );
  const routeCurves = useMemo<RouteCurveModel[]>(
    () =>
      NETWORK_ROUTES.map((route) => {
        const from = countryById.get(route.from);
        const to = countryById.get(route.to);

        if (!from || !to) {
          throw new Error(`Missing country for route ${route.id}`);
        }

        return {
          route,
          curve: createRouteCurve(from, to, route.lift),
        };
      }),
    [countryById],
  );

  return (
    <group name="digital-network-route-layer">
      {routeCurves.map(({ route, curve }) => (
        <NetworkRouteArc key={route.id} route={route} curve={curve} prefersReducedMotion={prefersReducedMotion} />
      ))}

      {countryPositions.map(({ country, position }) => (
        <NetworkCountryMarker
          key={country.id}
          country={country}
          position={position}
          showBadge={badgeCountryIds.has(country.id)}
          isCompactViewport={isCompactViewport}
        />
      ))}
    </group>
  );
}

function NetworkRouteArc({
  route,
  curve,
  prefersReducedMotion,
}: {
  route: NetworkRoute;
  curve: QuadraticBezierCurve3;
  prefersReducedMotion: boolean;
}) {
  const routeRef = useRef<Group>(null);
  const pulseRef = useRef<Group>(null);
  const coreMaterialRef = useRef<MeshBasicMaterial>(null);
  const glowMaterialRef = useRef<MeshBasicMaterial>(null);
  const camera = useThree((state) => state.camera);
  const color = useMemo(() => new Color(route.color), [route.color]);
  const accentColor = useMemo(() => new Color(route.accentColor), [route.accentColor]);
  const cameraDirectionRef = useRef(new Vector3());
  const visibilitySamples = useMemo(
    () => [0.14, 0.32, 0.5, 0.68, 0.86].map((progress) => curve.getPointAt(progress)),
    [curve],
  );
  const endpointSamples = useMemo(() => [curve.getPointAt(0), curve.getPointAt(1)], [curve]);
  const worldSampleRef = useRef(new Vector3());

  useFrame(({ clock }) => {
    if (!routeRef.current) return;

    const cameraDirection = cameraDirectionRef.current.copy(camera.position).normalize();
    const maxRouteFacing = visibilitySamples.reduce((maxFacing, sample) => {
      const worldSample = routeRef.current!.localToWorld(worldSampleRef.current.copy(sample));
      const sampleFacing = worldSample.dot(cameraDirection) / worldSample.length();

      return Math.max(maxFacing, sampleFacing);
    }, -1);
    const minEndpointFacing = endpointSamples.reduce((minFacing, sample) => {
      const worldSample = routeRef.current!.localToWorld(worldSampleRef.current.copy(sample));
      const sampleFacing = worldSample.dot(cameraDirection) / worldSample.length();

      return Math.min(minFacing, sampleFacing);
    }, 1);
    const endpointVisibility = clamp(
      (minEndpointFacing - ROUTE_ENDPOINT_FADE_START) / (ROUTE_ENDPOINT_FADE_END - ROUTE_ENDPOINT_FADE_START),
      0,
      1,
    );
    const routeVisibility =
      maxRouteFacing < ROUTE_BACKFACE_HIDE_THRESHOLD
        ? 0
        : clamp(
            (maxRouteFacing - ROUTE_HORIZON_FADE_START) / (ROUTE_HORIZON_FADE_END - ROUTE_HORIZON_FADE_START),
            0,
            1,
          ) * endpointVisibility;

    if (coreMaterialRef.current) {
      coreMaterialRef.current.opacity = ROUTE_CORE_OPACITY * routeVisibility;
    }

    if (glowMaterialRef.current) {
      glowMaterialRef.current.opacity = ROUTE_GLOW_OPACITY * routeVisibility * routeVisibility;
    }

    if (prefersReducedMotion) {
      if (pulseRef.current) pulseRef.current.visible = false;
      return;
    }

    const progress = (clock.elapsedTime * ROUTE_PULSE_SPEED + route.delay) % 1;
    const easedProgress = 0.5 - Math.cos(progress * Math.PI) * 0.5;
    const pulsePosition = curve.getPointAt(easedProgress);
    const worldPulsePosition = routeRef.current.localToWorld(worldSampleRef.current.copy(pulsePosition));
    const pulseFacing = worldPulsePosition.dot(cameraDirection) / worldPulsePosition.length();
    const pulseRimDistance = Math.hypot(pulsePosition.x, pulsePosition.y) / ROUTE_SURFACE_RADIUS;

    if (pulseRef.current) {
      pulseRef.current.visible = routeVisibility > 0.28 && pulseFacing > 0.48 && pulseRimDistance < 0.76;
      pulseRef.current.position.copy(pulsePosition);
    }
  });

  return (
    <group ref={routeRef} name={`network-route-${route.id}`}>
      <mesh renderOrder={4}>
        <tubeGeometry args={[curve, ROUTE_CURVE_SEGMENTS, ROUTE_LINE_RADIUS, 8, false]} />
        <meshBasicMaterial
          ref={coreMaterialRef}
          color={color}
          transparent
          opacity={ROUTE_CORE_OPACITY}
          depthTest
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>

      <mesh renderOrder={3}>
        <tubeGeometry args={[curve, ROUTE_CURVE_SEGMENTS, ROUTE_LINE_RADIUS * 2.8, 8, false]} />
        <meshBasicMaterial
          ref={glowMaterialRef}
          color={color}
          transparent
          opacity={ROUTE_GLOW_OPACITY}
          depthTest
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>

      <group ref={pulseRef} renderOrder={6}>
        <mesh>
          <sphereGeometry args={[ROUTE_PULSE_RADIUS, ROUTE_PULSE_SEGMENTS, ROUTE_PULSE_SEGMENTS]} />
          <meshBasicMaterial
            color={accentColor}
            transparent
            opacity={0.78}
            depthTest
            depthWrite={false}
            blending={AdditiveBlending}
          />
        </mesh>

        <mesh>
          <sphereGeometry args={[ROUTE_PULSE_RADIUS * 2.4, ROUTE_PULSE_SEGMENTS, ROUTE_PULSE_SEGMENTS]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.14}
            depthTest
            depthWrite={false}
            blending={AdditiveBlending}
          />
        </mesh>
      </group>

    </group>
  );
}

function NetworkCountryMarker({
  country,
  position,
  showBadge,
  isCompactViewport,
}: {
  country: NetworkCountry;
  position: Vector3;
  showBadge: boolean;
  isCompactViewport: boolean;
}) {
  const markerRef = useRef<Group>(null);
  const camera = useThree((state) => state.camera);
  const viewportSize = useThree((state) => state.size);
  const [badgeVisible, setBadgeVisible] = useState(false);
  const [badgeTexture, setBadgeTexture] = useState<FlagPinTextureModel | null>(null);
  const lastBadgeVisibleRef = useRef(false);
  const lastTextureDrawAtRef = useRef(0);
  const worldPositionRef = useRef(new Vector3());
  const cameraDirectionRef = useRef(new Vector3());
  const badgeScale = useMemo<[number, number, number]>(() => {
    const width = isCompactViewport ? 0.27 : 0.32;

    return [width, width, 1];
  }, [isCompactViewport]);

  useEffect(() => {
    let disposed = false;

    setBadgeTexture(null);

    if (!showBadge || typeof document === "undefined") return;

    void createFlagPinTexture(country).then((pinTexture) => {
      if (!pinTexture) return;

      if (disposed) {
        pinTexture.texture.dispose();
        return;
      }

      setBadgeTexture(pinTexture);
    });

    return () => {
      disposed = true;
    };
  }, [country, showBadge]);

  useEffect(() => () => badgeTexture?.texture.dispose(), [badgeTexture]);

  useFrame(({ clock }) => {
    if (!markerRef.current) return;

    const worldPosition = worldPositionRef.current;
    markerRef.current.getWorldPosition(worldPosition);
    const facingAmount = worldPosition.dot(cameraDirectionRef.current.copy(camera.position).normalize()) / worldPosition.length();
    const projectedPosition = worldPosition.project(camera);
    const screenX = (projectedPosition.x * 0.5 + 0.5) * viewportSize.width;
    const screenY = (-projectedPosition.y * 0.5 + 0.5) * viewportSize.height;
    const horizontalMargin = isCompactViewport ? 42 : 58;
    const verticalMargin = isCompactViewport ? 30 : 38;
    const hasBadgeRoom =
      screenX > horizontalMargin &&
      screenX < viewportSize.width - horizontalMargin &&
      screenY > verticalMargin &&
      screenY < viewportSize.height - verticalMargin;
    const nextBadgeVisible = showBadge && Boolean(badgeTexture) && facingAmount > 0.22 && hasBadgeRoom;

    markerRef.current.visible = nextBadgeVisible;

    if (nextBadgeVisible && badgeTexture && clock.elapsedTime - lastTextureDrawAtRef.current > 1 / FLAG_PIN_TEXTURE_FPS) {
      lastTextureDrawAtRef.current = clock.elapsedTime;
      drawFlagPinTexture(badgeTexture, clock.elapsedTime * 0.72);
    }

    if (lastBadgeVisibleRef.current !== nextBadgeVisible) {
      lastBadgeVisibleRef.current = nextBadgeVisible;
      setBadgeVisible(nextBadgeVisible);
    }
  });

  return (
    <group
      ref={markerRef}
      name={`network-country-${country.id}`}
      position={[position.x, position.y, position.z]}
      renderOrder={5}
    >
      <mesh>
        <sphereGeometry args={[ROUTE_NODE_RADIUS, 12, 12]} />
        <meshBasicMaterial
          color="#c8f6ff"
          transparent
          opacity={0.7}
          depthTest
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>

      <mesh>
        <sphereGeometry args={[ROUTE_NODE_RADIUS * 2.15, 12, 12]} />
        <meshBasicMaterial
          color="#45dfff"
          transparent
          opacity={0.08}
          depthTest
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>

      {badgeTexture ? (
        <sprite
          position={[0, ROUTE_NODE_RADIUS * (isCompactViewport ? 5.4 : 6), 0]}
          scale={badgeScale}
          renderOrder={7}
        >
          <spriteMaterial
            map={badgeTexture.texture}
            transparent
            opacity={badgeVisible ? 0.98 : 0}
            depthTest={false}
            depthWrite={false}
          />
        </sprite>
      ) : null}
    </group>
  );
}

function SurfaceGrid() {
  const gridLines = useMemo(() => {
    const materialOptions = {
      color: "#2a9fff",
      transparent: true,
      opacity: 0.022,
      depthTest: true,
      depthWrite: false,
      blending: AdditiveBlending,
    };
    const lines: Line[] = [];

    for (let lat = -60; lat <= 60; lat += SURFACE_GRID_LAT_STEP) {
      const geometry = createSphericalGuideGeometry(
        createLatitudeLinePoints(lat, SURFACE_GRID_SEGMENT_STEP),
        GLOBE_RADIUS + 0.018,
      );
      lines.push(new Line(geometry, new LineBasicMaterial(materialOptions)));
    }

    for (let lon = -180; lon < 180; lon += SURFACE_GRID_LON_STEP) {
      const geometry = createSphericalGuideGeometry(
        createLongitudeLinePoints(lon, SURFACE_GRID_SEGMENT_STEP),
        GLOBE_RADIUS + 0.018,
      );
      lines.push(new Line(geometry, new LineBasicMaterial(materialOptions)));
    }

    return lines;
  }, []);

  useEffect(
    () => () => {
      gridLines.forEach((line) => {
        line.geometry.dispose();
        const material = line.material;
        if (Array.isArray(material)) {
          material.forEach((entry) => entry.dispose());
        } else {
          material.dispose();
        }
      });
    },
    [gridLines],
  );

  return (
    <group name="surface-reference-grid">
      {gridLines.map((line, index) => (
        <primitive key={index} object={line} />
      ))}
    </group>
  );
}

function createSphericalGuideGeometry(points: LandPoint[], radius = GLOBE_RADIUS + 0.012) {
  const positions: number[] = [];

  points.forEach((point) => {
    const position = projectLonLatToSphere(point, radius);

    positions.push(position.x, position.y, position.z);
  });

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));

  return geometry;
}

function createLatitudeLinePoints(lat: number, step = 1) {
  const points: LandPoint[] = [];

  for (let lon = -180; lon <= 180; lon += step) {
    points.push({ lon, lat });
  }

  return points;
}

function createLongitudeLinePoints(lon: number, step = 1) {
  const points: LandPoint[] = [];

  for (let lat = -90; lat <= 90; lat += step) {
    points.push({ lon, lat });
  }

  return points;
}

function DebugCenteringGuides() {
  const equatorGeometry = useMemo(() => createSphericalGuideGeometry(createLatitudeLinePoints(0)), []);
  const primeMeridianGeometry = useMemo(() => createSphericalGuideGeometry(createLongitudeLinePoints(0)), []);
  const equatorLine = useMemo(
    () =>
      new Line(
        equatorGeometry,
        new LineBasicMaterial({
          color: "#ffffff",
          transparent: true,
          opacity: 0.16,
          depthTest: false,
          depthWrite: false,
        }),
      ),
    [equatorGeometry],
  );
  const primeMeridianLine = useMemo(
    () =>
      new Line(
        primeMeridianGeometry,
        new LineBasicMaterial({
          color: "#ffffff",
          transparent: true,
          opacity: 0.14,
          depthTest: false,
          depthWrite: false,
        }),
      ),
    [primeMeridianGeometry],
  );
  const viewCenterPosition = useMemo(
    () => projectLonLatToSphere({ lon: CENTER_LONGITUDE, lat: CENTER_LATITUDE }, GLOBE_RADIUS + 0.018),
    [],
  );

  useEffect(
    () => () => {
      equatorGeometry.dispose();
      primeMeridianGeometry.dispose();
      equatorLine.material.dispose();
      primeMeridianLine.material.dispose();
    },
    [equatorGeometry, primeMeridianGeometry, equatorLine, primeMeridianLine],
  );

  if (!GLOBE_DEBUG_MODE) return null;

  return (
    <group name="debug-geographic-guides">
      <primitive object={equatorLine} name="debug-equator-line" />
      <primitive object={primeMeridianLine} name="debug-prime-meridian-line" />

      <mesh name="debug-view-center-marker" position={[viewCenterPosition.x, viewCenterPosition.y, viewCenterPosition.z]}>
        <sphereGeometry args={[0.022, 12, 12]} />
        <meshBasicMaterial color="#fffbcc" transparent opacity={0.72} depthTest={false} depthWrite={false} />
      </mesh>
    </group>
  );
}

function DebugCameraTarget() {
  const camera = useThree((state) => state.camera);

  useEffect(() => {
    if (!GLOBE_DEBUG_MODE) return;

    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [camera]);

  return null;
}

function getRangeFill(value: number, min: number, max: number) {
  return `${((value - min) / (max - min)) * 100}%`;
}

function ControlRange({
  label,
  value,
  min,
  max,
  step,
  displayValue,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="control-range-row">
      <span className="control-range-meta">
        <span>{label}</span>
        <strong>{displayValue}</strong>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        style={{ "--control-fill": getRangeFill(value, min, max) } as CSSProperties}
      />
    </label>
  );
}

function GlobeControlPanel({
  controls,
  onControlsChange,
}: {
  controls: GlobeControlsState;
  onControlsChange: (controls: GlobeControlsState) => void;
}) {
  const updateControl = useCallback(
    <Key extends keyof GlobeControlsState>(key: Key, value: GlobeControlsState[Key]) => {
      onControlsChange({ ...controls, [key]: value });
    },
    [controls, onControlsChange],
  );
  const resetControls = useCallback(() => onControlsChange(DEFAULT_GLOBE_CONTROLS), [onControlsChange]);
  const copyControls = useCallback(() => {
    const serializedControls = JSON.stringify(controls, null, 2);

    void navigator.clipboard?.writeText(serializedControls);
  }, [controls]);

  return (
    <aside className="globe-control-panel" aria-label="Globe display controls">
      <header className="control-panel-header">
        <h2>Controls</h2>
        <button className="control-icon-button" type="button" aria-label="Panel settings">
          <span />
        </button>
      </header>

      <div className="control-panel-actions">
        <button className="control-icon-button" type="button" aria-label="Add control preset">
          +
        </button>
        <button className="control-version-button" type="button">
          <span>Version 1</span>
          <span aria-hidden="true">v</span>
        </button>
        <button className="control-copy-button" type="button" onClick={copyControls}>
          Copy
        </button>
      </div>

      <div className="control-panel-divider" />

      <section className="control-section">
        <div className="control-section-title">
          <span>General</span>
          <span aria-hidden="true">^</span>
        </div>

        <div className="control-mode-row" role="group" aria-label="Globe color mode">
          {(["dark", "light"] as const).map((themeOption) => (
            <button
              key={themeOption}
              className={controls.theme === themeOption ? "is-active" : ""}
              type="button"
              aria-pressed={controls.theme === themeOption}
              onClick={() => updateControl("theme", themeOption)}
            >
              {themeOption}
            </button>
          ))}
        </div>

        <ControlRange
          label="Rotation Rate"
          value={controls.rotationSpeed}
          min={0.2}
          max={4}
          step={0.1}
          displayValue={`${controls.rotationSpeed.toFixed(1)}x`}
          onChange={(value) => updateControl("rotationSpeed", value)}
        />

        <ControlRange
          label="Surface Intensity"
          value={controls.continentIntensity}
          min={0.5}
          max={50}
          step={0.25}
          displayValue={`${controls.continentIntensity.toFixed(1)}x`}
          onChange={(value) => updateControl("continentIntensity", value)}
        />
      </section>

      <section className="control-section control-section-collapsed">
        <div className="control-section-title">
          <span>Routes</span>
          <span aria-hidden="true">v</span>
        </div>
      </section>

      <button className="control-reset-button" type="button" onClick={resetControls}>
        Reset globe
      </button>
    </aside>
  );
}

function GlobeGroup({
  onDraggingChange,
  onInteractionStateChange,
  prefersReducedMotion,
  isCompactViewport,
  controls,
}: GlobeInteractionProps) {
  const yawGroupRef = useRef<Group>(null);
  const tiltGroupRef = useRef<Group>(null);
  const isDraggingRef = useRef(false);
  const activePointerIdRef = useRef<number | null>(null);
  const activePointerTargetRef = useRef<Element | null>(null);
  const previousPointerRef = useRef<PointerPosition | null>(null);
  const angularVelocityRef = useRef<AngularVelocity>({ x: 0, y: 0 });
  const verticalReturnVelocityRef = useRef(0);
  const interactionStateRef = useRef<InteractionState>("idle");
  const interactionEnergyRef = useRef(0);
  const autoRotationResumeDelayRef = useRef(0);
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
    if (GLOBE_DEBUG_MODE) return;

    yawGroupRef.current.rotation.z = DEFAULT_ROTATION_Z;
    tiltGroupRef.current.rotation.x = 0;
    tiltGroupRef.current.rotation.z = DEFAULT_ROTATION_Z;

    const velocity = angularVelocityRef.current;
    const hasVerticalMomentum = Math.abs(velocity.x) > MOMENTUM_EPSILON;
    const hasHorizontalMomentum = Math.abs(velocity.y) > MOMENTUM_EPSILON;
    const hasMomentum = hasVerticalMomentum || hasHorizontalMomentum;

    if (isDraggingRef.current) {
      verticalReturnVelocityRef.current = 0;
      const dragEnergy = prefersReducedMotion ? 0.42 : 1;
      interactionEnergyRef.current = dampValue(interactionEnergyRef.current, dragEnergy, INTERACTION_ENERGY_EASING, delta);
      return;
    }

    autoRotationResumeDelayRef.current = Math.max(0, autoRotationResumeDelayRef.current - delta);

    const shouldReturnVerticalRotation =
      !hasVerticalMomentum &&
      autoRotationResumeDelayRef.current <= 0 &&
      (Math.abs(yawGroupRef.current.rotation.x) > VERTICAL_RETURN_EPSILON ||
        Math.abs(verticalReturnVelocityRef.current) > VERTICAL_RETURN_VELOCITY_EPSILON);
    const targetEnergy = hasMomentum
      ? getMomentumEnergy(velocity) * (prefersReducedMotion ? 0.45 : 1)
      : shouldReturnVerticalRotation
        ? 0.08
        : 0;

    interactionEnergyRef.current = dampValue(
      interactionEnergyRef.current,
      targetEnergy,
      INTERACTION_ENERGY_EASING * (hasMomentum ? 0.74 : 0.48),
      delta,
    );

    if (hasMomentum) {
      setInteractionState("momentum");
    } else if (interactionEnergyRef.current > 0.025 || shouldReturnVerticalRotation) {
      setInteractionState("settling");
    } else {
      setInteractionState("idle");
    }

    if (hasVerticalMomentum) {
      verticalReturnVelocityRef.current = 0;
      yawGroupRef.current.rotation.x = clamp(
        yawGroupRef.current.rotation.x + velocity.x * delta,
        MIN_VERTICAL_ROTATION,
        MAX_VERTICAL_ROTATION,
      );
      velocity.x = dampVelocity(velocity.x, MOMENTUM_FRICTION, delta);
    } else {
      velocity.x = 0;

      if (shouldReturnVerticalRotation) {
        const { nextValue, nextVelocity } = stepSpring(
          yawGroupRef.current.rotation.x,
          verticalReturnVelocityRef.current,
          0,
          prefersReducedMotion ? REDUCED_MOTION_VERTICAL_RETURN_STIFFNESS : VERTICAL_RETURN_STIFFNESS,
          prefersReducedMotion ? REDUCED_MOTION_VERTICAL_RETURN_DAMPING : VERTICAL_RETURN_DAMPING,
          Math.min(delta, 0.04),
        );

        yawGroupRef.current.rotation.x = clamp(nextValue, MIN_VERTICAL_ROTATION, MAX_VERTICAL_ROTATION);
        verticalReturnVelocityRef.current = nextVelocity;

        if (
          Math.abs(yawGroupRef.current.rotation.x) <= VERTICAL_RETURN_EPSILON &&
          Math.abs(verticalReturnVelocityRef.current) <= VERTICAL_RETURN_VELOCITY_EPSILON
        ) {
          yawGroupRef.current.rotation.x = 0;
          verticalReturnVelocityRef.current = 0;
        }
      }
    }

    if (hasHorizontalMomentum) {
      yawGroupRef.current.rotation.y += velocity.y * delta;
      velocity.y = dampVelocity(velocity.y, MOMENTUM_FRICTION, delta);
    } else {
      velocity.y = 0;
    }

    const idleSpeed = prefersReducedMotion
      ? REDUCED_MOTION_IDLE_SPEED
      : IDLE_ROTATION_SPEED * controls.rotationSpeed;
    if (autoRotationResumeDelayRef.current <= 0) {
      yawGroupRef.current.rotation.y += delta * idleSpeed * getIdleBlend(Math.max(Math.abs(velocity.x), Math.abs(velocity.y)));
    }
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
    autoRotationResumeDelayRef.current = AUTO_ROTATION_RESUME_DELAY;
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
      yawGroupRef.current.rotation.x = clamp(
        yawGroupRef.current.rotation.x + clampedDeltaY * VERTICAL_DRAG_SENSITIVITY,
        MIN_VERTICAL_ROTATION,
        MAX_VERTICAL_ROTATION,
      );
      yawGroupRef.current.rotation.z = DEFAULT_ROTATION_Z;
      tiltGroupRef.current.rotation.x = 0;
      tiltGroupRef.current.rotation.z = DEFAULT_ROTATION_Z;

      const velocityScale = 1000 / deltaTime;
      const nextVelocityX = clamp(
        clampedDeltaY * VERTICAL_DRAG_SENSITIVITY * velocityScale,
        -MAX_VERTICAL_VELOCITY * (prefersReducedMotion ? 0.65 : 1),
        MAX_VERTICAL_VELOCITY * (prefersReducedMotion ? 0.65 : 1),
      );
      const nextVelocityY = clamp(
        clampedDeltaX * HORIZONTAL_DRAG_SENSITIVITY * velocityScale,
        -MAX_HORIZONTAL_VELOCITY * (prefersReducedMotion ? 0.65 : 1),
        MAX_HORIZONTAL_VELOCITY * (prefersReducedMotion ? 0.65 : 1),
      );

      angularVelocityRef.current.x += (nextVelocityX - angularVelocityRef.current.x) * VELOCITY_SMOOTHING;
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
      if (GLOBE_DEBUG_MODE) return;

      event.stopPropagation();

      isDraggingRef.current = true;
      activePointerIdRef.current = event.pointerId;
      activePointerTargetRef.current = event.nativeEvent.target as Element;
      activePointerTargetRef.current.setPointerCapture?.(event.pointerId);
      angularVelocityRef.current = { x: 0, y: 0 };
      verticalReturnVelocityRef.current = 0;
      autoRotationResumeDelayRef.current = AUTO_ROTATION_RESUME_DELAY;
      if (yawGroupRef.current) yawGroupRef.current.rotation.z = DEFAULT_ROTATION_Z;
      if (tiltGroupRef.current) {
        tiltGroupRef.current.rotation.x = 0;
        tiltGroupRef.current.rotation.z = DEFAULT_ROTATION_Z;
      }
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
      position={[0, 0, 0]}
      rotation={[DEFAULT_ROTATION_X, 0, DEFAULT_ROTATION_Z]}
      onPointerDown={GLOBE_DEBUG_MODE ? undefined : handlePointerDown}
    >
      <group ref={yawGroupRef} name="main-globe-yaw-group" rotation={[0, DEFAULT_ROTATION_Y, 0]}>
        <group ref={tiltGroupRef} name="main-globe-temporary-tilt-group">
          <DigitalGlobeSurface theme={controls.theme} continentIntensity={controls.continentIntensity} />
          {SHOW_NETWORK_LAYER ? (
            <NetworkRouteLayer prefersReducedMotion={prefersReducedMotion} isCompactViewport={isCompactViewport} />
          ) : null}
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
  controls,
}: GlobeSceneProps) {
  return (
    <>
      <DebugCameraTarget />
      <ambientLight intensity={0.42} />
      <directionalLight position={[4, 3, 5]} intensity={1.8} color="#8bc3ff" />
      <pointLight position={[-3, -1.5, 3]} intensity={2.1} color="#2b6dff" />
      <pointLight position={[0, 2.5, -4]} intensity={1} color="#2de8ff" />
      <GlobeGroup
        onDraggingChange={onDraggingChange}
        onInteractionStateChange={onInteractionStateChange}
        prefersReducedMotion={prefersReducedMotion}
        isCompactViewport={isCompactViewport}
        controls={controls}
      />
      <DebugCenteringGuides />
    </>
  );
}

export function GlobeComponent() {
  const [isDragging, setIsDragging] = useState(false);
  const [interactionState, setInteractionState] = useState<InteractionState>("idle");
  const [controls, setControls] = useState<GlobeControlsState>(DEFAULT_GLOBE_CONTROLS);
  const prefersReducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const isCompactViewport = useMediaQuery(COMPACT_MEDIA_QUERY);
  const canvasDpr = useMemo<[number, number]>(
    () => (prefersReducedMotion || isCompactViewport ? [1, 1.2] : [1, 1.5]),
    [isCompactViewport, prefersReducedMotion],
  );

  return (
    <section
      className={`globe-section theme-${controls.theme} is-${interactionState}${isDragging ? " is-dragging" : ""}${
        GLOBE_DEBUG_MODE ? " is-debug" : ""
      }`}
      aria-label="Interactive dotted Earth globe"
    >
      <div className="globe-ambient" aria-hidden="true" />
      <GlobeControlPanel controls={controls} onControlsChange={setControls} />
      <div className="globe-stage">
        <Canvas
          className="globe-canvas"
          camera={{ position: [0, 0, 7.45], fov: 39 }}
          dpr={canvasDpr}
          gl={{ antialias: true, alpha: true }}
        >
          <GlobeScene
            onDraggingChange={setIsDragging}
            onInteractionStateChange={setInteractionState}
            prefersReducedMotion={prefersReducedMotion}
            isCompactViewport={isCompactViewport}
            controls={controls}
          />
        </Canvas>
      </div>
    </section>
  );
}
