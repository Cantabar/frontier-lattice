import { type ReactNode, type Ref, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { SolarSystemPoints } from "./SolarSystemPoints";
import { SelectionIndicator } from "./SelectionIndicator";
import { CameraController } from "./CameraController";

interface GalaxyMapProps {
  sceneOverlays?: ReactNode;
  hudOverlays?: ReactNode;
}

export function GalaxyMap({ sceneOverlays, hudOverlays }: GalaxyMapProps) {
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  return (
    <div style={{ width: "100%", height: "100%" }}>
      <Canvas camera={{ position: [0, 0, 15000], fov: 60, near: 1, far: 200000 }}>
        <ambientLight intensity={0.5} />
        <OrbitControls ref={controlsRef as Ref<OrbitControlsImpl>} enableDamping />
        <CameraController controlsRef={controlsRef} />
        <SolarSystemPoints />
        <SelectionIndicator />
        {sceneOverlays}
      </Canvas>
      {hudOverlays}
    </div>
  );
}
