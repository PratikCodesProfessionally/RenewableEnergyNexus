/**
 * Netlify Function: PVGIS proxy for GreenHub Copilot
 *
 * The EU's PVGIS service does not send CORS headers, so browsers cannot call
 * it directly. This function fetches either
 *   - a typical meteorological year (type=tmy, default), or
 *   - the terrain horizon profile (type=horizon)
 * for a latitude/longitude, and returns a compact JSON the simulator uses.
 *
 * The TMY reply shrinks from about 1.3 MB to roughly 200 KB: only the five
 * columns the model needs, as numeric arrays in calendar order.
 *
 * Data: PVGIS (c) European Union, Joint Research Centre.
 */

const https = require('https');

const PVGIS_BASE = 'https://re.jrc.ec.europa.eu/api/v5_2';
const TIMEOUT_MS = 9000;   // Netlify stops synchronous functions at 10 s; fail cleanly before that
const HOURS = 8760;
const MONTH_START_DOY = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];

function jsonResponse(statusCode, body, extraHeaders) {
    return {
        statusCode,
        headers: Object.assign({
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Content-Type': 'application/json'
        }, extraHeaders || {}),
        body: JSON.stringify(body)
    };
}

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { 'User-Agent': 'RenewableEnergyNexus-GreenHubCopilot/1.0' } }, (res) => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                let parsed = null;
                try { parsed = JSON.parse(data); } catch (e) { /* PVGIS sends plain text on some errors */ }
                resolve({ status: res.statusCode, json: parsed, text: data });
            });
        });
        req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('PVGIS did not answer in time')));
        req.on('error', reject);
    });
}

function parseCoordinate(value, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < min || n > max) return null;
    return Math.round(n * 100) / 100;   // ~1 km; also makes responses cacheable
}

function pvgisError(result) {
    const msg = (result.json && (result.json.message || result.json.error)) || String(result.text || '').slice(0, 300);
    return msg || `PVGIS returned HTTP ${result.status}`;
}

async function getTmy(lat, lon) {
    const url = `${PVGIS_BASE}/tmy?lat=${lat}&lon=${lon}&outputformat=json`;
    const result = await fetchJson(url);
    if (result.status !== 200 || !result.json || !result.json.outputs) {
        return jsonResponse(result.status === 200 ? 502 : result.status, { error: pvgisError(result) });
    }

    const rows = result.json.outputs.tmy_hourly || [];
    if (rows.length !== HOURS) {
        return jsonResponse(502, { error: `Expected ${HOURS} hourly rows from PVGIS, got ${rows.length}` });
    }

    // Put every row at index (dayOfYear - 1) * 24 + hour, whatever year it came from.
    const ghi = new Array(HOURS).fill(null);
    const dni = new Array(HOURS).fill(null);
    const dhi = new Array(HOURS).fill(null);
    const tAmb = new Array(HOURS).fill(null);
    const ws = new Array(HOURS).fill(null);

    for (const row of rows) {
        const stamp = String(row['time(UTC)'] || '');
        const month = Number(stamp.slice(4, 6));
        const day = Number(stamp.slice(6, 8));
        const hour = Number(stamp.slice(9, 11));
        if (!month || !day || month > 12 || hour > 23 || (month === 2 && day === 29)) continue;
        const idx = (MONTH_START_DOY[month - 1] + day - 2) * 24 + hour;
        if (idx < 0 || idx >= HOURS) continue;
        ghi[idx] = Math.max(0, Math.round(row['G(h)']));
        dni[idx] = Math.max(0, Math.round(row['Gb(n)']));
        dhi[idx] = Math.max(0, Math.round(row['Gd(h)']));
        tAmb[idx] = Math.round(row.T2m * 10) / 10;
        ws[idx] = Math.round(row.WS10m * 10) / 10;
    }

    const missing = ghi.findIndex((v) => v === null);
    if (missing !== -1) {
        return jsonResponse(502, { error: `PVGIS data has a gap at hour ${missing}` });
    }

    const inputs = result.json.inputs || {};
    const loc = inputs.location || {};
    const meteo = inputs.meteo_data || {};

    return jsonResponse(200, {
        source: {
            name: 'PVGIS',
            provider: 'European Commission, Joint Research Centre',
            radiationDb: meteo.radiation_db || null,
            meteoDb: meteo.meteo_db || null,
            yearMin: meteo.year_min || null,
            yearMax: meteo.year_max || null,
            monthsSelected: (result.json.outputs.months_selected || []).map((m) => ({ month: m.month, year: m.year }))
        },
        location: {
            lat,
            lon,
            elevation: loc.elevation != null ? loc.elevation : null
        },
        timeOffsetH: Number(loc.irradiance_time_offset) || 0,
        hours: HOURS,
        ghi, dni, dhi, tAmb, ws
    }, { 'Cache-Control': 'public, max-age=604800' });
}

async function getHorizon(lat, lon) {
    const url = `${PVGIS_BASE}/printhorizon?lat=${lat}&lon=${lon}&outputformat=json`;
    const result = await fetchJson(url);
    if (result.status !== 200 || !result.json || !result.json.outputs) {
        return jsonResponse(result.status === 200 ? 502 : result.status, { error: pvgisError(result) });
    }

    // PVGIS measures azimuth from south (east = -90); the simulator uses north = 0, clockwise.
    const profile = (result.json.outputs.horizon_profile || []).map((p) => ({
        azimuthDeg: ((Number(p.A) + 180) % 360 + 360) % 360,
        elevationDeg: Math.max(0, Number(p.H_hor) || 0)
    }));

    return jsonResponse(200, {
        source: { name: 'PVGIS', horizonDb: 'DEM-calculated' },
        location: { lat, lon },
        profile
    }, { 'Cache-Control': 'public, max-age=2592000' });
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return jsonResponse(200, {});
    if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'Method not allowed' });

    const q = event.queryStringParameters || {};
    const lat = parseCoordinate(q.lat, -90, 90);
    const lon = parseCoordinate(q.lon, -180, 180);
    if (lat === null || lon === null) {
        return jsonResponse(400, { error: 'Provide lat (-90..90) and lon (-180..180).' });
    }

    try {
        return q.type === 'horizon' ? await getHorizon(lat, lon) : await getTmy(lat, lon);
    } catch (error) {
        return jsonResponse(502, { error: `Could not reach PVGIS: ${error.message}` });
    }
};
