import { type ReactNode, type Ref, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { SolarSystemPoints } from "./SolarSystemPoints";
import { SelectionIndicator } from "./SelectionIndicator";
import { CameraController } from "./CameraController";

interface GalaxyMapProps {
  positions: Float32Array;
  ids: number[];
  idToIndex: Map<number, number>;
  selectedId: number | null;
  onSelect: (id: number) => void;
  overlayColors?: Float32Array | null;
  sceneOverlays?: ReactNode;
  hudOverlays?: ReactNode;
}

export function GalaxyMap({
  positions,
  ids,
  idToIndex,
  selectedId,
  onSelect,
  overlayColors,
  sceneOverlays,
  hudOverlays,
}: GalaxyMapProps) {
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  return (
    <div style={{ width: "100%", height: "100%" }}>
      <Canvas camera={{ position: [0, 0, 15000], fov: 60, near: 1, far: 200000 }}>
        <ambientLight intensity={0.5} />
        <OrbitControls ref={controlsRef as Ref<OrbitControlsImpl>} enableDamping />
        <CameraController selectedId={selectedId} positions={positions} idToIndex={idToIndex} controlsRef={controlsRef} />
        <SolarSystemPoints positions={positions} ids={ids} onSelect={onSelect} selectedId={selectedId} overlayColors={overlayColors} />
        <SelectionIndicator
          positions={positions}
          idToIndex={idToIndex}
          selectedId={selectedId}
        />
        {sceneOverlays}
      </Canvas>
      {hudOverlays}
    </div>
  );
}
