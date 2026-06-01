import {
  ChevronLeftIcon,
  ChevronRightIcon,
  HomeIcon,
} from '@heroicons/react/24/outline';
import HierarchyIcon from '@web/assets/icons/hierarchy.svg?react';
import LineageIcon from '@web/assets/icons/lineage.svg?react';
import SqlIcon from '@web/assets/icons/sql.svg?react';
import { Tooltip } from '@web/elements';
import { useEffect, useState } from 'react';

import {
  type ActiveView,
  SIDEBAR_LABEL_THRESHOLD,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  useDataExplorerStore,
} from '../../stores/dataExplorerStore';

type NavItem = {
  id: ActiveView;
  label: string;
  tooltip: string;
  Icon: React.FC<{ className?: string }>;
};

const NAV_ITEMS: NavItem[] = [
  { id: 'home', label: 'Home', tooltip: 'Home', Icon: HomeIcon },
  {
    id: 'model',
    label: 'Model',
    tooltip: 'Model Lineage',
    Icon: LineageIcon,
  },
  {
    id: 'column',
    label: 'Column',
    tooltip: 'Column Lineage',
    Icon: HierarchyIcon,
  },
  { id: 'sql', label: 'SQL', tooltip: 'Adhoc Query Editor', Icon: SqlIcon },
];

interface NavButtonProps {
  item: NavItem;
  isActive: boolean;
  showLabel: boolean;
  onClick: () => void;
}

function NavButton({ item, isActive, showLabel, onClick }: NavButtonProps) {
  const { Icon, label, tooltip } = item;
  return (
    <Tooltip placement="right" content={tooltip} as="div">
      <button
        type="button"
        onClick={onClick}
        aria-label={tooltip}
        aria-current={isActive ? 'page' : undefined}
        className={`flex flex-col items-center justify-center gap-1 rounded-xl transition-colors ${
          showLabel ? 'w-14 h-14 px-1 py-2' : 'w-10 h-10'
        } ${
          isActive
            ? 'bg-primary/15 text-primary hover:bg-primary/20'
            : 'text-surface-contrast hover:bg-surface hover:text-foreground'
        }`}
      >
        <Icon className="w-5 h-5" />
        {showLabel && (
          <span className="text-[10px] leading-tight font-medium">{label}</span>
        )}
      </button>
    </Tooltip>
  );
}

export default function SidebarNav() {
  const activeView = useDataExplorerStore((s) => s.activeView);
  const setActiveView = useDataExplorerStore((s) => s.setActiveView);
  const sidebarWidth = useDataExplorerStore((s) => s.sidebarWidth);
  const setSidebarWidth = useDataExplorerStore((s) => s.setSidebarWidth);
  const toggleSidebar = useDataExplorerStore((s) => s.toggleSidebar);

  const [isDragging, setIsDragging] = useState(false);

  const showLabels = sidebarWidth >= SIDEBAR_LABEL_THRESHOLD;
  const isCollapsed =
    sidebarWidth < (SIDEBAR_MIN_WIDTH + SIDEBAR_MAX_WIDTH) / 2;

  // Attach drag listeners on window so the drag survives cursor leaving the handle.
  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      setSidebarWidth(e.clientX);
    };
    const onUp = () => setIsDragging(false);
    // Prevent text selection while dragging
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = prevUserSelect;
    };
  }, [isDragging, setSidebarWidth]);

  return (
    <div
      className="relative flex flex-col flex-shrink-0 border-r border-neutral bg-card"
      style={{
        width: sidebarWidth,
        transition: isDragging ? 'none' : 'width 150ms ease',
      }}
    >
      {/* Nav items */}
      <div className="flex flex-col items-center gap-1 p-1">
        {NAV_ITEMS.map((item) => (
          <NavButton
            key={item.id}
            item={item}
            isActive={activeView === item.id}
            showLabel={showLabels}
            onClick={() => setActiveView(item.id)}
          />
        ))}
      </div>

      {/* Spacer pushes the toggle to the bottom */}
      <div className="flex-1" />

      {/* Bottom snap toggle */}
      <button
        type="button"
        onClick={toggleSidebar}
        className="flex items-center justify-center border-t border-neutral py-2 text-surface-contrast hover:bg-surface hover:text-foreground transition-colors"
        title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-expanded={!isCollapsed}
      >
        {isCollapsed ? (
          <ChevronRightIcon className="w-4 h-4" />
        ) : (
          <ChevronLeftIcon className="w-4 h-4" />
        )}
      </button>

      {/* Drag handle - 4px-wide strip overlapping the right border */}
      <button
        type="button"
        aria-label="Resize sidebar"
        tabIndex={-1}
        onMouseDown={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/40"
      />
    </div>
  );
}
