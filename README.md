## deck.gl + DuckDB-WASM + GeoParquet (Cloud Run ready)

### Local development

1. Install Node 18+
2. Install deps:
```bash
npm i
```
3. Run dev:
```bash
npm run dev
```
Open http://localhost:5173

### Build
```bash
npm run build
npm run preview
```

### Deploy to Google Cloud Run

Prereqs: `gcloud` CLI, a GCP project, and Artifact Registry enabled.

1. Build container:
```bash
gcloud builds submit --tag "gcr.io/$(gcloud config get-value project)/deck-gl-test:latest"
```

2. Deploy to Cloud Run (public):
```bash
gcloud run deploy deck-gl-test \
  --image "gcr.io/$(gcloud config get-value project)/deck-gl-test:latest" \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --port 8080
```

This image serves the Vite-built static app via Nginx with SPA fallback.

### Configuration

- Mapbox token is currently in `src/App.tsx` via `MAPBOX_TOKEN`. Replace it with your token or source from env at build time.
- The app fetches GeoParquet via HTTPS from `https://storage.googleapis.com/coplac/classified_polygons.geoparquet` using DuckDB-WASM HTTPFS and SPATIAL extensions.

### Troubleshooting

- If you see blank map styles, ensure Mapbox token has public scopes and your domain is allowed.
- If DuckDB fails to load extensions in some browsers, try Chrome/Edge latest; Cloud Run serves over HTTPS which is required.


