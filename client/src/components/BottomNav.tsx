import { useLocation } from "wouter";
import { Archive, Upload, Search } from "lucide-react";

interface BottomNavProps {
  onUploadClick?: () => void;
}

export function BottomNav({ onUploadClick }: BottomNavProps) {
  const [location] = useLocation();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background/95 backdrop-blur-sm sm:hidden">
      <div className="flex items-center justify-around h-16 px-4">
        <a
          href="/"
          className={`flex flex-col items-center gap-1 px-4 py-2 rounded-lg transition-colors ${
            location === "/" ? "text-foreground" : "text-muted-foreground"
          }`}
        >
          <Archive className={`w-5 h-5 ${location === "/" ? "stroke-[2.5]" : "stroke-[1.5]"}`} />
          <span className="text-xs">File</span>
        </a>
        <button
          onClick={onUploadClick}
          className="flex flex-col items-center gap-1 px-4 py-2 rounded-lg transition-colors text-muted-foreground"
        >
          <Upload className="w-5 h-5 stroke-[1.5]" />
          <span className="text-xs">Carica</span>
        </button>
      </div>
    </nav>
  );
}
