import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { TopBar } from "@/components/TopBar";
import { BottomNav } from "@/components/BottomNav";
import { FileIcon } from "@/components/FileIcon";
import { UploadDropzone } from "@/components/UploadDropzone";
import { FloatingTabBar, type TabId } from "@/components/FloatingTabBar";
import { GalleryView } from "@/components/GalleryView";
import { AnalyticsView } from "@/components/AnalyticsView";
import { SettingsView } from "@/components/SettingsView";
import { trpc } from "@/lib/trpc";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  Loader2,
  Search,
  Trash2,
  Upload,
  FolderPlus,
  Folder,
  Pencil,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { it } from "date-fns/locale";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export default function Dashboard() {
  const { isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showUpload, setShowUpload] = useState(false);
  const [deleteKey, setDeleteKey] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("files");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renameTarget, setRenameTarget] = useState<{ key: string; filename: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [currentPrefix, setCurrentPrefix] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const pageSize = 20;

  useEffect(() => {
    if (!loading && !isAuthenticated) navigate("/login");
  }, [isAuthenticated, loading, navigate]);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [currentPrefix]);

  useEffect(() => {
    setSelectedKeys(new Set());
  }, [currentPrefix, debouncedSearch, page]);

  const utils = trpc.useUtils();
  const { data, isLoading, isFetching } = trpc.files.list.useQuery(
    { search: debouncedSearch, page, pageSize, prefix: currentPrefix },
    { enabled: isAuthenticated, refetchOnWindowFocus: false }
  );
  const getDownloadUrl = trpc.files.getDownloadUrl.useMutation();
  const deleteMutation = trpc.files.delete.useMutation({
    onSuccess: () => {
      toast.success("File eliminato");
      utils.files.list.invalidate();
      setDeleteKey(null);
    },
    onError: (e) => toast.error(e.message),
  });
  const mkdirMutation = trpc.files.mkdir.useMutation({
    onSuccess: () => {
      toast.success("Cartella creata");
      utils.files.list.invalidate();
      setShowNewFolder(false);
      setNewFolderName("");
    },
    onError: (e) => toast.error(e.message),
  });
  const renameMutation = trpc.files.rename.useMutation({
    onSuccess: () => {
      toast.success("File rinominato");
      utils.files.list.invalidate();
      setRenameTarget(null);
      setRenameValue("");
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteManyMutation = trpc.files.deleteMany.useMutation({
    onSuccess: (result) => {
      if (result.failed.length > 0) {
        toast.warning(`${result.deleted} eliminati, ${result.failed.length} non riusciti`);
      } else {
        toast.success(`${result.deleted} file eliminati`);
      }
      utils.files.list.invalidate();
      setSelectedKeys(new Set());
      setBulkDeleteConfirm(false);
    },
    onError: (e) => toast.error(e.message),
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
      // piccola pausa per evitare che il browser blocchi download multipli simultanei
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

  const handleRename = () => {
    if (!renameTarget) return;
    if (!renameValue.trim()) {
      toast.error("Nome file non valido");
      return;
    }
    if (renameValue.trim() === renameTarget.filename) {
      setRenameTarget(null);
      return;
    }
    renameMutation.mutate({ oldKey: renameTarget.key, newName: renameValue.trim() });
  };

  const handleCreateFolder = () => {
    if (!newFolderName.trim()) {
      toast.error("Nome cartella non valido");
      return;
    }
    mkdirMutation.mutate({ folderName: newFolderName, prefix: currentPrefix });
  };

  const openFolder = (folderPrefix: string) => {
    setSearch("");
    setDebouncedSearch("");
    setCurrentPrefix(folderPrefix);
  };

  // Breadcrumb segments derived from the current prefix, e.g.
  // "foto/vacanze/" -> [{ name: "foto", prefix: "foto/" }, { name: "vacanze", prefix: "foto/vacanze/" }]
  const breadcrumbs = currentPrefix
    .split("/")
    .filter(Boolean)
    .map((name, i, arr) => ({
      name,
      prefix: arr.slice(0, i + 1).join("/") + "/",
    }));

  const totalPages = data ? Math.ceil(data.total / pageSize) : 0;

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <TopBar />

      <main className="flex-1 container py-6 pb-24 sm:pb-32">
        <div className="flex items-start justify-between mb-8 gap-4">
          <div>
            <h1 className="font-serif text-3xl mb-1">File</h1>
            <p className="text-muted-foreground text-sm">
              {data ? `${data.total} file${currentPrefix ? " in questa cartella" : " nel bucket"}` : "Caricamento…"}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setShowNewFolder(true)}
              className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors"
            >
              <FolderPlus className="w-4 h-4" />
              <span className="hidden sm:inline">Nuova cartella</span>
            </button>
            <button
              onClick={() => setShowUpload((v) => !v)}
              className="flex items-center gap-2 px-4 py-2 bg-foreground text-background rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
            >
              <Upload className="w-4 h-4" />
              <span>Carica</span>
            </button>
          </div>
        </div>

        {activeTab === "files" && (
          <>
            {showUpload && (
              <div className="mb-8 animate-fade-in">
                <UploadDropzone
                  folder={currentPrefix.replace(/\/$/, "")}
                  onUploaded={() => {
                    utils.files.list.invalidate();
                    setShowUpload(false);
                  }}
                />
              </div>
            )}

            <div className="flex items-center gap-1 mb-4 text-sm overflow-x-auto whitespace-nowrap">
              <button
                onClick={() => openFolder("")}
                className={`px-2 py-1 rounded hover:bg-muted transition-colors ${
                  currentPrefix === "" ? "font-medium text-foreground" : "text-muted-foreground"
                }`}
              >
                Home
              </button>
              {breadcrumbs.map((crumb) => (
                <span key={crumb.prefix} className="flex items-center gap-1">
                  <span className="text-muted-foreground">/</span>
                  <button
                    onClick={() => openFolder(crumb.prefix)}
                    className={`px-2 py-1 rounded hover:bg-muted transition-colors ${
                      crumb.prefix === currentPrefix ? "font-medium text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {crumb.name}
                  </button>
                </span>
              ))}
            </div>

            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cerca file…"
                className="pl-9"
              />
            </div>

            {selectedKeys.size > 0 && (
              <div className="flex items-center justify-between gap-2 mb-3 px-4 py-2 bg-muted rounded-lg">
                <span className="text-sm font-medium">
                  {selectedKeys.size} selezionat{selectedKeys.size === 1 ? "o" : "i"}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleBulkDownload}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-border hover:bg-background transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Scarica
                  </button>
                  <button
                    onClick={() => setBulkDeleteConfirm(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Elimina
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

            <div className="border border-border rounded-xl overflow-hidden">
              {!isLoading && currentFileKeys.length > 0 && (
                <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-muted/40">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={toggleSelectAll}
                    aria-label="Seleziona tutti i file"
                  />
                  <span className="text-xs text-muted-foreground">Seleziona tutto</span>
                </div>
              )}
              {isLoading ? (
                <div className="divide-y divide-border">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-4 px-4 py-3">
                      <Skeleton className="w-5 h-5 rounded" />
                      <div className="flex-1 space-y-1.5">
                        <Skeleton className="h-4 w-48" />
                        <Skeleton className="h-3 w-32" />
                      </div>
                      <Skeleton className="h-4 w-16" />
                    </div>
                  ))}
                </div>
              ) : !data?.items?.length && !data?.folders?.length ? (
                <div className="py-16 text-center">
                  <p className="text-muted-foreground text-sm">
                    {search ? "Nessun file trovato" : "Cartella vuota"}
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {data?.folders?.map((folder) => (
                    <button
                      key={folder.prefix}
                      onClick={() => openFolder(folder.prefix)}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left"
                    >
                      <Folder className="w-5 h-5 text-muted-foreground shrink-0 fill-muted-foreground/20" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{folder.name}</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                    </button>
                  ))}
                  {data?.items?.map((file) => (
                    <div
                      key={file.s3Key}
                      className={`flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors group ${
                        isFetching ? "opacity-70" : ""
                      } ${selectedKeys.has(file.s3Key) ? "bg-muted/50" : ""}`}
                    >
                      <Checkbox
                        checked={selectedKeys.has(file.s3Key)}
                        onCheckedChange={() => toggleSelected(file.s3Key)}
                        aria-label={`Seleziona ${file.filename}`}
                      />
                      <FileIcon
                        mimeType={file.mimeType}
                        filename={file.filename}
                        className="w-5 h-5 text-muted-foreground shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{file.filename}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatBytes(file.size)}
                          {file.mimeType && (
                            <span className="ml-2 hidden sm:inline">{file.mimeType}</span>
                          )}
                        </p>
                      </div>
                      <div className="text-xs text-muted-foreground hidden md:block shrink-0">
                        {formatDistanceToNow(new Date(file.uploadedAt), {
                          addSuffix: true,
                          locale: it,
                        })}
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button
                          onClick={() => navigate(`/preview/${encodeURIComponent(file.s3Key)}`)}
                          className="p-1.5 rounded hover:bg-muted transition-colors"
                          title="Anteprima"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDownload(file.s3Key, file.filename)}
                          className="p-1.5 rounded hover:bg-muted transition-colors"
                          title="Scarica"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => {
                            setRenameTarget({ key: file.s3Key, filename: file.filename });
                            setRenameValue(file.filename);
                          }}
                          className="p-1.5 rounded hover:bg-muted transition-colors"
                          title="Rinomina"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeleteKey(file.s3Key)}
                          className="p-1.5 rounded hover:bg-muted transition-colors text-destructive"
                          title="Elimina"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4">
                <p className="text-xs text-muted-foreground">
                  Pagina {page} di {totalPages}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="p-2 rounded-md border border-border hover:bg-muted transition-colors disabled:opacity-40"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="p-2 rounded-md border border-border hover:bg-muted transition-colors disabled:opacity-40"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === "gallery" && <GalleryView items={data?.items ?? []} isLoading={isLoading} />}

        {activeTab === "analytics" && <AnalyticsView />}

        {activeTab === "settings" && <SettingsView />}
      </main>

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
    </div>
  );
}
