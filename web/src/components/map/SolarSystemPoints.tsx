import { useEffect, useMemo, useRef } from "react";
import { ThreeEvent, useThree } from "@react-three/fiber";
import * as THREE from "three";

interface SolarSystemPointsProps {
  positions: Float32Array;
  ids: number[];
  onSelect: (id: number) => void;
  selectedId?: number | null;
}

export function SolarSystemPoints({
  positions,
  ids,
  onSelect,
  selectedId = null,
}: SolarSystemPointsProps) {
  const { raycaster } = useThree();
  const colorAttrRef = useRef<THREE.BufferAttribute | null>(null);
  const prevIdRef = useRef<number | null>(null);

  useEffect(() => {
    raycaster.params.Points = { threshold: 50 };
  }, [raycaster]);

  const idToIndex = useMemo(() => {
    const map = new Map<number, number>();
    ids.forEach((id, i) => map.set(id, i));
    return map;
  }, [ids]);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const attribute = new THREE.BufferAttribute(positions, 3);
    geo.setAttribute("position", attribute);

    const colorBuffer = new Float32Array(positions.length).fill(1);
    const colorAttr = new THREE.BufferAttribute(colorBuffer, 3);
    geo.setAttribute("color", colorAttr);
    colorAttrRef.current = colorAttr;

    return geo;
  }, [positions]);

  useEffect(() => {
    return () => { geometry.dispose(); };
  }, [geometry]);

  useEffect(() => {
    const colorAttr = colorAttrRef.current;
    if (!colorAttr) return;
    const colorBuffer = colorAttr.array as Float32Array;

    if (prevIdRef.current !== null) {
      const prevIdx = idToIndex.get(prevIdRef.current);
      if (prevIdx !== undefined) {
        colorBuffer[prevIdx * 3] = 1;
        colorBuffer[prevIdx * 3 + 1] = 1;
        colorBuffer[prevIdx * 3 + 2] = 1;
      }
    }

    if (selectedId !== null && selectedId !== undefined) {
      const idx = idToIndex.get(selectedId);
      if (idx !== undefined) {
        colorBuffer[idx * 3] = 1;
        colorBuffer[idx * 3 + 1] = 0.84;
        colorBuffer[idx * 3 + 2] = 0;
      }
    }

    colorAttr.needsUpdate = true;
    prevIdRef.current = selectedId ?? null;
  }, [selectedId, idToIndex]);

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (event.intersections.length === 0) return;
    const index = event.intersections[0].index;
    if (index === undefined) return;
    onSelect(ids[index]);
  };

  return (
    <points geometry={geometry} onClick={handleClick}>
      <pointsMaterial vertexColors={true} size={2} />
    </points>
  );
}
