import { rovingKeyDown, rovingTabIndex } from '../lib/roving';

/** A segmented tab bar with roving focus. The caller renders the tabpanel with id `panelId`. */
export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  label,
  panelId,
  numbered = false,
}: {
  tabs: readonly { id: T; label: string }[];
  active: T;
  onChange: (tab: T) => void;
  label: string;
  panelId: string;
  numbered?: boolean;
}) {
  const current = tabs.findIndex((tab) => tab.id === active);
  return (
    <div
      role="tablist"
      aria-label={label}
      className="grid grid-flow-col gap-1 overflow-x-auto rounded-xl bg-paper-sunk p-1"
      onKeyDown={rovingKeyDown('tab', current, tabs.length, (index) => {
        const tab = tabs[index];
        if (tab) onChange(tab.id);
      })}
    >
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          id={`${panelId}-tab-${tab.id}`}
          role="tab"
          type="button"
          aria-selected={active === tab.id}
          aria-controls={active === tab.id ? panelId : undefined}
          tabIndex={rovingTabIndex(index, current)}
          onClick={() => onChange(tab.id)}
          className={`flex min-h-12 items-center justify-center gap-2 rounded-lg px-3 whitespace-nowrap transition-colors ${active === tab.id ? 'bg-accent text-on-accent' : 'text-ink-mute hover:bg-paper-deep hover:text-ink'}`}
        >
          {numbered && <span className="telemetry text-sm">{index + 1}</span>}
          <span className="text-base font-semibold">{tab.label}</span>
        </button>
      ))}
    </div>
  );
}
