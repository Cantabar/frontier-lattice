import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useMapContext } from "../../contexts/MapContext";
import { ACCENT_COLOR } from "../../lib/overlayPalette";
import { mapRenderBridge } from "../../lib/mapRenderBridge";

export function GlowLayer() {
  const { positions } = useMapContext();

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const colorBuffer = new Float32Array(positions.length);
    geo.setAttribute("color", new THREE.BufferAttribute(colorBuffer, 3));
    return geo;
  }, [positions]);

  useEffect(() => () => { geometry.dispose(); }, [geometry]);

  useFrame(() => {
    if (!mapRenderBridge.glowDirty) return;
    const glowMask = mapRenderBridge.glowMask;
    if (!glowMask) return;
    const attr = geometry.getAttribute("color") as THREE.BufferAttribute;
    const buf = attr.array as Float32Array;
    for (let i = 0; i < glowMask.length; i++) {
      const m = glowMask[i];
      buf[i * 3]     = ACCENT_COLOR.r * m;
      buf[i * 3 + 1] = ACCENT_COLOR.g * m;
      buf[i * 3 + 2] = ACCENT_COLOR.b * m;
    }
    attr.needsUpdate = true;
    mapRenderBridge.glowDirty = false;
  });

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
