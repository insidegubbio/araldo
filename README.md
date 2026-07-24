# Araldo

File manager web per bucket S3 (compatibile con AWS S3, Backblaze B2 e qualsiasi endpoint S3-compatible).

## Funzionalità

- Autenticazione OAuth con controllo accessi basato su ruoli (admin / user)
- Lista file con ricerca e paginazione
- Upload drag-and-drop con progress bar
- Download tramite URL pre-firmati
- Anteprima file (immagini, PDF)
- Eliminazione file (solo admin)
- Integrazione opzionale con worker Cloudflare per il tracking
- PWA completo: installabile su mobile e desktop
- Dark mode / light mode

## Variabili d'ambiente

| Variabile | Descrizione | Obbligatoria |
|---|---|---|
| `S3_BUCKET` | Nome del bucket S3 | sì |
| `S3_REGION` | Regione S3 (es. `us-east-1`, `eu-central-003`) | sì |
| `S3_ENDPOINT` | Endpoint custom per provider non-AWS (es. `s3.eu-central-003.backblazeb2.com`) | no |
| `S3_ACCESS_KEY` | Access Key ID S3 | sì |
| `S3_SECRET_KEY` | Secret Access Key S3 | sì |
| `WORKER_URL` | URL del worker Cloudflare per il tracking dei file | no |
| `DATABASE_URL` | Stringa di connessione MySQL/TiDB | sì |
| `JWT_SECRET` | Segreto per la firma dei cookie di sessione | sì |

## Deploy su Vercel

1. Collega il repository a Vercel
2. Imposta le variabili d'ambiente nella dashboard Vercel (Settings → Environment Variables)
3. Vercel rileverà automaticamente il file `vercel.json` e configurerà il build

## Sviluppo locale

```bash
pnpm install
pnpm run dev
```

## Worker Cloudflare (opzionale)

Se `WORKER_URL` è configurato, il backend invierà una richiesta POST al worker per ogni operazione su file (upload, download, eliminazione) con il seguente payload:

```json
{
  "key": "path/to/file.pdf",
  "filename": "file.pdf",
  "action": "upload | download | delete",
  "userId": 42,
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

Il worker allegato (`worker.js`) è un esempio che serve file da un bucket Backblaze B2 tramite firma AWS v4.
Per il tracking, il worker deve esporre un endpoint POST che accetti il payload sopra.

## Struttura del progetto

```
client/          frontend React + Vite
  src/
    pages/       Dashboard, Login, FilePreview
    components/  TopBar, BottomNav, FileIcon, UploadDropzone
  public/
    manifest.json
    sw.js
server/          backend Express + tRPC
  routers/
    files.ts     procedure S3: list, upload, download, delete
  s3.ts          helper AWS SDK v3
  worker.ts      integrazione worker Cloudflare
drizzle/         schema database
vercel.json      configurazione deploy Vercel
```

