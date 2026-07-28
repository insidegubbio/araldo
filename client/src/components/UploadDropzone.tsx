import { useRef, useState } from "react";
import { Upload, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";

interface UploadDropzoneProps {
  onUploaded?: () => void;
  folder?: string;
}

interface UploadingFile {
  id: string;
  name: string;
  progress: number;
  status: "pending" | "uploading" | "done" | "error";
}

const MAX_CONCURRENT_UPLOADS = 4;
const MAX_RETRIES = 4;
const RETRY_BASE_DELAY_MS = 800;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function UploadDropzone({ onUploaded, folder = "" }: UploadDropzoneProps) {
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState<UploadingFile[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const getUploadUrl = trpc.files.getUploadUrl.useMutation();
  const confirmUpload = trpc.files.confirmUpload.useMutation();

  const updateUpload = (id: string, patch: Partial<UploadingFile>) =>
    setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)));

  const uploadOnce = async (file: File, id: string) => {
    const { uploadUrl, key } = await getUploadUrl.mutateAsync({
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      folder,
    });
    updateUpload(id, { status: "uploading", progress: 0 });
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
  };

  const uploadFile = async (file: File) => {
    const id = crypto.randomUUID();
    setUploads((prev) => [...prev, { id, name: file.name, progress: 0, status: "pending" }]);

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        await uploadOnce(file, id);
        updateUpload(id, { status: "done", progress: 100 });
        toast.success(`${file.name} caricato`);
        onUploaded?.();
        return;
      } catch (err) {
        const isLastAttempt = attempt === MAX_RETRIES;
        if (isLastAttempt) {
          updateUpload(id, { status: "error" });
          toast.error(`Errore caricando ${file.name} (dopo ${MAX_RETRIES + 1} tentativi)`);
        } else {
          // esponential backoff: 0.8s, 1.6s, ...
          await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
        }
      }
    }
  };

  const runQueue = async (files: File[]) => {
    let cursor = 0;
    const worker = async () => {
      while (cursor < files.length) {
        const file = files[cursor];
        cursor += 1;
        await uploadFile(file);
      }
    };
    const workers = Array.from({ length: Math.min(MAX_CONCURRENT_UPLOADS, files.length) }, worker);
    await Promise.all(workers);
  };

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const fileArray = Array.from(files);
    if (fileArray.length > 20) {
      toast.info(`Carico ${fileArray.length} file, ${MAX_CONCURRENT_UPLOADS} alla volta...`);
    }
    runQueue(fileArray);
  };

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
          dragging ? "border-foreground bg-muted" : "border-border hover:border-muted-foreground"
        }`}
      >
        <Upload className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
        <p className="text-sm font-medium">Trascina i file qui</p>
        <p className="text-xs text-muted-foreground mt-1">oppure clicca per selezionare</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {uploads.length > 5 && (
        <p className="text-xs text-muted-foreground">
          {uploads.filter((u) => u.status === "done").length} / {uploads.length} completati
          {uploads.some((u) => u.status === "error") &&
            ` — ${uploads.filter((u) => u.status === "error").length} falliti`}
        </p>
      )}

      {uploads.length > 0 && (
        <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
          {uploads.map((u) => (
            <div key={u.id} className="flex items-center gap-3 p-3 border border-border rounded-lg">
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">{u.name}</p>
                {u.status === "uploading" && (
                  <Progress value={u.progress} className="h-1 mt-1.5" />
                )}
                {u.status === "done" && (
                  <p className="text-xs text-muted-foreground mt-0.5">Completato</p>
                )}
                {u.status === "error" && (
                  <p className="text-xs text-destructive mt-0.5">Errore</p>
                )}
              </div>
              <button
                onClick={() => setUploads((prev) => prev.filter((x) => x.id !== u.id))}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
