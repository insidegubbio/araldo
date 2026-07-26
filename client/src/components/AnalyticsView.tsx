import { trpc } from "@/lib/trpc";
import { Loader2, HardDrive, FileStack, Download } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatDistanceToNow } from "date-fns";
import { it } from "date-fns/locale";

export function AnalyticsView() {
  const { data: stats, isLoading } = trpc.files.storageStats.useQuery();
  const { data: topFiles, isLoading: isLoadingTop } = trpc.files.topAccessed.useQuery({ limit: 10 });

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
    <div className="space-y-6">
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

      <Card className="p-6">
        <h3 className="font-serif text-lg mb-4">File più scaricati</h3>
        {isLoadingTop ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : !topFiles?.length ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            Nessun download registrato finora
          </p>
        ) : (
          <div className="divide-y divide-border">
            {topFiles.map((file) => (
              <div key={file.s3Key} className="flex items-center gap-3 py-3">
                <Download className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{file.filename}</p>
                  {file.lastAccessed && (
                    <p className="text-xs text-muted-foreground">
                      ultimo accesso{" "}
                      {formatDistanceToNow(new Date(file.lastAccessed), { addSuffix: true, locale: it })}
                    </p>
                  )}
                </div>
                <span className="text-sm font-medium shrink-0">{file.accessCount}×</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
