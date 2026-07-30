import { FileIcon } from "./FileIcon";
import { trpc } from "@/lib/trpc";
import { Loader2, Download, Eye } from "lucide-react";
import { useLocation } from "wouter";
import { useState, useEffect, useRef, useCallback } from "react";

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
  resolveDownloadUrl: (key: string) => Promise<string>;
  onOpen: () => void;
  onDownload: () => void;
}

function GalleryThumb({ item, workerUrl, resolveDownloadUrl, onOpen, onDownload }: GalleryThumbProps) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const requested = useRef(false);

  const isImage = item.mimeType?.startsWith("image/");
  const isVideo = item.mimeType?.startsWith("video/");

  useEffect(() => {
    if (!inView || !isImage || requested.current) return;
    requested.current = true;

    if (workerUrl) {
      setThumbUrl(buildWorkerUrl(workerUrl, item.s3Key));
      return;
    }

    resolveDownloadUrl(item.s3Key)
      .then((url) => setThumbUrl(url))
      .catch(() => {
        requested.current = false;
      });
  }, [inView, isImage, workerUrl, item.s3Key, resolveDownloadUrl]);

  return (
    <div
      ref={ref}
      className="group relative aspect-square rounded-lg border border-border overflow-hidden bg-muted hover:border-foreground transition-colors cursor-pointer"
      onClick={onOpen}
    >
      {isImage && (
        thumbUrl ? (
          <img
            src={thumbUrl}
            alt={item.filename}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect fill='%23f0f0f0' width='100' height='100'/%3E%3C/svg%3E";
            }}
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
  const settingsQuery = trpc.files.settings.useQuery();
  const workerUrl = settingsQuery.data?.workerUrl ?? null;

  const getDownloadUrl = trpc.files.getDownloadUrl.useMutation();
  const downloadUrlCache = useRef<Map<string, Promise<string>>>(new Map());

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

  const mediaItems = items.filter((f) => {
    const mime = f.mimeType ?? "";
    if (mime.startsWith("image/") || mime.startsWith("video/")) return true;
    const ext = f.filename.split(".").pop()?.toLowerCase() ?? "";
    return ["jpg","jpeg","png","gif","webp","heic","heif","mp4","mov"].includes(ext);
  });

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
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
      {mediaItems.map((item) => (
        <GalleryThumb
          key={item.s3Key}
          item={item}
          workerUrl={workerUrl}
          resolveDownloadUrl={resolveDownloadUrl}
          onOpen={() => navigate(`/preview/${encodeURIComponent(item.s3Key)}`)}
          onDownload={() => handleDownload(item.s3Key, item.filename)}
        />
      ))}
    </div>
  );
}
