import { Canvas, useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group } from "three";

const IDLE_ROTATION_SPEED = 0.045;
const GLOBE_DISPLAY_TILT = -0.18;

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

function GlobeGroup() {
  const globeRef = useRef<Group>(null);

  useFrame((_, delta) => {
    if (!globeRef.current) return;
    globeRef.current.rotation.y += delta * IDLE_ROTATION_SPEED;
    globeRef.current.rotation.x = GLOBE_DISPLAY_TILT;
  });

  return (
    <group ref={globeRef} name="main-globe-rotation-group">
      <PlaceholderGlobe />
    </group>
  );
}

function GlobeScene() {
  return (
    <>
      <ambientLight intensity={0.42} />
      <directionalLight position={[4, 3, 5]} intensity={1.8} color="#8bc3ff" />
      <pointLight position={[-3, -1.5, 3]} intensity={2.1} color="#2b6dff" />
      <pointLight position={[0, 2.5, -4]} intensity={1} color="#2de8ff" />
      <GlobeGroup />
    </>
  );
}

export function GlobeComponent() {
  return (
    <section className="globe-section" aria-label="Kinetic network globe">
      <div className="globe-ambient" aria-hidden="true" />
      <div className="globe-stage">
        <Canvas
          className="globe-canvas"
          camera={{ position: [0, 0, 5.2], fov: 42 }}
          dpr={[1, 1.75]}
          gl={{ antialias: true, alpha: true }}
        >
          <GlobeScene />
        </Canvas>
      </div>
    </section>
  );
}
