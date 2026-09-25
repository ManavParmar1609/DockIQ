/** Icons for the taxonomy's stable icon keys (served by GET /api/taxonomy). Never emoji. */
import {
  CalendarDays,
  FileText,
  List,
  LockKeyhole,
  Package,
  ScanLine,
  Server,
  ShieldAlert,
  Shuffle,
  Thermometer,
  TriangleAlert,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

const ISSUE_ICONS: Record<string, LucideIcon> = {
  thermometer: Thermometer,
  alert: TriangleAlert,
  package: Package,
  shuffle: Shuffle,
  list: List,
  calendar: CalendarDays,
  lock: LockKeyhole,
  shield: ShieldAlert,
  wrench: Wrench,
  server: Server,
  scan: ScanLine,
  file: FileText,
};

export function issueIcon(key: string): LucideIcon {
  return ISSUE_ICONS[key] ?? TriangleAlert;
}
