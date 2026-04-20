import { useEffect, useMemo } from "react";
import { ThreeEvent, useThree } from "@react-three/fiber";
import * as THREE from "three";

interface SolarSystemPointsProps {
  positions: Float32Array;
  ids: number[];
  onSelect: (id: number) => void;
}

export function SolarSystemPoints({
  positions,
  ids,
  onSelect,
}: SolarSystemPointsProps) {
  const { raycaster } = useThree();

  useEffect(() => {
    raycaster.params.Points = { threshold: 50 };
  }, [raycaster]);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const attribute = new THREE.BufferAttribute(positions, 3);
    geo.setAttribute("position", attribute);
    return geo;
  }, [positions]);

  useEffect(() => {
    return () => { geometry.dispose(); };
  }, [geometry]);

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (event.intersections.length === 0) return;
    const index = event.intersections[0].index;
    if (index === undefined) return;
    onSelect(ids[index]);
  };

  return (
    <points geometry={geometry} onClick={handleClick}>
      <pointsMaterial color="white" size={0.5} sizeAttenuation={true} />
    </points>
  );
}
