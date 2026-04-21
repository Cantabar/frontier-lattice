import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

interface GlowLayerProps {
  positions: Float32Array;
  glowMask: Float32Array;
  glowColor: THREE.Color;
}

export function GlowLayer({ positions, glowMask, glowColor }: GlowLayerProps) {
  const colorAttrRef = useRef<THREE.BufferAttribute | null>(null);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const colorBuffer = new Float32Array((positions.length / 3) * 3);
    const attr = new THREE.BufferAttribute(colorBuffer, 3);
    geo.setAttribute("color", attr);
    colorAttrRef.current = attr;
    return geo;
  }, [positions]);

  useEffect(() => () => { geometry.dispose(); }, [geometry]);

  useEffect(() => {
    const attr = colorAttrRef.current;
    if (!attr) return;
    const buf = attr.array as Float32Array;
    const count = glowMask.length;
    for (let i = 0; i < count; i++) {
      const m = glowMask[i];
      buf[i * 3]     = glowColor.r * m;
      buf[i * 3 + 1] = glowColor.g * m;
      buf[i * 3 + 2] = glowColor.b * m;
    }
    attr.needsUpdate = true;
  }, [glowMask, glowColor]);

  return (
    <points geometry={geometry}>
      <pointsMaterial
        vertexColors
        size={6}
        sizeAttenuation={false}
        blending={THREE.AdditiveBlending}
        transparent
        depthWrite={false}
      />
    </points>
  );
}
