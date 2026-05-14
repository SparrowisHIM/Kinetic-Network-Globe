import { Canvas, type ThreeEvent, useFrame } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AdditiveBlending,
  BufferGeometry,
  Float32BufferAttribute,
  type Mesh,
  QuadraticBezierCurve3,
  TubeGeometry,
  Vector3,
  type Group,
} from "three";

const IDLE_ROTATION_SPEED = 0.045;
const GLOBE_DISPLAY_TILT = -0.18;
const HORIZONTAL_DRAG_SENSITIVITY = 0.006;
const VERTICAL_DRAG_SENSITIVITY = 0.003;
const MIN_VERTICAL_ROTATION = -0.72;
const MAX_VERTICAL_ROTATION = 0.48;
const MAX_HORIZONTAL_VELOCITY = 3.2;
const MAX_VERTICAL_VELOCITY = 1.25;
const VELOCITY_SMOOTHING = 0.35;
const MOMENTUM_FRICTION = 0.92;
const VERTICAL_MOMENTUM_FRICTION = 0.86;
const MOMENTUM_EPSILON = 0.0025;
const IDLE_BLEND_START_VELOCITY = 0.16;
const MAX_POINTER_DELTA = 80;
const MIN_POINTER_DELTA_TIME = 16;
const MAX_POINTER_DELTA_TIME = 80;
const GLOBE_DOT_COUNT = 5200;
const GLOBE_RADIUS = 1.62;
const DOT_POINT_SIZE = 3.8;
const ROUTE_RADIUS = GLOBE_RADIUS + 0.045;
const ROUTE_SEGMENTS = 96;
const ROUTE_LONGITUDE_OFFSET = 90;
const PULSE_LOOP_GAP = 0.48;
const PULSE_TRAIL_OFFSET = 0.055;

type GlobeGroupProps = {
  onDraggingChange: (isDragging: boolean) => void;
};

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
  x: number;
  y: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function dampVelocity(velocity: number, friction: number, delta: number) {
  return velocity * Math.pow(friction, delta * 60);
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

function createRouteCurve(route: GlobeRoute) {
  const start = latLngToSpherePosition(route.startLat, route.startLng);
  const end = latLngToSpherePosition(route.endLat, route.endLng);
  const angle = start.angleTo(end);
  const lift = clamp(0.14 + angle * 0.12, 0.18, 0.42);
  const middle = start.clone().add(end).normalize().multiplyScalar(ROUTE_RADIUS + lift);

  return new QuadraticBezierCurve3(start, middle, end);
}

function createRouteArcGeometry(route: GlobeRoute, curve: QuadraticBezierCurve3) {
  const tubeRadius = route.status === "primary" ? 0.009 : route.status === "active" ? 0.007 : 0.005;

  return new TubeGeometry(curve, ROUTE_SEGMENTS, tubeRadius, 8, false);
}

function createRouteArcAsset(route: GlobeRoute, index: number): RouteArcAsset {
  const curve = createRouteCurve(route);

  return {
    route,
    curve,
    geometry: createRouteArcGeometry(route, curve),
    pulseDuration: route.status === "primary" ? 3.6 + index * 0.08 : route.status === "active" ? 4.25 : 5.15,
    pulseDelay: index * 0.43 + (route.status === "quiet" ? 0.7 : 0),
  };
}

function getRouteOpacity(status: RouteStatus) {
  if (status === "primary") return 0.58;
  if (status === "active") return 0.42;
  return 0.26;
}

function getRouteGlowOpacity(status: RouteStatus) {
  if (status === "primary") return 0.18;
  if (status === "active") return 0.13;
  return 0.09;
}

function getPulseScale(status: RouteStatus) {
  if (status === "primary") return 0.034;
  if (status === "active") return 0.029;
  return 0.024;
}

function createGlobeDotGeometry() {
  const geometry = new BufferGeometry();
  const positions = new Float32Array(GLOBE_DOT_COUNT * 3);
  const seeds = new Float32Array(GLOBE_DOT_COUNT);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  for (let index = 0; index < GLOBE_DOT_COUNT; index += 1) {
    const y = 1 - (index / (GLOBE_DOT_COUNT - 1)) * 2;
    const radiusAtY = Math.sqrt(1 - y * y);
    const theta = index * goldenAngle;
    const positionIndex = index * 3;

    positions[positionIndex] = Math.cos(theta) * radiusAtY * GLOBE_RADIUS;
    positions[positionIndex + 1] = y * GLOBE_RADIUS;
    positions[positionIndex + 2] = Math.sin(theta) * radiusAtY * GLOBE_RADIUS;
    seeds[index] = (index % 17) / 17;
  }

  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("aSeed", new Float32BufferAttribute(seeds, 1));

  return geometry;
}

function RimAtmosphere() {
  const rimUniforms = useMemo(
    () => ({
      uGlowColor: { value: [0.35, 0.78, 1] },
    }),
    [],
  );

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
            varying float vRim;

            void main() {
              float rim = smoothstep(0.34, 1.0, vRim);
              float alpha = pow(rim, 2.4) * 0.34;
              gl_FragColor = vec4(uGlowColor, alpha);
            }
          `}
        />
      </mesh>

      <mesh scale={1.08}>
        <sphereGeometry args={[1.78, 128, 128]} />
        <meshBasicMaterial color="#2f9fff" transparent opacity={0.018} depthWrite={false} blending={AdditiveBlending} />
      </mesh>
    </group>
  );
}

function DigitalGlobeSurface() {
  const dotGeometry = useMemo(createGlobeDotGeometry, []);
  const dotUniforms = useMemo(
    () => ({
      uPointSize: { value: DOT_POINT_SIZE },
      uInnerColor: { value: [0.22, 0.67, 1] },
      uOuterColor: { value: [0.82, 0.95, 1] },
    }),
    [],
  );

  return (
    <group>
      <mesh>
        <sphereGeometry args={[1.56, 96, 96]} />
        <meshBasicMaterial color="#031021" />
      </mesh>

      <points geometry={dotGeometry}>
        <shaderMaterial
          transparent
          depthTest
          depthWrite={false}
          blending={AdditiveBlending}
          uniforms={dotUniforms}
          vertexShader={`
            attribute float aSeed;
            uniform float uPointSize;
            varying float vFacing;
            varying float vSeed;

            void main() {
              vec3 viewNormal = normalize(normalMatrix * normalize(position));
              vFacing = smoothstep(-0.08, 0.85, viewNormal.z);
              vSeed = aSeed;

              vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
              gl_Position = projectionMatrix * mvPosition;
              gl_PointSize = uPointSize * (5.2 / -mvPosition.z) * mix(0.75, 1.35, vFacing);
            }
          `}
          fragmentShader={`
            precision highp float;

            uniform vec3 uInnerColor;
            uniform vec3 uOuterColor;
            varying float vFacing;
            varying float vSeed;

            void main() {
              vec2 point = gl_PointCoord - vec2(0.5);
              float distanceFromCenter = length(point);
              float dotMask = smoothstep(0.5, 0.18, distanceFromCenter);
              float core = smoothstep(0.24, 0.0, distanceFromCenter);
              float alpha = dotMask * mix(0.06, 0.72, vFacing) * mix(0.72, 1.0, vSeed);
              vec3 color = mix(uInnerColor, uOuterColor, core * 0.85 + vFacing * 0.25);

              if (alpha < 0.01) discard;
              gl_FragColor = vec4(color, alpha);
            }
          `}
        />
      </points>

      <mesh>
        <sphereGeometry args={[1.69, 96, 96]} />
        <meshBasicMaterial color="#1f8fff" transparent opacity={0.06} depthWrite={false} />
      </mesh>

      <RimAtmosphere />
    </group>
  );
}

function RoutePulse({ asset }: { asset: RouteArcAsset }) {
  const coreRef = useRef<Mesh>(null);
  const glowRef = useRef<Mesh>(null);
  const trailRef = useRef<Mesh>(null);
  const baseScale = getPulseScale(asset.route.status);

  useFrame(({ clock }) => {
    const loopDuration = asset.pulseDuration + PULSE_LOOP_GAP;
    const loopTime = (clock.elapsedTime + asset.pulseDelay) % loopDuration;
    const progress = clamp(loopTime / asset.pulseDuration, 0, 1);
    const fadeIn = smoothstep(0, 0.09, progress);
    const fadeOut = 1 - smoothstep(0.84, 1, progress);
    const visibility = fadeIn * fadeOut;

    if (visibility <= 0) {
      if (coreRef.current) coreRef.current.visible = false;
      if (glowRef.current) glowRef.current.visible = false;
      if (trailRef.current) trailRef.current.visible = false;
      return;
    }

    const pulsePosition = asset.curve.getPointAt(progress);
    const trailPosition = asset.curve.getPointAt(clamp(progress - PULSE_TRAIL_OFFSET, 0, 1));
    const shimmer = 1 + Math.sin(clock.elapsedTime * 5.2 + asset.pulseDelay) * 0.08;

    if (coreRef.current) {
      coreRef.current.visible = true;
      coreRef.current.position.copy(pulsePosition);
      coreRef.current.scale.setScalar(baseScale * shimmer);
    }

    if (glowRef.current) {
      glowRef.current.visible = true;
      glowRef.current.position.copy(pulsePosition);
      glowRef.current.scale.setScalar(baseScale * 2.7 * shimmer);
    }

    if (trailRef.current) {
      trailRef.current.visible = true;
      trailRef.current.position.copy(trailPosition);
      trailRef.current.scale.setScalar(baseScale * 1.45 * visibility);
    }
  });

  return (
    <group>
      <mesh ref={trailRef}>
        <sphereGeometry args={[1, 16, 16]} />
        <meshBasicMaterial
          color="#6ad9ff"
          transparent
          opacity={0.18}
          depthTest
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>
      <mesh ref={glowRef}>
        <sphereGeometry args={[1, 18, 18]} />
        <meshBasicMaterial
          color="#58d5ff"
          transparent
          opacity={0.2}
          depthTest={false}
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>
      <mesh ref={coreRef}>
        <sphereGeometry args={[1, 18, 18]} />
        <meshBasicMaterial color="#d9fbff" transparent opacity={0.88} depthWrite={false} blending={AdditiveBlending} />
      </mesh>
    </group>
  );
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const x = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return x * x * (3 - 2 * x);
}

function RouteArcLayer() {
  const routeAssets = useMemo(() => GLOBAL_ROUTES.map(createRouteArcAsset), []);

  return (
    <group name="global-route-arc-layer">
      {routeAssets.map(({ route, geometry }) => (
        <group key={route.id}>
          <mesh geometry={geometry}>
            <meshBasicMaterial
              color="#4ebfff"
              transparent
              opacity={getRouteGlowOpacity(route.status)}
              depthTest={false}
              depthWrite={false}
              blending={AdditiveBlending}
            />
          </mesh>
          <mesh geometry={geometry}>
            <meshBasicMaterial
              color={route.status === "primary" ? "#b8f3ff" : "#5fc8ff"}
              transparent
              opacity={getRouteOpacity(route.status)}
              depthTest
              depthWrite={false}
              blending={AdditiveBlending}
            />
          </mesh>
        </group>
      ))}
      {routeAssets.map((asset) => (
        <RoutePulse key={`${asset.route.id}-pulse`} asset={asset} />
      ))}
    </group>
  );
}

function GlobeGroup({ onDraggingChange }: GlobeGroupProps) {
  const globeRef = useRef<Group>(null);
  const isDraggingRef = useRef(false);
  const activePointerIdRef = useRef<number | null>(null);
  const previousPointerRef = useRef<PointerPosition | null>(null);
  const angularVelocityRef = useRef<AngularVelocity>({ x: 0, y: 0 });

  useFrame((_, delta) => {
    if (!globeRef.current) return;
    if (isDraggingRef.current) return;

    const velocity = angularVelocityRef.current;
    const hasMomentum = Math.abs(velocity.y) > MOMENTUM_EPSILON || Math.abs(velocity.x) > MOMENTUM_EPSILON;

    if (hasMomentum) {
      globeRef.current.rotation.y += velocity.y * delta;
      globeRef.current.rotation.x = clamp(
        globeRef.current.rotation.x + velocity.x * delta,
        MIN_VERTICAL_ROTATION,
        MAX_VERTICAL_ROTATION,
      );

      if (
        globeRef.current.rotation.x === MIN_VERTICAL_ROTATION ||
        globeRef.current.rotation.x === MAX_VERTICAL_ROTATION
      ) {
        velocity.x = 0;
      }

      velocity.y = dampVelocity(velocity.y, MOMENTUM_FRICTION, delta);
      velocity.x = dampVelocity(velocity.x, VERTICAL_MOMENTUM_FRICTION, delta);
    } else {
      velocity.y = 0;
      velocity.x = 0;
    }

    globeRef.current.rotation.y += delta * IDLE_ROTATION_SPEED * getIdleBlend(velocity.y);
  });

  const stopDrag = useCallback(() => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    activePointerIdRef.current = null;
    previousPointerRef.current = null;
    onDraggingChange(false);
  }, [onDraggingChange]);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      if (!isDraggingRef.current) return;
      if (activePointerIdRef.current !== event.pointerId) return;
      if (!globeRef.current || !previousPointerRef.current) return;

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

      globeRef.current.rotation.y += clampedDeltaX * HORIZONTAL_DRAG_SENSITIVITY;
      globeRef.current.rotation.x = clamp(
        globeRef.current.rotation.x + clampedDeltaY * VERTICAL_DRAG_SENSITIVITY,
        MIN_VERTICAL_ROTATION,
        MAX_VERTICAL_ROTATION,
      );

      const velocityScale = 1000 / deltaTime;
      const nextVelocityY = clamp(
        clampedDeltaX * HORIZONTAL_DRAG_SENSITIVITY * velocityScale,
        -MAX_HORIZONTAL_VELOCITY,
        MAX_HORIZONTAL_VELOCITY,
      );
      const nextVelocityX = clamp(
        clampedDeltaY * VERTICAL_DRAG_SENSITIVITY * velocityScale,
        -MAX_VERTICAL_VELOCITY,
        MAX_VERTICAL_VELOCITY,
      );

      angularVelocityRef.current.y += (nextVelocityY - angularVelocityRef.current.y) * VELOCITY_SMOOTHING;
      angularVelocityRef.current.x += (nextVelocityX - angularVelocityRef.current.x) * VELOCITY_SMOOTHING;

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
  }, [stopDrag]);

  const handlePointerDown = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
      event.nativeEvent.preventDefault();

      isDraggingRef.current = true;
      activePointerIdRef.current = event.pointerId;
      angularVelocityRef.current = { x: 0, y: 0 };
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
      ref={globeRef}
      name="main-globe-rotation-group"
      rotation={[GLOBE_DISPLAY_TILT, 0, 0]}
      onPointerDown={handlePointerDown}
    >
      <DigitalGlobeSurface />
      <RouteArcLayer />
    </group>
  );
}

function GlobeScene({ onDraggingChange }: GlobeGroupProps) {
  return (
    <>
      <ambientLight intensity={0.42} />
      <directionalLight position={[4, 3, 5]} intensity={1.8} color="#8bc3ff" />
      <pointLight position={[-3, -1.5, 3]} intensity={2.1} color="#2b6dff" />
      <pointLight position={[0, 2.5, -4]} intensity={1} color="#2de8ff" />
      <GlobeGroup onDraggingChange={onDraggingChange} />
    </>
  );
}

export function GlobeComponent() {
  const [isDragging, setIsDragging] = useState(false);

  return (
    <section className={`globe-section${isDragging ? " is-dragging" : ""}`} aria-label="Kinetic network globe">
      <div className="globe-ambient" aria-hidden="true" />
      <div className="globe-stage">
        <Canvas
          className="globe-canvas"
          camera={{ position: [0, 0, 5.2], fov: 42 }}
          dpr={[1, 1.75]}
          gl={{ antialias: true, alpha: true }}
        >
          <GlobeScene onDraggingChange={setIsDragging} />
        </Canvas>
      </div>
    </section>
  );
}
