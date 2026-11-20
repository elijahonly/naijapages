/**
 * Optional, opt-in live OpenStreetMap Overpass integration test.
 *
 * NEVER runs during standard CI (`npm run cf:test`).
 * To execute manually against a permitted Overpass-compatible endpoint:
 *
 *   OSM_LIVE_TEST=true \
 *   OSM_OVERPASS_URL="https://<your-permitted-overpass-endpoint>/api/interpreter" \
 *   OSM_LIVE_BBOX="6.425,3.415,6.435,3.430" \
 *   npm run cf:test:osm:live
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { osmSourceAdapter } from './services/discovery';

test('Optional live OpenStreetMap Overpass pilot query (explicit opt-in only)', async (t) => {
  if (process.env.OSM_LIVE_TEST !== 'true') {
    t.skip('Skipped by default. Set OSM_LIVE_TEST=true, OSM_OVERPASS_URL, and OSM_LIVE_BBOX to run live pilot.');
    return;
  }

  const endpoint = process.env.OSM_OVERPASS_URL?.trim();
  const bboxRaw = process.env.OSM_LIVE_BBOX?.trim();

  if (!endpoint || !bboxRaw) {
    t.skip('Both OSM_OVERPASS_URL and OSM_LIVE_BBOX (south,west,north,east) are required when OSM_LIVE_TEST=true.');
    return;
  }

  const parts = bboxRaw.split(',').map((v) => Number(v.trim()));
  assert.equal(parts.length, 4, 'OSM_LIVE_BBOX must be formatted as south,west,north,east');
  const [south, west, north, east] = parts;

  const result = await osmSourceAdapter.discover(
    {
      bbox: { south, west, north, east },
      maxResults: 20,
    },
    {
      OSM_OVERPASS_URL: endpoint,
      OSM_USER_AGENT:
        process.env.OSM_USER_AGENT ?? 'NaijaPagesDiscoveryPilot/1.0 (+https://naijapages.ng)',
      OSM_REQUEST_TIMEOUT_MS: process.env.OSM_REQUEST_TIMEOUT_MS ?? '20000',
    },
    { skipCache: true },
  );

  assert.equal(result.sourceId, 'openstreetmap_overpass');
  assert.ok(result.totalRawElements >= 0);
  for (const candidate of result.candidates) {
    assert.ok(candidate.name.length > 0);
    assert.ok(candidate.sourceUrl.startsWith('https://www.openstreetmap.org/'));
    assert.ok(candidate.confidenceScore <= 0.65);
  }
});
