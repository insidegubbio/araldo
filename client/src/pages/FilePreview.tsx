import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { TopBar } from "@/components/TopBar";
import { BottomNav } from "@/components/BottomNav";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, Download, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useParams, useSearch } from "wouter";
import { toast } from "sonner";

function buildWorkerUrl(workerBase: string, key: string): string {
  const base = workerBase.replace(/\/+$/, "");
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return `${base}/${encodedKey}`;
}

export default function FilePreview() {
  const { isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();
  const params = useParams<{ key: string }>();
  const search = useSearch();
  const key = decodeURIComponent(params.key ?? "");
  const mimeTypeFromQuery = new URLSearchParams(search).get("type");
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [workerFailed, setWorkerFailed] = useState(false);

  const settingsQuery = trpc.files.settings.useQuery();
  const workerUrl = settingsQuery.data?.workerUrl ?? null;
  const getDownloadUrl = trpc.files.getDownloadUrl.useMutation();

  useEffect(() => {
    if (!loading && !isAuthenticated) navigate("/login");
  }, [isAuthenticated, loading, navigate]);

  useEffect(() => {
    if (!key || !isAuthenticated) return;

    if (workerUrl && !workerFailed) {
      setDownloadUrl(buildWorkerUrl(workerUrl, key));
    } else if ((workerUrl === null || workerFailed) && settingsQuery.isFetched) {
      getDownloadUrl.mutateAsync({ key }).then((r) => setDownloadUrl(r.downloadUrl)).catch(() => {
        toast.error("Impossibile ottenere il link di download");
      });
    }
  }, [key, isAuthenticated, workerUrl, workerFailed, settingsQuery.isFetched]);

  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  const mime = mimeTypeFromQuery ?? "";
  const isImage =
    mime.startsWith("image/") ||
    (!mime && ["jpg", "jpeg", "png", "gif", "webp", "avif", "svg", "heic", "heif"].includes(ext));
  const isVideo =
    mime.startsWith("video/") || (!mime && ["mp4", "mov", "webm", "m4v"].includes(ext));
  const isPdf = mime === "application/pdf" || (!mime && ext === "pdf");
  const isText = ["txt", "md", "csv", "log", "json", "js", "ts", "html", "css"].includes(ext);
  const isPending = !downloadUrl && (!settingsQuery.isFetched || getDownloadUrl.isPending);

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
      <main className="flex-1 container py-6 pb-24 sm:pb-6">
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => navigate("/")}
            className="p-2 rounded-md hover:bg-muted transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h1 className="font-serif text-xl truncate">{key.split("/").pop()}</h1>
          {downloadUrl && (
            <a
              href={downloadUrl}
              download
              className="ml-auto flex items-center gap-2 px-3 py-1.5 border border-border rounded-lg hover:bg-muted transition-colors text-sm"
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Scarica</span>
            </a>
          )}
        </div>

        {isPending && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {downloadUrl && isImage && (
          <div className="flex items-center justify-center">
            <img
              src={downloadUrl}
              alt={key}
              className="max-w-full max-h-[70vh] rounded-lg border border-border object-contain"
              onError={() => {
                //worker didn't have the original cached/mirrored
                if (workerUrl && !workerFailed) setWorkerFailed(true);
              }}
            />
          </div>
        )}

        {downloadUrl && isVideo && (
          <div className="flex items-center justify-center">
            <video
              src={downloadUrl}
              controls
              className="max-w-full max-h-[70vh] rounded-lg border border-border"
              onError={() => {
                if (workerUrl && !workerFailed) setWorkerFailed(true);
              }}
            />
          </div>
        )}

        {downloadUrl && isPdf && (
          <iframe
            src={downloadUrl}
            className="w-full h-[70vh] rounded-lg border border-border"
            title={key}
          />
        )}

        {downloadUrl && !isImage && !isVideo && !isPdf && (
          <div className="p-6 border border-border rounded-xl bg-muted text-center">
            <p className="text-muted-foreground text-sm mb-4">
              Anteprima non disponibile per questo tipo di file.
            </p>
            <a
              href={downloadUrl}
              download
              className="inline-flex items-center gap-2 px-4 py-2 bg-foreground text-background rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
            >
              <Download className="w-4 h-4" />
              Scarica il file
            </a>
          </div>
        )}
      </main>
      <BottomNav onUploadClick={() => {}} />
    </div>
  );
}
