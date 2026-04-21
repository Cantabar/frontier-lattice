import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useMapContext } from "../../contexts/MapContext";
import { ACCENT_COLOR } from "../../lib/overlayPalette";

export function GlowLayer() {
  const { positions, glowMask } = useMapContext();
  const colorAttrRef = useRef<THREE.BufferAttribute | null>(null);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const colorBuffer = new Float32Array(positions.length);
    const attr = new THREE.BufferAttribute(colorBuffer, 3);
    geo.setAttribute("color", attr);
    colorAttrRef.current = attr;
    return geo;
  }, [positions]);

  useEffect(() => () => { geometry.dispose(); }, [geometry]);

  useEffect(() => {
    const attr = colorAttrRef.current;
    if (!attr || !glowMask) return;
    const buf = attr.array as Float32Array;
    for (let i = 0; i < glowMask.length; i++) {
      const m = glowMask[i];
      buf[i * 3]     = ACCENT_COLOR.r * m;
      buf[i * 3 + 1] = ACCENT_COLOR.g * m;
      buf[i * 3 + 2] = ACCENT_COLOR.b * m;
    }
    attr.needsUpdate = true;
  }, [glowMask]);

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
