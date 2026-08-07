import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Copy, Check, Loader2, ImageDown, Folder } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { MoveToFolderDialog } from "@/components/MoveToFolderDialog";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function SettingsView() {
  const { user } = useAuth();
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const { data: settings, isLoading } = trpc.files.settings.useQuery();
  const configureCors = trpc.files.configureCors.useMutation({
    onSuccess: (result) => {
      const list = result.origins.join(", ");
      toast.success(`CORS configurato per: ${list}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [optimizePrefix, setOptimizePrefix] = useState<string | null>(null);
  const [useDifferentDestination, setUseDifferentDestination] = useState(false);
  const [destinationPrefix, setDestinationPrefix] = useState<string | null>(null);
  const [showDestPicker, setShowDestPicker] = useState(false);
  const [maxWidth, setMaxWidth] = useState("1920");
  const [quality, setQuality] = useState("80");
  const [convertToWebp, setConvertToWebp] = useState(true);
  const [optimizeStats, setOptimizeStats] = useState<{
    processed: number;
    skipped: number;
    failed: number;
    originalBytes: number;
    newBytes: number;
  } | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [remaining, setRemaining] = useState(0);

  const optimizeMutation = trpc.files.optimizeImages.useMutation({
    onSuccess: (result) => {
      setOptimizeStats((prev) => ({
        processed: (prev?.processed ?? 0) + result.processed,
        skipped: (prev?.skipped ?? 0) + result.skipped,
        failed: (prev?.failed ?? 0) + result.failed,
        originalBytes: (prev?.originalBytes ?? 0) + result.originalBytes,
        newBytes: (prev?.newBytes ?? 0) + result.newBytes,
      }));
      setHasMore(result.hasMore);
      setRemaining(result.remaining);
      if (result.processed === 0 && result.skipped === 0 && result.failed === 0) {
        toast.info("Nessuna immagine da ottimizzare in questa cartella");
      } else if (!result.hasMore) {
        toast.success(`Ottimizzazione completata: ${result.processed} immagini ridotte`);
      } else {
        toast.success(`${result.processed} immagini ottimizzate, altre ${result.remaining} in coda`);
      }
    },
    onError: (e) => toast.error(e.message),
  });

  const runOptimize = () => {
    if (optimizePrefix === null) return;
    if (useDifferentDestination && destinationPrefix === null) return;
    optimizeMutation.mutate({
      prefix: optimizePrefix,
      maxWidth: Number(maxWidth),
      quality: Number(quality),
      convertToWebp,
      ...(useDifferentDestination ? { destinationPrefix: destinationPrefix ?? "" } : {}),
    });
  };

  const handlePickFolder = (prefix: string) => {
    setOptimizePrefix(prefix);
    setOptimizeStats(null);
    setHasMore(false);
    setRemaining(0);
    setShowFolderPicker(false);
  };

  const handlePickDestination = (prefix: string) => {
    setDestinationPrefix(prefix);
    setOptimizeStats(null);
    setHasMore(false);
    setRemaining(0);
    setShowDestPicker(false);
  };

  const handleToggleDifferentDestination = (checked: boolean) => {
    setUseDifferentDestination(checked);
    if (!checked) {
      setDestinationPrefix(null);
    }
    setOptimizeStats(null);
    setHasMore(false);
    setRemaining(0);
  };

  const savedPercent =
    optimizeStats && optimizeStats.originalBytes > 0
      ? Math.round((1 - optimizeStats.newBytes / optimizeStats.originalBytes) * 100)
      : 0;

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
    toast.success("Copiato");
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <h3 className="font-serif text-lg mb-4">Account</h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Nome</label>
            <Input value={user?.name ?? "—"} disabled />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Email</label>
            <Input value={user?.email ?? "—"} disabled />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Ruolo</label>
            <div className="flex items-center gap-2">
              <Input value={user?.role ?? "user"} disabled />
              {user?.role === "admin" && <Badge>Admin</Badge>}
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="font-serif text-lg mb-4">Configurazione Storage</h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Bucket S3</label>
            <div className="flex items-center gap-2">
              <Input value={settings?.bucket ?? "—"} disabled />
              <Button
                size="sm"
                variant="outline"
                onClick={() => copyToClipboard(settings?.bucket ?? "", "bucket")}
              >
                {copiedField === "bucket" ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground block mb-1">CORS del bucket</label>
            <Button
              size="sm"
              variant="outline"
              onClick={() => configureCors.mutate()}
              disabled={configureCors.isPending}
              className="w-full sm:w-auto"
            >
              {configureCors.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Configura CORS ora"
              )}
            </Button>
            <p className="text-xs text-muted-foreground mt-2">
              Applica CORS_ALLOWED_ORIGINS al bucket, così il browser può caricare i file direttamente su S3.
            </p>
          </div>
        </div>
      </Card>

      {settings?.workerUrl && (
        <Card className="p-6">
          <h3 className="font-serif text-lg mb-4">Worker Cloudflare</h3>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">URL Worker</label>
              <div className="flex items-center gap-2">
                <Input value="Configurato" disabled />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => toast.success("Worker configurato")}
                >
                  <Check className="w-4 h-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">Tracking file abilitato</p>
            </div>
          </div>
        </Card>
      )}

      <Card className="p-6">
        <h3 className="font-serif text-lg mb-1 flex items-center gap-2">
          <ImageDown className="w-4 h-4" />
          Ottimizza immagini per il web
        </h3>
        <p className="text-xs text-muted-foreground mb-4">
          Ridimensiona e ricomprime le immagini di una cartella per ridurne il peso. Le
          immagini più piccole del risultato ottimizzato vengono lasciate invariate.
        </p>

        <div className="space-y-4">
          <div>
            <Label className="text-xs text-muted-foreground block mb-1">Cartella</Label>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFolderPicker(true)}
              className="w-full sm:w-auto justify-start gap-2"
            >
              <Folder className="w-4 h-4" />
              {optimizePrefix === null
                ? "Scegli cartella…"
                : optimizePrefix === ""
                  ? "Home (radice)"
                  : optimizePrefix.replace(/\/$/, "")}
            </Button>
          </div>

          <div className="flex items-center justify-between gap-4 p-3 border border-border rounded-lg">
            <div>
              <p className="text-sm font-medium">Salva in un'altra cartella</p>
              <p className="text-xs text-muted-foreground">
                Se disattivato, le immagini ottimizzate sostituiscono quelle originali nella stessa cartella.
              </p>
            </div>
            <Switch checked={useDifferentDestination} onCheckedChange={handleToggleDifferentDestination} />
          </div>

          {useDifferentDestination && (
            <div>
              <Label className="text-xs text-muted-foreground block mb-1">Cartella di destinazione</Label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowDestPicker(true)}
                className="w-full sm:w-auto justify-start gap-2"
              >
                <Folder className="w-4 h-4" />
                {destinationPrefix === null
                  ? "Scegli cartella…"
                  : destinationPrefix === ""
                    ? "Home (radice)"
                    : destinationPrefix.replace(/\/$/, "")}
              </Button>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs text-muted-foreground block mb-1">
                Larghezza massima
              </Label>
              <Select value={maxWidth} onValueChange={setMaxWidth}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1280">1280 px</SelectItem>
                  <SelectItem value="1920">1920 px (consigliato)</SelectItem>
                  <SelectItem value="2560">2560 px</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground block mb-1">Qualità</Label>
              <Select value={quality} onValueChange={setQuality}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="60">60 (più leggera)</SelectItem>
                  <SelectItem value="80">80 (consigliata)</SelectItem>
                  <SelectItem value="90">90 (più definita)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 p-3 border border-border rounded-lg">
            <div>
              <p className="text-sm font-medium">Converti in WebP</p>
              <p className="text-xs text-muted-foreground">
                Formato moderno, in genere il 25-35% più leggero di JPEG a parità di qualità.
                Se disattivato, mantiene JPEG/PNG.
              </p>
            </div>
            <Switch checked={convertToWebp} onCheckedChange={setConvertToWebp} />
          </div>

          <Button
            onClick={runOptimize}
            disabled={
              optimizePrefix === null ||
              (useDifferentDestination && destinationPrefix === null) ||
              optimizeMutation.isPending
            }
            className="w-full sm:w-auto"
          >
            {optimizeMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : hasMore ? (
              `Continua (${remaining} rimanenti)`
            ) : (
              "Avvia ottimizzazione"
            )}
          </Button>

          {optimizeStats && (
            <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3 space-y-1">
              <p>
                <span className="font-medium text-foreground">{optimizeStats.processed}</span>{" "}
                immagini ottimizzate
                {optimizeStats.skipped > 0 && `, ${optimizeStats.skipped} già ottimali`}
                {optimizeStats.failed > 0 && `, ${optimizeStats.failed} non riuscite`}
              </p>
              {optimizeStats.processed > 0 && (
                <p>
                  {formatBytes(optimizeStats.originalBytes)} →{" "}
                  {formatBytes(optimizeStats.newBytes)}{" "}
                  <span className="font-medium text-foreground">
                    (-{savedPercent}%, risparmiati {formatBytes(optimizeStats.originalBytes - optimizeStats.newBytes)})
                  </span>
                </p>
              )}
              {hasMore && <p>Ci sono ancora {remaining} immagini da elaborare, premi di nuovo per continuare.</p>}
            </div>
          )}
        </div>
      </Card>

      <Card className="p-6 bg-muted/50">
        <h3 className="font-serif text-lg mb-2">Informazioni</h3>
        <p className="text-xs text-muted-foreground">
          Araldo v{settings?.version ?? "—"} • Supporto PWA
        </p>
      </Card>

      <MoveToFolderDialog
        open={showFolderPicker}
        onOpenChange={setShowFolderPicker}
        count={0}
        title="Scegli cartella da ottimizzare"
        description="Clicca 'Seleziona' sulla cartella da ottimizzare, oppure usa la freccia per aprirla"
        confirmLabel="Seleziona questa cartella"
        onConfirm={handlePickFolder}
        selectionMode
      />

      <MoveToFolderDialog
        open={showDestPicker}
        onOpenChange={setShowDestPicker}
        count={0}
        title="Scegli cartella di destinazione"
        description="Clicca 'Seleziona' sulla cartella dove salvare le immagini ottimizzate, oppure usa la freccia per aprirla"
        confirmLabel="Seleziona questa cartella"
        onConfirm={handlePickDestination}
        selectionMode
      />
    </div>
  );
}
