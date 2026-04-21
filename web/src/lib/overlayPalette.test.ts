import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { assignCategoricalColors, gradientColor } from "./overlayPalette";

// ── fixtures ─────────────────────────────────────────────────────────────────

const BLUE = new THREE.Color(0, 0, 1);
const RED = new THREE.Color(1, 0, 0);

// ── assignCategoricalColors ───────────────────────────────────────────────────

describe("assignCategoricalColors", () => {
  it("returns a color for every input category id", () => {
    const ids = [10, 20, 30];
    const adjacency = new Map<number, number[]>();
    const result = assignCategoricalColors(ids, adjacency);
    expect(result.size).toBe(3);
    for (const id of ids) {
      expect(result.has(id)).toBe(true);
      expect(result.get(id)).toBeInstanceOf(THREE.Color);
    }
  });

  it("assigns no two adjacent categories the same color", () => {
    // Triangle graph: every pair is adjacent — requires 3 distinct colors
    const ids = [1, 2, 3];
    const adjacency = new Map([
      [1, [2, 3]],
      [2, [1, 3]],
      [3, [1, 2]],
    ]);
    const result = assignCategoricalColors(ids, adjacency);
    for (const [id, neighbors] of adjacency) {
      const color = result.get(id)!;
      for (const neighborId of neighbors) {
        expect(color.getHex()).not.toBe(result.get(neighborId)!.getHex());
      }
    }
  });

  it("is deterministic — identical input always produces the same color assignment", () => {
    const ids = [1, 2, 3, 4, 5];
    const adjacency = new Map([
      [1, [2]],
      [2, [1, 3]],
      [3, [2, 4]],
      [4, [3, 5]],
      [5, [4]],
    ]);
    const r1 = assignCategoricalColors(ids, adjacency);
    const r2 = assignCategoricalColors(ids, adjacency);
    for (const id of ids) {
      expect(r1.get(id)!.getHex()).toBe(r2.get(id)!.getHex());
    }
  });

  it("cycles the palette without throwing when categories exceed palette size", () => {
    const ids = Array.from({ length: 30 }, (_, i) => i + 1);
    const adjacency = new Map<number, number[]>();
    expect(() => assignCategoricalColors(ids, adjacency)).not.toThrow();
    const result = assignCategoricalColors(ids, adjacency);
    expect(result.size).toBe(30);
  });

  it("returns an empty map for empty input", () => {
    expect(assignCategoricalColors([], new Map()).size).toBe(0);
  });

  it("processes categories in ascending numeric id order", () => {
    // Out-of-order input should produce the same result as sorted input
    const ids = [30, 10, 20];
    const sortedIds = [10, 20, 30];
    const adjacency = new Map<number, number[]>();
    const r1 = assignCategoricalColors(ids, adjacency);
    const r2 = assignCategoricalColors(sortedIds, adjacency);
    expect(r1.get(10)!.getHex()).toBe(r2.get(10)!.getHex());
    expect(r1.get(20)!.getHex()).toBe(r2.get(20)!.getHex());
    expect(r1.get(30)!.getHex()).toBe(r2.get(30)!.getHex());
  });
});

// ── gradientColor ─────────────────────────────────────────────────────────────

describe("gradientColor", () => {
  it("returns the 'from' color when value equals min", () => {
    const result = gradientColor(0, 0, 10, BLUE, RED);
    expect(result.r).toBeCloseTo(BLUE.r, 3);
    expect(result.g).toBeCloseTo(BLUE.g, 3);
    expect(result.b).toBeCloseTo(BLUE.b, 3);
  });

  it("returns the 'to' color when value equals max", () => {
    const result = gradientColor(10, 0, 10, BLUE, RED);
    expect(result.r).toBeCloseTo(RED.r, 3);
    expect(result.g).toBeCloseTo(RED.g, 3);
    expect(result.b).toBeCloseTo(RED.b, 3);
  });

  it("returns the midpoint color when value is halfway between min and max", () => {
    const result = gradientColor(5, 0, 10, BLUE, RED);
    expect(result.r).toBeCloseTo(0.5, 3);
    expect(result.b).toBeCloseTo(0.5, 3);
  });

  it("clamps values below min to the 'from' color", () => {
    const result = gradientColor(-99, 0, 10, BLUE, RED);
    expect(result.r).toBeCloseTo(BLUE.r, 3);
    expect(result.b).toBeCloseTo(BLUE.b, 3);
  });

  it("clamps values above max to the 'to' color", () => {
    const result = gradientColor(999, 0, 10, BLUE, RED);
    expect(result.r).toBeCloseTo(RED.r, 3);
    expect(result.b).toBeCloseTo(RED.b, 3);
  });

  it("does not mutate the 'from' or 'to' input colors", () => {
    const fromR = BLUE.r;
    const toR = RED.r;
    gradientColor(5, 0, 10, BLUE, RED);
    expect(BLUE.r).toBe(fromR);
    expect(RED.r).toBe(toR);
  });
});
