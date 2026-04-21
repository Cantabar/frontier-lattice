import { useEffect, useRef } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useMapContext } from "../../contexts/MapContext";

const FLY_DURATION_MS = 800;

interface CameraControllerProps {
  controlsRef: React.RefObject<OrbitControlsImpl | null>;
}

export function CameraController({ controlsRef }: CameraControllerProps) {
  const { selectedId, positions, idToIndex } = useMapContext();
  const { camera } = useThree();

  const startTargetRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const endTargetRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const startOffsetRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const startTimeRef = useRef<number>(0);
  const animatingRef = useRef<boolean>(false);

  useEffect(() => {
    if (selectedId === null) return;
    const controls = controlsRef.current;
    if (!controls) return;

    const idx = idToIndex.get(selectedId);
    if (idx === undefined) return;

    const ex = positions[idx * 3];
    const ey = positions[idx * 3 + 1];
    const ez = positions[idx * 3 + 2];

    startTargetRef.current.copy(controls.target);
    endTargetRef.current.set(ex, ey, ez);
    startOffsetRef.current.copy(camera.position).sub(controls.target);
    startTimeRef.current = performance.now();
    controls.enableDamping = false;
    animatingRef.current = true;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- positions/idToIndex/camera/controlsRef are stable after mount; re-triggering on them would restart the animation unexpectedly
  }, [selectedId]);

  useFrame(() => {
    if (!animatingRef.current) return;
    const controls = controlsRef.current;
    if (!controls) return;

    const elapsed = performance.now() - startTimeRef.current;
    const raw = Math.min(elapsed / FLY_DURATION_MS, 1);
    const t =
      raw < 0.5
        ? 4 * raw * raw * raw
        : 1 - Math.pow(-2 * raw + 2, 3) / 2;

    controls.target.lerpVectors(startTargetRef.current, endTargetRef.current, t);
    camera.position.copy(controls.target).add(startOffsetRef.current);
    controls.update();

    if (raw >= 1) {
      controls.enableDamping = true;
      animatingRef.current = false;
    }
  });

  return null;
}
