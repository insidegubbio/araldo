import { trpc } from "@/lib/trpc";
import { Loader2, HardDrive, FileStack } from "lucide-react";
import { Card } from "@/components/ui/card";

export function AnalyticsView() {
  const { data: stats, isLoading } = trpc.files.storageStats.useQuery();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="py-16 text-center">
        <p className="text-muted-foreground text-sm">Impossibile caricare le statistiche</p>
      </div>
    );
  }

  function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card className="p-6">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-lg bg-muted">
            <HardDrive className="w-6 h-6 text-foreground" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground mb-1">Spazio utilizzato</p>
            <p className="text-2xl font-serif font-bold">{stats.totalSizeGB} GB</p>
            <p className="text-xs text-muted-foreground mt-2">{formatBytes(stats.totalSize)}</p>
          </div>
        </div>
      </Card>
      <Card className="p-6">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-lg bg-muted">
            <FileStack className="w-6 h-6 text-foreground" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground mb-1">Numero file</p>
            <p className="text-2xl font-serif font-bold">{stats.fileCount}</p>
            <p className="text-xs text-muted-foreground mt-2">file totali</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
