import { useRef, useState } from "react";
import { Upload, X, FolderUp } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";

interface UploadDropzoneProps {
  onUploaded?: () => void;
  folder?: string;
  existingFilenames?: string[];
}

interface UploadingFile {
  id: string;
  name: string;
  relativePath: string;
  progress: number;
  status: "pending" | "uploading" | "done" | "error";
}

interface FileToUpload {
  file: File;
  relativePath: string;
}

const MAX_CONCURRENT_UPLOADS = 4;
const MAX_RETRIES = 4;
const RETRY_BASE_DELAY_MS = 800;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function traverseEntry(
  entry: FileSystemEntry,
  basePath: string,
  out: FileToUpload[]
): Promise<void> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    const file = await new Promise<File>((resolve, reject) => fileEntry.file(resolve, reject));
    out.push({ file, relativePath: basePath });
    return;
  }

  if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry;
    const reader = dirEntry.createReader();
    const childPath = basePath ? `${basePath}/${entry.name}` : entry.name;
    const readBatch = () =>
      new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));

    // readEntries must be called repeatedly until it returns an empty array
    let entries: FileSystemEntry[] = [];
    while (true) {
      const batch = await readBatch();
      if (batch.length === 0) break;
      entries = entries.concat(batch);
    }

    for (const child of entries) {
      await traverseEntry(child, childPath, out);
    }
  }
}

async function collectFilesFromDataTransfer(dataTransfer: DataTransfer): Promise<FileToUpload[]> {
  const items = Array.from(dataTransfer.items);
  const supportsEntries = items.length > 0 && typeof items[0].webkitGetAsEntry === "function";

  if (!supportsEntries) {
    return Array.from(dataTransfer.files).map((file) => ({ file, relativePath: "" }));
  }

  const out: FileToUpload[] = [];
  await Promise.all(
    items.map(async (item) => {
      const entry = item.webkitGetAsEntry?.();
      if (entry) {
        await traverseEntry(entry, "", out);
      } else {
        const file = item.getAsFile();
        if (file) out.push({ file, relativePath: "" });
      }
    })
  );
  return out;
}

function filesFromFileList(fileList: FileList): FileToUpload[] {
  return Array.from(fileList).map((file) => {
    const relPath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
    if (relPath && relPath.includes("/")) {
      return { file, relativePath: relPath.split("/").slice(0, -1).join("/") };
    }
    return { file, relativePath: "" };
  });
}

export function UploadDropzone({ onUploaded, folder = "", existingFilenames = [] }: UploadDropzoneProps) {
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState<UploadingFile[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const getUploadUrl = trpc.files.getUploadUrl.useMutation();
  const confirmUpload = trpc.files.confirmUpload.useMutation();

  const updateUpload = (id: string, patch: Partial<UploadingFile>) =>
    setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)));

  const uploadOnce = async (file: File, relativePath: string, id: string) => {
    const { uploadUrl, key } = await getUploadUrl.mutateAsync({
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      folder,
      relativePath,
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

  const uploadFile = async ({ file, relativePath }: FileToUpload) => {
    const id = crypto.randomUUID();
    const displayName = relativePath ? `${relativePath}/${file.name}` : file.name;
    setUploads((prev) => [
      ...prev,
      { id, name: file.name, relativePath, progress: 0, status: "pending" },
    ]);

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        await uploadOnce(file, relativePath, id);
        updateUpload(id, { status: "done", progress: 100 });
        toast.success(`${displayName} caricato`);
        onUploaded?.();
        return;
      } catch (err) {
        const isLastAttempt = attempt === MAX_RETRIES;
        if (isLastAttempt) {
          updateUpload(id, { status: "error" });
          toast.error(`Errore caricando ${displayName} (dopo ${MAX_RETRIES + 1} tentativi)`);
        } else {
          // esponential backoff: 0.8s, 1.6s, ...
          await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
        }
      }
    }
  };

  const runQueue = async (files: FileToUpload[]) => {
    let cursor = 0;
    const worker = async () => {
      while (cursor < files.length) {
        const item = files[cursor];
        cursor += 1;
        await uploadFile(item);
      }
    };
    const workers = Array.from({ length: Math.min(MAX_CONCURRENT_UPLOADS, files.length) }, worker);
    await Promise.all(workers);
  };

  const handleFileItems = (items: FileToUpload[]) => {
    if (items.length === 0) return;

    const topLevelItems = items.filter((i) => !i.relativePath);
    if (existingFilenames.length > 0 && topLevelItems.length > 0) {
      const existingSet = new Set(existingFilenames.map((n) => n.toLowerCase()));
      const duplicates = topLevelItems.filter((i) => existingSet.has(i.file.name.toLowerCase()));
      if (duplicates.length > 0) {
        const names = duplicates.map((d) => d.file.name).join(", ");
        toast.warning(
          duplicates.length === 1
            ? `"${names}" esiste già in questa cartella e verrà sovrascritto`
            : `${duplicates.length} file esistono già e verranno sovrascritti: ${names}`
        );
      }
    }

    if (items.length > 20) {
      toast.info(`Carico ${items.length} file, ${MAX_CONCURRENT_UPLOADS} alla volta...`);
    }
    runQueue(items);
  };

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    handleFileItems(filesFromFileList(files));
  };

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={async (e) => {
          e.preventDefault();
          setDragging(false);
          const items = await collectFilesFromDataTransfer(e.dataTransfer);
          handleFileItems(items);
        }}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
          dragging ? "border-foreground bg-muted" : "border-border hover:border-muted-foreground"
        }`}
      >
        <Upload className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
        <p className="text-sm font-medium">Trascina i file o le cartelle qui</p>
        <p className="text-xs text-muted-foreground mt-1">oppure clicca per selezionare</p>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); folderInputRef.current?.click(); }}
          className="inline-flex items-center gap-1.5 mt-3 text-xs font-medium text-foreground hover:underline"
        >
          <FolderUp className="w-3.5 h-3.5" />
          Seleziona una cartella
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
        />
        <input
          ref={folderInputRef}
          type="file"
          multiple
          // @ts-ignore - non-standard attributes needed to enable folder selection in supporting browsers
          webkitdirectory=""
          directory=""
          className="hidden"
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
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
                <p className="text-sm truncate">
                  {u.relativePath && (
                    <span className="text-muted-foreground">{u.relativePath}/</span>
                  )}
                  {u.name}
                </p>
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
