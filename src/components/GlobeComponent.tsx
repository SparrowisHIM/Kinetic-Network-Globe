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
const GLOBE_SPHERE_SEGMENTS = 192;
const GLOBE_DETAIL_SEGMENTS = 128;
const SURFACE_GRID_LAT_STEP = 20;
const SURFACE_GRID_LON_STEP = 20;
const SURFACE_GRID_SEGMENT_STEP = 1;
const ROUTE_SURFACE_RADIUS = GLOBE_RADIUS + 0.05;
const ROUTE_CURVE_SEGMENTS = 80;
const ROUTE_LINE_RADIUS = 0.0042;
const ROUTE_PULSE_SPEED = 0.115;
const ROUTE_PULSE_RADIUS = 0.023;
const ROUTE_NODE_RADIUS = 0.019;
const ROUTE_PULSE_SEGMENTS = 12;
const ROUTE_CORE_OPACITY = 0.54;
const ROUTE_GLOW_OPACITY = 0.06;
const LIGHT_ROUTE_CORE_OPACITY = 0.86;
const LIGHT_ROUTE_PULSE_OPACITY = 0.62;
const LIGHT_ROUTE_GLOW_ALPHA_BY_TONE = {
  cyan: 0.14,
  purple: 0.12,
  pink: 0.12,
  gold: 0.12,
} as const;
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
export type GlobeTheme = "dark" | "light";
type GlobeMode = "network" | "countries" | "oceans";

type GlobeComponentProps = {
  theme?: GlobeTheme;
};

type GlobeControlsState = {
  theme: GlobeTheme;
  mode: GlobeMode;
  rotationSpeed: number;
  continentIntensity: number;
  routesEnabled: boolean;
  autoSpin: boolean;
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
  theme: GlobeTheme;
};

type LabelTextureModel = {
  texture: CanvasTexture;
  width: number;
  height: number;
};

type LightRouteTone = keyof typeof LIGHT_ROUTE_GLOW_ALPHA_BY_TONE;

const DEFAULT_GLOBE_CONTROLS: GlobeControlsState = {
  theme: "dark",
  mode: "network",
  rotationSpeed: 1,
  continentIntensity: 1,
  routesEnabled: true,
  autoSpin: true,
};

const GLOBE_MODE_DEFAULTS = {
  network: {
    rotationSpeed: 1,
    continentIntensity: 1,
    routesEnabled: true,
    autoSpin: true,
  },
  countries: {
    rotationSpeed: 0.85,
    continentIntensity: 1.35,
    routesEnabled: false,
    autoSpin: true,
  },
  oceans: {
    rotationSpeed: 0.55,
    continentIntensity: 0.55,
    routesEnabled: false,
    autoSpin: true,
  },
} satisfies Record<GlobeMode, Omit<GlobeControlsState, "theme" | "mode">>;

const GLOBE_MODES = [
  {
    id: "network",
    label: "Network",
    description: "Countries and live routes",
  },
  {
    id: "countries",
    label: "Countries",
    description: "Major countries only",
  },
  {
    id: "oceans",
    label: "Oceans",
    description: "Ocean labels and currents",
  },
] satisfies Array<{ id: GlobeMode; label: string; description: string }>;

const OCEAN_REGIONS = [
  { id: "pacific", name: "Pacific", lat: 7, lon: -151, tone: "#5fe7ff", scale: 1.05 },
  { id: "atlantic", name: "Atlantic", lat: 2, lon: -32, tone: "#78d9ff", scale: 0.9 },
  { id: "indian", name: "Indian", lat: -22, lon: 76, tone: "#77f2dc", scale: 0.86 },
  { id: "southern", name: "Southern", lat: -56, lon: 32, tone: "#b6f4ff", scale: 0.78 },
] satisfies Array<LandPoint & { id: string; name: string; tone: string; scale: number }>;

const DARK_CONTINENT_INTENSITY_GAIN = 1.65;
const LIGHT_CONTINENT_INTENSITY_GAIN = 1.68;

const LIGHT_GLOBE_TOKENS = {
  pageBgStart: "#fffaf3",
  pageBgMid: "#f7fbff",
  pageBgEnd: "#edf4fb",
  surfaceTop: "#ffffff",
  surfaceMid: "#dde5ef",
  surfaceBottom: "#b8c6d8",
  surfaceTopColor: [255 / 255, 255 / 255, 255 / 255],
  surfaceMidColor: [221 / 255, 229 / 255, 239 / 255],
  surfaceBottomColor: [184 / 255, 198 / 255, 216 / 255],
  innerShadowColor: [15 / 255, 23 / 255, 42 / 255],
  innerHighlightColor: [1, 1, 1],
  innerShadow: "rgba(15, 23, 42, 0.10)",
  innerDepth: "rgba(15, 23, 42, 0.16)",
  landDotFront: [15 / 255, 23 / 255, 42 / 255],
  landDotMid: [15 / 255, 23 / 255, 42 / 255],
  landDotBack: [15 / 255, 23 / 255, 42 / 255],
  grid: "#182438",
  gridOpacity: 0.045,
  gridSoft: "#182438",
  gridSoftOpacity: 0.025,
  rim: [148 / 255, 163 / 255, 184 / 255],
  rimStrong: [96 / 255, 165 / 255, 250 / 255],
  rimHighlight: [1, 1, 1],
  rimHighlightOpacity: 0.82,
  atmosphere: [147 / 255, 197 / 255, 253 / 255],
  atmosphereOpacity: 0.18,
  routeCyan: "#06a6b3",
  routePurple: "#7c3aed",
  routePink: "#e11d48",
  routeGold: "#d97706",
  markerBg: "rgba(255, 255, 255, 0.94)",
  markerBorder: "rgba(255, 255, 255, 0.95)",
  markerShadow: "0 10px 28px rgba(15, 23, 42, 0.20)",
  markerRingShadow: "0 0 0 3px rgba(255, 255, 255, 0.86)",
} satisfies {
  pageBgStart: string;
  pageBgMid: string;
  pageBgEnd: string;
  surfaceTop: string;
  surfaceMid: string;
  surfaceBottom: string;
  surfaceTopColor: [number, number, number];
  surfaceMidColor: [number, number, number];
  surfaceBottomColor: [number, number, number];
  innerShadowColor: [number, number, number];
  innerHighlightColor: [number, number, number];
  innerShadow: string;
  innerDepth: string;
  landDotFront: [number, number, number];
  landDotMid: [number, number, number];
  landDotBack: [number, number, number];
  grid: string;
  gridOpacity: number;
  gridSoft: string;
  gridSoftOpacity: number;
  rim: [number, number, number];
  rimStrong: [number, number, number];
  rimHighlight: [number, number, number];
  rimHighlightOpacity: number;
  atmosphere: [number, number, number];
  atmosphereOpacity: number;
  routeCyan: string;
  routePurple: string;
  routePink: string;
  routeGold: string;
  markerBg: string;
  markerBorder: string;
  markerShadow: string;
  markerRingShadow: string;
};

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
    oceanCore: LIGHT_GLOBE_TOKENS.surfaceMid,
    oceanVeil: LIGHT_GLOBE_TOKENS.surfaceTop,
    oceanVeilOpacity: 0.08,
    oceanBase: [0.8, 0.86, 0.93],
    oceanGlow: [0.74, 0.84, 0.96],
    rimGlow: LIGHT_GLOBE_TOKENS.rimStrong,
    rimSoft: LIGHT_GLOBE_TOKENS.rim,
    rimIntensity: 1.26,
    landInner: LIGHT_GLOBE_TOKENS.landDotMid,
    landOuter: LIGHT_GLOBE_TOKENS.landDotFront,
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

const LIGHT_ROUTE_TONE_BY_DARK_COLOR: Record<string, LightRouteTone> = {
  "#45dfff": "cyan",
  "#8b7cff": "purple",
  "#ff4da6": "pink",
  "#ff9b4a": "gold",
};

const LIGHT_ROUTE_COLORS: Record<LightRouteTone, string> = {
  cyan: LIGHT_GLOBE_TOKENS.routeCyan,
  purple: LIGHT_GLOBE_TOKENS.routePurple,
  pink: LIGHT_GLOBE_TOKENS.routePink,
  gold: LIGHT_GLOBE_TOKENS.routeGold,
};

function getLightRouteTone(route: NetworkRoute): LightRouteTone {
  return LIGHT_ROUTE_TONE_BY_DARK_COLOR[route.color.toLowerCase()] ?? "cyan";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function wrapLongitude(longitude: number) {
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
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
  const { canvas, context, flagImage, texture, borderColors, theme } = pinTexture;
  const size = canvas.width;
  const center = size / 2;
  const glowRadius = 112;
  const ringRadius = 84;
  const flagRadius = 58;
  const flagDiameter = flagRadius * 2;
  const ringColors = [...borderColors, borderColors[0]];

  context.clearRect(0, 0, size, size);
  context.setTransform(1, 0, 0, 1, 0, 0);

  if (theme === "light") {
    const baseRadius = flagRadius + 15;

    const ambientGlow = context.createRadialGradient(center, center + 8, flagRadius * 0.5, center, center + 8, glowRadius);
    ambientGlow.addColorStop(0, colorWithAlpha(borderColors[0], 0.16));
    ambientGlow.addColorStop(0.5, "rgba(15, 23, 42, 0.1)");
    ambientGlow.addColorStop(1, "rgba(15, 23, 42, 0)");
    context.fillStyle = ambientGlow;
    context.beginPath();
    context.arc(center, center + 8, glowRadius, 0, Math.PI * 2);
    context.fill();

    context.save();
    context.shadowColor = "rgba(15, 23, 42, 0.2)";
    context.shadowBlur = 30;
    context.shadowOffsetY = 11;
    context.fillStyle = "rgba(255, 255, 255, 0.95)";
    context.beginPath();
    context.arc(center, center, baseRadius, 0, Math.PI * 2);
    context.fill();
    context.restore();

    context.lineWidth = 8.5;
    context.strokeStyle = "rgba(255, 255, 255, 0.9)";
    context.beginPath();
    context.arc(center, center, ringRadius + 5, 0, Math.PI * 2);
    context.stroke();

    const ringGradient = context.createConicGradient(rotation, center, center);
    ringColors.forEach((color, index) => {
      ringGradient.addColorStop(index / Math.max(1, ringColors.length - 1), colorWithAlpha(color, 0.98));
    });
    context.lineWidth = 11.5;
    context.strokeStyle = ringGradient;
    context.beginPath();
    context.arc(center, center, ringRadius, 0, Math.PI * 2);
    context.stroke();

    context.lineWidth = 4;
    context.strokeStyle = "rgba(255, 255, 255, 0.95)";
    context.beginPath();
    context.arc(center, center, flagRadius + 7, 0, Math.PI * 2);
    context.stroke();

    context.save();
    context.beginPath();
    context.arc(center, center, flagRadius, 0, Math.PI * 2);
    context.clip();
    drawImageCover(context, flagImage, center - flagRadius, center - flagRadius, flagDiameter, flagDiameter);
    context.restore();

    const innerRim = context.createLinearGradient(center - flagRadius, center - flagRadius, center + flagRadius, center + flagRadius);
    innerRim.addColorStop(0, "rgba(255, 255, 255, 0.9)");
    innerRim.addColorStop(0.55, colorWithAlpha(borderColors[Math.floor(borderColors.length / 2)], 0.42));
    innerRim.addColorStop(1, "rgba(15, 23, 42, 0.24)");
    context.lineWidth = 3.25;
    context.strokeStyle = innerRim;
    context.beginPath();
    context.arc(center, center, flagRadius, 0, Math.PI * 2);
    context.stroke();

    context.fillStyle = "rgba(255, 255, 255, 0.34)";
    context.beginPath();
    context.ellipse(center - 18, center - 24, 32, 13, -0.35, 0, Math.PI * 2);
    context.fill();

    texture.needsUpdate = true;
    return;
  }

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

function createOceanLabelTexture(name: string, tone: string, theme: GlobeTheme): LabelTextureModel | null {
  if (typeof document === "undefined") return null;

  const scale = Math.min(window.devicePixelRatio || 1, 2);
  const width = 224;
  const height = 86;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) return null;

  canvas.width = width * scale;
  canvas.height = height * scale;
  context.scale(scale, scale);
  context.clearRect(0, 0, width, height);

  const glow = context.createRadialGradient(width / 2, height / 2, 8, width / 2, height / 2, width / 2);
  glow.addColorStop(0, theme === "light" ? "rgba(255,255,255,0.92)" : "rgba(217,250,255,0.5)");
  glow.addColorStop(0.36, `${tone}55`);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);

  context.strokeStyle = `${tone}78`;
  context.lineWidth = 1;
  context.beginPath();
  context.ellipse(width / 2, height / 2 + 1, width * 0.38, height * 0.25, 0, 0, Math.PI * 2);
  context.stroke();

  context.font = "700 22px 'Aptos Display', 'Segoe UI', sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.shadowColor = theme === "light" ? "rgba(15, 23, 42, 0.28)" : tone;
  context.shadowBlur = theme === "light" ? 9 : 14;
  context.fillStyle = theme === "light" ? "rgba(15, 23, 42, 0.78)" : "rgba(238, 253, 255, 0.94)";
  context.fillText(name.toUpperCase(), width / 2, height / 2 - 1);

  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;

  return { texture, width, height };
}

async function createFlagPinTexture(country: NetworkCountry, theme: GlobeTheme) {
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
    theme,
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

function createLightDenseLandPoints(landPoints: LandPoint[]) {
  const densePoints: LandPoint[] = [];

  landPoints.forEach((point, index) => {
    densePoints.push(point);

    const latitudeScale = Math.max(0.45, Math.cos((point.lat * Math.PI) / 180));
    const lonOffset = (index % 2 === 0 ? 0.22 : -0.22) / latitudeScale;
    const latOffset = index % 3 === 0 ? 0.16 : -0.13;
    const denseLatitude = point.lat + latOffset;

    if (denseLatitude < LAND_MIN_LATITUDE || denseLatitude > LAND_MAX_LATITUDE) return;

    densePoints.push({
      lon: wrapLongitude(point.lon + lonOffset),
      lat: denseLatitude,
    });
  });

  return densePoints;
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
      uLightTheme: { value: theme === "light" ? 1 : 0 },
      uLightRim: { value: LIGHT_GLOBE_TOKENS.rim },
      uLightRimStrong: { value: LIGHT_GLOBE_TOKENS.rimStrong },
      uLightRimHighlight: { value: LIGHT_GLOBE_TOKENS.rimHighlight },
      uLightAtmosphere: { value: LIGHT_GLOBE_TOKENS.atmosphere },
    }),
    [palette, theme],
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
            uniform float uLightTheme;
            uniform vec3 uLightRim;
            uniform vec3 uLightRimStrong;
            uniform vec3 uLightRimHighlight;
            uniform vec3 uLightAtmosphere;
            varying float vRim;

            void main() {
              float rim = smoothstep(0.18, 1.0, vRim);
              float darkFineEdge = pow(rim, 3.15) * 0.2;
              float darkSoftHalo = pow(rim, 1.35) * 0.045;
              vec3 darkColor = mix(uSoftGlowColor, uGlowColor, smoothstep(0.52, 1.0, rim));
              float darkAlpha = (darkFineEdge + darkSoftHalo) * uRimIntensity;

              float lightAtmosphere = pow(rim, 1.22) * 0.16;
              float lightMainRim = pow(rim, 1.95) * 0.32;
              float lightAccent = pow(rim, 3.6) * 0.26;
              float lightHighlight = pow(rim, 4.7) * 0.78;
              vec3 lightColor = uLightAtmosphere * lightAtmosphere;
              lightColor += uLightRim * lightMainRim;
              lightColor += uLightRimStrong * lightAccent;
              lightColor += uLightRimHighlight * lightHighlight;
              float lightAlpha = clamp(lightAtmosphere + lightMainRim + lightAccent * 0.3 + lightHighlight * 0.46, 0.0, 0.62);

              gl_FragColor = vec4(mix(darkColor, lightColor, uLightTheme), mix(darkAlpha, lightAlpha, uLightTheme));
            }
          `}
        />
      </mesh>
    </group>
  );
}

function ViewportRimPolish({ theme }: { theme: GlobeTheme }) {
  if (theme === "light") return null;

  return (
    <group name="viewport-rim-polish" renderOrder={20}>
      <mesh>
        <ringGeometry args={[GLOBE_RADIUS * 1.004, GLOBE_RADIUS * 1.057, 256]} />
        <meshBasicMaterial
          color="#2a9fff"
          transparent
          opacity={0.14}
          depthTest={false}
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>
      <mesh>
        <ringGeometry args={[GLOBE_RADIUS * 1.044, GLOBE_RADIUS * 1.057, 256]} />
        <meshBasicMaterial
          color="#7fdcff"
          transparent
          opacity={0.12}
          depthTest={false}
          depthWrite={false}
          blending={AdditiveBlending}
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
            float alpha = 0.018 + centerGlow * 0.034 + rimGlow * 0.03;
            vec3 color = mix(uBaseColor, uGlowColor, centerGlow * 0.24 + rimGlow * 0.2);

            gl_FragColor = vec4(color, alpha);
          }
        `}
      />
    </mesh>
  );
}

function LightGlobeBodySurface() {
  const uniforms = useMemo(
    () => ({
      uSurfaceTop: { value: LIGHT_GLOBE_TOKENS.surfaceTopColor },
      uSurfaceMid: { value: LIGHT_GLOBE_TOKENS.surfaceMidColor },
      uSurfaceBottom: { value: LIGHT_GLOBE_TOKENS.surfaceBottomColor },
      uInnerShadow: { value: LIGHT_GLOBE_TOKENS.innerShadowColor },
      uInnerHighlight: { value: LIGHT_GLOBE_TOKENS.innerHighlightColor },
    }),
    [],
  );

  return (
    <mesh>
      <sphereGeometry args={[GLOBE_RADIUS * 0.985, GLOBE_DETAIL_SEGMENTS, GLOBE_DETAIL_SEGMENTS]} />
      <shaderMaterial
        depthWrite
        uniforms={uniforms}
        vertexShader={`
          varying vec3 vSphereNormal;
          varying float vFacing;

          void main() {
            vec3 sphereNormal = normalize(position);
            vec3 viewNormal = normalize(normalMatrix * sphereNormal);
            vSphereNormal = sphereNormal;
            vFacing = clamp(viewNormal.z, 0.0, 1.0);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={`
          precision highp float;

          uniform vec3 uSurfaceTop;
          uniform vec3 uSurfaceMid;
          uniform vec3 uSurfaceBottom;
          uniform vec3 uInnerShadow;
          uniform vec3 uInnerHighlight;
          varying vec3 vSphereNormal;
          varying float vFacing;

          void main() {
            vec3 highlightCenter = normalize(vec3(-0.48, 0.6, 0.64));
            vec3 lowerDepthDirection = normalize(vec3(0.38, -0.78, 0.5));
            float highlight = smoothstep(0.35, 1.0, dot(vSphereNormal, highlightCenter));
            float lowerDepth = smoothstep(-0.2, 1.0, dot(vSphereNormal, lowerDepthDirection));
            float rimDepth = pow(1.0 - vFacing, 1.42);
            float centerGlass = smoothstep(0.02, 1.0, vFacing);

            vec3 frostedColor = mix(uSurfaceBottom, uSurfaceMid, highlight * 0.52 + centerGlass * 0.18);
            frostedColor = mix(frostedColor, uSurfaceTop, highlight * 0.38);
            frostedColor = mix(frostedColor, uInnerShadow, lowerDepth * 0.13 + rimDepth * 0.1);
            frostedColor = mix(frostedColor, uInnerHighlight, highlight * 0.18 + centerGlass * 0.05);

            gl_FragColor = vec4(frostedColor, 1.0);
          }
        `}
      />
    </mesh>
  );
}

function LightReferenceGlassShell() {
  const uniforms = useMemo(
    () => ({
      uAtmosphere: { value: LIGHT_GLOBE_TOKENS.atmosphere },
      uRim: { value: LIGHT_GLOBE_TOKENS.rim },
      uRimStrong: { value: LIGHT_GLOBE_TOKENS.rimStrong },
      uHighlight: { value: LIGHT_GLOBE_TOKENS.rimHighlight },
    }),
    [],
  );

  return (
    <mesh renderOrder={12}>
      <sphereGeometry args={[GLOBE_RADIUS * 1.048, GLOBE_SPHERE_SEGMENTS, GLOBE_SPHERE_SEGMENTS]} />
      <shaderMaterial
        transparent
        depthTest={false}
        depthWrite={false}
        blending={NormalBlending}
        uniforms={uniforms}
        vertexShader={`
          varying float vFacing;
          varying float vRim;
          varying float vUpper;

          void main() {
            vec3 sphereNormal = normalize(position);
            vec3 viewNormal = normalize(normalMatrix * sphereNormal);
            vFacing = clamp(viewNormal.z, 0.0, 1.0);
            vRim = 1.0 - abs(viewNormal.z);
            vUpper = smoothstep(-0.2, 0.92, sphereNormal.y);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={`
          precision highp float;

          uniform vec3 uAtmosphere;
          uniform vec3 uRim;
          uniform vec3 uRimStrong;
          uniform vec3 uHighlight;
          varying float vFacing;
          varying float vRim;
          varying float vUpper;

          void main() {
            float rim = smoothstep(0.22, 1.0, vRim);
            float glassBody = smoothstep(0.06, 0.9, vFacing) * 0.012;
            float softEdge = pow(rim, 1.48) * 0.12;
            float brightEdge = pow(rim, 4.0) * 0.2;
            float upperGlint = pow(rim, 2.8) * vUpper * 0.11;
            vec3 color = uAtmosphere * glassBody;
            color += uRim * softEdge;
            color += uRimStrong * upperGlint;
            color += uHighlight * brightEdge;
            float alpha = clamp(glassBody + softEdge * 0.54 + brightEdge * 0.38 + upperGlint * 0.28, 0.0, 0.22);

            gl_FragColor = vec4(color, alpha);
          }
        `}
      />
    </mesh>
  );
}

function LightReferenceGlassAperture({ theme }: { theme: GlobeTheme }) {
  if (theme !== "light") return null;

  return (
    <mesh name="light-reference-glass-aperture" renderOrder={36}>
      <circleGeometry args={[GLOBE_RADIUS * 1.056, 384]} />
      <shaderMaterial
        transparent
        depthTest={false}
        depthWrite={false}
        blending={NormalBlending}
        vertexShader={`
          varying vec2 vUv;

          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={`
          precision highp float;

          varying vec2 vUv;

          void main() {
            vec2 centeredUv = vUv - vec2(0.5);
            float radius = length(centeredUv) * 2.0;
            float inside = 1.0 - smoothstep(1.0, 1.012, radius);
            float centerWash = smoothstep(0.0, 0.84, radius) * 0.018;
            float innerFrost = smoothstep(0.68, 0.97, radius) * (1.0 - smoothstep(0.998, 1.012, radius));
            float glassLip = smoothstep(0.91, 0.992, radius) * (1.0 - smoothstep(1.0, 1.012, radius));
            float highlight = smoothstep(0.958, 0.997, radius) * (1.0 - smoothstep(0.998, 1.009, radius));
            vec3 frost = mix(vec3(0.9, 0.94, 0.985), vec3(1.0), highlight * 0.9);
            float alpha = (centerWash + innerFrost * 0.08 + glassLip * 0.2 + highlight * 0.36) * inside;

            if (alpha < 0.002) discard;
            gl_FragColor = vec4(frost, alpha);
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
  const isLightTheme = theme === "light";
  const pointSizeGain = isLightTheme ? 0.035 : 0.2;
  const pointSize = LAND_DOT_POINT_SIZE * (isLightTheme ? 0.98 : 1) * (1 + Math.log2(Math.max(shaderIntensity, 1)) * pointSizeGain);
  const landGeometry = useMemo(() => {
    const landPoints = generateLandPoints({
      longitudeStep: DOT_SPACING,
      latitudeStep: DOT_SPACING,
      jitter: DOT_JITTER,
      minLatitude: LAND_MIN_LATITUDE,
      maxLatitude: LAND_MAX_LATITUDE,
    });

    return createLandDotGeometry(isLightTheme ? createLightDenseLandPoints(landPoints) : landPoints);
  }, [isLightTheme]);
  const landUniforms = useMemo(
    () => ({
      uPointSize: { value: pointSize },
      uInnerColor: { value: palette.landInner },
      uOuterColor: { value: palette.landOuter },
      uIntensity: { value: shaderIntensity },
      uLightTheme: { value: isLightTheme ? 1 : 0 },
    }),
    [isLightTheme, palette, pointSize, shaderIntensity],
  );

  useEffect(() => () => landGeometry.dispose(), [landGeometry]);

  const surfaceVertexShader = `
    attribute float aSeed;
    uniform float uPointSize;
    varying float vFacing;
    varying float vViewFacing;
    varying float vEdgeFade;
    varying float vNorthLight;
    varying float vPolarFade;
    varying float vSeed;

    void main() {
      vec3 sphereNormal = normalize(position);
      vec3 viewNormal = normalize(normalMatrix * sphereNormal);
      // viewNormal.z is strongest at the camera-facing center of the sphere.
      // It lets front dots read brightly while rim/back dots fall away.
      vFacing = smoothstep(-0.12, 0.58, viewNormal.z);
      vViewFacing = viewNormal.z;
      vEdgeFade = smoothstep(-0.28, 0.04, viewNormal.z);
      vNorthLight = smoothstep(0.02, 0.78, sphereNormal.y);
      vPolarFade = 1.0 - smoothstep(0.91, 0.972, abs(sphereNormal.y));
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
    varying float vViewFacing;
    varying float vEdgeFade;
    varying float vNorthLight;
    varying float vPolarFade;
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
      float lightDepth = smoothstep(-0.24, 0.68, vViewFacing);
      float lightBackPresence = smoothstep(-0.58, -0.18, vViewFacing);
      float lightDotOpacity = mix(0.26, 0.78, lightDepth);
      lightDotOpacity = mix(0.26, lightDotOpacity, lightBackPresence);
      float lightIntensityLift = 1.0 + log2(max(uIntensity, 1.0)) * 0.16;
      float lightThemeAlpha = dotMask * lightDotOpacity * vPolarFade * mix(0.96, 1.0, vSeed) * lightIntensityLift;
      float darkThemeAlpha = dotMask * vEdgeFade * vPolarFade * visibleSideLight * mix(0.95, 1.0, vSeed) * intensityAlpha;
      vec3 edgeColor = uInnerColor * 0.98;
      vec3 lightThemeColor = mix(edgeColor * 0.82, uOuterColor * 0.92, core * 0.08 + lightDepth * 0.04);
      vec3 darkThemeColor = mix(edgeColor, mix(uInnerColor, uOuterColor, core * 0.9 + frontLight * 0.48 + topLandLift) * mix(0.82, 3.2, clamp(log2(max(uIntensity, 1.0)) / 6.4, 0.0, 1.0)), frontLight);
      float alpha = mix(darkThemeAlpha, lightThemeAlpha, uLightTheme);
      vec3 color = mix(darkThemeColor, lightThemeColor, uLightTheme);

      if (alpha < 0.008) discard;
      gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
    }
  `;

  return (
    <group>
      {theme === "light" ? (
        <LightGlobeBodySurface />
      ) : (
        <mesh>
          <sphereGeometry args={[GLOBE_RADIUS * 0.985, GLOBE_DETAIL_SEGMENTS, GLOBE_DETAIL_SEGMENTS]} />
          <meshBasicMaterial color={palette.oceanCore} depthWrite />
        </mesh>
      )}

      <GlassyOceanIllumination theme={theme} />

      <SurfaceGrid theme={theme} />

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

      {theme === "light" ? <LightReferenceGlassShell /> : <RimAtmosphere theme={theme} />}
    </group>
  );
}

function NetworkRouteLayer({
  prefersReducedMotion,
  isCompactViewport,
  theme,
  showRoutes,
  showCountries,
}: {
  prefersReducedMotion: boolean;
  isCompactViewport: boolean;
  theme: GlobeTheme;
  showRoutes: boolean;
  showCountries: boolean;
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
      {showRoutes
        ? routeCurves.map(({ route, curve }) => (
            <NetworkRouteArc key={route.id} route={route} curve={curve} prefersReducedMotion={prefersReducedMotion} theme={theme} />
          ))
        : null}

      {showCountries
        ? countryPositions.map(({ country, position }) => (
            <NetworkCountryMarker
              key={country.id}
              country={country}
              position={position}
              showBadge={badgeCountryIds.has(country.id)}
              isCompactViewport={isCompactViewport}
              theme={theme}
            />
          ))
        : null}
    </group>
  );
}

function NetworkRouteArc({
  route,
  curve,
  prefersReducedMotion,
  theme,
}: {
  route: NetworkRoute;
  curve: QuadraticBezierCurve3;
  prefersReducedMotion: boolean;
  theme: GlobeTheme;
}) {
  const routeRef = useRef<Group>(null);
  const pulseRef = useRef<Group>(null);
  const coreMaterialRef = useRef<MeshBasicMaterial>(null);
  const glowMaterialRef = useRef<MeshBasicMaterial>(null);
  const camera = useThree((state) => state.camera);
  const isLightTheme = theme === "light";
  const lightRouteTone = useMemo(() => getLightRouteTone(route), [route]);
  const routeColor = useMemo(
    () => new Color(isLightTheme ? LIGHT_ROUTE_COLORS[lightRouteTone] : route.color),
    [isLightTheme, lightRouteTone, route.color],
  );
  const pulseColor = useMemo(
    () => new Color(isLightTheme ? LIGHT_ROUTE_COLORS[lightRouteTone] : route.accentColor),
    [isLightTheme, lightRouteTone, route.accentColor],
  );
  const routeCoreOpacity = isLightTheme ? LIGHT_ROUTE_CORE_OPACITY : ROUTE_CORE_OPACITY;
  const routeGlowOpacity = isLightTheme ? LIGHT_ROUTE_GLOW_ALPHA_BY_TONE[lightRouteTone] : ROUTE_GLOW_OPACITY;
  const lightToneOpacityScale = lightRouteTone === "pink" ? 0.98 : 1;
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
      coreMaterialRef.current.opacity = routeCoreOpacity * lightToneOpacityScale * routeVisibility;
    }

    if (glowMaterialRef.current) {
      glowMaterialRef.current.opacity = routeGlowOpacity * routeVisibility * routeVisibility;
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
        <tubeGeometry args={[curve, ROUTE_CURVE_SEGMENTS, isLightTheme ? ROUTE_LINE_RADIUS * 0.92 : ROUTE_LINE_RADIUS, 8, false]} />
        <meshBasicMaterial
          ref={coreMaterialRef}
          color={routeColor}
          transparent
          opacity={routeCoreOpacity}
          depthTest
          depthWrite={false}
          blending={isLightTheme ? NormalBlending : AdditiveBlending}
        />
      </mesh>

      <mesh renderOrder={3}>
        <tubeGeometry args={[curve, ROUTE_CURVE_SEGMENTS, ROUTE_LINE_RADIUS * (isLightTheme ? 1.8 : 2.8), 8, false]} />
        <meshBasicMaterial
          ref={glowMaterialRef}
          color={routeColor}
          transparent
          opacity={routeGlowOpacity}
          depthTest
          depthWrite={false}
          blending={isLightTheme ? NormalBlending : AdditiveBlending}
        />
      </mesh>

      <group ref={pulseRef} renderOrder={6}>
        <mesh>
          <sphereGeometry args={[ROUTE_PULSE_RADIUS, ROUTE_PULSE_SEGMENTS, ROUTE_PULSE_SEGMENTS]} />
          <meshBasicMaterial
            color={pulseColor}
            transparent
            opacity={isLightTheme ? LIGHT_ROUTE_PULSE_OPACITY * lightToneOpacityScale : 0.78}
            depthTest
            depthWrite={false}
            blending={isLightTheme ? NormalBlending : AdditiveBlending}
          />
        </mesh>

        <mesh>
          <sphereGeometry args={[ROUTE_PULSE_RADIUS * 2.4, ROUTE_PULSE_SEGMENTS, ROUTE_PULSE_SEGMENTS]} />
          <meshBasicMaterial
            color={routeColor}
            transparent
            opacity={isLightTheme ? routeGlowOpacity : 0.14}
            depthTest
            depthWrite={false}
            blending={isLightTheme ? NormalBlending : AdditiveBlending}
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
  theme,
}: {
  country: NetworkCountry;
  position: Vector3;
  showBadge: boolean;
  isCompactViewport: boolean;
  theme: GlobeTheme;
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

    void createFlagPinTexture(country, theme).then((pinTexture) => {
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
  }, [country, showBadge, theme]);

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

function OceanFocusLayer({
  theme,
  isCompactViewport,
}: {
  theme: GlobeTheme;
  isCompactViewport: boolean;
}) {
  const [textures, setTextures] = useState<Record<string, LabelTextureModel>>({});
  const camera = useThree((state) => state.camera);
  const cameraDirectionRef = useRef(new Vector3());
  const worldPositionRef = useRef(new Vector3());
  const groupRefs = useRef<Record<string, Group | null>>({});
  const oceanPositions = useMemo(
    () =>
      OCEAN_REGIONS.map((ocean) => ({
        ocean,
        position: sphereCoordinateToVector(ocean),
      })),
    [],
  );

  useEffect(() => {
    const nextTextures = OCEAN_REGIONS.reduce<Record<string, LabelTextureModel>>((accumulator, ocean) => {
      const texture = createOceanLabelTexture(ocean.name, ocean.tone, theme);

      if (texture) accumulator[ocean.id] = texture;

      return accumulator;
    }, {});

    setTextures(nextTextures);

    return () => {
      Object.values(nextTextures).forEach(({ texture }) => texture.dispose());
    };
  }, [theme]);

  useFrame(({ clock }) => {
    const cameraDirection = cameraDirectionRef.current.copy(camera.position).normalize();

    oceanPositions.forEach(({ ocean }) => {
      const group = groupRefs.current[ocean.id];

      if (!group) return;

      group.getWorldPosition(worldPositionRef.current);
      const facingAmount = worldPositionRef.current.dot(cameraDirection) / worldPositionRef.current.length();
      const visibleAmount = clamp((facingAmount - 0.08) / 0.42, 0, 1);
      group.visible = visibleAmount > 0.04;
      group.scale.setScalar((isCompactViewport ? 0.75 : 1) * ocean.scale * (0.94 + Math.sin(clock.elapsedTime * 1.6) * 0.025));

      group.children.forEach((child) => {
        const material = "material" in child ? child.material : null;

        if (material && typeof material === "object" && !Array.isArray(material)) {
          (material as { opacity?: number }).opacity = visibleAmount;
        }
      });
    });
  });

  return (
    <group name="ocean-focus-layer">
      {oceanPositions.map(({ ocean, position }) => {
        const labelTexture = textures[ocean.id];

        return (
          <group
            key={ocean.id}
            ref={(group) => {
              groupRefs.current[ocean.id] = group;
            }}
            position={[position.x * 1.04, position.y * 1.04, position.z * 1.04]}
            renderOrder={8}
          >
            <mesh>
              <sphereGeometry args={[0.052, 20, 20]} />
              <meshBasicMaterial
                color={ocean.tone}
                transparent
                opacity={0.58}
                depthTest={false}
                depthWrite={false}
                blending={theme === "light" ? NormalBlending : AdditiveBlending}
              />
            </mesh>
            <mesh>
              <sphereGeometry args={[0.14, 20, 20]} />
              <meshBasicMaterial
                color={ocean.tone}
                transparent
                opacity={0.14}
                depthTest={false}
                depthWrite={false}
                blending={theme === "light" ? NormalBlending : AdditiveBlending}
              />
            </mesh>
            {labelTexture ? (
              <sprite position={[0, 0.24, 0]} scale={[0.78, 0.3, 1]} renderOrder={9}>
                <spriteMaterial map={labelTexture.texture} transparent opacity={0.92} depthTest={false} depthWrite={false} />
              </sprite>
            ) : null}
          </group>
        );
      })}
    </group>
  );
}

function SurfaceGrid({ theme }: { theme: GlobeTheme }) {
  const gridLines = useMemo(() => {
    const isLightTheme = theme === "light";
    const softMaterialOptions = {
      color: isLightTheme ? LIGHT_GLOBE_TOKENS.grid : "#2a9fff",
      transparent: true,
      opacity: isLightTheme ? LIGHT_GLOBE_TOKENS.gridSoftOpacity : 0.022,
      depthTest: true,
      depthWrite: false,
      blending: isLightTheme ? NormalBlending : AdditiveBlending,
    };
    const primaryMaterialOptions = {
      ...softMaterialOptions,
      opacity: isLightTheme ? LIGHT_GLOBE_TOKENS.gridOpacity : 0.022,
    };
    const lines: Line[] = [];

    for (let lat = -60; lat <= 60; lat += SURFACE_GRID_LAT_STEP) {
      const geometry = createSphericalGuideGeometry(
        createLatitudeLinePoints(lat, SURFACE_GRID_SEGMENT_STEP),
        GLOBE_RADIUS + 0.018,
      );
      const isPrimaryLine = lat === 0 || Math.abs(lat) === 40;
      lines.push(new Line(geometry, new LineBasicMaterial(isPrimaryLine ? primaryMaterialOptions : softMaterialOptions)));
    }

    for (let lon = -180; lon < 180; lon += SURFACE_GRID_LON_STEP) {
      const geometry = createSphericalGuideGeometry(
        createLongitudeLinePoints(lon, SURFACE_GRID_SEGMENT_STEP),
        GLOBE_RADIUS + 0.018,
      );
      const isPrimaryLine = lon % 60 === 0;
      lines.push(new Line(geometry, new LineBasicMaterial(isPrimaryLine ? primaryMaterialOptions : softMaterialOptions)));
    }

    return lines;
  }, [theme]);

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

function RoutePowerSwitch({
  checked,
  disabled = false,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      className={`route-power-switch${checked ? " is-on" : ""}${disabled ? " is-disabled" : ""}`}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="route-power-copy">
        <span>Live routes</span>
        <strong>{disabled ? "Mode keeps routes hidden" : checked ? "Transmission online" : "Network hidden"}</strong>
      </span>
      <span className="route-power-track" aria-hidden="true">
        <span className="route-power-sparks" />
        <span className="route-power-thumb" />
      </span>
    </button>
  );
}

function getModeControls(theme: GlobeTheme, mode: GlobeMode): GlobeControlsState {
  return {
    theme,
    mode,
    ...GLOBE_MODE_DEFAULTS[mode],
  };
}

function GlobeControlPanel({
  controls,
  onControlsChange,
  isOpen,
  onOpenChange,
}: {
  controls: GlobeControlsState;
  onControlsChange: (controls: GlobeControlsState) => void;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}) {
  const updateControl = useCallback(
    <Key extends keyof GlobeControlsState>(key: Key, value: GlobeControlsState[Key]) => {
      onControlsChange({ ...controls, [key]: value });
    },
    [controls, onControlsChange],
  );
  const resetControls = useCallback(
    () => onControlsChange(getModeControls(controls.theme, controls.mode)),
    [controls.mode, controls.theme, onControlsChange],
  );
  const activeModeIndex = useMemo(
    () => GLOBE_MODES.findIndex((mode) => mode.id === controls.mode),
    [controls],
  );
  const activeMode = GLOBE_MODES[activeModeIndex >= 0 ? activeModeIndex : 0];
  const routesActive = controls.mode === "network" && controls.routesEnabled;
  const routesLocked = controls.mode !== "network";
  const applyNextMode = useCallback(() => {
    const nextMode = GLOBE_MODES[(activeModeIndex + 1) % GLOBE_MODES.length];

    onControlsChange(getModeControls(controls.theme, nextMode.id));
  }, [activeModeIndex, controls.theme, onControlsChange]);
  const toggleAutoSpin = useCallback(() => updateControl("autoSpin", !controls.autoSpin), [controls.autoSpin, updateControl]);

  if (!isOpen) {
    return (
      <aside className="globe-control-panel is-collapsed" aria-label="Globe display controls">
        <button
          className="control-icon-button"
          type="button"
          aria-label="Open globe controls"
          aria-expanded={false}
          onClick={() => onOpenChange(true)}
        >
          <span />
        </button>
      </aside>
    );
  }

  return (
    <aside className="globe-control-panel" aria-label="Globe display controls">
      <header className="control-panel-header">
        <h2>Controls</h2>
        <button
          className="control-icon-button"
          type="button"
          aria-label="Close globe controls"
          aria-expanded={true}
          onClick={() => onOpenChange(false)}
        >
          <span />
        </button>
      </header>

      <div className="control-panel-actions">
        <button
          className={`control-orbit-button${controls.autoSpin ? " is-spinning" : ""}`}
          type="button"
          aria-label={controls.autoSpin ? "Pause auto spin" : "Resume auto spin"}
          aria-pressed={controls.autoSpin}
          onClick={toggleAutoSpin}
        >
          <span className="orbit-icon" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M24 0V24H0V0H24Z" fill="white" fillOpacity="0.01" />
              <path
                d="M9.19473 3.4458C8.45728 5.6226 8 8.65109 8 12C8 15.3489 8.45728 18.3774 9.19473 20.5542M3.4458 9.19473C4.33533 6.48059 6.48059 4.33533 9.19473 3.4458C10.0775 3.15648 11.0205 3 12 3C12.9795 3 13.9225 3.15648 14.8053 3.4458M14.8053 3.4458C15.5427 5.6226 16 8.65109 16 12C16 15.3489 15.5427 18.3774 14.8053 20.5542M20.5542 14.8053C20.8435 13.9225 21 12.9795 21 12C21 11.0205 20.8435 10.0775 20.5542 9.19473C19.6647 6.48059 17.5194 4.33533 14.8053 3.4458M20.5542 9.19473C18.3774 8.45728 15.3489 8 12 8C8.65109 8 5.6226 8.45728 3.4458 9.19473M20.5542 14.8053C18.3774 15.5427 15.3489 16 12 16C8.65109 16 5.6226 15.5427 3.4458 14.8053M3.4458 14.8053C4.33533 17.5194 6.48059 19.6647 9.19473 20.5542C10.0775 20.8435 11.0205 21 12 21C12.9795 21 13.9225 20.8435 14.8053 20.5542C17.5194 19.6647 19.6647 17.5194 20.5542 14.8053M3.4458 14.8053C3.15648 13.9225 3 12.9795 3 12C3 11.0205 3.15648 10.0775 3.4458 9.19473"
                stroke="currentColor"
              />
            </svg>
          </span>
        </button>
        <button className="control-version-button" type="button" onClick={applyNextMode}>
          <span>{activeMode.label}</span>
          <span aria-hidden="true">v</span>
        </button>
        <button className="control-copy-button" type="button" onClick={() => onOpenChange(false)}>
          Focus
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
          <span aria-hidden="true">{routesActive ? "on" : "off"}</span>
        </div>
        <RoutePowerSwitch
          checked={routesActive}
          disabled={routesLocked}
          onChange={(value) => updateControl("routesEnabled", value)}
        />
      </section>

      <button className="control-reset-button" type="button" onClick={resetControls}>
        Reset view
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

    const idleSpeed = !controls.autoSpin
      ? 0
      : prefersReducedMotion
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
          {SHOW_NETWORK_LAYER && controls.mode !== "oceans" ? (
            <NetworkRouteLayer
              prefersReducedMotion={prefersReducedMotion}
              isCompactViewport={isCompactViewport}
              theme={controls.theme}
              showRoutes={controls.mode === "network" && controls.routesEnabled}
              showCountries={controls.mode === "network" || controls.mode === "countries"}
            />
          ) : null}
          {controls.mode === "oceans" ? <OceanFocusLayer theme={controls.theme} isCompactViewport={isCompactViewport} /> : null}
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
      <LightReferenceGlassAperture theme={controls.theme} />
      <ViewportRimPolish theme={controls.theme} />
      <DebugCenteringGuides />
    </>
  );
}

export function GlobeComponent({ theme }: GlobeComponentProps = {}) {
  const [isDragging, setIsDragging] = useState(false);
  const [interactionState, setInteractionState] = useState<InteractionState>("idle");
  const [controls, setControls] = useState<GlobeControlsState>(DEFAULT_GLOBE_CONTROLS);
  const [isControlPanelOpen, setIsControlPanelOpen] = useState(true);
  const activeTheme = theme ?? controls.theme;
  const activeControls = useMemo<GlobeControlsState>(
    () => ({
      ...controls,
      theme: activeTheme,
    }),
    [activeTheme, controls],
  );
  const prefersReducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const isCompactViewport = useMediaQuery(COMPACT_MEDIA_QUERY);
  const canvasDpr = useMemo<[number, number]>(
    () => (prefersReducedMotion || isCompactViewport ? [1, 1.2] : [1, 1.5]),
    [isCompactViewport, prefersReducedMotion],
  );

  useEffect(() => {
    setIsControlPanelOpen(!isCompactViewport);
  }, [isCompactViewport]);

  return (
    <section
      className={`globe-section theme-${activeTheme} is-${interactionState}${isDragging ? " is-dragging" : ""}${
        GLOBE_DEBUG_MODE ? " is-debug" : ""
      }`}
      data-theme={activeTheme}
      aria-label="Interactive dotted Earth globe"
    >
      <div className="globe-ambient" aria-hidden="true" />
      <GlobeControlPanel
        controls={activeControls}
        onControlsChange={setControls}
        isOpen={isControlPanelOpen}
        onOpenChange={setIsControlPanelOpen}
      />
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
            controls={activeControls}
          />
        </Canvas>
      </div>
    </section>
  );
}
