import { Canvas, type ThreeEvent, useFrame } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdditiveBlending, BufferGeometry, Float32BufferAttribute, type Group } from "three";

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

type GlobeGroupProps = {
  onDraggingChange: (isDragging: boolean) => void;
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
