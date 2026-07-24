# araldo

file manager web per bucket s3 e provider compatibili (aws s3, backblaze b2, cloudflare r2, wasabi, minio, ecc).

## caratteristiche

- autenticazione oauth con controllo accessi basato su ruoli (admin, user)
- lista file con ricerca e paginazione
- upload drag and drop con progress bar
- creazione cartelle e rinomina file
- eliminazione file con conferma (solo admin)
- download tramite url pre firmati, senza esporre le chiavi s3 al client
- anteprima file diretta in browser (immagini, pdf)
- vista galleria con griglia per immagini e video
- vista analytics con storage usage totale e conteggio file
- vista settings con info account, bucket s3 e worker url
- bottom navigation bar stile pill per mobile
- dark mode e light mode
- pwa completa, installabile su mobile e desktop, con service worker e icone
- integrazione opzionale con un worker cloudflare per il tracking degli upload
- design con instrument serif e satoshi come font principali

## stack tecnico

frontend: react, typescript, wouter per il routing, tanstack query, framer motion, tailwind css, componenti radix ui.

backend: express, trpc, drizzle orm, mysql o tidb come database, aws sdk v3 per s3, jose per la firma dei cookie di sessione.

build e deploy: vite, esbuild, vercel come piattaforma di hosting principale.

## variabili d’ambiente

- s3_bucket: nome del bucket s3, obbligatoria.
- s3_region: regione s3, es. us east 1 o eu central 003, obbligatoria.
- s3_endpoint: endpoint custom per provider non aws, es. s3.eu central 003.backblazeb2.com, opzionale.
- s3_access_key: access key id s3, obbligatoria.
- s3_secret_key: secret access key s3, obbligatoria.
- worker_url: url del worker cloudflare per il tracking dei file, opzionale.
- database_url: stringa di connessione mysql o tidb, obbligatoria.
- jwt_secret: segreto per la firma dei cookie di sessione, obbligatoria.

## sviluppo locale

```bash
pnpm install
pnpm run dev
```

l’app parte in modalita sviluppo con hot reload su vite.

## build di produzione

```bash
pnpm run build
pnpm run start
```

## database

```bash
pnpm run db:push
```

genera e applica le migrazioni drizzle verso il database configurato in database_url.

## test

```bash
pnpm run test
```

esegue la suite vitest sulle procedure trpc principali.

## deploy su vercel

collega il repository a vercel, imposta le variabili d’ambiente nella dashboard (settings, environment variables), poi vercel rileva automaticamente il file vercel.json e configura la build.

## struttura del progetto

client: frontend react, pagine, componenti, hook e stili.
server: backend express, router trpc, integrazione s3 e storage.
shared: tipi e costanti condivise tra client e server.
drizzle: schema del database e migrazioni.
