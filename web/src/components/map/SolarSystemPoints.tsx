import { useEffect, useMemo, useRef } from "react";
import { ThreeEvent, useThree } from "@react-three/fiber";
import * as THREE from "three";

const GOLD: [number, number, number] = [1, 0.84, 0];
const WHITE: [number, number, number] = [1, 1, 1];

interface SolarSystemPointsProps {
  positions: Float32Array;
  ids: number[];
  onSelect: (id: number) => void;
  selectedId?: number | null;
  overlayColors?: Float32Array | null;
}

export function SolarSystemPoints({
  positions,
  ids,
  onSelect,
  selectedId = null,
  overlayColors = null,
}: SolarSystemPointsProps) {
  const { raycaster } = useThree();
  const colorAttrRef = useRef<THREE.BufferAttribute | null>(null);
  const prevIdRef = useRef<number | null>(null);
  const restoreColorRef = useRef<[number, number, number]>(WHITE);

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

  // Apply overlay colors to the full buffer whenever the overlay changes.
  useEffect(() => {
    const colorAttr = colorAttrRef.current;
    if (!colorAttr) return;
    const buf = colorAttr.array as Float32Array;

    if (overlayColors) {
      buf.set(overlayColors);
    } else {
      buf.fill(1);
    }

    // Re-apply gold highlight if a system is still selected.
    if (selectedId !== null && selectedId !== undefined) {
      const idx = idToIndex.get(selectedId);
      if (idx !== undefined) {
        // Capture the new underlying color for this system before overwriting.
        restoreColorRef.current = overlayColors
          ? [overlayColors[idx * 3], overlayColors[idx * 3 + 1], overlayColors[idx * 3 + 2]]
          : WHITE;
        buf[idx * 3]     = GOLD[0];
        buf[idx * 3 + 1] = GOLD[1];
        buf[idx * 3 + 2] = GOLD[2];
      }
    }

    colorAttr.needsUpdate = true;
  }, [overlayColors, idToIndex, selectedId]);

  // Apply gold highlight when the selected system changes.
  useEffect(() => {
    const colorAttr = colorAttrRef.current;
    if (!colorAttr) return;
    const buf = colorAttr.array as Float32Array;

    // Restore previous selection.
    if (prevIdRef.current !== null) {
      const prevIdx = idToIndex.get(prevIdRef.current);
      if (prevIdx !== undefined) {
        const [r, g, b] = restoreColorRef.current;
        buf[prevIdx * 3]     = r;
        buf[prevIdx * 3 + 1] = g;
        buf[prevIdx * 3 + 2] = b;
      }
    }

    // Highlight new selection, capturing restore color first.
    if (selectedId !== null && selectedId !== undefined) {
      const idx = idToIndex.get(selectedId);
      if (idx !== undefined) {
        restoreColorRef.current = overlayColors
          ? [overlayColors[idx * 3], overlayColors[idx * 3 + 1], overlayColors[idx * 3 + 2]]
          : WHITE;
        buf[idx * 3]     = GOLD[0];
        buf[idx * 3 + 1] = GOLD[1];
        buf[idx * 3 + 2] = GOLD[2];
      }
    }

    colorAttr.needsUpdate = true;
    prevIdRef.current = selectedId ?? null;
  }, [selectedId, idToIndex, overlayColors]);

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (event.intersections.length === 0) return;
    const index = event.intersections[0].index;
    if (index === undefined) return;
    onSelect(ids[index]);
  };

  return (
    <points geometry={geometry} onClick={handleClick}>
      <pointsMaterial vertexColors={true} size={2} sizeAttenuation={false} />
    </points>
  );
}
