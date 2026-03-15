import { useEffect, useState, useMemo } from "react";
import type { RecipeData } from "../lib/types";

export interface BlueprintOutput {
  typeId: number;
  quantity: number;
}

export interface BlueprintInput {
  typeId: number;
  quantity: number;
}

export interface BlueprintFacility {
  facilityTypeId: number;
  facilityName: string;
  facilityFamily: string;
}

export interface BlueprintEntry {
  blueprintId: number;
  primaryTypeId: number;
  primaryName: string;
  primaryIcon: string | null;
  primaryCategoryName: string | null;
  primaryGroupName: string | null;
  primaryMetaGroupName: string | null;
  slotType: "high" | "mid" | "low" | "engine" | null;
  sizeClass: "small" | "medium" | "large" | null;
  runTime: number;
  outputs: BlueprintOutput[];
  inputs: BlueprintInput[];
  facilities: BlueprintFacility[];
}

let cache: BlueprintEntry[] | null = null;
let cachePromise: Promise<BlueprintEntry[]> | null = null;

function fetchBlueprints(): Promise<BlueprintEntry[]> {
  if (cache) return Promise.resolve(cache);
  if (!cachePromise) {
    cachePromise = fetch("/blueprints.json")
      .then((r) => r.json())
      .then((data: BlueprintEntry[]) => {
        cache = data;
        return data;
      });
  }
  return cachePromise;
}

export function useBlueprints() {
  const [blueprints, setBlueprints] = useState<BlueprintEntry[]>(cache ?? []);

  useEffect(() => {
    if (cache) {
      setBlueprints(cache);
      return;
    }
    fetchBlueprints().then(setBlueprints);
  }, []);

  function getBlueprint(blueprintId: number): BlueprintEntry | undefined {
    return blueprints.find((b) => b.blueprintId === blueprintId);
  }

  /**
   * Convert blueprints into RecipeData[] for the optimizer.
   * When multiple blueprints produce the same output, only the first is kept
   * (matching the game behaviour where the player selects a specific recipe).
   */
  const recipesForOptimizer = useMemo<RecipeData[]>(() => {
    const seen = new Set<number>();
    const recipes: RecipeData[] = [];

    for (const bp of blueprints) {
      const outputTypeId = bp.outputs[0]?.typeId;
      if (outputTypeId == null || seen.has(outputTypeId)) continue;
      seen.add(outputTypeId);

      recipes.push({
        outputTypeId,
        outputQuantity: bp.outputs[0].quantity,
        inputs: bp.inputs.map((i) => ({ typeId: i.typeId, quantity: i.quantity })),
        runTime: bp.runTime,
      });
    }

    return recipes;
  }, [blueprints]);

  return { blueprints, getBlueprint, recipesForOptimizer };
}
