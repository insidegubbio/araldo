import { FileIcon } from "./FileIcon";
import { trpc } from "@/lib/trpc";
import { Loader2, Download, Eye, Check, FolderInput, X } from "lucide-react";
import { useLocation } from "wouter";
import { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { MoveToFolderDialog } from "./MoveToFolderDialog";
import { SortBar, applySortToItems, type SortState } from "./SortBar";

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
}

function buildWorkerUrl(workerBase: string, key: string): string {
  const base = workerBase.replace(/\/+$/, "");
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return `${base}/${encodedKey}`;
}

function getThumbnailKey(originalKey: string): string {
  return `_thumbnails/${originalKey}.jpg`;
}

function useInView<T extends HTMLElement>(rootMargin = "200px") {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || inView) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setInView(true);
            observer.disconnect();
          }
        });
      },
      { rootMargin }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [inView, rootMargin]);

  return { ref, inView };
}

interface GalleryThumbProps {
  item: GalleryItem;
  workerUrl: string | null;
  resolveThumbnailUrl: (key: string, mimeType: string | null) => Promise<string>;
  onOpen: () => void;
  onDownload: () => void;
  selected: boolean;
  onToggleSelect: () => void;
}

const BROKEN_IMAGE_PLACEHOLDER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect fill='%23f0f0f0' width='100' height='100'/%3E%3C/svg%3E";

function GalleryThumb({ item, workerUrl, resolveThumbnailUrl, onOpen, onDownload, selected, onToggleSelect }: GalleryThumbProps) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const fellBackToFull = useRef(false);
  const requested = useRef(false);

  const isImage = item.mimeType?.startsWith("image/");
  const isVideo = item.mimeType?.startsWith("video/");

  useEffect(() => {
    if (!inView || !isImage || requested.current) return;
    requested.current = true;

    if (workerUrl) {
      setThumbUrl(buildWorkerUrl(workerUrl, getThumbnailKey(item.s3Key)));
      return;
    }

    resolveThumbnailUrl(item.s3Key, item.mimeType)
      .then((url) => setThumbUrl(url))
      .catch(() => {
        requested.current = false;
      });
  }, [inView, isImage, workerUrl, item.s3Key, item.mimeType, resolveThumbnailUrl]);

  const handleImgError = () => {
    if (workerUrl && !fellBackToFull.current) {
      // no thumbnail generated for this file yet: fall back to the full image
      fellBackToFull.current = true;
      setThumbUrl(buildWorkerUrl(workerUrl, item.s3Key));
      return;
    }
    setThumbUrl(BROKEN_IMAGE_PLACEHOLDER);
  };

  return (
    <div
      ref={ref}
      className={`group relative aspect-square rounded-lg border overflow-hidden bg-muted transition-colors cursor-pointer ${
        selected ? "border-foreground ring-2 ring-foreground" : "border-border hover:border-foreground"
      }`}
      onClick={onOpen}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleSelect();
        }}
        className={`absolute top-2 left-2 z-10 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-opacity ${
          selected
            ? "bg-foreground border-foreground opacity-100"
            : "bg-background/70 border-background/70 opacity-0 group-hover:opacity-100"
        }`}
        title="Seleziona"
      >
        {selected && <Check className="w-3.5 h-3.5 text-background" />}
      </button>
      {isImage && (
        thumbUrl ? (
          <img
            src={thumbUrl}
            alt={item.filename}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
            onError={handleImgError}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        )
      )}
      {isVideo && (
        <div className="w-full h-full flex items-center justify-center bg-muted">
          <FileIcon mimeType={item.mimeType} filename={item.filename} className="w-8 h-8 text-muted-foreground" />
        </div>
      )}
      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
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
      <div className="absolute bottom-0 left-0 right-0 p-2 bg-black/60 text-white text-xs truncate opacity-0 group-hover:opacity-100 transition-opacity">
        {item.filename}
      </div>
    </div>
  );
}

export function GalleryView({ items, isLoading }: GalleryViewProps) {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const settingsQuery = trpc.files.settings.useQuery();
  const workerUrl = settingsQuery.data?.workerUrl ?? null;

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [sort, setSort] = useState<SortState>({ field: "uploadedAt", direction: "desc" });

  const getDownloadUrl = trpc.files.getDownloadUrl.useMutation();
  const getThumbnailUrl = trpc.files.getThumbnailUrl.useMutation();
  const moveManyMutation = trpc.files.moveMany.useMutation({
    onSuccess: (result) => {
      if (result.failed.length > 0) {
        toast.warning(`${result.moved} spostati, ${result.failed.length} non riusciti`);
      } else {
        toast.success(`${result.moved} file spostat${result.moved === 1 ? "o" : "i"}`);
      }
      utils.files.list.invalidate();
      setSelectedKeys(new Set());
      setShowMoveDialog(false);
    },
    onError: (e) => toast.error(e.message),
  });
  const downloadUrlCache = useRef<Map<string, Promise<string>>>(new Map());
  const thumbnailUrlCache = useRef<Map<string, Promise<string>>>(new Map());

  const toggleSelected = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const resolveDownloadUrl = useCallback(
    (key: string) => {
      const cached = downloadUrlCache.current.get(key);
      if (cached) return cached;
      const promise = getDownloadUrl.mutateAsync({ key }).then((res) => res.downloadUrl);
      downloadUrlCache.current.set(key, promise);
      promise.catch(() => downloadUrlCache.current.delete(key));
      return promise;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const resolveThumbnailUrl = useCallback(
    (key: string, mimeType: string | null) => {
      const cached = thumbnailUrlCache.current.get(key);
      if (cached) return cached;
      const promise = getThumbnailUrl.mutateAsync({ key, mimeType }).then((res) => res.downloadUrl);
      thumbnailUrlCache.current.set(key, promise);
      promise.catch(() => thumbnailUrlCache.current.delete(key));
      return promise;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const mediaItems = applySortToItems(
    items.filter((f) => {
      const mime = f.mimeType ?? "";
      if (mime.startsWith("image/") || mime.startsWith("video/")) return true;
      const ext = f.filename.split(".").pop()?.toLowerCase() ?? "";
      return ["jpg","jpeg","png","gif","webp","heic","heif","mp4","mov"].includes(ext);
    }),
    sort
  );

  const handleDownload = async (key: string, filename: string) => {
    try {
      const url = workerUrl ? buildWorkerUrl(workerUrl, key) : await resolveDownloadUrl(key);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
    } catch {
      // error
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
      {selectedKeys.size > 0 && (
        <div className="flex items-center justify-between gap-2 mb-4 px-4 py-2 bg-muted rounded-lg">
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
              onClick={() => setSelectedKeys(new Set())}
              className="flex items-center gap-1 px-2 py-1.5 text-sm rounded-md hover:bg-background transition-colors text-muted-foreground"
              title="Deseleziona tutto"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      <SortBar sort={sort} onChange={setSort} className="mb-4" />

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {mediaItems.map((item) => (
          <GalleryThumb
            key={item.s3Key}
            item={item}
            workerUrl={workerUrl}
            resolveThumbnailUrl={resolveThumbnailUrl}
            onOpen={() =>
              selectedKeys.size > 0
                ? toggleSelected(item.s3Key)
                : navigate(
                    `/preview/${encodeURIComponent(item.s3Key)}${
                      item.mimeType ? `?type=${encodeURIComponent(item.mimeType)}` : ""
                    }`
                  )
            }
            onDownload={() => handleDownload(item.s3Key, item.filename)}
            selected={selectedKeys.has(item.s3Key)}
            onToggleSelect={() => toggleSelected(item.s3Key)}
          />
        ))}
      </div>

      <MoveToFolderDialog
        open={showMoveDialog}
        onOpenChange={setShowMoveDialog}
        count={selectedKeys.size}
        isMoving={moveManyMutation.isPending}
        onConfirm={(destinationPrefix) =>
          moveManyMutation.mutate({ keys: Array.from(selectedKeys), destinationPrefix })
        }
      />
    </div>
  );
}
