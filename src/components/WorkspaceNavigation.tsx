"use client";

import { SideGroup, SideItem } from "./ShellParts";
import { WORKSPACE_NAVIGATION, type WorkspaceKey } from "@/lib/workspaceNavigation";

export function WorkspaceNavigation({ current, collapsed, onNavigate }: {
  current: WorkspaceKey;
  collapsed: boolean;
  onNavigate: (href: string) => void;
}) {
  return (
    <nav aria-label="Primary navigation" className="flex-1 overflow-y-auto overscroll-contain px-3 py-4">
      <SideGroup label="Workspace" collapsed={collapsed}>
        {WORKSPACE_NAVIGATION.map((item) => (
          <SideItem key={item.key} icon={item.icon} label={item.label} current={current === item.key}
            collapsed={collapsed} onClick={() => onNavigate(item.href)} />
        ))}
      </SideGroup>
    </nav>
  );
}
