import type { CSSProperties } from "react";

/**
 * Corm growth mark.
 *
 * A rounded bulb with concentric tunic arcs and a small upward sprout,
 * evoking underground growth potential.
 *
 * Designed at a 32×32 viewBox so it works as a favicon-sized mark
 * and scales cleanly to header size.
 */

const CYAN = "#00E5FF";

interface LogoMarkProps {
  size?: number;
  color?: string;
  style?: CSSProperties;
  className?: string;
}

/** Standalone corm mark */
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
      {/* Bulb body — rounded bottom */}
      <ellipse cx={16} cy={19} rx={10} ry={9} stroke={color} strokeWidth={1.4} fill="none" />
      {/* Inner tunic arcs — concentric growth rings */}
      <ellipse cx={16} cy={19} rx={6.5} ry={5.8} stroke={color} strokeWidth={1.0} fill="none" opacity={0.7} />
      <ellipse cx={16} cy={19} rx={3.2} ry={2.8} stroke={color} strokeWidth={0.8} fill="none" opacity={0.5} />
      {/* Sprout — upward shoot from the top */}
      <path
        d="M16 10 Q16 5 13 3"
        stroke={color}
        strokeWidth={1.4}
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M16 10 Q16 6 19 4.5"
        stroke={color}
        strokeWidth={1.4}
        strokeLinecap="round"
        fill="none"
      />
      {/* Growth node at sprout base */}
      <circle cx={16} cy={11} r={1.8} fill={color} />
      {/* Root node at base */}
      <circle cx={16} cy={28} r={1.2} fill={color} opacity={0.6} />
      {/* Small root tendrils */}
      <line x1={16} y1={28} x2={13} y2={30.5} stroke={color} strokeWidth={0.8} strokeLinecap="round" opacity={0.5} />
      <line x1={16} y1={28} x2={19} y2={30.5} stroke={color} strokeWidth={0.8} strokeLinecap="round" opacity={0.5} />
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

/** Full horizontal lockup: mark + "FRONTIER CORM" wordmark */
export function Logo({
  height = 28,
  color = "#F0F4F8",
  accentColor = CYAN,
  style,
  className,
}: LogoProps) {
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
        <ellipse cx={16} cy={19} rx={10} ry={9} stroke={accentColor} strokeWidth={1.4} fill="none" />
        <ellipse cx={16} cy={19} rx={6.5} ry={5.8} stroke={accentColor} strokeWidth={1.0} fill="none" opacity={0.7} />
        <ellipse cx={16} cy={19} rx={3.2} ry={2.8} stroke={accentColor} strokeWidth={0.8} fill="none" opacity={0.5} />
        <path d="M16 10 Q16 5 13 3" stroke={accentColor} strokeWidth={1.4} strokeLinecap="round" fill="none" />
        <path d="M16 10 Q16 6 19 4.5" stroke={accentColor} strokeWidth={1.4} strokeLinecap="round" fill="none" />
        <circle cx={16} cy={11} r={1.8} fill={accentColor} />
        <circle cx={16} cy={28} r={1.2} fill={accentColor} opacity={0.6} />
        <line x1={16} y1={28} x2={13} y2={30.5} stroke={accentColor} strokeWidth={0.8} strokeLinecap="round" opacity={0.5} />
        <line x1={16} y1={28} x2={19} y2={30.5} stroke={accentColor} strokeWidth={0.8} strokeLinecap="round" opacity={0.5} />
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
          CORM
        </tspan>
      </text>
    </svg>
  );
}
