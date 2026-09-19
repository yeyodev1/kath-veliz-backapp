# Kath Veliz API

Express 5 + Mongoose + TypeScript. Se despliega en Vercel como función serverless.

## Setup local

```bash
pnpm install
cp .env.example .env         # rellenar DB_URI, JWT_SECRET, ADMIN_PASSWORD
pnpm dev                     # http://localhost:8100
```

Smoke:

```bash
curl http://localhost:8100/
curl http://localhost:8100/api/health
curl -X POST http://localhost:8100/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@cliente.com","password":"..."}'
```

## Scripts

| Script | Qué hace |
|---|---|
| `pnpm dev` | ts-node-dev con recarga |
| `pnpm build` | `tsc` → `dist/` |
| `pnpm start` | `node dist/index.js` |
| `pnpm seed:admin` | crea/actualiza la cuenta admin desde `.env` |
| `pnpm format` | prettier |

## Endpoints

Todo cuelga de `/api` (`src/routes/index.ts`).

- `GET /` → alive
- `GET /api/health` → `{ ok, db, uptime }`
- `POST /api/auth/login` → `{ token, user }`
- `GET /api/auth/me` → `{ user }` (Bearer)
- `PUT /api/auth/password` → `{ user }` (Bearer) body `{ current, next }`

## Deploy a Vercel

- `api/index.ts` — entrada serverless: conecta Mongo, siembra admin y delega en la app Express.
- `vercel.json` — todo el tráfico se reescribe a `/api`.

Variables de entorno (Vercel → Project → Settings → Environment Variables): las mismas de `.env.example`.

```bash
vercel --prod
```

## Despliegue

- Producción: https://kath-veliz-backapp.vercel.app/api (`/api/health` para comprobar la conexión a Mongo).
- Vercel está enlazado a este repo: **cada push a `main` despliega solo**. No hace falta `vercel deploy`.
- Las variables de entorno viven en el proyecto de Vercel (Production y Preview). La lista de nombres está en
  `.env.example`; los valores nunca se versionan. Al cambiar de dominio hay que actualizar `FRONTEND_URL` y
  `CORS_ORIGINS` en Vercel y volver a desplegar.
- Ningún archivo pasa por el API: las imágenes y adjuntos suben directo a Cloudinary con firma y los videos directo
  a Bunny por TUS, porque Vercel corta los cuerpos de petición en ~4.5 MB.
