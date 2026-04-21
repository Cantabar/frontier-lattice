import { useEffect, useLayoutEffect, useMemo } from "react";
import { ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useMapContext } from "../../contexts/MapContext";
import { mapRenderBridge } from "../../lib/mapRenderBridge";

export function SolarSystemPoints() {
  const { positions, ids, setSelectedId } = useMapContext();
  const { raycaster } = useThree();

  useEffect(() => {
    raycaster.params.Points = { threshold: 50 };
  }, [raycaster]);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const colorBuffer = new Float32Array(positions.length).fill(1);
    geo.setAttribute("color", new THREE.BufferAttribute(colorBuffer, 3));
    return geo;
  }, [positions]);

  useEffect(() => () => { geometry.dispose(); }, [geometry]);

  // Apply current bridge colors on mount/remount so conditional scene changes don't leave stars white.
  useLayoutEffect(() => {
    const attr = geometry.getAttribute("color") as THREE.BufferAttribute;
    const colors = mapRenderBridge.finalStarColors;
    if (colors.length === 0) return;
    (attr.array as Float32Array).set(colors);
    attr.needsUpdate = true;
  }, [geometry]);

  useFrame(() => {
    if (!mapRenderBridge.colorsDirty) return;
    const attr = geometry.getAttribute("color") as THREE.BufferAttribute;
    const colors = mapRenderBridge.finalStarColors;
    if (colors.length === 0) return;
    (attr.array as Float32Array).set(colors);
    attr.needsUpdate = true;
    mapRenderBridge.colorsDirty = false;
  });

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (event.intersections.length === 0) return;
    const index = event.intersections[0].index;
    if (index === undefined) return;
    setSelectedId(ids[index]);
  };

  return (
    <points geometry={geometry} onClick={handleClick}>
      <pointsMaterial vertexColors={true} size={2} sizeAttenuation={false} />
    </points>
  );
}
