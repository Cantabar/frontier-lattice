import React, { createContext, useContext, useState, useCallback } from "react";

interface CanvasSelectionValue {
  hoveredCardId: string | null;
  selectedCardId: string | null;
  /** The card that drives the highlight: hover takes precedence over click-selection. */
  focusedCardId: string | null;
  onCardPointerEnter(cardId: string): void;
  onCardPointerLeave(cardId: string): void;
  onCardClick(cardId: string): void;
  onBackgroundClick(): void;
}

const CanvasSelectionContext = createContext<CanvasSelectionValue | null>(null);

export function CanvasSelectionProvider({ children }: { children: React.ReactNode }) {
  const [hoveredCardId, setHoveredCardId] = useState<string | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  const focusedCardId = hoveredCardId ?? selectedCardId;

  const onCardPointerEnter = useCallback((cardId: string) => {
    setHoveredCardId(cardId);
  }, []);

  const onCardPointerLeave = useCallback((cardId: string) => {
    setHoveredCardId((id) => (id === cardId ? null : id));
  }, []);

  const onCardClick = useCallback((cardId: string) => {
    setSelectedCardId((id) => (id === cardId ? null : cardId));
  }, []);

  const onBackgroundClick = useCallback(() => {
    setSelectedCardId(null);
  }, []);

  return (
    <CanvasSelectionContext.Provider
      value={{
        hoveredCardId,
        selectedCardId,
        focusedCardId,
        onCardPointerEnter,
        onCardPointerLeave,
        onCardClick,
        onBackgroundClick,
      }}
    >
      {children}
    </CanvasSelectionContext.Provider>
  );
}

export function useCanvasSelection(): CanvasSelectionValue {
  const ctx = useContext(CanvasSelectionContext);
  if (!ctx) throw new Error("useCanvasSelection must be used within CanvasSelectionProvider");
  return ctx;
}
