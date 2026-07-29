import { FileIcon } from "./FileIcon";
import { MoveToFolderDialog } from "./MoveToFolderDialog";
import { trpc } from "@/lib/trpc";
import { Loader2, Download, Eye, FolderInput, X, CheckCircle2 } from "lucide-react";
import { useLocation } from "wouter";
import { useEffect, useRef, useState, useCallback, memo } from "react";
import { toast } from "sonner";

interface GalleryItem {
  s3Key: string;
  filename: string;
  mimeType: string | null;
  size: number;
  uploadedAt: Date;
}

interface GalleryViewProps {
  items: GalleryItem[];
  isLoading?: boolean;
  currentPrefix?: string;
  onMoved?: () => void;
}

// some otimization things

const MAX_CONCURRENT_THUMB_FETCHES = 4;
let activeThumbFetches = 0;
const thumbFetchQueue: (() => void)[] = [];
const thumbUrlCache = new Map<string, string>();

function withThumbConcurrencyLimit<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = () => {
      activeThumbFetches++;
      fn()
        .then(resolve, reject)
        .finally(() => {
          activeThumbFetches--;
          const next = thumbFetchQueue.shift();
          if (next) next();
        });
    };
    if (activeThumbFetches < MAX_CONCURRENT_THUMB_FETCHES) run();
    else thumbFetchQueue.push(run);
  });
}

export function GalleryView({ items, isLoading, currentPrefix = "", onMoved }: GalleryViewProps) {
  const [, navigate] = useLocation();
  const getDownloadUrl = trpc.files.getDownloadUrl.useMutation();
  const utils = trpc.useUtils();
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [showMoveDialog, setShowMoveDialog] = useState(false);

  const moveMutation = trpc.files.moveMany.useMutation({
    onSuccess: (result) => {
      if (result.failed.length > 0) {
        toast.warning(`${result.moved} spostati, ${result.failed.length} non riusciti`);
      } else {
        toast.success(`${result.moved} file spostati`);
      }
      utils.files.list.invalidate();
      setSelectedKeys(new Set());
      setSelectMode(false);
      setShowMoveDialog(false);
      onMoved?.();
    },
    onError: (e) => toast.error(e.message),
  });

  const mediaItems = items.filter((f) => {
    const mime = f.mimeType ?? "";
    if (mime.startsWith("image/") || mime.startsWith("video/")) return true;
    const ext = f.filename.split(".").pop()?.toLowerCase() ?? "";
    return ["jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "mp4", "mov"].includes(ext);
  });

  const toggleSelected = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const currentFileKeys = data?.items?.map((f) => f.s3Key) ?? [];
  const allSelected = currentFileKeys.length > 0 && currentFileKeys.every((k) => selectedKeys.has(k));

  const toggleSelectAll = () => {
    setSelectedKeys((prev) => {
      if (allSelected) return new Set();
      const next = new Set(prev);
      currentFileKeys.forEach((k) => next.add(k));
      return next;
    });
  };

  const handleBulkDownload = async () => {
    const files = data?.items?.filter((f) => selectedKeys.has(f.s3Key)) ?? [];
    for (const file of files) {
      await handleDownload(file.s3Key, file.filename);
      await new Promise((r) => setTimeout(r, 200));
    }
  };

  const handleDownload = async (key: string, filename: string) => {
    try {
      const { downloadUrl } = await getDownloadUrl.mutateAsync({ key });
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = filename;
      a.click();
    } catch {
      toast.error("Impossibile generare il link di download");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (mediaItems.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-muted-foreground text-sm">Nessuna immagine o video</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-3">
        {selectMode && selectedKeys.size > 0 ? (
          <div className="flex items-center justify-between gap-2 w-full px-4 py-2 bg-muted rounded-lg">
            <span className="text-sm font-medium">
              {selectedKeys.size} selezionat{selectedKeys.size === 1 ? "o" : "i"}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowMoveDialog(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-border hover:bg-background transition-colors"
              >
                <FolderInput className="w-3.5 h-3.5" />
                Sposta
              </button>
              <button
                onClick={() => {
                  setSelectedKeys(new Set());
                  setSelectMode(false);
                }}
                className="flex items-center gap-1 px-2 py-1.5 text-sm rounded-md hover:bg-background transition-colors text-muted-foreground"
                title="Annulla selezione"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setSelectMode((v) => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border transition-colors ${
              selectMode
                ? "border-foreground bg-foreground text-background"
                : "border-border hover:bg-muted"
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Seleziona
          </button>
        )}
      </div>

            <BottomNav onUploadClick={() => setShowUpload((v) => !v)} />
      <FloatingTabBar activeTab={activeTab} onTabChange={setActiveTab} />

      <AlertDialog open={!!deleteKey} onOpenChange={(o) => !o && setDeleteKey(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Elimina file</AlertDialogTitle>
            <AlertDialogDescription>
              Questa azione è irreversibile. Il file verrà eliminato definitivamente dal bucket S3.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteKey && deleteMutation.mutate({ key: deleteKey })}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Elimina"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkDeleteConfirm} onOpenChange={setBulkDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Elimina {selectedKeys.size} file</AlertDialogTitle>
            <AlertDialogDescription>
              Questa azione è irreversibile. I file selezionati verranno eliminati definitivamente dal bucket S3.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteManyMutation.mutate({ keys: Array.from(selectedKeys) })}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteManyMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Elimina"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showNewFolder} onOpenChange={setShowNewFolder}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuova cartella</DialogTitle>
          </DialogHeader>
          <input
            type="text"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="Nome cartella"
            className="w-full px-3 py-2 border border-border rounded-lg text-sm"
            onKeyDown={(e) => e.key === "Enter" && handleCreateFolder()}
          />
          <DialogFooter>
            <button
              onClick={() => setShowNewFolder(false)}
              className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted transition-colors"
            >
              Annulla
            </button>
            <button
              onClick={handleCreateFolder}
              disabled={mkdirMutation.isPending}
              className="px-4 py-2 text-sm bg-foreground text-background rounded-lg hover:opacity-90 transition-opacity disabled:opacity-60"
            >
              {mkdirMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Crea"
              )}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!renameTarget} onOpenChange={(o) => !o && setRenameTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rinomina file</DialogTitle>
          </DialogHeader>
          <input
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            placeholder="Nuovo nome file"
            className="w-full px-3 py-2 border border-border rounded-lg text-sm"
            onKeyDown={(e) => e.key === "Enter" && handleRename()}
            autoFocus
          />
          <DialogFooter>
            <button
              onClick={() => setRenameTarget(null)}
              className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted transition-colors"
            >
              Annulla
            </button>
            <button
              onClick={handleRename}
              disabled={renameMutation.isPending}
              className="px-4 py-2 text-sm bg-foreground text-background rounded-lg hover:opacity-90 transition-opacity disabled:opacity-60"
            >
              {renameMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Rinomina"
              )}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!folderDeleteConfirm} onOpenChange={(o) => !o && setFolderDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Elimina cartella</AlertDialogTitle>
            <AlertDialogDescription>
              Questa azione è irreversibile. La cartella e tutto il suo contenuto verranno eliminati definitivamente dal bucket S3.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => folderDeleteConfirm && deleteFolderMutation.mutate({ prefix: folderDeleteConfirm })}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteFolderMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Elimina"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!folderRenameTarget} onOpenChange={(o) => !o && setFolderRenameTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rinomina cartella</DialogTitle>
          </DialogHeader>
          <input
            type="text"
            value={folderRenameValue}
            onChange={(e) => setFolderRenameValue(e.target.value)}
            placeholder="Nuovo nome cartella"
            className="w-full px-3 py-2 border border-border rounded-lg text-sm"
            onKeyDown={(e) => e.key === "Enter" && handleRenameFolder()}
            autoFocus
          />
          <DialogFooter>
            <button
              onClick={() => setFolderRenameTarget(null)}
              className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted transition-colors"
            >
              Annulla
            </button>
            <button
              onClick={handleRenameFolder}
              disabled={renameFolderMutation.isPending}
              className="px-4 py-2 text-sm bg-foreground text-background rounded-lg hover:opacity-90 transition-opacity disabled:opacity-60"
            >
              {renameFolderMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Rinomina"
              )}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>

        {activeTab === "gallery" && (
          <GalleryView
            items={data?.items ?? []}
            isLoading={isLoading}
            currentPrefix={currentPrefix}
            onMoved={() => utils.files.list.invalidate()}
          />
        )}

        {activeTab === "analytics" && <AnalyticsView />}

        {activeTab === "settings" && <SettingsView />}
      </main>

      <MoveToFolderDialog
        open={showMoveDialog}
        onOpenChange={setShowMoveDialog}
        count={selectedKeys.size}
        initialPrefix={currentPrefix}
        isMoving={moveMutation.isPending}
        onConfirm={(destinationPrefix) => {
          moveMutation.mutate({ keys: Array.from(selectedKeys), destinationPrefix });
        }}
      />
    </div>
  );
}

interface GalleryThumbProps {
  item: GalleryItem;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  onPreview: () => void;
  onDownload: () => void;
}

const GalleryThumb = memo(function GalleryThumb({
  item,
  selectMode,
  selected,
  onToggleSelect,
  onOpen,
  onPreview,
  onDownload,
}: GalleryThumbProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const requestedRef = useRef(false);
  const [thumbUrl, setThumbUrl] = useState<string | undefined>(thumbUrlCache.get(item.s3Key));
  const getDownloadUrl = trpc.files.getDownloadUrl.useMutation();

  const isImage = item.mimeType?.startsWith("image/");
  const isVideo = item.mimeType?.startsWith("video/");

  const fetchThumb = useCallback(() => {
    if (requestedRef.current || thumbUrl) return;
    requestedRef.current = true;
    withThumbConcurrencyLimit(() => getDownloadUrl.mutateAsync({ key: item.s3Key }))
      .then(({ downloadUrl }) => {
        thumbUrlCache.set(item.s3Key, downloadUrl);
        setThumbUrl(downloadUrl);
      })
      .catch(() => {
        requestedRef.current = false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.s3Key, thumbUrl]);

  useEffect(() => {
    if (!isImage || thumbUrl) return;
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          fetchThumb();
          observer.disconnect();
        }
      },
      { rootMargin: "300px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [isImage, thumbUrl, fetchThumb]);

  return (
    <div
      ref={containerRef}
      className={`group relative aspect-square rounded-lg border overflow-hidden bg-muted transition-colors cursor-pointer ${
        selected ? "border-foreground ring-2 ring-foreground" : "border-border hover:border-foreground"
      }`}
      onClick={onOpen}
    >
      {isImage &&
        (thumbUrl ? (
          <img
            src={thumbUrl}
            alt={item.filename}
            className="w-full h-full object-cover"
            loading="lazy"
            decoding="async"
            onError={(e) => {
              (e.target as HTMLImageElement).src =
                "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect fill='%23f0f0f0' width='100' height='100'/%3E%3C/svg%3E";
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        ))}
      {isVideo && (
        <div className="w-full h-full flex items-center justify-center bg-muted">
          <FileIcon mimeType={item.mimeType} filename={item.filename} className="w-8 h-8 text-muted-foreground" />
        </div>
      )}

      {selectMode && (
        <div
          className="absolute top-2 left-2 w-5 h-5 rounded-full border-2 border-white shadow flex items-center justify-center bg-black/30"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect();
          }}
        >
          {selected && <div className="w-3 h-3 rounded-full bg-white" />}
        </div>
      )}

      {!selectMode && (
        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPreview();
            }}
            className="p-2 rounded-full bg-background/80 hover:bg-background transition-colors"
          >
            <Eye className="w-4 h-4" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDownload();
            }}
            className="p-2 rounded-full bg-background/80 hover:bg-background transition-colors"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      )}
      <div className="absolute bottom-0 left-0 right-0 p-2 bg-black/60 text-white text-xs truncate opacity-0 group-hover:opacity-100 transition-opacity">
        {item.filename}
      </div>
    </div>
  );
});
