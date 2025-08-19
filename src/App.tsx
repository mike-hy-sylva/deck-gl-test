import React, { useEffect, useMemo, useState } from 'react';
import DeckGL from '@deck.gl/react';
import { GeoJsonLayer } from '@deck.gl/layers';
import mapboxgl from 'mapbox-gl';
import { Map } from 'react-map-gl';
import * as duckdb from '@duckdb/duckdb-wasm';

const MAPBOX_TOKEN = 'pk.eyJ1IjoibWlrZS1oeWwiLCJhIjoiY204Mng2MXBvMGc1MjJpc2FoNW4xdG5rcyJ9.4aQw23m4m4Lws6hdb4ROwA';
mapboxgl.accessToken = MAPBOX_TOKEN;

type FeatureCollection = GeoJSON.FeatureCollection<GeoJSON.Geometry, { [key: string]: any }>;

const PARQUET_URL = 'https://storage.googleapis.com/coplac/classified_polygons.geoparquet';

export default function App() {
  const [db, setDb] = useState<duckdb.AsyncDuckDB | null>(null);
  const [data, setData] = useState<FeatureCollection | null>(null);
  const [minClass, setMinClass] = useState<number>(1);
  const [maxClass, setMaxClass] = useState<number>(25);
  const [status, setStatus] = useState<string>('Initializing...');

  useEffect(() => {
    let isCancelled = false;
    (async () => {
      setStatus('Loading DuckDB...');
      const bundles = duckdb.getJsDelivrBundles();
      const bundle = await duckdb.selectBundle(bundles);
      const worker = new Worker(bundle.mainWorker);
      const logger = new duckdb.ConsoleLogger();
      const _db = new duckdb.AsyncDuckDB(logger, worker);
      await _db.instantiate(bundle.mainModule, bundle.pthreadWorker ?? bundle.mainWorker);
      if (isCancelled) return;
      setDb(_db);
      setStatus('DuckDB ready');
    })();
    return () => {
      isCancelled = true;
    };
  }, []);

  const loadData = useMemo(() => {
    return async (db: duckdb.AsyncDuckDB, minVal: number, maxVal: number) => {
      setStatus('Querying parquet via HTTP...');
      const conn = await db.connect();
      try {
        await conn.query(`INSTALL httpfs;`);
        await conn.query(`LOAD httpfs;`);
        await conn.query(`INSTALL spatial;`);
        await conn.query(`LOAD spatial;`);
        await conn.query(`SET enable_http_metadata_cache=true;`);
        await conn.query(`CREATE OR REPLACE VIEW gp AS SELECT * FROM read_parquet('${PARQUET_URL}');`);

        // Discover columns
        const colsRes = await conn.query(`
          SELECT column_name, data_type
          FROM information_schema.columns
          WHERE table_name = 'gp'
        `);
        const columnNames = (colsRes.getChild('column_name')?.toArray() as string[]) || [];
        const dataTypes = (colsRes.getChild('data_type')?.toArray() as string[]) || [];
        const schema = columnNames.map((n, i) => ({ name: n.toLowerCase(), type: (dataTypes[i] || '').toUpperCase() }));

        const findCol = (cands: string[]) => schema.find(c => cands.includes(c.name));
        const geomCand = findCol(['geometry','geom','wkb_geometry','wkb','the_geom']);
        const classCand = findCol(['class','class_id','classval','class_val','cls','value','category']);
        const geomCol = geomCand?.name || 'geometry';
        const geomType = geomCand?.type || '';
        const classCol = classCand?.name || 'class';

        // Build geometry expression depending on type
        const geomExpr = geomType.includes('BLOB') || geomCol.includes('wkb')
          ? `ST_GeomFromWKB("${geomCol}")`
          : `TRY_CAST("${geomCol}" AS GEOMETRY)`;
        const classExpr = `TRY_CAST("${classCol}" AS INT)`;

        const sql = `
          WITH base AS (
            SELECT ST_AsGeoJSON(${geomExpr}) AS geojson, ${classExpr} AS class_val
            FROM gp
          )
          SELECT geojson, class_val
          FROM base
          WHERE geojson IS NOT NULL
            AND (class_val IS NULL OR (class_val BETWEEN ${minVal} AND ${maxVal}))
        `;
        const res = await conn.query(sql);
        const geojsonCol = res.getChild('geojson');
        const classColArr = res.getChild('class_val');
        const geojsonArr = (geojsonCol?.toArray() as (string | null)[]) || [];
        const classArr = (classColArr?.toArray() as (number | null)[]) || [];

        const features: FeatureCollection = { type: 'FeatureCollection', features: [] };
        for (let i = 0; i < geojsonArr.length; i++) {
          const geomJson = geojsonArr[i];
          if (!geomJson) continue;
          const geometry = JSON.parse(geomJson) as GeoJSON.Geometry;
          const classVal = classArr[i] ?? null;
          features.features.push({ type: 'Feature', geometry, properties: { class_val: classVal } });
        }
        setData(features);
        setStatus(`Loaded ${features.features.length} features`);
      } finally {
        await conn.close();
      }
    };
  }, []);

  useEffect(() => {
    if (!db) return;
    loadData(db, minClass, maxClass);
  }, [db, minClass, maxClass, loadData]);

  const layers = useMemo(() => {
    if (!data) return [];
    return [
      new GeoJsonLayer({
        id: 'geojson-layer',
        data,
        pickable: true,
        filled: true,
        stroked: false,
        getFillColor: (f: any) => {
          const c = Math.max(1, Math.min(25, Number(f.properties?.class_val ?? 1)));
          const v = Math.round((c - 1) / 24 * 255);
          return [v, v, v, 180];
        },
        getLineColor: [0, 0, 0, 80],
        updateTriggers: {
          getFillColor: [minClass, maxClass]
        }
      })
    ];
  }, [data, minClass, maxClass]);

  const initialViewState = {
    longitude: -73.9857,
    latitude: 40.7484,
    zoom: 5,
    pitch: 45,
    bearing: 0
  };

  return (
    <div style={{ height: '100vh', width: '100vw' }}>
      <div style={{ position: 'absolute', zIndex: 10, top: 10, left: 10, background: 'rgba(255,255,255,0.9)', padding: 8, borderRadius: 4 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>GeoParquet via DuckDB-WASM</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label>Min class</label>
          <input type="number" min={1} max={25} value={minClass} onChange={(e) => setMinClass(Number(e.target.value))} style={{ width: 64 }} />
          <label>Max class</label>
          <input type="number" min={1} max={25} value={maxClass} onChange={(e) => setMaxClass(Number(e.target.value))} style={{ width: 64 }} />
        </div>
        <div style={{ marginTop: 6, fontSize: 12, color: '#555' }}>{status}</div>
      </div>
      <DeckGL
        initialViewState={initialViewState}
        controller={true}
        layers={layers as any}
      >
        <Map
          mapboxAccessToken={MAPBOX_TOKEN}
          mapStyle="mapbox://styles/mapbox/satellite-streets-v12"
          terrain={{ source: 'mapbox-dem', exaggeration: 1.2 }}
          onLoad={(e) => {
            const map = e.target as mapboxgl.Map;
            if (!map.getSource('mapbox-dem')) {
              map.addSource('mapbox-dem', {
                type: 'raster-dem',
                url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
                tileSize: 512,
                maxzoom: 14
              } as any);
            }
            map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.2 });
            map.setFog({});
          }}
        />
      </DeckGL>
    </div>
  );
}


