import { Canvas, type ThreeEvent, useFrame } from "@react-three/fiber";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Group } from "three";

const IDLE_ROTATION_SPEED = 0.045;
const GLOBE_DISPLAY_TILT = -0.18;
const HORIZONTAL_DRAG_SENSITIVITY = 0.006;
const VERTICAL_DRAG_SENSITIVITY = 0.003;
const MIN_VERTICAL_ROTATION = -0.72;
const MAX_VERTICAL_ROTATION = 0.48;

type GlobeGroupProps = {
  onDraggingChange: (isDragging: boolean) => void;
};

type PointerPosition = {
  x: number;
  y: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function PlaceholderGlobe() {
  return (
    <group>
      <mesh>
        <sphereGeometry args={[1.6, 96, 96]} />
        <meshBasicMaterial color="#123c68" />
      </mesh>

      <mesh>
        <sphereGeometry args={[1.605, 48, 48]} />
        <meshBasicMaterial color="#66d6ff" wireframe transparent opacity={0.34} />
      </mesh>

      <mesh>
        <sphereGeometry args={[1.68, 96, 96]} />
        <meshBasicMaterial color="#1f8fff" transparent opacity={0.13} />
      </mesh>
    </group>
  );
}

function GlobeGroup({ onDraggingChange }: GlobeGroupProps) {
  const globeRef = useRef<Group>(null);
  const isDraggingRef = useRef(false);
  const activePointerIdRef = useRef<number | null>(null);
  const previousPointerRef = useRef<PointerPosition | null>(null);

  useFrame((_, delta) => {
    if (!globeRef.current) return;
    if (isDraggingRef.current) return;
    globeRef.current.rotation.y += delta * IDLE_ROTATION_SPEED;
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

      globeRef.current.rotation.y += deltaX * HORIZONTAL_DRAG_SENSITIVITY;
      globeRef.current.rotation.x = clamp(
        globeRef.current.rotation.x + deltaY * VERTICAL_DRAG_SENSITIVITY,
        MIN_VERTICAL_ROTATION,
        MAX_VERTICAL_ROTATION,
      );

      previousPointerRef.current = {
        x: event.clientX,
        y: event.clientY,
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
      previousPointerRef.current = {
        x: event.clientX,
        y: event.clientY,
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
      <PlaceholderGlobe />
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
