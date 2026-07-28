import { FileIcon } from "./FileIcon";
import { trpc } from "@/lib/trpc";
import { Loader2, Download, Eye } from "lucide-react";
import { useLocation } from "wouter";
import { useState, useEffect, useRef } from "react";

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

export function GalleryView({ items, isLoading }: GalleryViewProps) {
  const [, navigate] = useLocation();
  const getDownloadUrl = trpc.files.getDownloadUrl.useMutation();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const requestedKeys = useRef<Set<string>>(new Set());

  const mediaItems = items.filter((f) => {
    const mime = f.mimeType ?? "";
    if (mime.startsWith("image/") || mime.startsWith("video/")) return true;
    const ext = f.filename.split(".").pop()?.toLowerCase() ?? "";
    return ["jpg","jpeg","png","gif","webp","heic","heif","mp4","mov"].includes(ext);
  });

  // getDownloadUrl e' una mutation tRPC (solo POST): non puo' essere usata
  // direttamente come <img src>. Recuperiamo l'URL presigned per ogni
  // thumbnail una sola volta e lo mettiamo in cache localmente.
  useEffect(() => {
    const imageItems = mediaItems.filter((item) => item.mimeType?.startsWith("image/"));
    imageItems.forEach((item) => {
      if (requestedKeys.current.has(item.s3Key) || thumbUrls[item.s3Key]) return;
      requestedKeys.current.add(item.s3Key);
      getDownloadUrl.mutateAsync({ key: item.s3Key })
        .then(({ downloadUrl }) => {
          setThumbUrls((prev) => ({ ...prev, [item.s3Key]: downloadUrl }));
        })
        .catch(() => {
          requestedKeys.current.delete(item.s3Key);
        });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);
  
  const handleDownload = async (key: string, filename: string) => {
    try {
      const { downloadUrl } = await getDownloadUrl.mutateAsync({ key });
      const a = document.createElement("a");
      a.href = downloadUrl;
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
      {mediaItems.map((item) => {
        const isImage = item.mimeType?.startsWith("image/");
        const isVideo = item.mimeType?.startsWith("video/");
        return (
          <div
            key={item.s3Key}
            className="group relative aspect-square rounded-lg border border-border overflow-hidden bg-muted hover:border-foreground transition-colors cursor-pointer"
            onClick={() => setSelectedKey(item.s3Key)}
          >
            {isImage && (
              thumbUrls[item.s3Key] ? (
                <img
                  src={thumbUrls[item.s3Key]}
                  alt={item.filename}
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
                  navigate(`/preview/${encodeURIComponent(item.s3Key)}`);
                }}
                className="p-2 rounded-full bg-background/80 hover:bg-background transition-colors"
              >
                <Eye className="w-4 h-4" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDownload(item.s3Key, item.filename);
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
      })}
    </div>
  );
}
