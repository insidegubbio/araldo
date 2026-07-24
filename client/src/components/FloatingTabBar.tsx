import { Archive, Image, BarChart3, Settings } from "lucide-react";
import { useState } from "react";

export type TabId = "files" | "gallery" | "analytics" | "settings";

interface FloatingTabBarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

const tabs: Array<{ id: TabId; label: string; icon: typeof Archive }> = [
  { id: "files", label: "File", icon: Archive },
  { id: "gallery", label: "Galleria", icon: Image },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "settings", label: "Impostazioni", icon: Settings },
];

export function FloatingTabBar({ activeTab, onTabChange }: FloatingTabBarProps) {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 hidden sm:block">
      <div className="flex items-center gap-1 px-2 py-2 bg-background/90 backdrop-blur-md border border-border rounded-full shadow-lg">
        {tabs.map(({ id, label, icon: Icon }) => {
          const isActive = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => onTabChange(id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-full transition-all duration-200 text-sm font-medium ${
                isActive
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title={label}
            >
              <Icon className="w-4 h-4" />
              <span className="hidden md:inline">{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
