import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Upload, X, FolderOpen, FileText, Link, Check } from "lucide-react";

// types
interface SharedFile {
  name: string;
  type: string;
  size: number;
  data: string; // base64
}

interface SharePayload {
  title: string;
  text: string;
  url: string;
  files: SharedFile[];
  receivedAt: number;
}

interface UploadingFile {
  id: string;
  name: string;
  progress: number;
  status: "pending" | "uploading" | "done" | "error";
}

// some helpers
function base64ToFile(sf: SharedFile): File {
  const binary = atob(sf.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], sf.name, { type: sf.type });
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ShareReceive() {
  const [, setLocation] = useLocation();
  const [payload, setPayload] = useState<SharePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [folder, setFolder] = useState("");
  const [uploads, setUploads] = useState<UploadingFile[]>([]);
  const [done, setDone] = useState(false);

  const getUploadUrl = trpc.files.getUploadUrl.useMutation();
  const confirmUpload = trpc.files.confirmUpload.useMutation();

  //read the payload that the service worker cached
  useEffect(() => {
    (async () => {
      try {
        const cache = await caches.open("share-target-v1");
        const response = await cache.match("/share-payload");
        if (response) {
          const data: SharePayload = await response.json();
          setPayload(data);
          await cache.delete("/share-payload");
        }
      } catch (e) {
        console.error("Could not read share payload", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const updateUpload = (id: string, patch: Partial<UploadingFile>) =>
    setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)));

  const uploadFile = async (sharedFile: SharedFile) => {
    const file = base64ToFile(sharedFile);
    const id = crypto.randomUUID();

    setUploads((prev) => [
      ...prev,
      { id, name: file.name, progress: 0, status: "pending" },
    ]);

    try {
      const { uploadUrl, key } = await getUploadUrl.mutateAsync({
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        folder,
      });

      updateUpload(id, { status: "uploading" });

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", uploadUrl);
        xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable)
            updateUpload(id, { progress: Math.round((e.loaded / e.total) * 100) });
        };
        xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`HTTP ${xhr.status}`)));
        xhr.onerror = () => reject(new Error("network error"));
        xhr.send(file);
      });

      await confirmUpload.mutateAsync({ key, size: file.size });
      updateUpload(id, { status: "done", progress: 100 });
      toast.success(`${file.name} caricato`);
    } catch (err) {
      updateUpload(id, { status: "error" });
      toast.error(`Errore caricando ${sharedFile.name}`);
    }
  };

  const handleUploadAll = async () => {
    if (!payload) return;
    await Promise.all(payload.files.map(uploadFile));
    setDone(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground text-sm">Ricezione contenuti…</p>
      </div>
    );
  }

  if (!payload || (payload.files.length === 0 && !payload.url && !payload.text)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-8 text-center">
        <p className="text-muted-foreground">Nessun contenuto ricevuto.</p>
        <Button onClick={() => setLocation("/")}>Vai alla dashboard</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <header className="flex items-center justify-between px-4 h-14 border-b">
        <div className="flex items-center gap-2">
          <Upload className="w-5 h-5 text-primary" />
          <span className="font-semibold">Condividi con Araldo</span>
        </div>
        <button
          onClick={() => setLocation("/")}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Chiudi"
        >
          <X className="w-5 h-5" />
        </button>
      </header>

      <main className="flex-1 overflow-y-auto p-4 space-y-6 max-w-lg mx-auto w-full">

        {(payload.title || payload.text || payload.url) && (
          <section className="rounded-xl border border-border p-4 space-y-2 bg-muted/30">
            {payload.title && (
              <p className="font-medium text-sm">{payload.title}</p>
            )}
            {payload.text && (
              <p className="text-sm text-muted-foreground">{payload.text}</p>
            )}
            {payload.url && (
              <a
                href={payload.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-sm text-primary underline underline-offset-2"
              >
                <Link className="w-3 h-3" />
                {payload.url}
              </a>
            )}
          </section>
        )}

        {/* file list */}
        {payload.files.length > 0 && (
          <section className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              File da caricare ({payload.files.length})
            </p>
            {payload.files.map((sf) => {
              const up = uploads.find((u) => u.name === sf.name);
              return (
                <div
                  key={sf.name}
                  className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card"
                >
                  <FileText className="w-5 h-5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{sf.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {sf.type} · {formatBytes(sf.size)}
                    </p>
                    {up?.status === "uploading" && (
                      <Progress value={up.progress} className="h-1 mt-1.5" />
                    )}
                    {up?.status === "done" && (
                      <p className="text-xs text-green-600 mt-0.5 flex items-center gap-1">
                        <Check className="w-3 h-3" /> Caricato
                      </p>
                    )}
                    {up?.status === "error" && (
                      <p className="text-xs text-destructive mt-0.5">Errore</p>
                    )}
                  </div>
                </div>
              );
            })}
          </section>
        )}

        {payload.files.length > 0 && !done && (
          <section className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <FolderOpen className="w-3.5 h-3.5" />
              Cartella di destinazione (opzionale)
            </label>
            <input
              type="text"
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              placeholder="es. foto/2025  oppure  documenti/lavoro"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="text-xs text-muted-foreground">
              Lascia vuoto per salvare nella radice. Usa "/" per creare sotto-cartelle.
            </p>
          </section>
        )}

        {/* actions */}
        {!done ? (
          payload.files.length > 0 ? (
            <Button
              className="w-full"
              onClick={handleUploadAll}
              disabled={uploads.some((u) => u.status === "uploading")}
            >
              <Upload className="w-4 h-4 mr-2" />
              Carica{folder ? ` in "${folder}"` : ""}
            </Button>
          ) : (
            <Button className="w-full" onClick={() => setLocation("/")}>
              Vai alla dashboard
            </Button>
          )
        ) : (
          <div className="flex flex-col gap-3 items-center py-4">
            <div className="rounded-full bg-green-100 p-3">
              <Check className="w-6 h-6 text-green-600" />
            </div>
            <p className="font-medium">Caricamento completato!</p>
            <Button variant="outline" onClick={() => setLocation("/")}>
              Vai alla dashboard
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
