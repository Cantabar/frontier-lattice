import type { ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { SolarSystemPoints } from "./SolarSystemPoints";
import { SelectionIndicator } from "./SelectionIndicator";

interface GalaxyMapProps {
  positions: Float32Array;
  ids: number[];
  idToIndex: Map<number, number>;
  selectedId: number | null;
  onSelect: (id: number) => void;
  sceneOverlays?: ReactNode;
  hudOverlays?: ReactNode;
}

export function GalaxyMap({
  positions,
  ids,
  idToIndex,
  selectedId,
  onSelect,
  sceneOverlays,
  hudOverlays,
}: GalaxyMapProps) {
  return (
    <div style={{ width: "100%", height: "100%" }}>
      <Canvas camera={{ position: [0, 0, 15000], fov: 60 }}>
        <ambientLight intensity={0.5} />
        <OrbitControls enableDamping />
        <SolarSystemPoints positions={positions} ids={ids} onSelect={onSelect} />
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
