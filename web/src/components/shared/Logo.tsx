import type { CSSProperties } from "react";

/**
 * Hexagonal lattice node mark.
 *
 * Six lines converge from a center point to hexagon vertices,
 * with small circles at each vertex and the center.
 *
 * Designed at a 32×32 viewBox so it works as a favicon-sized mark
 * and scales cleanly to header size.
 */

const CYAN = "#00E5FF";

/** Hexagon vertices (pointy-top orientation, radius 12, center 16,16) */
const R = 12;
const CX = 16;
const CY = 16;
const vertices = Array.from({ length: 6 }, (_, i) => {
  const angle = (Math.PI / 3) * i - Math.PI / 2;
  return { x: CX + R * Math.cos(angle), y: CY + R * Math.sin(angle) };
});

interface LogoMarkProps {
  size?: number;
  color?: string;
  style?: CSSProperties;
  className?: string;
}

/** Standalone lattice hexagon mark */
export function LogoMark({
  size = 32,
  color = CYAN,
  style,
  className,
}: LogoMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={style}
      className={className}
    >
      {/* Lines from center to each vertex */}
      {vertices.map((v, i) => (
        <line
          key={`spoke-${i}`}
          x1={CX}
          y1={CY}
          x2={v.x}
          y2={v.y}
          stroke={color}
          strokeWidth={1.2}
          strokeLinecap="round"
        />
      ))}
      {/* Hexagon perimeter */}
      <polygon
        points={vertices.map((v) => `${v.x},${v.y}`).join(" ")}
        stroke={color}
        strokeWidth={1.2}
        strokeLinejoin="round"
        fill="none"
      />
      {/* Vertex dots */}
      {vertices.map((v, i) => (
        <circle key={`dot-${i}`} cx={v.x} cy={v.y} r={2} fill={color} />
      ))}
      {/* Center dot */}
      <circle cx={CX} cy={CY} r={2.4} fill={color} />
    </svg>
  );
}

interface LogoProps {
  height?: number;
  color?: string;
  accentColor?: string;
  style?: CSSProperties;
  className?: string;
}

/** Full horizontal lockup: mark + "FRONTIER LATTICE" wordmark */
export function Logo({
  height = 28,
  color = "#F0F4F8",
  accentColor = CYAN,
  style,
  className,
}: LogoProps) {
  // Scale factor from the 32-unit mark height
  const scale = height / 32;
  const markWidth = 32 * scale;
  const gap = 8 * scale;
  const fontSize = 14 * scale;

  return (
    <svg
      height={height}
      viewBox={`0 0 ${markWidth + gap + 150 * scale} ${height}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={style}
      className={className}
    >
      {/* Mark */}
      <g transform={`scale(${scale})`}>
        {vertices.map((v, i) => (
          <line
            key={`spoke-${i}`}
            x1={CX}
            y1={CY}
            x2={v.x}
            y2={v.y}
            stroke={accentColor}
            strokeWidth={1.2}
            strokeLinecap="round"
          />
        ))}
        <polygon
          points={vertices.map((v) => `${v.x},${v.y}`).join(" ")}
          stroke={accentColor}
          strokeWidth={1.2}
          strokeLinejoin="round"
          fill="none"
        />
        {vertices.map((v, i) => (
          <circle
            key={`dot-${i}`}
            cx={v.x}
            cy={v.y}
            r={2}
            fill={accentColor}
          />
        ))}
        <circle cx={CX} cy={CY} r={2.4} fill={accentColor} />
      </g>
      {/* Wordmark */}
      <text
        x={markWidth + gap}
        y={height * 0.62}
        fontFamily="Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
        fontSize={fontSize}
        letterSpacing="-0.01em"
      >
        <tspan fill={color} fontWeight={300}>
          FRONTIER{" "}
        </tspan>
        <tspan fill={accentColor} fontWeight={700}>
          LATTICE
        </tspan>
      </text>
    </svg>
  );
}
