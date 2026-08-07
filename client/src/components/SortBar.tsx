import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";

export type SortField = "name" | "size" | "uploadedAt" | "mimeType";
export type SortDirection = "asc" | "desc";

export interface SortState {
  field: SortField;
  direction: SortDirection;
}

interface SortBarProps {
  sort: SortState;
  onChange: (sort: SortState) => void;
  className?: string;
}

const SORT_OPTIONS: { field: SortField; label: string }[] = [
  { field: "name", label: "Nome" },
  { field: "uploadedAt", label: "Data aggiunta" },
  { field: "size", label: "Dimensione" },
  { field: "mimeType", label: "Tipo" },
];

export function SortBar({ sort, onChange, className = "" }: SortBarProps) {
  const handleClick = (field: SortField) => {
    if (sort.field === field) {
      onChange({ field, direction: sort.direction === "asc" ? "desc" : "asc" });
    } else {
      onChange({ field, direction: "asc" });
    }
  };

  return (
    <div className={`flex items-center gap-1 flex-wrap ${className}`}>
      <span className="text-xs text-muted-foreground mr-1 flex items-center gap-1">
        <ArrowUpDown className="w-3 h-3" />
        Ordina:
      </span>
      {SORT_OPTIONS.map(({ field, label }) => {
        const active = sort.field === field;
        return (
          <button
            key={field}
            onClick={() => handleClick(field)}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              active
                ? "bg-foreground text-background"
                : "border border-border hover:bg-muted text-muted-foreground"
            }`}
          >
            {label}
            {active ? (
              sort.direction === "asc" ? (
                <ArrowUp className="w-3 h-3" />
              ) : (
                <ArrowDown className="w-3 h-3" />
              )
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function applySortToItems<
  T extends { filename: string; size: number; uploadedAt: Date; mimeType: string | null }
>(items: T[], sort: SortState): T[] {
  return [...items].sort((a, b) => {
    let cmp = 0;
    switch (sort.field) {
      case "name":
        cmp = a.filename.localeCompare(b.filename, undefined, { sensitivity: "base" });
        break;
      case "size":
        cmp = a.size - b.size;
        break;
      case "uploadedAt":
        cmp = new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime();
        break;
      case "mimeType":
        cmp = (a.mimeType ?? "").localeCompare(b.mimeType ?? "", undefined, { sensitivity: "base" });
        break;
    }
    return sort.direction === "asc" ? cmp : -cmp;
  });
}
