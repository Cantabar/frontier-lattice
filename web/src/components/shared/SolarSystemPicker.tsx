/**
 * Autocomplete picker for selecting a solar system by name.
 *
 * Features:
 *   - Debounced substring search (prefix-prioritised)
 *   - System ID shown in muted text next to each match
 *   - Keyboard navigation (↑ / ↓ / Enter / Escape)
 *   - Allows clearing the selection
 *   - Also accepts a raw numeric ID typed directly
 */

import { useState, useRef, useEffect, useCallback } from "react";
import styled from "styled-components";
import {
  searchSolarSystems,
  SOLAR_SYSTEMS,
  type SolarSystemEntry,
} from "../../lib/solarSystems";

// ============================================================
// Styled primitives
// ============================================================

const Wrapper = styled.div`
  position: relative;
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const Input = styled.input`
  width: 100%;
  background: ${({ theme }) => theme.colors.surface.bg};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  color: ${({ theme }) => theme.colors.text.primary};
  font-size: 14px;

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary.main};
  }

  &::placeholder {
    color: ${({ theme }) => theme.colors.text.muted};
  }
`;

const Dropdown = styled.ul`
  position: absolute;
  z-index: 20;
  top: 100%;
  left: 0;
  right: 0;
  margin: 2px 0 0;
  padding: 4px 0;
  list-style: none;
  background: ${({ theme }) => theme.colors.surface.overlay};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  max-height: 220px;
  overflow-y: auto;
`;

const Option = styled.li<{ $active: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  cursor: pointer;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text.primary};
  background: ${({ $active, theme }) =>
    $active ? theme.colors.surface.raised : "transparent"};

  &:hover {
    background: ${({ theme }) => theme.colors.surface.raised};
  }
`;

const SystemName = styled.span`
  font-weight: 500;
`;

const SystemId = styled.span`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.text.muted};
  flex-shrink: 0;
  margin-left: 8px;
`;

// ============================================================
// Component
// ============================================================

interface Props {
  /** Currently selected solar system ID, or null. */
  value: number | null;
  /** Called when the user selects or clears a solar system. */
  onChange: (entry: SolarSystemEntry | null) => void;
  /** Placeholder text. */
  placeholder?: string;
}

export function SolarSystemPicker({
  value,
  onChange,
  placeholder = "Search solar systems…",
}: Props) {
  // Resolve initial display text from value
  const initial = value ? SOLAR_SYSTEMS.get(value) : null;
  const [text, setText] = useState(initial ? initial.name : "");
  const [results, setResults] = useState<SolarSystemEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Sync text when value changes externally
  useEffect(() => {
    const entry = value ? SOLAR_SYSTEMS.get(value) : null;
    setText(entry ? entry.name : "");
  }, [value]);

  const doSearch = useCallback((q: string) => {
    const matches = searchSolarSystems(q, 15);
    setResults(matches);
    setActiveIdx(-1);
  }, []);

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setText(v);
    setOpen(true);

    // Clear selection if text is edited after a selection
    if (value) onChange(null);

    // Debounce search
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(v), 120);
  }

  function handleSelect(entry: SolarSystemEntry) {
    setText(entry.name);
    onChange(entry);
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "ArrowDown") {
        setOpen(true);
        doSearch(text);
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, results.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (activeIdx >= 0 && activeIdx < results.length) {
          handleSelect(results[activeIdx]);
        }
        break;
      case "Escape":
        setOpen(false);
        break;
    }
  }

  function handleFocus() {
    doSearch(text);
    setOpen(true);
  }

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <Wrapper ref={wrapperRef}>
      <Input
        value={text}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        placeholder={placeholder}
        autoComplete="off"
      />
      {open && results.length > 0 && (
        <Dropdown>
          {results.map((entry, i) => (
            <Option
              key={entry.id}
              $active={i === activeIdx}
              onMouseDown={() => handleSelect(entry)}
            >
              <SystemName>{entry.name}</SystemName>
              <SystemId>#{entry.id}</SystemId>
            </Option>
          ))}
        </Dropdown>
      )}
    </Wrapper>
  );
}
