import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useMapContext } from "../../contexts/MapContext";
import { ACCENT_COLOR } from "../../lib/overlayPalette";

export function DensityGradientLayer() {
  const { positions, densityMask } = useMapContext();

  const texture = useMemo(() => {
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(canvas);
  }, []);

  useEffect(() => () => { texture.dispose(); }, [texture]);

  const geometry = useMemo(() => {
    const qualifying: number[] = [];
    if (densityMask) {
      for (let i = 0; i < densityMask.length; i++) {
        if (densityMask[i] > 0.5) {
          qualifying.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(qualifying), 3));
    return geo;
  }, [positions, densityMask]);

  useEffect(() => () => { geometry.dispose(); }, [geometry]);

  return (
    <points geometry={geometry}>
      <pointsMaterial
        color={ACCENT_COLOR}
        size={2000}
        sizeAttenuation
        map={texture}
        blending={THREE.AdditiveBlending}
        transparent
        depthWrite={false}
        opacity={0.15}
      />
    </points>
  );
}
