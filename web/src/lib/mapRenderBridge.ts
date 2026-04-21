/**
 * Module-level mutable bridge for Three.js visual state.
 *
 * React context doesn't propagate reactively across R3F's custom reconciler
 * boundary (its-fine's Bridge bails out of re-rendering when props are
 * structurally stable). Components inside <Canvas> that need reactive updates
 * use useFrame to poll this bridge instead.
 */

export const mapRenderBridge = {
  finalStarColors: new Float32Array(0) as Float32Array,
  glowMask: null as Float32Array | null,
  colorsDirty: false,
  glowDirty: false,
};
