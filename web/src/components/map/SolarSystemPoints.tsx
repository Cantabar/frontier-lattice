import { useEffect, useMemo, useRef } from "react";
import { ThreeEvent, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useMapContext } from "../../contexts/MapContext";

export function SolarSystemPoints() {
  const { positions, ids, idToIndex, finalStarColors, setSelectedId } = useMapContext();
  const { raycaster } = useThree();
  const colorAttrRef = useRef<THREE.BufferAttribute | null>(null);

  useEffect(() => {
    raycaster.params.Points = { threshold: 50 };
  }, [raycaster]);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const colorBuffer = new Float32Array(positions.length).fill(1);
    const colorAttr = new THREE.BufferAttribute(colorBuffer, 3);
    geo.setAttribute("color", colorAttr);
    colorAttrRef.current = colorAttr;
    return geo;
  }, [positions]);

  useEffect(() => () => { geometry.dispose(); }, [geometry]);

  useEffect(() => {
    const attr = colorAttrRef.current;
    if (!attr) return;
    (attr.array as Float32Array).set(finalStarColors);
    attr.needsUpdate = true;
  }, [finalStarColors]);

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
