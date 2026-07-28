import { FileIcon } from "./FileIcon";
import { trpc } from "@/lib/trpc";
import { Loader2, Download, Eye } from "lucide-react";
import { useLocation } from "wouter";
import { useState } from "react";

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

  const mediaItems = items.filter((f) => {
    const mime = f.mimeType ?? "";
    if (mime.startsWith("image/") || mime.startsWith("video/")) return true;
    const ext = f.filename.split(".").pop()?.toLowerCase() ?? "";
    return ["jpg","jpeg","png","gif","webp","heic","heif","mp4","mov"].includes(ext);
  });
  
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
              <img
                src={`/api/trpc/files.getDownloadUrl?key=${encodeURIComponent(item.s3Key)}`}
                alt={item.filename}
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect fill='%23f0f0f0' width='100' height='100'/%3E%3C/svg%3E";
                }}
              />
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
