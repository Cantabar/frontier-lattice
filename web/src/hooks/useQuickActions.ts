import { useState, useCallback } from "react";
import type { TrustlessContractVariant } from "../lib/types";

const STORAGE_KEY = "dashboard.quickActions";

const ALL_VARIANTS: TrustlessContractVariant[] = [
  "CoinForCoin",
  "CoinForItem",
  "ItemForCoin",
  "ItemForItem",
  "Transport",
];

const VARIANT_LABELS: Record<TrustlessContractVariant, string> = {
  CoinForCoin: "Coin → Coin",
  CoinForItem: "Coin → Item",
  ItemForCoin: "Item → Coin",
  ItemForItem: "Item → Item",
  Transport: "Transport",
};

const VARIANT_DESCRIPTIONS: Record<TrustlessContractVariant, string> = {
  CoinForCoin: "Offer coins, receive different coins",
  CoinForItem: "Offer coins, receive items at an SSU",
  ItemForCoin: "Offer items at an SSU, receive coins",
  ItemForItem: "Trade items at one SSU for items at another",
  Transport: "Pay for item delivery to an SSU",
};

function load(): TrustlessContractVariant[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return ALL_VARIANTS;
    const parsed = JSON.parse(raw) as string[];
    const valid = parsed.filter((v): v is TrustlessContractVariant =>
      ALL_VARIANTS.includes(v as TrustlessContractVariant),
    );
    return valid.length > 0 ? valid : ALL_VARIANTS;
  } catch {
    return ALL_VARIANTS;
  }
}

function save(variants: TrustlessContractVariant[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(variants));
}

export function useQuickActions() {
  const [enabled, setEnabled] = useState<TrustlessContractVariant[]>(load);

  const toggle = useCallback((variant: TrustlessContractVariant) => {
    setEnabled((prev) => {
      const next = prev.includes(variant)
        ? prev.filter((v) => v !== variant)
        : [...prev, variant];
      // Don't allow removing all — keep at least one
      const result = next.length > 0 ? next : prev;
      save(result);
      return result;
    });
  }, []);

  const reset = useCallback(() => {
    save(ALL_VARIANTS);
    setEnabled(ALL_VARIANTS);
  }, []);

  return { enabled, toggle, reset, allVariants: ALL_VARIANTS, variantLabels: VARIANT_LABELS, variantDescriptions: VARIANT_DESCRIPTIONS };
}
