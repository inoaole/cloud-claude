import type { ComponentType, SVGProps } from 'react';
import { IconGrowth, IconMachines, IconSettings, IconTimeline, IconToday } from '../components/icons';

export interface TabDef {
  path: string;
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
}

/** The five primary tabs — order is the tab-bar order (DESIGN.md). */
export const TABS: TabDef[] = [
  { path: '/today', label: 'Today', Icon: IconToday },
  { path: '/timeline', label: 'Timeline', Icon: IconTimeline },
  { path: '/growth', label: 'Growth', Icon: IconGrowth },
  { path: '/machines', label: 'Machines', Icon: IconMachines },
  { path: '/settings', label: 'Settings', Icon: IconSettings },
];

export function titleForPath(pathname: string): string {
  return TABS.find((t) => pathname.startsWith(t.path))?.label ?? 'Today';
}
