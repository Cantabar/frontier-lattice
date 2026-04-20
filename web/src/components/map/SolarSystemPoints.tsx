import { useEffect, useMemo, useRef } from "react";
import { ThreeEvent, useThree } from "@react-three/fiber";
import * as THREE from "three";

interface SolarSystemPointsProps {
  positions: Float32Array;
  ids: number[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}

export function SolarSystemPoints({
  positions,
  ids,
  onSelect,
}: SolarSystemPointsProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const { raycaster } = useThree();

  useEffect(() => {
    raycaster.params.Points = { threshold: 1.5 };
  }, [raycaster]);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const attribute = new THREE.BufferAttribute(positions, 3);
    attribute.needsUpdate = false;
    geo.setAttribute("position", attribute);
    return geo;
  }, [positions]);

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (event.intersections.length === 0) return;
    const index = event.intersections[0].index;
    if (index === undefined) return;
    onSelect(ids[index]);
  };

  return (
    <points ref={pointsRef} geometry={geometry} onClick={handleClick}>
      <pointsMaterial color="white" size={0.5} sizeAttenuation={true} />
    </points>
  );
}
