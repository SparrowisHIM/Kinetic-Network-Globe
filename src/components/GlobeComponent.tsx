import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { generateLandPoints, type LandPoint } from "../data/globeLandPoints";
import { projectLonLatToSphere } from "../utils/sphereProjection";
import {
  AdditiveBlending,
  BufferGeometry,
  Float32BufferAttribute,
  Line,
  LineBasicMaterial,
  type Group,
} from "three";

const GLOBE_DEBUG_MODE = false;
const IDLE_ROTATION_SPEED = 0.045;
const CENTER_LONGITUDE = 20;
const CENTER_LATITUDE = 3;
const DOT_SPACING = 1.08;
const DOT_JITTER = DOT_SPACING * 0.2;
const DOT_SIZE = 1.28;
const LAND_MIN_LATITUDE = -62;
const LAND_MAX_LATITUDE = 78;
// Keep the default vertical tilt neutral so the land matrix does not feel pushed upward.
// The Africa/Europe starting view is selected by CENTER_LONGITUDE and the y-axis orientation.
const DEFAULT_ROTATION_X = 0;
const DEFAULT_ROTATION_Y = -(CENTER_LONGITUDE * Math.PI) / 180;
const DEFAULT_ROTATION_Z = 0;
const HORIZONTAL_DRAG_SENSITIVITY = 0.0032;
const VERTICAL_TILT_SENSITIVITY = 0.00055;
// Vertical drag is intentionally tiny and temporary: enough tactile feedback,
// never enough to pull the pole toward the equator or corrupt the upright Earth view.
const MIN_INSPECTION_TILT = -0.14;
const MAX_INSPECTION_TILT = 0.14;
const MAX_HORIZONTAL_VELOCITY = 2.2;
const VELOCITY_SMOOTHING = 0.28;
const MOMENTUM_FRICTION = 0.88;
const MOMENTUM_EPSILON = 0.0025;
const TILT_SETTLE_EPSILON = 0.0015;
const TILT_RETURN_SMOOTHING = 8.4;
const AUTO_ROTATION_RESUME_DELAY = 0.65;
const IDLE_BLEND_START_VELOCITY = 0.16;
const MAX_POINTER_DELTA = 80;
const MIN_POINTER_DELTA_TIME = 16;
const MAX_POINTER_DELTA_TIME = 80;
const GLOBE_RADIUS = 2.4;
const LAND_DOT_POINT_SIZE = DOT_SIZE;
const INTERACTION_ENERGY_EASING = 5.8;
const REDUCED_MOTION_IDLE_SPEED = 0.008;
const COMPACT_MEDIA_QUERY = "(max-width: 640px), (max-height: 620px)";
const SURFACE_GRID_LAT_STEP = 20;
const SURFACE_GRID_LON_STEP = 20;
const SURFACE_GRID_SEGMENT_STEP = 2;

type GlobeGroupProps = {
  onDraggingChange: (isDragging: boolean) => void;
};

type InteractionState = "idle" | "dragging" | "momentum" | "settling";

type GlobeSceneProps = GlobeGroupProps & {
  onInteractionStateChange: (interactionState: InteractionState) => void;
  prefersReducedMotion: boolean;
  isCompactViewport: boolean;
};

type GlobeInteractionProps = GlobeGroupProps & {
  onInteractionStateChange: (interactionState: InteractionState) => void;
  prefersReducedMotion: boolean;
};

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

function landPointToSpherePosition(point: LandPoint, radius = GLOBE_RADIUS) {
  return projectLonLatToSphere(point, radius);
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
  const velocityStrength = Math.abs(velocity.y / MAX_HORIZONTAL_VELOCITY);
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

function RimAtmosphere() {
  const rimUniforms = useMemo(
    () => ({
      uGlowColor: { value: [0.48, 0.84, 1] },
    }),
    [],
  );

  return (
    <group>
      <mesh>
        <sphereGeometry args={[GLOBE_RADIUS * 1.055, 128, 128]} />
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
            varying float vRim;

            void main() {
              float rim = smoothstep(0.36, 1.0, vRim);
              float alpha = pow(rim, 2.35) * 0.28;
              gl_FragColor = vec4(uGlowColor, alpha);
            }
          `}
        />
      </mesh>

      <mesh scale={1.08}>
        <sphereGeometry args={[GLOBE_RADIUS * 1.06, 128, 128]} />
        <meshBasicMaterial
          color="#2f9fff"
          transparent
          opacity={0.016}
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

function GlassyOceanIllumination() {
  const uniforms = useMemo(
    () => ({
      uBaseColor: { value: [0.04, 0.16, 0.28] },
      uGlowColor: { value: [0.22, 0.68, 1] },
    }),
    [],
  );

  return (
    <mesh>
      <sphereGeometry args={[GLOBE_RADIUS * 1.002, 96, 96]} />
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
            float alpha = 0.014 + centerGlow * 0.026 + rimGlow * 0.02;
            vec3 color = mix(uBaseColor, uGlowColor, centerGlow * 0.34 + rimGlow * 0.28);

            gl_FragColor = vec4(color, alpha);
          }
        `}
      />
    </mesh>
  );
}

function DigitalGlobeSurface() {
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
      uPointSize: { value: LAND_DOT_POINT_SIZE },
      uInnerColor: { value: [0.5, 0.86, 1] },
      uOuterColor: { value: [0.96, 0.99, 1] },
    }),
    [],
  );

  useEffect(() => () => landGeometry.dispose(), [landGeometry]);

  const surfaceVertexShader = `
    attribute float aSeed;
    uniform float uPointSize;
    varying float vFacing;
    varying float vEdgeFade;
    varying float vSeed;

    void main() {
      vec3 viewNormal = normalize(normalMatrix * normalize(position));
      // viewNormal.z is strongest at the camera-facing center of the sphere.
      // It lets front dots read brightly while rim/back dots fall away.
      vFacing = smoothstep(0.0, 0.74, viewNormal.z);
      vEdgeFade = smoothstep(-0.04, 0.26, viewNormal.z);
      vSeed = aSeed;

      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      gl_PointSize = uPointSize * (6.0 / -mvPosition.z) * mix(0.46, 1.08, vFacing);
    }
  `;

  const surfaceFragmentShader = `
    precision highp float;

    uniform vec3 uInnerColor;
    uniform vec3 uOuterColor;
    varying float vFacing;
    varying float vEdgeFade;
    varying float vSeed;

    void main() {
      vec2 point = gl_PointCoord - vec2(0.5);
      float distanceFromCenter = length(point);
      float dotMask = smoothstep(0.5, 0.16, distanceFromCenter);
      float core = smoothstep(0.22, 0.0, distanceFromCenter);
      float frontLight = smoothstep(0.04, 1.0, vFacing);
      float visibleSideLight = mix(0.24, 1.0, frontLight);
      float alpha = dotMask * vEdgeFade * visibleSideLight * mix(0.84, 1.0, vSeed);
      vec3 edgeColor = uInnerColor * 0.78;
      vec3 brightColor = mix(uInnerColor, uOuterColor, core * 0.82 + frontLight * 0.4);
      vec3 color = mix(edgeColor, brightColor, frontLight);

      if (alpha < 0.012) discard;
      gl_FragColor = vec4(color, alpha);
    }
  `;

  return (
    <group>
      <mesh>
        <sphereGeometry args={[GLOBE_RADIUS * 0.985, 96, 96]} />
        <meshBasicMaterial color="#020915" depthWrite />
      </mesh>

      <GlassyOceanIllumination />

      <SurfaceGrid />

      <points geometry={landGeometry}>
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
        <sphereGeometry args={[GLOBE_RADIUS * 1.01, 96, 96]} />
        <meshBasicMaterial color="#1f8fff" transparent opacity={0.04} depthWrite={false} />
      </mesh>

      <RimAtmosphere />
    </group>
  );
}

function SurfaceGrid() {
  const gridLines = useMemo(() => {
    const materialOptions = {
      color: "#2a9fff",
      transparent: true,
      opacity: 0.034,
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

function GlobeGroup({
  onDraggingChange,
  onInteractionStateChange,
  prefersReducedMotion,
}: GlobeInteractionProps) {
  const yawGroupRef = useRef<Group>(null);
  const tiltGroupRef = useRef<Group>(null);
  const isDraggingRef = useRef(false);
  const activePointerIdRef = useRef<number | null>(null);
  const activePointerTargetRef = useRef<Element | null>(null);
  const previousPointerRef = useRef<PointerPosition | null>(null);
  const angularVelocityRef = useRef<AngularVelocity>({ y: 0 });
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
    tiltGroupRef.current.rotation.z = DEFAULT_ROTATION_Z;

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
    autoRotationResumeDelayRef.current = Math.max(0, autoRotationResumeDelayRef.current - delta);

    const idleSpeed = prefersReducedMotion ? REDUCED_MOTION_IDLE_SPEED : IDLE_ROTATION_SPEED;
    if (autoRotationResumeDelayRef.current <= 0) {
      yawGroupRef.current.rotation.y += delta * idleSpeed * getIdleBlend(velocity.y);
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
      tiltGroupRef.current.rotation.x = clamp(
        tiltGroupRef.current.rotation.x + clampedDeltaY * VERTICAL_TILT_SENSITIVITY,
        MIN_INSPECTION_TILT,
        MAX_INSPECTION_TILT,
      );
      yawGroupRef.current.rotation.z = DEFAULT_ROTATION_Z;
      tiltGroupRef.current.rotation.z = DEFAULT_ROTATION_Z;

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
      if (GLOBE_DEBUG_MODE) return;

      event.stopPropagation();
      event.nativeEvent.preventDefault();

      isDraggingRef.current = true;
      activePointerIdRef.current = event.pointerId;
      activePointerTargetRef.current = event.nativeEvent.target as Element;
      activePointerTargetRef.current.setPointerCapture?.(event.pointerId);
      angularVelocityRef.current = { y: 0 };
      autoRotationResumeDelayRef.current = AUTO_ROTATION_RESUME_DELAY;
      if (yawGroupRef.current) yawGroupRef.current.rotation.z = DEFAULT_ROTATION_Z;
      if (tiltGroupRef.current) tiltGroupRef.current.rotation.z = DEFAULT_ROTATION_Z;
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
          <DigitalGlobeSurface />
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
      <DebugCameraTarget />
      <ambientLight intensity={0.42} />
      <directionalLight position={[4, 3, 5]} intensity={1.8} color="#8bc3ff" />
      <pointLight position={[-3, -1.5, 3]} intensity={2.1} color="#2b6dff" />
      <pointLight position={[0, 2.5, -4]} intensity={1} color="#2de8ff" />
      <GlobeGroup
        onDraggingChange={onDraggingChange}
        onInteractionStateChange={onInteractionStateChange}
        prefersReducedMotion={prefersReducedMotion}
      />
      <DebugCenteringGuides />
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
      className={`globe-section is-${interactionState}${isDragging ? " is-dragging" : ""}${
        GLOBE_DEBUG_MODE ? " is-debug" : ""
      }`}
      aria-label="Interactive dotted Earth globe"
    >
      <div className="globe-ambient" aria-hidden="true" />
      <div className="globe-stage">
        <Canvas
          className="globe-canvas"
          camera={{ position: [0, 0, 7.75], fov: 42 }}
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
