import type { ComponentType, SVGProps } from 'react';
import { IconGrowth, IconMachines, IconMarket, IconSettings, IconTimeline, IconToday } from '../components/icons';

export interface TabDef {
  path: string;
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
}

/** The six primary tabs — order is the tab-bar order (DESIGN.md).
    Market sits right after Today on purpose: Market is the morning screen and
    Today is the evening one, so together they bookend the day. */
export const TABS: TabDef[] = [
  { path: '/today', label: 'Today', Icon: IconToday },
  { path: '/market', label: 'Market', Icon: IconMarket },
  { path: '/timeline', label: 'Timeline', Icon: IconTimeline },
  { path: '/growth', label: 'Growth', Icon: IconGrowth },
  { path: '/machines', label: 'Machines', Icon: IconMachines },
  { path: '/settings', label: 'Settings', Icon: IconSettings },
];

export function titleForPath(pathname: string): string {
  return TABS.find((t) => pathname.startsWith(t.path))?.label ?? 'Today';
}
