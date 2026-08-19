// Tab glyphs — distinct inline SVGs (design-review: no more identical squares).
// stroke/fill: currentColor so the TabBar's active/inactive color drives them.
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

/** Today — a sun/day marker. */
export function IconToday(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
    </svg>
  );
}

/** Timeline — stacked rows. */
export function IconTimeline(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M8 6h12M8 12h12M8 18h12" />
      <circle cx="3.5" cy="6" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="3.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="3.5" cy="18" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Growth — rising bars. */
export function IconGrowth(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 20V13M10 20V9M16 20v-6M22 20V5" />
    </svg>
  );
}

/** Machines — a terminal prompt. */
export function IconMachines(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M7 9l3 3-3 3M13 15h4" />
    </svg>
  );
}

/** Settings — a gear. */
export function IconSettings(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.5v2.2M12 19.3v2.2M4.2 7l1.9 1.1M17.9 15.9l1.9 1.1M4.2 17l1.9-1.1M17.9 8.1l1.9-1.1" />
    </svg>
  );
}

/** Market — a rising line over a baseline. Deliberately not a candlestick:
    this screen is a briefing to read, not a chart to trade off. */
export function IconMarket(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3.5 19.5h17" />
      <path d="M5 15.5l4.5-5 3.5 3 5.5-6.5" />
      <path d="M18.5 7v3.2M18.5 7h-3.2" />
    </svg>
  );
}

/** Trailing-edge disclosure chevron for the Cell component. */
export function IconChevron(props: IconProps) {
  return (
    <svg {...base} width={18} height={18} {...props}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
