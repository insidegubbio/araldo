import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Folder, ChevronRight, Loader2, Home, FolderPlus, Check, X } from "lucide-react";
import { toast } from "sonner";

interface MoveToFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  initialPrefix?: string;
  onConfirm: (destinationPrefix: string) => void;
  isMoving?: boolean;
  title?: string;
  description?: string;
  confirmLabel?: string;
}

// dialog for choosing directory
export function MoveToFolderDialog({
  open,
  onOpenChange,
  count,
  initialPrefix = "",
  onConfirm,
  isMoving,
  title,
  description,
  confirmLabel,
}: MoveToFolderDialogProps) {
  const [prefix, setPrefix] = useState(initialPrefix);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  useEffect(() => {
    if (open) setPrefix(initialPrefix);
  }, [open, initialPrefix]);

  useEffect(() => {
    setCreatingFolder(false);
    setNewFolderName("");
  }, [prefix]);

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.files.listFolders.useQuery(
    { prefix },
    { enabled: open }
  );

  const mkdirMutation = trpc.files.mkdir.useMutation({
    onSuccess: (result) => {
      utils.files.listFolders.invalidate();
      const newPrefix = result.key.replace(/\.gitkeep$/, "");
      setPrefix(newPrefix);
      setCreatingFolder(false);
      setNewFolderName("");
    },
    onError: (e) => toast.error(e.message),
  });

  const handleCreateFolder = () => {
    if (!newFolderName.trim()) {
      toast.error("Nome cartella non valido");
      return;
    }
    mkdirMutation.mutate({ folderName: newFolderName.trim(), prefix });
  };

  const breadcrumbs = prefix
    .split("/")
    .filter(Boolean)
    .map((name, i, arr) => ({
      name,
      prefix: arr.slice(0, i + 1).join("/") + "/",
    }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title ?? `Sposta ${count} file`}</DialogTitle>
          <DialogDescription>{description ?? "Scegli la cartella di destinazione"}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 text-sm overflow-x-auto whitespace-nowrap py-1">
            <button
              onClick={() => setPrefix("")}
              className={`px-2 py-1 rounded hover:bg-muted transition-colors flex items-center gap-1 ${
                prefix === "" ? "font-medium text-foreground" : "text-muted-foreground"
              }`}
            >
              <Home className="w-3.5 h-3.5" />
              Home
            </button>
            {breadcrumbs.map((crumb) => (
              <span key={crumb.prefix} className="flex items-center gap-1">
                <span className="text-muted-foreground">/</span>
                <button
                  onClick={() => setPrefix(crumb.prefix)}
                  className={`px-2 py-1 rounded hover:bg-muted transition-colors ${
                    crumb.prefix === prefix ? "font-medium text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {crumb.name}
                </button>
              </span>
            ))}
          </div>
          {!creatingFolder && (
            <button
              onClick={() => setCreatingFolder(true)}
              title="Nuova cartella"
              className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground rounded-md border border-border hover:bg-muted hover:text-foreground transition-colors shrink-0"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Nuova</span>
            </button>
          )}
        </div>

        {creatingFolder && (
          <div className="flex items-center gap-2">
            <input
              type="text"
              autoFocus
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Nome nuova cartella"
              className="flex-1 min-w-0 px-3 py-2 border border-border rounded-lg text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateFolder();
                if (e.key === "Escape") setCreatingFolder(false);
              }}
            />
            <button
              onClick={handleCreateFolder}
              disabled={mkdirMutation.isPending}
              title="Crea"
              className="p-2 rounded-lg bg-foreground text-background hover:opacity-90 transition-opacity disabled:opacity-60 shrink-0"
            >
              {mkdirMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
            </button>
            <button
              onClick={() => setCreatingFolder(false)}
              title="Annulla"
              className="p-2 rounded-lg border border-border hover:bg-muted transition-colors shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <ScrollArea className="h-56 border border-border rounded-lg">
          {isLoading ? (
            <div className="flex items-center justify-center h-56">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : data?.folders?.length ? (
            <div className="divide-y divide-border">
              {data.folders.map((folder) => (
                <button
                  key={folder.prefix}
                  onClick={() => setPrefix(folder.prefix)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50 transition-colors text-left"
                >
                  <Folder className="w-4 h-4 text-muted-foreground shrink-0 fill-muted-foreground/20" />
                  <span className="flex-1 min-w-0 text-sm truncate">{folder.name}</span>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                </button>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-56">
              <p className="text-sm text-muted-foreground">Nessuna sottocartella</p>
            </div>
          )}
        </ScrollArea>

        <DialogFooter>
          <button
            onClick={() => onOpenChange(false)}
            className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted transition-colors"
          >
            Annulla
          </button>
          <button
            onClick={() => onConfirm(prefix)}
            disabled={isMoving}
            className="px-4 py-2 text-sm bg-foreground text-background rounded-lg hover:opacity-90 transition-opacity disabled:opacity-60 flex items-center gap-2"
          >
            {isMoving && <Loader2 className="w-4 h-4 animate-spin" />}
            {confirmLabel ?? `Sposta qui${prefix ? ` (${breadcrumbs[breadcrumbs.length - 1]?.name})` : " (Home)"}`}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
