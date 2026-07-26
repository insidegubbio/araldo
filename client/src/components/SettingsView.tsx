import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Copy, Check, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

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

          {user?.role === "admin" && (
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
          )}
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

      <Card className="p-6 bg-muted/50">
        <h3 className="font-serif text-lg mb-2">Informazioni</h3>
        <p className="text-xs text-muted-foreground">
          Araldo v1.0 • Supporto PWA
        </p>
      </Card>
    </div>
  );
}
