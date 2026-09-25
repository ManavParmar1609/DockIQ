import {
  BarChart3,
  ClipboardCheck,
  FileText,
  History,
  LayoutDashboard,
  MessageSquare,
  PackageCheck,
  RadioTower,
  ArrowLeftRight,
  ShieldAlert,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';

import type { Role } from '../api/types';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  /** Shorter label for the phone tab bar. */
  short?: string;
}

export const NAV: Record<Role, NavItem[]> = {
  operator: [
    { to: '/app', label: 'Shift', icon: LayoutDashboard, end: true },
    { to: '/app/order', label: 'Order', icon: PackageCheck },
    { to: '/app/inspection', label: 'Inspect', icon: ClipboardCheck },
    { to: '/app/report', label: 'Report', icon: TriangleAlert },
    { to: '/app/issues', label: 'My issues', short: 'Issues', icon: History, end: true },
    { to: '/app/chat', label: 'Assistant', short: 'Ask', icon: MessageSquare },
  ],
  supervisor: [
    { to: '/app', label: 'Floor', icon: LayoutDashboard, end: true },
    { to: '/app/log', label: 'Issue log', short: 'Log', icon: FileText },
    { to: '/app/analytics', label: 'Analytics', short: 'Stats', icon: BarChart3 },
    { to: '/app/handoff', label: 'Handoff', icon: ArrowLeftRight },
    { to: '/app/sim', label: 'Simulator', short: 'Sim', icon: RadioTower },
    { to: '/app/chat', label: 'Assistant', short: 'Ask', icon: MessageSquare },
  ],
  quality: [
    { to: '/app', label: 'Quality', icon: ShieldAlert, end: true },
    { to: '/app/log', label: 'Issue log', icon: FileText },
    { to: '/app/analytics', label: 'Analytics', icon: BarChart3 },
    { to: '/app/sim', label: 'Simulator', short: 'Sim', icon: RadioTower },
  ],
};

export const ROLE_LABEL: Record<Role, string> = {
  operator: 'Dock operator',
  supervisor: 'Supervisor',
  quality: 'Quality',
};
