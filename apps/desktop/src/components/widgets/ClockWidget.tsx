import React, { useState, useEffect, useCallback } from 'react';
import { useTheme } from '../theme';
import { useAppSettingsStore } from '../../stores/appSettings';

export type ClockMode = 'analog' | 'digital' | 'custom';

interface ClockWidgetProps {
  /** 'compact' for sidebar, 'normal' for tab bar area */
  size?: 'compact' | 'normal';
  className?: string;
}

/**
 * ClockWidget — Three clock modes: analog, digital, custom.
 *
 * Each theme has its own custom clock style:
 * - Papyrus: Sundial-inspired with Roman numerals
 * - Halftone: Retro digital with dot-matrix style
 * - Isometric: 3D isometric clock face
 * - Minimal Art: Minimal line clock with single hand
 */
export const ClockWidget: React.FC<ClockWidgetProps> = ({ size = 'compact', className }) => {
  const { themeSkin } = useTheme();
  const { clockMode, setClockMode } = useClockStore();

  const px = size === 'compact' ? 80 : 120;

  return (
    <div
      className={className}
      style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}
      onClick={() => {
        // Cycle through modes
        const modes: ClockMode[] = ['analog', 'digital', 'custom'];
        const idx = modes.indexOf(clockMode);
        setClockMode(modes[(idx + 1) % modes.length]);
      }}
      title={`Clock mode: ${clockMode} (click to change)`}
      role="button"
      tabIndex={0}
    >
      {clockMode === 'analog' && <AnalogClock size={px} themeSkin={themeSkin} />}
      {clockMode === 'digital' && <DigitalClock size={px} themeSkin={themeSkin} />}
      {clockMode === 'custom' && <CustomClock size={px} themeSkin={themeSkin} />}
      {size === 'normal' && (
        <span className="text-xs" style={{ color: 'var(--fg-dim)' }}>
          {clockMode}
        </span>
      )}
    </div>
  );
};

// ─── Clock Mode Store ────────────────────────────────────────────────────────

interface ClockStoreState {
  clockMode: ClockMode;
  setClockMode: (mode: ClockMode) => void;
}

const useClockStore = createClockStore();

function createClockStore() {
  let mode: ClockMode = 'analog';
  const listeners = new Set<() => void>();

  function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }

  function getSnapshot(): ClockStoreState {
    return {
      clockMode: mode,
      setClockMode: (m: ClockMode) => {
        mode = m;
        try {
          window.papyrus?.setStoredSetting('clockMode', m);
        } catch {}
        // Use a stable reference to avoid firing during unmount
        const currentListeners = Array.from(listeners);
        for (const l of currentListeners) {
          try { l(); } catch { /* component may have unmounted */ }
        }
      },
    };
  }

  if (typeof window !== 'undefined' && window.papyrus) {
    window.papyrus?.getStoredSetting('clockMode').then((m: string) => {
      if (m && ['analog', 'digital', 'custom'].includes(m)) {
        mode = m as ClockMode;
        const currentListeners = Array.from(listeners);
        for (const l of currentListeners) {
          try { l(); } catch { /* component may have unmounted */ }
        }
      }
    }).catch(() => {});
  }

  return function useClockStore(): ClockStoreState {
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);

    React.useEffect(() => {
      const unsubscribe = subscribe(forceUpdate);
      return unsubscribe;
    }, []);

    return getSnapshot();
  };
}

// ─── Analog Clock ────────────────────────────────────────────────────────────────

const AnalogClock: React.FC<{ size: number; themeSkin: string }> = ({ size, themeSkin }) => {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const hours = time.getHours() % 12;
  const minutes = time.getMinutes();
  const seconds = time.getSeconds();

  const hourAngle = (hours + minutes / 60) * 30;
  const minuteAngle = (minutes + seconds / 60) * 6;
  const secondAngle = seconds * 6;

  const accent = 'var(--accent-primary)';
  const fg = 'var(--fg-secondary)';
  const fgDim = 'var(--fg-dim)';
  const bg = 'var(--bg-secondary)';
  const border = 'var(--border-default)';

  const r = size / 2 - 4;
  const center = size / 2;

  // Roman numerals for papyrus theme
  const romanNumerals = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Clock face */}
      <circle cx={center} cy={center} r={r} fill={bg} stroke={border} strokeWidth={1.5} />

      {/* Hour markers */}
      {Array.from({ length: 12 }).map((_, i) => {
        const angle = (i * 30 * Math.PI) / 180;
        const isMain = i % 3 === 0;
        const innerR = isMain ? r - 8 : r - 5;
        const outerR = r - 2;
        const x1 = center + Math.sin(angle) * innerR;
        const y1 = center - Math.cos(angle) * innerR;
        const x2 = center + Math.sin(angle) * outerR;
        const y2 = center - Math.cos(angle) * outerR;

        if (themeSkin === 'papyrus' && isMain) {
          // Roman numerals
          const textR = r - 14;
          const tx = center + Math.sin(angle) * textR;
          const ty = center - Math.cos(angle) * textR;
          return (
            <text
              key={i}
              x={tx}
              y={ty}
              textAnchor="middle"
              dominantBaseline="central"
              fill={accent}
              fontSize={size < 90 ? 7 : 9}
              fontFamily="serif"
              style={{ fontWeight: 600 }}
            >
              {romanNumerals[i]}
            </text>
          );
        }

        return (
          <line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={isMain ? fg : fgDim}
            strokeWidth={isMain ? 2 : 1}
            strokeLinecap="round"
          />
        );
      })}

      {/* Hour hand */}
      <line
        x1={center}
        y1={center}
        x2={center + Math.sin((hourAngle * Math.PI) / 180) * (r * 0.5)}
        y2={center - Math.cos((hourAngle * Math.PI) / 180) * (r * 0.5)}
        stroke={fg}
        strokeWidth={2.5}
        strokeLinecap="round"
      />

      {/* Minute hand */}
      <line
        x1={center}
        y1={center}
        x2={center + Math.sin((minuteAngle * Math.PI) / 180) * (r * 0.7)}
        y2={center - Math.cos((minuteAngle * Math.PI) / 180) * (r * 0.7)}
        stroke={fg}
        strokeWidth={1.5}
        strokeLinecap="round"
      />

      {/* Second hand */}
      <line
        x1={center}
        y1={center}
        x2={center + Math.sin((secondAngle * Math.PI) / 180) * (r * 0.8)}
        y2={center - Math.cos((secondAngle * Math.PI) / 180) * (r * 0.8)}
        stroke={accent}
        strokeWidth={0.8}
        strokeLinecap="round"
      />

      {/* Center dot */}
      <circle cx={center} cy={center} r={2.5} fill={accent} />
    </svg>
  );
};

// ─── Digital Clock ────────────────────────────────────────────────────────────────

const DigitalClock: React.FC<{ size: number; themeSkin: string }> = ({ size, themeSkin }) => {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const h = time.getHours().toString().padStart(2, '0');
  const m = time.getMinutes().toString().padStart(2, '0');
  const s = time.getSeconds().toString().padStart(2, '0');

  const isHalftone = themeSkin === 'halftone';

  return (
    <div
      className="flex items-center justify-center"
      style={{
        width: size,
        height: size * 0.5,
        fontFamily: isHalftone ? '"Courier New", monospace' : '"SF Mono", "Fira Code", monospace',
        fontSize: size < 90 ? 14 : 20,
        letterSpacing: isHalftone ? '0.15em' : '0.05em',
        color: 'var(--accent-primary)',
        backgroundColor: 'var(--bg-secondary)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md, 4px)',
      }}
    >
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
        {h}<span style={{ opacity: time.getSeconds() % 2 === 0 ? 1 : 0.3 }}>:</span>{m}
      </span>
      <span
        className="ml-1"
        style={{
          fontSize: size < 90 ? 10 : 13,
          color: 'var(--fg-dim)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {s}
      </span>
    </div>
  );
};

// ─── Custom Theme Clock ──────────────────────────────────────────────────────────

const CustomClock: React.FC<{ size: number; themeSkin: string }> = ({ size, themeSkin }) => {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Papyrus: Sundial-inspired with Roman numerals
  if (themeSkin === 'papyrus') {
    return <SundialClock size={size} time={time} />;
  }

  // Halftone: Dot-matrix style
  if (themeSkin === 'halftone') {
    return <DotMatrixClock size={size} time={time} />;
  }

  // Isometric: 3D isometric clock face
  if (themeSkin === 'isometric') {
    return <IsometricClock size={size} time={time} />;
  }

  // Minimal Art: Minimal line clock with single hand
  return <MinimalLineClock size={size} time={time} />;
};

// ─── Sundial Clock (Papyrus) ──────────────────────────────────────────────────

const SundialClock: React.FC<{ size: number; time: Date }> = ({ size, time }) => {
  const hours = time.getHours() % 12;
  const minutes = time.getMinutes();
  const angle = (hours + minutes / 60) * 30;
  const center = size / 2;
  const r = size / 2 - 4;

  const romanNumerals = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Sundial base — warm gradient */}
      <defs>
        <radialGradient id="sundial-grad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--bg-card)" />
          <stop offset="100%" stopColor="var(--bg-secondary)" />
        </radialGradient>
      </defs>
      <circle cx={center} cy={center} r={r} fill="url(#sundial-grad)" stroke="var(--accent-primary)" strokeWidth={1} opacity={0.8} />

      {/* Decorative inner ring */}
      <circle cx={center} cy={center} r={r * 0.85} fill="none" stroke="var(--accent-primary)" strokeWidth={0.5} opacity={0.3} />

      {/* Roman numerals */}
      {romanNumerals.map((numeral, i) => {
        const a = (i * 30 * Math.PI) / 180;
        const textR = r * 0.7;
        return (
          <text
            key={i}
            x={center + Math.sin(a) * textR}
            y={center - Math.cos(a) * textR}
            textAnchor="middle"
            dominantBaseline="central"
            fill="var(--accent-primary)"
            fontSize={size < 90 ? 6 : 9}
            fontFamily="serif"
            style={{ fontWeight: 700, letterSpacing: '0.05em' }}
          >
            {numeral}
          </text>
        );
      })}

      {/* Shadow/gnomon */}
      <line
        x1={center}
        y1={center}
        x2={center + Math.sin((angle * Math.PI) / 180) * (r * 0.55)}
        y2={center - Math.cos((angle * Math.PI) / 180) * (r * 0.55)}
        stroke="var(--papyrus-ink-dark, #8B7340)"
        strokeWidth={3}
        strokeLinecap="round"
        opacity={0.6}
      />

      {/* Main hand */}
      <line
        x1={center}
        y1={center}
        x2={center + Math.sin((angle * Math.PI) / 180) * (r * 0.6)}
        y2={center - Math.cos((angle * Math.PI) / 180) * (r * 0.6)}
        stroke="var(--accent-primary)"
        strokeWidth={1.5}
        strokeLinecap="round"
      />

      {/* Center ornament */}
      <circle cx={center} cy={center} r={3} fill="var(--accent-primary)" />
      <circle cx={center} cy={center} r={1.5} fill="var(--bg-primary)" />
    </svg>
  );
};

// ─── Dot-Matrix Clock (Halftone) ──────────────────────────────────────────────

const DotMatrixClock: React.FC<{ size: number; time: Date }> = ({ size, time }) => {
  const h = time.getHours().toString().padStart(2, '0');
  const m = time.getMinutes().toString().padStart(2, '0');

  // Simple 3x5 dot-matrix digit patterns
  const digits: Record<string, number[][]> = {
    '0': [[1,1,1],[1,0,1],[1,0,1],[1,0,1],[1,1,1]],
    '1': [[0,1,0],[1,1,0],[0,1,0],[0,1,0],[1,1,1]],
    '2': [[1,1,1],[0,0,1],[1,1,1],[1,0,0],[1,1,1]],
    '3': [[1,1,1],[0,0,1],[1,1,1],[0,0,1],[1,1,1]],
    '4': [[1,0,1],[1,0,1],[1,1,1],[0,0,1],[0,0,1]],
    '5': [[1,1,1],[1,0,0],[1,1,1],[0,0,1],[1,1,1]],
    '6': [[1,1,1],[1,0,0],[1,1,1],[1,0,1],[1,1,1]],
    '7': [[1,1,1],[0,0,1],[0,0,1],[0,0,1],[0,0,1]],
    '8': [[1,1,1],[1,0,1],[1,1,1],[1,0,1],[1,1,1]],
    '9': [[1,1,1],[1,0,1],[1,1,1],[0,0,1],[1,1,1]],
  };

  const dotSize = size < 90 ? 3 : 4;
  const gap = dotSize + 1;
  const digitWidth = 3 * gap;
  const colonWidth = gap;

  // Render a digit at x offset
  const renderDigit = (char: string, offsetX: number) => {
    const pattern = digits[char];
    if (!pattern) return null;
    const dots: React.ReactNode[] = [];
    pattern.forEach((row, y) => {
      row.forEach((on, x) => {
        if (on) {
          dots.push(
            <circle
              key={`${char}-${y}-${x}`}
              cx={offsetX + x * gap + dotSize / 2}
              cy={y * gap + dotSize / 2 + 4}
              r={dotSize / 2}
              fill="var(--accent-primary)"
            />
          );
        }
      });
    });
    return dots;
  };

  const totalWidth = 4 * digitWidth + colonWidth;
  const svgH = 5 * gap + 8;

  return (
    <svg width={size} height={size * 0.6} viewBox={`0 0 ${totalWidth} ${svgH}`}>
      {renderDigit(h[0], 0)}
      {renderDigit(h[1], digitWidth)}
      {/* Colon */}
      <circle cx={2 * digitWidth + colonWidth / 2} cy={2 * gap} r={dotSize / 2} fill="var(--accent-primary)" opacity={time.getSeconds() % 2 === 0 ? 1 : 0.3} />
      <circle cx={2 * digitWidth + colonWidth / 2} cy={4 * gap} r={dotSize / 2} fill="var(--accent-primary)" opacity={time.getSeconds() % 2 === 0 ? 1 : 0.3} />
      {renderDigit(m[0], 2 * digitWidth + colonWidth)}
      {renderDigit(m[1], 3 * digitWidth + colonWidth)}
    </svg>
  );
};

// ─── Isometric 3D Clock ──────────────────────────────────────────────────────

const IsometricClock: React.FC<{ size: number; time: Date }> = ({ size, time }) => {
  const hours = time.getHours() % 12;
  const minutes = time.getMinutes();
  const seconds = time.getSeconds();
  const angle = (hours + minutes / 60) * 30;
  const center = size / 2;
  const r = size / 2 - 8;

  // Isometric distortion: scale X by cos(30°) and skew
  const isoX = 0.866; // cos(30°)
  const isoY = 0.5;   // sin(30°)

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <defs>
        <linearGradient id="iso-clock-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="var(--bg-card)" />
          <stop offset="100%" stopColor="var(--bg-surface)" />
        </linearGradient>
      </defs>

      {/* 3D effect: bottom face */}
      <ellipse cx={center + 3} cy={center + 4} rx={r * isoX} ry={r * isoY} fill="var(--bg-muted)" opacity={0.5} />

      {/* Main face */}
      <ellipse cx={center} cy={center} rx={r * isoX} ry={r * isoY} fill="url(#iso-clock-grad)" stroke="var(--accent-primary)" strokeWidth={1.5} />

      {/* Hour markers */}
      {Array.from({ length: 12 }).map((_, i) => {
        const a = (i * 30 * Math.PI) / 180;
        const isMain = i % 3 === 0;
        const innerR = isMain ? r - 10 : r - 6;
        const outerR = r - 3;
        // Isometric projection of angle
        const x1 = center + Math.sin(a) * innerR * isoX;
        const y1 = center - Math.cos(a) * innerR * isoY;
        const x2 = center + Math.sin(a) * outerR * isoX;
        const y2 = center - Math.cos(a) * outerR * isoY;
        return (
          <line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={isMain ? 'var(--accent-primary)' : 'var(--fg-dim)'}
            strokeWidth={isMain ? 2 : 1}
            strokeLinecap="round"
          />
        );
      })}

      {/* Hour hand (isometric) */}
      <line
        x1={center}
        y1={center}
        x2={center + Math.sin((angle * Math.PI) / 180) * (r * 0.45) * isoX}
        y2={center - Math.cos((angle * Math.PI) / 180) * (r * 0.45) * isoY}
        stroke="var(--fg-primary)"
        strokeWidth={2.5}
        strokeLinecap="round"
      />

      {/* Minute hand (isometric) */}
      <line
        x1={center}
        y1={center}
        x2={center + Math.sin((((minutes + seconds / 60) * 6) * Math.PI) / 180) * (r * 0.65) * isoX}
        y2={center - Math.cos((((minutes + seconds / 60) * 6) * Math.PI) / 180) * (r * 0.65) * isoY}
        stroke="var(--fg-secondary)"
        strokeWidth={1.5}
        strokeLinecap="round"
      />

      {/* Center dot */}
      <ellipse cx={center} cy={center} rx={3} ry={2} fill="var(--accent-primary)" />
    </svg>
  );
};

// ─── Minimal Line Clock (Minimal Art) ────────────────────────────────────────

const MinimalLineClock: React.FC<{ size: number; time: Date }> = ({ size, time}) => {
  const hours = time.getHours() % 12;
  const minutes = time.getMinutes();
  const angle = (hours + minutes / 60) * 30;

  const center = size / 2;
  const r = size / 2 - 6;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Single thin circle */}
      <circle
        cx={center}
        cy={center}
        r={r}
        fill="none"
        stroke="var(--accent-primary)"
        strokeWidth={0.5}
        opacity={0.4}
      />

      {/* Single hand — only hours, very minimal */}
      <line
        x1={center}
        y1={center}
        x2={center + Math.sin((angle * Math.PI) / 180) * (r * 0.8)}
        y2={center - Math.cos((angle * Math.PI) / 180) * (r * 0.8)}
        stroke="var(--accent-primary)"
        strokeWidth={1}
        strokeLinecap="round"
      />

      {/* Small dot at the tip */}
      <circle
        cx={center + Math.sin((angle * Math.PI) / 180) * (r * 0.8)}
        cy={center - Math.cos((angle * Math.PI) / 180) * (r * 0.8)}
        r={1.5}
        fill="var(--accent-primary)"
      />

      {/* Center point */}
      <circle cx={center} cy={center} r={1} fill="var(--accent-primary)" />
    </svg>
  );
};

export default ClockWidget;
