import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useEnergyMap, formatEnergyDisplay } from "./useEnergyMap";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@mysten/dapp-kit", () => ({
  useSuiClient: vi.fn(),
}));

import { useSuiClient } from "@mysten/dapp-kit";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ENERGY_MAP_KEY = "frontier-corm:energy-map";

const TWO_FIELD_RESPONSE = {
  data: [
    { name: { value: "88067" }, objectId: "0xaaa" }, // Printer → 100
    { name: { value: "88082" }, objectId: "0xbbb" }, // Mini Storage → 50
  ],
  hasNextPage: false,
};

const TWO_OBJECT_RESPONSE = [
  { data: { content: { dataType: "moveObject", fields: { value: "100" } } } },
  { data: { content: { dataType: "moveObject", fields: { value: "50" } } } },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockClient(
  overrides: Partial<{
    getDynamicFields: ReturnType<typeof vi.fn>;
    multiGetObjects: ReturnType<typeof vi.fn>;
  }> = {},
) {
  return {
    getDynamicFields:
      overrides.getDynamicFields ??
      vi.fn().mockResolvedValue(TWO_FIELD_RESPONSE),
    multiGetObjects:
      overrides.multiGetObjects ??
      vi.fn().mockResolvedValue(TWO_OBJECT_RESPONSE),
  };
}

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children);
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useEnergyMap", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  // Happy path — cache hit
  it("returns cached map from localStorage without making any RPC calls", async () => {
    localStorage.setItem(
      ENERGY_MAP_KEY,
      JSON.stringify({ "88067": 100, "88082": 50 }),
    );

    const mockClient = makeMockClient();
    vi.mocked(useSuiClient).mockReturnValue(mockClient as never);

    const { result } = renderHook(() => useEnergyMap(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.energyMap.get(88067)).toBe(100);
    expect(result.current.energyMap.get(88082)).toBe(50);
    expect(mockClient.getDynamicFields).not.toHaveBeenCalled();
  });

  // Happy path — cache miss
  it("fetches from the Sui RPC and writes the result to localStorage on a cache miss", async () => {
    const mockClient = makeMockClient();
    vi.mocked(useSuiClient).mockReturnValue(mockClient as never);

    const { result } = renderHook(() => useEnergyMap(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.energyMap.get(88067)).toBe(100);
    expect(result.current.energyMap.get(88082)).toBe(50);

    const stored = JSON.parse(localStorage.getItem(ENERGY_MAP_KEY) ?? "null");
    expect(stored).toEqual({ "88067": 100, "88082": 50 });
  });

  // clearCache
  it("clearCache removes the localStorage key and triggers a fresh RPC fetch on next render", async () => {
    localStorage.setItem(
      ENERGY_MAP_KEY,
      JSON.stringify({ "88067": 100 }),
    );

    const mockClient = makeMockClient();
    vi.mocked(useSuiClient).mockReturnValue(mockClient as never);

    const { result } = renderHook(() => useEnergyMap(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockClient.getDynamicFields).not.toHaveBeenCalled(); // served from cache

    result.current.clearCache();

    await waitFor(() =>
      expect(localStorage.getItem(ENERGY_MAP_KEY)).toBeNull(),
    );
    // After eviction the hook refetches
    await waitFor(() =>
      expect(mockClient.getDynamicFields).toHaveBeenCalledTimes(1),
    );
  });

  // Pagination guard
  it("logs a console warning when the energy table has more pages than the fetch limit", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const mockClient = makeMockClient({
      getDynamicFields: vi
        .fn()
        .mockResolvedValue({ ...TWO_FIELD_RESPONSE, hasNextPage: true }),
    });
    vi.mocked(useSuiClient).mockReturnValue(mockClient as never);

    const { result } = renderHook(() => useEnergyMap(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("pagination"),
    );

    warnSpy.mockRestore();
  });

  // formatEnergyDisplay — known typeId
  it("formatEnergyDisplay returns '⚡ {N} GJ' for a typeId present in the energy map", () => {
    const map = new Map<number, number>([[88067, 100]]);
    expect(formatEnergyDisplay(88067, map)).toBe("⚡ 100 GJ");
  });

  // formatEnergyDisplay — unknown typeId
  it("formatEnergyDisplay returns '⚡ — GJ' for a typeId absent from the energy map", () => {
    const map = new Map<number, number>();
    expect(formatEnergyDisplay(99999, map)).toBe("⚡ — GJ");
  });

  // Edge case — malformed RPC response
  it("skips entries with missing content without producing NaN values in the map", async () => {
    const mockClient = makeMockClient({
      getDynamicFields: vi.fn().mockResolvedValue({
        data: [
          { name: { value: "88067" }, objectId: "0xaaa" }, // valid
          { name: { value: "88082" }, objectId: "0xbbb" }, // malformed → should be skipped
        ],
        hasNextPage: false,
      }),
      multiGetObjects: vi.fn().mockResolvedValue([
        { data: { content: { dataType: "moveObject", fields: { value: "100" } } } },
        { data: null }, // missing content
      ]),
    });
    vi.mocked(useSuiClient).mockReturnValue(mockClient as never);

    const { result } = renderHook(() => useEnergyMap(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.energyMap.get(88067)).toBe(100);
    expect(result.current.energyMap.has(88082)).toBe(false);
    expect(
      [...result.current.energyMap.values()].every((v) => !Number.isNaN(v)),
    ).toBe(true);
  });
});
