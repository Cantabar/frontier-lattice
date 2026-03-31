/**
 * Custom `<select>` replacement that renders a portal-based `<ul>` dropdown
 * instead of relying on the browser's native popup layer.
 *
 * Native `<select>` elements are broken inside EVE Frontier's in-game browser
 * because the CEF off-screen renderer composites the popup in a separate
 * buffer (PET_POPUP) that the game engine doesn't display. This component
 * keeps everything in the main DOM layer.
 *
 * Modeled after the positioning / interaction patterns in SolarSystemPicker.
 */

import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import styled, { css } from "styled-components";

// ============================================================
// Types
// ============================================================

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectOptgroup {
  label: string;
  options: SelectOption[];
}

interface BaseProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Full-width trigger (default true). */
  fullWidth?: boolean;
  /** Compact inline style for filter bars. */
  compact?: boolean;
}

interface FlatProps extends BaseProps {
  options: SelectOption[];
  optgroups?: never;
}

interface GroupedProps extends BaseProps {
  options?: never;
  optgroups: SelectOptgroup[];
}

type Props = FlatProps | GroupedProps;

// ============================================================
// Styled primitives
// ============================================================

const Trigger = styled.button<{ $fullWidth: boolean; $compact: boolean; $open: boolean; $hasValue: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  background: ${({ theme }) => theme.colors.surface.bg};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  color: ${({ $hasValue, theme }) =>
    $hasValue ? theme.colors.text.primary : theme.colors.text.muted};
  font-size: 14px;
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  cursor: pointer;
  text-align: left;
  min-width: 0;

  ${({ $fullWidth }) =>
    $fullWidth &&
    css`
      width: 100%;
    `}

  ${({ $compact, theme }) =>
    $compact &&
    css`
      background: ${theme.colors.surface.raised};
      color: ${theme.colors.text.secondary};
      font-size: 13px;
      font-weight: 600;
      padding: ${theme.spacing.xs} ${theme.spacing.md};
    `}

  ${({ $open, theme }) =>
    $open &&
    css`
      border-color: ${theme.colors.primary.main};
    `}

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary.main};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const TriggerLabel = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
`;

const Chevron = styled.span<{ $open: boolean }>`
  flex-shrink: 0;
  font-size: 10px;
  line-height: 1;
  transition: transform 0.15s ease;
  transform: ${({ $open }) => ($open ? "rotate(180deg)" : "rotate(0)")};
`;

const Dropdown = styled.ul<{ $top: number; $left: number; $width: number }>`
  position: fixed;
  z-index: 200;
  top: ${({ $top }) => $top}px;
  left: ${({ $left }) => $left}px;
  width: ${({ $width }) => $width}px;
  margin: 2px 0 0;
  padding: 4px 0;
  list-style: none;
  background: ${({ theme }) => theme.colors.surface.overlay};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  max-height: 260px;
  overflow-y: auto;
`;

const Option = styled.li<{ $active: boolean; $disabled: boolean; $selected: boolean }>`
  padding: 6px 12px;
  cursor: ${({ $disabled }) => ($disabled ? "not-allowed" : "pointer")};
  font-size: 13px;
  color: ${({ $disabled, theme }) =>
    $disabled ? theme.colors.text.disabled : theme.colors.text.primary};
  background: ${({ $active, $selected, theme }) =>
    $active
      ? theme.colors.surface.raised
      : $selected
        ? theme.colors.primary.subtle
        : "transparent"};

  &:hover {
    background: ${({ $disabled, theme }) =>
      $disabled ? "transparent" : theme.colors.surface.raised};
  }
`;

const GroupLabel = styled.li`
  padding: 6px 12px 2px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: ${({ theme }) => theme.colors.text.muted};
  cursor: default;
`;

// ============================================================
// Helpers
// ============================================================

function flattenOptions(props: Props): SelectOption[] {
  if (props.options) return props.options;
  return props.optgroups.flatMap((g) => g.options);
}

// ============================================================
// Component
// ============================================================

export function CustomSelect(props: Props) {
  const {
    value,
    onChange,
    placeholder = "Select…",
    disabled = false,
    fullWidth = true,
    compact = false,
  } = props;

  const allOptions = useMemo(() => flattenOptions(props), [props.options, props.optgroups]);

  const selectedLabel = useMemo(() => {
    const opt = allOptions.find((o) => o.value === value);
    return opt?.label ?? null;
  }, [allOptions, value]);

  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLUListElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  // Recalculate dropdown position
  const updatePos = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom, left: rect.left, width: rect.width });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePos();
    window.addEventListener("scroll", updatePos, true);
    window.addEventListener("resize", updatePos);
    return () => {
      window.removeEventListener("scroll", updatePos, true);
      window.removeEventListener("resize", updatePos);
    };
  }, [open, updatePos]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        dropdownRef.current?.contains(target)
      )
        return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open]);

  // Scroll active item into view
  useEffect(() => {
    if (!open || activeIdx < 0) return;
    const ul = dropdownRef.current;
    if (!ul) return;
    const items = ul.querySelectorAll<HTMLLIElement>("[data-option-idx]");
    items[activeIdx]?.scrollIntoView({ block: "nearest" });
  }, [activeIdx, open]);

  function toggle() {
    if (disabled) return;
    setOpen((v) => {
      if (!v) {
        // When opening, highlight the currently-selected option
        const idx = allOptions.findIndex((o) => o.value === value);
        setActiveIdx(idx >= 0 ? idx : 0);
      }
      return !v;
    });
  }

  function selectOption(opt: SelectOption) {
    if (opt.disabled) return;
    onChange(opt.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIdx((i) => {
          let next = i + 1;
          while (next < allOptions.length && allOptions[next].disabled) next++;
          return next < allOptions.length ? next : i;
        });
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIdx((i) => {
          let next = i - 1;
          while (next >= 0 && allOptions[next].disabled) next--;
          return next >= 0 ? next : i;
        });
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (activeIdx >= 0 && activeIdx < allOptions.length) {
          selectOption(allOptions[activeIdx]);
        }
        break;
      case "Escape":
      case "Tab":
        setOpen(false);
        break;
    }
  }

  // Build dropdown content — flat or grouped
  function renderOptions() {
    let flatIdx = 0;

    if (props.optgroups) {
      return props.optgroups.map((group) => (
        <li key={`group-${group.label}`} role="presentation">
          <GroupLabel>{group.label}</GroupLabel>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {group.options.map((opt) => {
              const idx = flatIdx++;
              return (
                <Option
                  key={opt.value}
                  data-option-idx={idx}
                  $active={idx === activeIdx}
                  $disabled={!!opt.disabled}
                  $selected={opt.value === value}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectOption(opt);
                  }}
                  onMouseEnter={() => setActiveIdx(idx)}
                >
                  {opt.label}
                </Option>
              );
            })}
          </ul>
        </li>
      ));
    }

    return allOptions.map((opt, i) => (
      <Option
        key={opt.value}
        data-option-idx={i}
        $active={i === activeIdx}
        $disabled={!!opt.disabled}
        $selected={opt.value === value}
        onMouseDown={(e) => {
          e.preventDefault();
          selectOption(opt);
        }}
        onMouseEnter={() => setActiveIdx(i)}
      >
        {opt.label}
      </Option>
    ));
  }

  return (
    <>
      <Trigger
        ref={triggerRef}
        type="button"
        onClick={toggle}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        $fullWidth={fullWidth}
        $compact={compact}
        $open={open}
        $hasValue={!!selectedLabel}
      >
        <TriggerLabel>{selectedLabel ?? placeholder}</TriggerLabel>
        <Chevron $open={open}>▾</Chevron>
      </Trigger>

      {open &&
        createPortal(
          <Dropdown
            ref={dropdownRef}
            $top={pos.top}
            $left={pos.left}
            $width={pos.width}
          >
            {renderOptions()}
          </Dropdown>,
          document.body,
        )}
    </>
  );
}
