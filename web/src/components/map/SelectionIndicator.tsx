import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useMapContext } from "../../contexts/MapContext";

export function SelectionIndicator() {
  const { positions, idToIndex, selectedId } = useMapContext();

  if (selectedId === null) return null;

  const idx = idToIndex.get(selectedId);
  if (idx === undefined) return null;

  const x = positions[idx * 3];
  const y = positions[idx * 3 + 1];
  const z = positions[idx * 3 + 2];

  return <TorusRing x={x} y={y} z={z} />;
}

interface TorusRingProps {
  x: number;
  y: number;
  z: number;
}

function TorusRing({ x, y, z }: TorusRingProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const { camera } = useThree();
  const starWorldPos = useMemo(() => new THREE.Vector3(x, y, z), [x, y, z]);

  useFrame(() => {
    if (meshRef.current) {
      meshRef.current.quaternion.copy(camera.quaternion);
      const dist = camera.position.distanceTo(starWorldPos);
      meshRef.current.scale.setScalar(dist * 0.008);
    }
  });

  return (
    <mesh ref={meshRef} position={[x, y, z]}>
      <torusGeometry args={[1, 0.06, 8, 48]} />
      <meshBasicMaterial color="#00e5ff" />
    </mesh>
  );
}
