/* ==========================================================================
 * GreenHub Copilot: page controller
 *
 * Holds the configuration, keeps the form and the model in sync, fetches
 * PVGIS weather through the Netlify proxy, re-runs the engine live as the
 * user edits, and renders results, scenarios, share links and exports.
 * ========================================================================== */
(function () {
    'use strict';

    const E = window.PVSimEngine;
    const C = window.PVSimCharts;
    const root = document.querySelector('.pvs-root');
    if (!root || !E || !C) return;

    const $ = (id) => document.getElementById(id);
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
    const nf1 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const eur = (v) => (v < 0 ? '−€' : '€') + nf0.format(Math.abs(v));

    const css = (name) => getComputedStyle(root).getPropertyValue(name).trim();
    const COL = {
        direct: css('--s-direct'), battery: css('--s-battery'), export: css('--s-export'),
        curtail: css('--s-curtail'), grid: css('--s-grid'), load: css('--s-load'),
        pos: css('--s-pos'), neg: css('--s-neg')
    };
    const SCENARIO_SLOTS = [css('--s-direct'), css('--s-export'), css('--s-battery'), css('--s-grid')];

    const FN_URL = '/.netlify/functions/pvgis-tmy';
    const SCEN_KEY = 'pvs-scenarios-v1';
    const MODE_KEY = 'pvs-mode';

    /* ------------------------------------------------------------------ *
     * State                                                               *
     * ------------------------------------------------------------------ */

    let config = E.mergeDeep(E.defaultConfig(), { ui: { areaM2: 140, heatSpecific: 80, heatFromArea: true } });
    let mode = 'simple';
    let weather = null;
    let terrain = null;
    let weatherKey = null;
    let result = null;
    let runTimer = null;
    let fetchTimer = null;
    let fetchSeq = 0;
    const weatherCache = new Map();
    let compareSlots = {};

    const store = {
        get(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } },
        set(key, v) { try { window.localStorage.setItem(key, v); return true; } catch (e) { return false; } }
    };

    /* ------------------------------------------------------------------ *
     * Small helpers                                                       *
     * ------------------------------------------------------------------ */

    function getPath(obj, path) {
        return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
    }
    function setPath(obj, path, value) {
        const keys = path.split('.');
        let o = obj;
        keys.slice(0, -1).forEach((k) => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; });
        o[keys[keys.length - 1]] = value;
    }
    function clone(v) { return JSON.parse(JSON.stringify(v)); }
    function round2(v) { return Math.round(Number(v) * 100) / 100; }

    function toast(message) {
        const t = document.createElement('div');
        t.className = 'pvs-toast';
        t.setAttribute('role', 'status');
        t.textContent = message;
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 2600);
    }

    function setStatus(message, kind, retry) {
        const s = $('pvs-status');
        s.textContent = '';
        s.className = 'pvs-status' + (kind === 'error' ? ' is-error' : '');
        if (!message) return;
        s.appendChild(document.createTextNode(message));
        if (retry) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'pvs-btn-ghost pvs-btn-small';
            b.textContent = 'Try again';
            b.addEventListener('click', retry);
            s.appendChild(b);
        }
    }

    function compassName(az) {
        const names = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
        return names[Math.round((((az % 360) + 360) % 360) / 22.5) % 16];
    }

    /* ------------------------------------------------------------------ *
     * Mode (progressive disclosure)                                       *
     * ------------------------------------------------------------------ */

    function setMode(next, quiet) {
        mode = next === 'expert' ? 'expert' : 'simple';
        root.classList.toggle('is-expert', mode === 'expert');
        document.querySelectorAll('.pvs-mode-btn').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === mode)));
        store.set(MODE_KEY, mode);
        if (mode === 'expert') {
            renderArrays();
            drawHorizon();
        } else {
            syncSimpleRoof();
        }
        if (!quiet && result) renderResults();
    }

    /* ------------------------------------------------------------------ *
     * Generic form binding                                                *
     * ------------------------------------------------------------------ */

    function bindInputs() {
        document.querySelectorAll('[data-bind]').forEach((input) => {
            const evt = input.type === 'checkbox' || input.tagName === 'SELECT' ? 'change' : 'input';
            input.addEventListener(evt, () => {
                const path = input.dataset.bind;
                let value;
                if (input.type === 'checkbox') {
                    value = input.checked;
                } else if (input.tagName === 'SELECT' && input.dataset.type !== 'number') {
                    value = input.value;
                } else {
                    if (input.value === '' && input.dataset.nullable) {
                        value = null;
                    } else {
                        value = Number(input.value);
                        if (!Number.isFinite(value)) return;
                        if (input.dataset.scale) value = value / Number(input.dataset.scale);
                    }
                }
                setPath(config, path, value);

                if (path === 'heatPump.heatDemandKwh') config.ui.heatFromArea = false;
                if (path.startsWith('location.')) {
                    config.location.name = null;
                    $('pvs-preset').value = '';
                    scheduleWeather();
                } else {
                    scheduleRun();
                }
                updateDisplays();
            });
        });
    }

    function syncForm() {
        document.querySelectorAll('[data-bind]').forEach((input) => {
            let v = getPath(config, input.dataset.bind);
            if (input.type === 'checkbox') {
                input.checked = !!v;
            } else if (v == null) {
                input.value = '';
            } else {
                if (input.dataset.scale) v = Math.round(v * Number(input.dataset.scale) * 1000) / 1000;
                input.value = String(v);
            }
        });
        $('pvs-area').value = config.ui.areaM2;
        $('pvs-standard').value = String(config.ui.heatSpecific);
        syncSimpleRoof();
        updateDisplays();
        if (mode === 'expert') renderArrays();
    }

    function updateDisplays() {
        $('pvs-kwp-out').textContent = nf1.format(E.totalKwp(config)) + ' kWp';
        $('pvs-tilt-out').textContent = $('pvs-tilt').value + '°';
        $('pvs-batt-out').textContent = config.battery.capacityKwh > 0 ? nf1.format(config.battery.capacityKwh) + ' kWh' : 'none';

        document.querySelectorAll('[data-show-if]').forEach((block) => {
            const box = $(block.dataset.showIf);
            block.hidden = !(box && box.checked);
        });
        document.querySelectorAll('[data-show-if-value]').forEach((block) => {
            const [id, val] = block.dataset.showIfValue.split('=');
            const ctl = $(id);
            block.hidden = !(ctl && ctl.value === val);
        });

        // heat demand from area unless the user typed their own figure
        if (config.ui.heatFromArea) {
            config.heatPump.heatDemandKwh = Math.round(config.ui.areaM2 * config.ui.heatSpecific / 100) * 100;
            const heatInput = $('pvs-heat');
            if (document.activeElement !== heatInput) heatInput.value = String(config.heatPump.heatDemandKwh);
        }
        $('pvs-heat-estimate').textContent = config.ui.heatFromArea
            ? `About ${nf0.format(config.heatPump.heatDemandKwh)} kWh of space heating a year, plus ${nf0.format(config.heatPump.dhwKwh)} kWh for hot water.`
            : `Using your figure of ${nf0.format(config.heatPump.heatDemandKwh)} kWh of space heating a year.`;

        const est = E.estimateCapex(config, E.totalKwp(config));
        $('pvs-capex-hint').textContent = config.finance.capexOverrideEur != null
            ? `Using your figure. A typical 2026 German price would be about ${eur(est.total)}.`
            : `Estimated at ${eur(est.total)} from typical 2026 German prices` +
              (est.battery > 0 ? ` (solar ${eur(est.pv)}, battery ${eur(est.battery)})` : '') + '. Enter your quote to use it.';
    }

    /* ------------------------------------------------------------------ *
     * Roof: simple controls and the expert roof-face editor               *
     * ------------------------------------------------------------------ */

    function simpleRepresentation(arrays) {
        const a = arrays.filter((x) => Number(x.kWp) > 0);
        if (a.length === 1 && !a[0].shadingLossPct) return { kwp: a[0].kWp, orientation: String(Math.round(a[0].azimuthDeg)), tilt: a[0].tiltDeg };
        if (a.length === 2) {
            const az = a.map((x) => Math.round(x.azimuthDeg)).sort((p, q) => p - q);
            if (az[0] === 90 && az[1] === 270 && a[0].tiltDeg === a[1].tiltDeg && Math.abs(a[0].kWp - a[1].kWp) < 0.01) {
                return { kwp: a[0].kWp + a[1].kWp, orientation: 'ew', tilt: a[0].tiltDeg };
            }
        }
        return null;
    }

    function syncSimpleRoof() {
        const rep = simpleRepresentation(config.arrays);
        const orient = $('pvs-orientation');
        if (rep && Array.from(orient.options).some((o) => o.value === rep.orientation)) {
            $('pvs-kwp').value = String(rep.kwp);
            orient.value = rep.orientation;
            $('pvs-tilt').value = String(rep.tilt);
            $('pvs-roof-note').hidden = true;
        } else {
            $('pvs-kwp').value = String(E.totalKwp(config));
            $('pvs-roof-note').hidden = false;
        }
        updateDisplays();
    }

    function arraysFromSimple() {
        const kwp = Number($('pvs-kwp').value);
        const tilt = Number($('pvs-tilt').value);
        const o = $('pvs-orientation').value;
        const mounting = (config.arrays[0] && config.arrays[0].mounting) || 'roof';
        if (o === 'ew') {
            return [
                { name: 'East roof', kWp: round2(kwp / 2), tiltDeg: tilt, azimuthDeg: 90, mounting, shadingLossPct: 0 },
                { name: 'West roof', kWp: round2(kwp / 2), tiltDeg: tilt, azimuthDeg: 270, mounting, shadingLossPct: 0 }
            ];
        }
        const az = Number(o);
        return [{ name: compassName(az) + ' roof', kWp: kwp, tiltDeg: tilt, azimuthDeg: az, mounting, shadingLossPct: 0 }];
    }

    function bindSimpleRoof() {
        ['pvs-kwp', 'pvs-tilt'].forEach((id) => $(id).addEventListener('input', onSimpleRoof));
        $('pvs-orientation').addEventListener('change', onSimpleRoof);
    }

    function onSimpleRoof() {
        config.arrays = arraysFromSimple();
        $('pvs-roof-note').hidden = true;
        updateDisplays();
        scheduleRun();
    }

    function renderArrays() {
        const host = $('pvs-arrays');
        host.textContent = '';
        config.arrays.forEach((arr, idx) => {
            const card = document.createElement('div');
            card.className = 'pvs-array';

            const head = document.createElement('div');
            head.className = 'pvs-array-head';
            const name = document.createElement('input');
            name.type = 'text';
            name.value = arr.name || `Roof face ${idx + 1}`;
            name.setAttribute('aria-label', `Name of roof face ${idx + 1}`);
            name.addEventListener('input', () => { arr.name = name.value; });
            head.appendChild(name);
            if (config.arrays.length > 1) {
                const rm = document.createElement('button');
                rm.type = 'button';
                rm.className = 'pvs-array-remove';
                rm.textContent = 'Remove';
                rm.setAttribute('aria-label', `Remove ${arr.name || 'roof face ' + (idx + 1)}`);
                rm.addEventListener('click', () => {
                    config.arrays.splice(idx, 1);
                    renderArrays();
                    syncSimpleRoof();
                    scheduleRun();
                });
                head.appendChild(rm);
            }
            card.appendChild(head);

            const fields = [
                { key: 'kWp', label: 'kWp', step: '0.1', min: '0', max: '200' },
                { key: 'tiltDeg', label: 'Tilt (°)', step: '1', min: '0', max: '90' },
                { key: 'azimuthDeg', label: 'Faces (°, 180 = S)', step: '1', min: '0', max: '359' },
                { key: 'shadingLossPct', label: 'Extra shading (%)', step: '1', min: '0', max: '90' }
            ];
            const row1 = document.createElement('div');
            row1.className = 'pvs-row';
            const row2 = document.createElement('div');
            row2.className = 'pvs-row';
            fields.forEach((f, i) => {
                const wrap = document.createElement('div');
                wrap.className = 'pvs-field';
                const id = `pvs-arr-${idx}-${f.key}`;
                const label = document.createElement('label');
                label.htmlFor = id;
                label.textContent = f.label;
                const input = document.createElement('input');
                input.type = 'number';
                input.id = id;
                input.step = f.step; input.min = f.min; input.max = f.max;
                input.value = String(arr[f.key] != null ? arr[f.key] : 0);
                input.addEventListener('input', () => {
                    const v = Number(input.value);
                    if (!Number.isFinite(v)) return;
                    arr[f.key] = v;
                    if (f.key === 'azimuthDeg') label.textContent = `Faces ${compassName(v)} (°)`;
                    syncSimpleRoof();
                    scheduleRun();
                });
                if (f.key === 'azimuthDeg') label.textContent = `Faces ${compassName(arr.azimuthDeg)} (°)`;
                wrap.appendChild(label);
                wrap.appendChild(input);
                (i < 2 ? row1 : row2).appendChild(wrap);
            });
            card.appendChild(row1);
            card.appendChild(row2);

            const mWrap = document.createElement('div');
            mWrap.className = 'pvs-field';
            mWrap.style.marginTop = '0.4rem';
            const mId = `pvs-arr-${idx}-mount`;
            const mLabel = document.createElement('label');
            mLabel.htmlFor = mId;
            mLabel.textContent = 'Mounting';
            const sel = document.createElement('select');
            sel.id = mId;
            Object.keys(E.MOUNTING).forEach((k) => {
                const o = document.createElement('option');
                o.value = k;
                o.textContent = E.MOUNTING[k].label;
                sel.appendChild(o);
            });
            sel.value = arr.mounting || 'roof';
            sel.addEventListener('change', () => { arr.mounting = sel.value; scheduleRun(); });
            mWrap.appendChild(mLabel);
            mWrap.appendChild(sel);
            card.appendChild(mWrap);

            host.appendChild(card);
        });
        $('pvs-add-array').hidden = config.arrays.length >= 4;
    }

    function bindArrayAdd() {
        $('pvs-add-array').addEventListener('click', () => {
            if (config.arrays.length >= 4) return;
            config.arrays.push({ name: `Roof face ${config.arrays.length + 1}`, kWp: 3, tiltDeg: 30, azimuthDeg: 270, mounting: 'roof', shadingLossPct: 0 });
            renderArrays();
            syncSimpleRoof();
            scheduleRun();
        });
    }

    /* ------------------------------------------------------------------ *
     * Location and weather                                                *
     * ------------------------------------------------------------------ */

    function setLocation(lat, lon, name) {
        config.location.lat = round2(lat);
        config.location.lon = round2(lon);
        config.location.name = name || null;
        $('pvs-lat').value = String(config.location.lat);
        $('pvs-lon').value = String(config.location.lon);
        loadWeather();
    }

    function bindLocation() {
        $('pvs-preset').addEventListener('change', (e) => {
            if (!e.target.value) return;
            const [lat, lon] = e.target.value.split(',').map(Number);
            setLocation(lat, lon, e.target.options[e.target.selectedIndex].textContent);
        });

        const search = async () => {
            const q = $('pvs-search').value.trim();
            if (!q) return;
            const hint = $('pvs-weather-status');
            hint.className = 'pvs-hint';
            hint.textContent = 'Searching…';
            try {
                const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`, { headers: { 'Accept-Language': 'en' } });
                const list = await res.json();
                if (!Array.isArray(list) || !list.length) {
                    hint.className = 'pvs-hint is-error';
                    hint.textContent = `Couldn't find "${q}". Try a town name or postcode, or enter coordinates.`;
                    return;
                }
                const hit = list[0];
                $('pvs-preset').value = '';
                setLocation(Number(hit.lat), Number(hit.lon), String(hit.display_name || q).split(',').slice(0, 2).join(','));
            } catch (err) {
                hint.className = 'pvs-hint is-error';
                hint.textContent = 'Place search is unavailable right now. Enter the coordinates instead.';
            }
        };
        $('pvs-search-btn').addEventListener('click', search);
        $('pvs-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } });

        $('pvs-geo').addEventListener('click', () => {
            const hint = $('pvs-weather-status');
            if (!navigator.geolocation) {
                hint.className = 'pvs-hint is-error';
                hint.textContent = 'Your browser does not share its location. Enter the coordinates instead.';
                return;
            }
            hint.className = 'pvs-hint';
            hint.textContent = 'Asking your browser for the location…';
            navigator.geolocation.getCurrentPosition(
                (pos) => { $('pvs-preset').value = ''; setLocation(pos.coords.latitude, pos.coords.longitude, 'My location'); },
                () => { hint.className = 'pvs-hint is-error'; hint.textContent = 'Location access was declined. Enter the coordinates instead.'; },
                { timeout: 10000, maximumAge: 600000 }
            );
        });
    }

    function scheduleWeather() {
        clearTimeout(fetchTimer);
        fetchTimer = setTimeout(loadWeather, 700);
    }

    function cacheGet(key) {
        if (weatherCache.has(key)) return weatherCache.get(key);
        try {
            const raw = window.sessionStorage.getItem('pvs-w-' + key);
            if (raw) {
                const v = JSON.parse(raw);
                weatherCache.set(key, v);
                return v;
            }
        } catch (e) { /* storage unavailable */ }
        return null;
    }
    function cacheSet(key, v) {
        weatherCache.set(key, v);
        try { window.sessionStorage.setItem('pvs-w-' + key, JSON.stringify(v)); } catch (e) { /* quota or disabled */ }
    }

    async function loadWeather() {
        clearTimeout(fetchTimer);
        const lat = round2(config.location.lat);
        const lon = round2(config.location.lon);
        const hint = $('pvs-weather-status');
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -60 || lat > 70 || lon < -180 || lon > 180) {
            hint.className = 'pvs-hint is-error';
            hint.textContent = 'Latitude must be between -60 and 70, longitude between -180 and 180.';
            return;
        }
        const key = `${lat},${lon}`;
        const seq = ++fetchSeq;

        let data = cacheGet(key);
        if (!data) {
            hint.className = 'pvs-hint';
            hint.textContent = `Fetching a typical weather year for ${lat}, ${lon} from PVGIS…`;
            if (result) $('pvs-output').classList.add('is-stale');
            else setStatus('Fetching satellite weather data from PVGIS. This takes a few seconds the first time.');
            try {
                const [tRes, hRes] = await Promise.all([
                    fetch(`${FN_URL}?lat=${lat}&lon=${lon}`),
                    fetch(`${FN_URL}?lat=${lat}&lon=${lon}&type=horizon`).catch(() => null)
                ]);
                if (seq !== fetchSeq) return;
                if (!tRes.ok) {
                    let msg = `HTTP ${tRes.status}`;
                    try { const j = await tRes.json(); msg = j.error || msg; } catch (e) { /* not JSON */ }
                    throw new Error(msg);
                }
                const tmy = await tRes.json();
                let horizonProfile = null;
                if (hRes && hRes.ok) {
                    try { horizonProfile = (await hRes.json()).profile || null; } catch (e) { horizonProfile = null; }
                }
                data = { tmy, horizon: horizonProfile ? E.resampleHorizon(horizonProfile) : null };
                cacheSet(key, data);
            } catch (err) {
                if (seq !== fetchSeq) return;
                // the results on screen belong to the previous location: keep them, but dimmed
                if (result) $('pvs-output').classList.add('is-stale');
                hint.className = 'pvs-hint is-error';
                hint.textContent = 'No weather data for this location.';
                const local = /404|501|Failed to fetch|NetworkError/i.test(String(err.message));
                setStatus(local
                    ? 'The weather service could not be reached. If you are running the site locally, start it with "netlify dev" so the PVGIS proxy function is available.'
                    : `PVGIS could not provide weather data here: ${err.message}`, 'error', loadWeather);
                return;
            }
        }
        if (seq !== fetchSeq) return;

        weather = data.tmy;
        terrain = data.horizon;
        weatherKey = key;
        const src = weather.source || {};
        hint.className = 'pvs-hint is-ok';
        hint.textContent = `Typical year from ${src.radiationDb || 'PVGIS'}` +
            (src.yearMin ? `, ${src.yearMin}–${src.yearMax}` : '') +
            (weather.location && weather.location.elevation != null ? ` · ${nf0.format(weather.location.elevation)} m above sea level` : '') +
            (terrain ? '' : ' · terrain horizon unavailable');
        setStatus('');
        drawHorizon();
        runNow();
    }

    /* ------------------------------------------------------------------ *
     * Running the model                                                   *
     * ------------------------------------------------------------------ */

    function scheduleRun() {
        clearTimeout(runTimer);
        runTimer = setTimeout(runNow, 180);
    }

    function runNow() {
        clearTimeout(runTimer);
        if (!weather) return;
        try {
            result = E.simulate(config, weather, terrain);
        } catch (err) {
            setStatus(`The simulation stopped: ${err.message}`, 'error');
            return;
        }
        $('pvs-output').hidden = false;
        $('pvs-output').classList.remove('is-stale');
        $('pvs-csv').disabled = false;
        $('pvs-pdf').disabled = false;
        renderResults();
    }

    /* ------------------------------------------------------------------ *
     * Results                                                             *
     * ------------------------------------------------------------------ */

    function tile(label, value, note) {
        const t = document.createElement('div');
        t.className = 'pvs-tile';
        const l = document.createElement('p');
        l.className = 'pvs-tile-label';
        l.textContent = label;
        const v = document.createElement('p');
        v.className = 'pvs-tile-value';
        v.textContent = value;
        t.appendChild(l);
        t.appendChild(v);
        if (note) {
            const n = document.createElement('p');
            n.className = 'pvs-tile-note';
            n.textContent = note;
            t.appendChild(n);
        }
        return t;
    }

    function renderResults() {
        if (!result) return;
        const k = result.kpi;
        const life = result.yearly.length;

        $('pvs-payback').textContent = k.paybackYears == null ? `not within ${life} years` : `${nf1.format(k.paybackYears)} years`;
        $('pvs-hero-sub').textContent = k.paybackYears == null
            ? `After ${life} years you would be ${eur(-k.lifetimeNetEur)} behind. Try a smaller system, a lower price or a higher self-consumption.`
            : `Then about ${eur(k.lifetimeNetEur)} ahead after ${life} years. You save ${eur(k.year1NetEur)} in year one after running costs.`;

        const tiles = $('pvs-tiles');
        tiles.textContent = '';
        tiles.appendChild(tile('Solar yield', `${nf0.format(k.pvKwh)} kWh`, `${nf0.format(k.specificYield)} kWh per kWp`));
        tiles.appendChild(tile('Self-consumption', `${nf0.format(k.selfConsumptionPct)} %`, 'of your solar used at home'));
        tiles.appendChild(tile('Self-sufficiency', `${nf0.format(k.autarkyPct)} %`, 'of your use covered by solar'));
        tiles.appendChild(tile('Savings, year one', eur(k.year1NetEur), 'after running costs'));
        tiles.appendChild(tile('Investment', eur(k.capexEur), config.finance.capexOverrideEur != null ? 'your figure' : 'estimated'));
        tiles.appendChild(tile('CO₂ avoided', `${nf1.format(k.co2AvoidedKg / 1000)} t/yr`, `at ${nf2.format(config.finance.co2KgPerKwh)} kg/kWh`));
        if (mode === 'expert') {
            tiles.appendChild(tile('Performance ratio', `${nf1.format(100 * k.performanceRatio)} %`, 'AC yield / plane irradiation'));
            tiles.appendChild(tile('Net present value', eur(k.npvEur), `at ${nf1.format(config.finance.discountRatePct)} % discount`));
            tiles.appendChild(tile('Internal rate of return', k.irrPct == null ? 'n/a' : `${nf1.format(k.irrPct)} %`, `over ${life} years`));
            tiles.appendChild(tile('Cost of solar power', k.lcoeEurPerKwh == null ? 'n/a' : `${nf1.format(100 * k.lcoeEurPerKwh)} ct/kWh`, 'levelised (LCOE)'));
            if (config.battery.capacityKwh > 0) tiles.appendChild(tile('Battery cycles', `${nf0.format(k.batteryCycles)} /yr`, `${nf1.format(result.meta.batteryPowerKw)} kW power`));
            if (config.heatPump.enabled) tiles.appendChild(tile('Heat pump SCOP', nf2.format(result.meta.scop), `${nf0.format(result.meta.heatDemandKwh)} kWh heat`));
            if (config.ev.enabled) tiles.appendChild(tile('Car charged by solar', `${nf0.format(k.evSolarSharePct)} %`, `${nf0.format(result.meta.evAnnualKwh)} kWh a year`));
            tiles.appendChild(tile('Inverter', `${nf1.format(result.meta.inverterKw)} kW`, `DC/AC ratio ${nf2.format(result.meta.dcAcRatio)}`));
            if (k.curtailedKwh > 0.5) tiles.appendChild(tile('Lost to feed-in limit', `${nf0.format(k.curtailedKwh)} kWh`, `${nf1.format(100 * k.curtailedKwh / k.pvKwh)} % of yield`));
            if (k.clippedKwh > 0.5) tiles.appendChild(tile('Inverter clipping', `${nf0.format(k.clippedKwh)} kWh`, `${nf1.format(100 * k.clippedKwh / (k.pvKwh + k.clippedKwh))} % of DC`));
        }

        renderMonthly();
        renderDay();
        renderCash();
        if (mode === 'expert') {
            renderCarpet();
            renderLosses();
        }
        renderMethod();
        renderHorizonLoss();
        renderCompare();
    }

    function monthlySeries(key) { return result.monthly.map((m) => m[key]); }

    function renderMonthly() {
        const solarSeries = [
            { label: 'Used directly', color: COL.direct, values: monthlySeries('direct'), always: true },
            { label: 'Stored in battery', color: COL.battery, values: monthlySeries('battCharge') },
            { label: 'Fed into the grid', color: COL.export, values: monthlySeries('exported'), always: true },
            { label: 'Curtailed by feed-in limit', color: COL.curtail, values: monthlySeries('curtailed') }
        ];
        C.stackedColumns($('pvs-chart-solar'), {
            categories: MONTHS, categoryTitles: MONTHS_LONG, series: solarSeries, unit: 'kWh',
            ariaLabel: 'Monthly solar production split into used directly, stored in battery, fed into the grid and curtailed'
        });
        tableFor('pvs-chart-solar', ['Month'].concat(solarSeries.filter((s) => s.always || s.values.some((v) => v > 0)).map((s) => s.label + ' (kWh)')).concat(['Total (kWh)']),
            MONTHS_LONG.map((m, i) => {
                const vis = solarSeries.filter((s) => s.always || s.values.some((v) => v > 0));
                return [m].concat(vis.map((s) => nf0.format(s.values[i]))).concat([nf0.format(result.monthly[i].pvAc)]);
            }), true);

        const supplySeries = [
            { label: 'Solar, directly', color: COL.direct, values: monthlySeries('direct'), always: true },
            { label: 'From battery', color: COL.battery, values: monthlySeries('battDischarge') },
            { label: 'From the grid', color: COL.grid, values: monthlySeries('imported'), always: true }
        ];
        C.stackedColumns($('pvs-chart-supply'), {
            categories: MONTHS, categoryTitles: MONTHS_LONG, series: supplySeries, unit: 'kWh',
            ariaLabel: 'Monthly consumption split into solar directly, from battery and from the grid'
        });
        const visS = supplySeries.filter((s) => s.always || s.values.some((v) => v > 0));
        tableFor('pvs-chart-supply', ['Month'].concat(visS.map((s) => s.label + ' (kWh)')).concat(['Household', 'Heat pump', 'Car', 'Total use (kWh)']),
            MONTHS_LONG.map((m, i) => {
                const mm = result.monthly[i];
                return [m].concat(visS.map((s) => nf0.format(s.values[i]))).concat([nf0.format(mm.house), nf0.format(mm.hp), nf0.format(mm.ev), nf0.format(mm.load)]);
            }), true);
    }

    function tableFor(chartId, cols, rows, withTotal) {
        const host = $(chartId + '-table');
        if (!host) return;
        let allRows = rows;
        if (withTotal) {
            const totals = cols.slice(1).map((_, ci) => rows.reduce((a, r) => a + Number(String(r[ci + 1]).replace(/,/g, '')), 0));
            allRows = rows.concat([['Year'].concat(totals.map((t) => nf0.format(t)))]);
        }
        C.table(host, cols, allRows);
        if (withTotal) {
            const last = host.querySelector('tbody tr:last-child');
            if (last) last.classList.add('is-total');
        }
    }

    // index of local hour h on day-of-year d in the UTC-indexed arrays
    function idxLocal(doy, localHour) {
        return Math.max(0, Math.min(E.HOURS - 1, (doy - 1) * 24 + localHour - result.meta.localHourOffset));
    }

    function renderDay() {
        const H = result.hourly;
        const month = Number($('pvs-day-month').value);
        const kind = $('pvs-day-kind').value;
        const first = E.MONTH_START_DOY[month];
        const days = E.MONTH_DAYS[month];

        const dayTotal = (doy) => {
            let s = 0;
            for (let h = 0; h < 24; h++) s += H.pvAc[idxLocal(doy, h)];
            return s;
        };

        let pv = new Array(24).fill(0);
        let load = new Array(24).fill(0);
        let soc = new Array(24).fill(0);
        let title;
        if (kind === 'avg') {
            for (let d = 0; d < days; d++) {
                for (let h = 0; h < 24; h++) {
                    const i = idxLocal(first + d, h);
                    pv[h] += H.pvAc[i] / days;
                    load[h] += H.load[i] / days;
                    soc[h] += H.socPct[i] / days;
                }
            }
            title = `Average day in ${MONTHS_LONG[month]}`;
        } else {
            let pick = first;
            let best = kind === 'best' ? -1 : Infinity;
            for (let d = 0; d < days; d++) {
                const t = dayTotal(first + d);
                if ((kind === 'best' && t > best) || (kind === 'worst' && t < best)) { best = t; pick = first + d; }
            }
            for (let h = 0; h < 24; h++) {
                const i = idxLocal(pick, h);
                pv[h] = H.pvAc[i]; load[h] = H.load[i]; soc[h] = H.socPct[i];
            }
            title = `${kind === 'best' ? 'Sunniest' : 'Darkest'} day in ${MONTHS_LONG[month]} (${pick - first + 1} ${MONTHS_LONG[month]} in the typical year)`;
        }
        const pvSum = pv.reduce((a, b) => a + b, 0);
        const loadSum = load.reduce((a, b) => a + b, 0);
        $('pvs-day-sub').textContent = `${title} · solar ${nf1.format(pvSum)} kWh, use ${nf1.format(loadSum)} kWh`;

        const hours = Array.from({ length: 24 }, (_, i) => i);
        const hh = (h) => String(h).padStart(2, '0') + ':00';
        C.lines($('pvs-chart-day'), {
            x: hours, xFormat: hh, xFormatLong: (h) => `${hh(h)}–${hh((h + 1) % 24)}`, xTickEvery: 3,
            series: [
                { label: 'Solar production', color: COL.direct, values: pv, area: true },
                { label: 'Consumption', color: COL.load, values: load }
            ],
            unit: 'kW', valueFormat: (v) => nf2.format(v), yMin: 0,
            yFormat: (v) => nf1.format(v).replace(/\.0$/, ''),
            ariaLabel: `${title}: solar production and consumption by hour in kilowatts`
        });

        const socWrap = $('pvs-chart-soc-wrap');
        if (config.battery.capacityKwh > 0) {
            socWrap.hidden = false;
            C.lines($('pvs-chart-soc'), {
                x: hours, xFormat: hh, xTickEvery: 3, height: 130,
                series: [{ label: 'Battery charge', color: COL.battery, values: soc, area: true }],
                unit: '%', valueFormat: (v) => nf0.format(v), yMin: 0, yMax: 100, yFormat: (v) => v + '%',
                ariaLabel: `${title}: battery state of charge in percent`
            });
        } else {
            socWrap.hidden = true;
        }

        C.table($('pvs-chart-day-table'), ['Hour', 'Solar (kW)', 'Use (kW)'].concat(config.battery.capacityKwh > 0 ? ['Battery (%)'] : []),
            hours.map((h) => [hh(h), nf2.format(pv[h]), nf2.format(load[h])].concat(config.battery.capacityKwh > 0 ? [nf0.format(soc[h])] : [])));
    }

    function renderCash() {
        const k = result.kpi;
        const cum = result.cumulative;
        const years = cum.map((_, i) => (i === 0 ? '0' : String(i)));
        C.signedColumns($('pvs-chart-cash'), {
            categories: years, values: cum,
            categoryTitle: (i) => (i === 0 ? 'Day one (investment)' : `End of year ${i}`),
            posColor: COL.pos, negColor: COL.neg, posLabel: 'Ahead', negLabel: 'Still paying back',
            valueLabel: 'cumulative', valueFormat: eur,
            extraRows: (i) => (i === 0 ? [] : [{ value: eur(result.yearly[i - 1].netEur), label: 'net this year' }]),
            marker: k.paybackYears == null ? null : { position: k.paybackYears, label: `Paid back after ${nf1.format(k.paybackYears)} years` },
            ariaLabel: 'Cumulative cash position by year, negative while the investment is being paid back'
        });
        $('pvs-cash-sub').textContent = `Investment ${eur(k.capexEur)} · electricity prices rise ${nf1.format(config.tariff.escalationPctPerYear)} % a year · feed-in tariff for ${config.tariff.feedInYears} years`;
        C.table($('pvs-chart-cash-table'),
            ['Year', 'Solar (kWh)', 'Bill without (€)', 'Bill with (€)', 'Feed-in (€)', 'Costs (€)', 'Net (€)', 'Cumulative (€)'],
            [['0', '', '', '', '', nf0.format(k.capexEur), nf0.format(-k.capexEur), nf0.format(-k.capexEur)]].concat(
                result.yearly.map((y) => [String(y.year), nf0.format(y.pvKwh), nf0.format(y.billWithoutEur), nf0.format(y.billWithEur),
                    nf0.format(y.feedInEur), nf0.format(y.opexEur + y.replacementEur), nf0.format(y.netEur), nf0.format(y.cumulativeEur)])
            ));
    }

    function renderCarpet() {
        const off = result.meta.localHourOffset;
        C.heatmap($('pvs-chart-carpet'), {
            values: result.hourly.pvAc,
            hourIndex: (h) => ((h - off) % 24 + 24) % 24,
            unit: 'kW', legendLabel: 'Solar output', valueLabel: 'solar output',
            cellTitle: (d, h) => {
                const doy = d + 1;
                let m = 11;
                while (m > 0 && E.MONTH_START_DOY[m] > doy) m--;
                return `${doy - E.MONTH_START_DOY[m] + 1} ${MONTHS_LONG[m]}, ${String(h).padStart(2, '0')}:00`;
            },
            ariaLabel: 'Heatmap of solar output for every hour of the year. Use arrow keys to move between days and hours.'
        });
    }

    function renderLosses() {
        const L = result.losses;
        const k = result.kpi;
        const nominal = L.nominalKwh;
        const pct = (v) => (nominal > 0 ? nf1.format(100 * v / nominal) + ' %' : '');
        const horizon = E.totalKwp(config) * L.horizonBlockedKwhM2;
        const optical = L.nominalKwh - horizon - L.stcKwh;
        const systemLoss = L.stcKwh - L.temperatureLossKwh - L.dcKwh;
        const rows = [
            ['Sunlight on the panels, at rated efficiency', nf0.format(nominal), '100 %'],
            ['Blocked by the horizon', '−' + nf0.format(horizon), pct(horizon)],
            ['Reflection, sky obstruction and extra shading', '−' + nf0.format(optical), pct(optical)],
            ['Heat and weak light', '−' + nf0.format(L.temperatureLossKwh), pct(L.temperatureLossKwh)],
            ['Cables, mismatch and dirt', '−' + nf0.format(systemLoss), pct(systemLoss)],
            ['Inverter conversion', '−' + nf0.format(L.inverterLossKwh), pct(L.inverterLossKwh)],
            ['Inverter clipping', '−' + nf0.format(L.clippedKwh), pct(L.clippedKwh)],
            ['Solar electricity delivered', nf0.format(L.acKwh), pct(L.acKwh)],
            ['  used in the house (incl. via battery)', nf0.format(k.selfUsedKwh), ''],
            ['  fed into the grid', nf0.format(k.exportKwh), ''],
            ['  curtailed by the feed-in limit', nf0.format(k.curtailedKwh), ''],
            ['  lost in the battery', nf0.format(Math.max(0, k.pvKwh - k.selfUsedKwh - k.exportKwh - k.curtailedKwh)), '']
        ];
        C.table($('pvs-losses'), ['Step', 'kWh', 'Share'], rows);
        const delivered = $('pvs-losses').querySelectorAll('tbody tr')[7];
        if (delivered) delivered.classList.add('is-total');
    }

    function renderHorizonLoss() {
        const L = result.losses;
        const share = L.poaRawKwhM2 > 0 ? 100 * L.horizonBlockedKwhM2 / L.poaRawKwhM2 : 0;
        $('pvs-horizon-loss').textContent = share < 0.05
            ? 'Nothing on the horizon blocks your panels noticeably.'
            : `Obstructions block ${nf1.format(share)} % of the sunlight that would reach your panels.`;
    }

    function renderMethod() {
        const body = $('pvs-method-body');
        body.textContent = '';
        const src = (weather && weather.source) || {};
        const add = (tag, txt) => { const n = document.createElement(tag); n.textContent = txt; body.appendChild(n); return n; };
        const list = (items) => { const ul = document.createElement('ul'); items.forEach((t) => { const li = document.createElement('li'); li.textContent = t; ul.appendChild(li); }); body.appendChild(ul); };

        add('h4', 'Weather');
        add('p', `A typical meteorological year from PVGIS (European Commission, Joint Research Centre) for ${config.location.lat}, ${config.location.lon}: hourly global, direct and diffuse sunlight, air temperature and wind. Radiation from ${src.radiationDb || 'satellite data'}, temperature and wind from ${src.meteoDb || 'reanalysis'}` +
            (src.yearMin ? `, each month picked as the most typical one between ${src.yearMin} and ${src.yearMax}.` : '.'));
        add('h4', 'From sunlight to electricity');
        list([
            'Sun position every hour from the date, time and your coordinates.',
            'Sunlight on each roof face with the Hay-Davies model: direct beam, the bright ring around the sun, the rest of the sky and light reflected from the ground.',
            'Hills from PVGIS terrain data and anything you draw in the horizon editor block the direct sun when it is behind them.',
            'Reflection off the glass at low sun angles (ASHRAE model).',
            'Panel temperature from sunlight, air temperature and wind (Faiman model), and the efficiency loss from heat and weak light.',
            `One shared inverter of ${nf1.format(result.meta.inverterKw)} kW at ${nf1.format(config.inverter.efficiencyPct)} % efficiency, which clips above its rating.`
        ]);
        add('p', 'Checked against PVGIS\'s own yield calculator for Cologne, Munich, Hamburg and Madrid across four roof orientations: with the PVGIS reference module selected the results agree within 3.5 %.');
        add('h4', 'Your consumption');
        list([
            'Household use follows the shape of the German standard household profile (BDEW H0), including weekday, weekend and seasonal patterns. Because H0 averages thousands of homes, half of each day’s energy is turned into individual appliance runs (cooking, washing, kettle), so your home has the peaks a real single home has. The same household is used in every run, so scenarios stay comparable.',
            'A heat pump\'s heating follows the outdoor temperature below the heating limit; its efficiency comes from the temperature lift it has to manage.',
            'A car needs the same energy every day; the charging setting decides when it draws it.'
        ]);
        add('h4', 'Battery and grid');
        add('p', 'Each hour, solar power first covers the house, then charges the battery, then goes to the grid (up to any feed-in limit). Shortfalls are covered from the battery, then the grid.');
        add('h4', 'Money');
        add('p', `Savings are your electricity bill without the system minus the bill with it, plus feed-in income, minus running costs and an inverter replacement in year ${config.finance.inverterReplacementYear}. Each year is simulated again with module degradation and battery ageing. Prices are in today's euros at a ${nf1.format(config.tariff.escalationPctPerYear)} % yearly price rise.`);
        add('h4', 'What it does not do');
        list([
            'Changes within an hour. The model works in whole hours, which smooths short spikes in use and passing clouds; compared with minute-by-minute data this makes self-consumption and self-sufficiency look a few percentage points better than they will be.',
            'Weather that differs from the typical year. Each month of a typical year is a real month picked as representative, so single months (in Cologne, December) can be sunnier or duller than the long-term average.',
            'Partial shading of individual panels by nearby objects beyond the extra-shading percentage you enter.',
            'Snow cover and local microclimate.',
            'Dynamic electricity prices, negative-price hours and subsidies or tax effects.'
        ]);
    }

    /* ------------------------------------------------------------------ *
     * Horizon editor                                                      *
     * ------------------------------------------------------------------ */

    const HZ = { maxEl: 70, selected: 18, dragging: false };

    function customHorizon() {
        if (!Array.isArray(config.horizon.custom) || config.horizon.custom.length !== 36) config.horizon.custom = new Array(36).fill(0);
        return config.horizon.custom;
    }

    function drawHorizon() {
        const canvas = $('pvs-horizon-canvas');
        if (!canvas || mode !== 'expert') return;
        const w = canvas.clientWidth || 320;
        const h = canvas.clientHeight || 220;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const m = { l: 30, r: 8, t: 8, b: 22 };
        const iw = w - m.l - m.r;
        const ih = h - m.t - m.b;
        const sx = (az) => m.l + (az / 360) * iw;
        const sy = (el) => m.t + ih - (Math.min(HZ.maxEl, Math.max(0, el)) / HZ.maxEl) * ih;
        HZ.geom = { m, iw, ih, sx, sy };

        ctx.fillStyle = css('--surface-2');
        ctx.fillRect(0, 0, w, h);

        ctx.strokeStyle = css('--grid');
        ctx.lineWidth = 1;
        ctx.fillStyle = css('--text-muted');
        ctx.font = '11px Inter, system-ui, sans-serif';
        ctx.textAlign = 'right';
        [0, 20, 40, 60].forEach((el) => {
            ctx.beginPath(); ctx.moveTo(m.l, sy(el) + 0.5); ctx.lineTo(w - m.r, sy(el) + 0.5); ctx.stroke();
            ctx.fillText(el + '°', m.l - 4, sy(el) + 4);
        });
        ctx.textAlign = 'center';
        ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'N'].forEach((lab, i) => ctx.fillText(lab, sx(i * 45), h - 6));

        // sun paths for June, the equinoxes and December
        const lat = config.location.lat;
        const lon = config.location.lon;
        [[172, 'Jun'], [80, 'Mar/Sep'], [355, 'Dec']].forEach(([doy, label]) => {
            ctx.strokeStyle = css('--text-muted');
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            let started = false;
            let peak = { el: -90, az: 180 };
            for (let t = 0; t <= 24; t += 0.1) {
                const p = E.sunPosition(doy, t, lat, lon);
                if (p.elevationDeg <= 0) { started = false; continue; }
                if (p.elevationDeg > peak.el) peak = { el: p.elevationDeg, az: p.azimuthDeg };
                const x = sx(p.azimuthDeg);
                const y = sy(p.elevationDeg);
                if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
            }
            ctx.stroke();
            ctx.fillStyle = css('--text-secondary');
            ctx.fillText(label, sx(peak.az), Math.max(m.t + 10, sy(peak.el) - 6));
        });

        const fillProfile = (arr, fill, stroke) => {
            ctx.beginPath();
            ctx.moveTo(sx(0), sy(0));
            for (let i = 0; i <= 36; i++) ctx.lineTo(sx(i * 10), sy(arr[i % 36]));
            ctx.lineTo(sx(360), sy(0));
            ctx.closePath();
            ctx.fillStyle = fill;
            ctx.fill();
            if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
        };

        if (config.horizon.useTerrain && terrain) fillProfile(terrain, 'rgba(137,135,129,0.35)', 'rgba(195,194,183,0.6)');
        const custom = customHorizon();
        if (custom.some((v) => v > 0)) fillProfile(custom, 'rgba(240,239,236,0.22)', 'rgba(240,239,236,0.8)');

        custom.forEach((v, i) => {
            const x = sx(i * 10);
            const y = sy(v);
            ctx.beginPath();
            ctx.arc(x, y, i === HZ.selected ? 5 : 3, 0, Math.PI * 2);
            ctx.fillStyle = i === HZ.selected ? css('--accent-2') : css('--text-primary');
            ctx.fill();
        });
        if (document.activeElement === canvas) {
            ctx.fillStyle = css('--text-primary');
            ctx.textAlign = 'left';
            ctx.fillText(`${HZ.selected * 10}° ${compassName(HZ.selected * 10)}: ${nf0.format(custom[HZ.selected])}°`, m.l + 6, m.t + 12);
        }
    }

    function bindHorizon() {
        const canvas = $('pvs-horizon-canvas');
        const pick = (evt) => {
            const g = HZ.geom;
            if (!g) return;
            const rect = canvas.getBoundingClientRect();
            const x = evt.clientX - rect.left;
            const y = evt.clientY - rect.top;
            const idx = Math.round(((x - g.m.l) / g.iw) * 36);
            const i = ((idx % 36) + 36) % 36;
            const el = Math.max(0, Math.min(HZ.maxEl, ((g.m.t + g.ih - y) / g.ih) * HZ.maxEl));
            customHorizon()[i] = Math.round(el);
            HZ.selected = i;
            drawHorizon();
        };
        canvas.addEventListener('pointerdown', (e) => { HZ.dragging = true; canvas.setPointerCapture(e.pointerId); pick(e); });
        canvas.addEventListener('pointermove', (e) => { if (HZ.dragging) pick(e); });
        const end = () => { if (HZ.dragging) { HZ.dragging = false; scheduleRun(); } };
        canvas.addEventListener('pointerup', end);
        canvas.addEventListener('pointercancel', end);
        canvas.addEventListener('focus', drawHorizon);
        canvas.addEventListener('blur', drawHorizon);
        canvas.addEventListener('keydown', (e) => {
            const c = customHorizon();
            const step = e.shiftKey ? 5 : 1;
            if (e.key === 'ArrowLeft') HZ.selected = (HZ.selected + 35) % 36;
            else if (e.key === 'ArrowRight') HZ.selected = (HZ.selected + 1) % 36;
            else if (e.key === 'ArrowUp') { c[HZ.selected] = Math.min(HZ.maxEl, c[HZ.selected] + step); scheduleRun(); }
            else if (e.key === 'ArrowDown') { c[HZ.selected] = Math.max(0, c[HZ.selected] - step); scheduleRun(); }
            else return;
            e.preventDefault();
            drawHorizon();
        });

        document.querySelectorAll('[data-horizon]').forEach((b) => b.addEventListener('click', () => {
            const kind = b.dataset.horizon;
            const c = new Array(36).fill(0);
            if (kind === 'tree-se') { [11, 12, 13, 14, 15].forEach((i, k) => { c[i] = [12, 22, 26, 22, 12][k]; }); }
            if (kind === 'house-s') { [16, 17, 18, 19, 20].forEach((i) => { c[i] = 18; }); }
            if (kind === 'valley') { for (let i = 0; i < 36; i++) c[i] = 8 + 6 * Math.abs(Math.cos(i * 10 * Math.PI / 180)); }
            config.horizon.custom = kind === 'clear' ? null : c.map((v) => Math.round(v));
            drawHorizon();
            runNow();
        }));
        $('pvs-terrain').addEventListener('change', drawHorizon);

        if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => drawHorizon()).observe(canvas);
    }

    /* ------------------------------------------------------------------ *
     * Custom load profile upload                                          *
     * ------------------------------------------------------------------ */

    function bindCsvUpload() {
        const input = $('pvs-csv-upload');
        const status = $('pvs-csv-status');
        const clear = $('pvs-csv-clear');
        input.addEventListener('change', () => {
            const file = input.files && input.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                const numbers = String(reader.result)
                    .split(/\r?\n/)
                    .map((line) => {
                        const cells = line.split(/[;,\t]/).map((c) => c.trim().replace(/"/g, ''));
                        for (let i = cells.length - 1; i >= 0; i--) {
                            const n = Number(cells[i].replace(',', '.'));
                            if (cells[i] !== '' && Number.isFinite(n)) return n;
                        }
                        return null;
                    })
                    .filter((n) => n !== null);
                let values = numbers;
                if (numbers.length === 35040) {   // quarter-hourly smart meter export
                    values = [];
                    for (let i = 0; i < 8760; i++) values.push(numbers[4 * i] + numbers[4 * i + 1] + numbers[4 * i + 2] + numbers[4 * i + 3]);
                } else if (numbers.length === 8784) {   // leap year: drop 29 February
                    values = numbers.slice(0, 59 * 24).concat(numbers.slice(60 * 24));
                }
                if (values.length !== 8760) {
                    status.className = 'pvs-hint is-error';
                    status.textContent = `Found ${nf0.format(numbers.length)} numbers. The file needs 8,760 hourly (or 35,040 quarter-hourly) values.`;
                    return;
                }
                const total = values.reduce((a, b) => a + Math.max(0, b), 0);
                config.household.customHourly = values;
                config.household.annualKwh = Math.round(total);
                $('pvs-load').value = String(config.household.annualKwh);
                status.className = 'pvs-hint is-ok';
                status.textContent = `Using your profile from ${file.name}: ${nf0.format(total)} kWh a year. It stays on this device and is not part of share links.`;
                clear.hidden = false;
                runNow();
            };
            reader.readAsText(file);
        });
        clear.addEventListener('click', () => {
            config.household.customHourly = null;
            input.value = '';
            clear.hidden = true;
            status.className = 'pvs-hint';
            status.textContent = 'Back to the standard daily routine.';
            runNow();
        });
    }

    /* ------------------------------------------------------------------ *
     * Scenarios                                                           *
     * ------------------------------------------------------------------ */

    function loadScenarios() {
        try { return JSON.parse(store.get(SCEN_KEY) || '[]'); } catch (e) { return []; }
    }
    function saveScenarios(list) {
        if (!store.set(SCEN_KEY, JSON.stringify(list))) toast('Your browser did not allow saving. Scenarios last until you close this page.');
    }
    let scenarios = loadScenarios();

    function scenarioConfig() {
        const c = clone(Object.assign({}, config, { household: Object.assign({}, config.household, { customHourly: null }) }));
        c.ui = Object.assign({}, c.ui, { hadCustomProfile: !!config.household.customHourly });
        return c;
    }

    function bindScenarios() {
        $('pvs-scenario-save').addEventListener('click', () => {
            if (!result) return;
            const name = $('pvs-scenario-name').value.trim() || `Scenario ${scenarios.length + 1}`;
            const k = result.kpi;
            const entry = {
                id: Date.now().toString(36),
                name,
                savedAt: new Date().toISOString(),
                config: scenarioConfig(),
                kpi: {
                    kwp: result.meta.kwp, battery: config.battery.capacityKwh, pvKwh: k.pvKwh, selfConsumptionPct: k.selfConsumptionPct,
                    autarkyPct: k.autarkyPct, capexEur: k.capexEur, year1NetEur: k.year1NetEur, paybackYears: k.paybackYears,
                    npvEur: k.npvEur, irrPct: k.irrPct, lifetimeNetEur: k.lifetimeNetEur, co2AvoidedKg: k.co2AvoidedKg
                },
                cumulative: result.cumulative.map((v) => Math.round(v))
            };
            scenarios.unshift(entry);
            scenarios = scenarios.slice(0, 8);
            saveScenarios(scenarios);
            // newly saved scenarios join the comparison while there is room
            if (Object.keys(compareSlots).length < 4) assignSlot(entry.id);
            $('pvs-scenario-name').value = '';
            renderScenarioList();
            renderCompare();
            toast(`Saved "${name}"`);
        });
    }

    function assignSlot(id) {
        const used = Object.values(compareSlots);
        const free = [0, 1, 2, 3].find((s) => used.indexOf(s) === -1);
        if (free === undefined) return false;
        compareSlots[id] = free;
        return true;
    }

    function renderScenarioList() {
        const ul = $('pvs-scenarios');
        ul.textContent = '';
        Object.keys(compareSlots).forEach((id) => { if (!scenarios.find((s) => s.id === id)) delete compareSlots[id]; });
        scenarios.forEach((s) => {
            const li = document.createElement('li');
            const label = document.createElement('label');
            const box = document.createElement('input');
            box.type = 'checkbox';
            box.checked = compareSlots[s.id] !== undefined;
            box.setAttribute('aria-label', `Compare ${s.name}`);
            box.addEventListener('change', () => {
                if (box.checked) {
                    if (!assignSlot(s.id)) { box.checked = false; toast('Compare up to four scenarios at a time.'); return; }
                } else {
                    delete compareSlots[s.id];
                }
                renderScenarioList();
                renderCompare();
            });
            label.appendChild(box);
            if (compareSlots[s.id] !== undefined) {
                const sw = document.createElement('span');
                sw.className = 'pvs-scenario-swatch';
                sw.style.background = SCENARIO_SLOTS[compareSlots[s.id]];
                label.appendChild(sw);
            }
            const nm = document.createElement('span');
            nm.className = 'pvs-scenario-name';
            nm.textContent = s.name;
            label.appendChild(nm);
            const meta = document.createElement('span');
            meta.className = 'pvs-scenario-meta';
            meta.textContent = `${nf1.format(s.kpi.kwp)} kWp · ${s.kpi.battery > 0 ? nf1.format(s.kpi.battery) + ' kWh battery' : 'no battery'} · ` +
                (s.kpi.paybackYears == null ? 'no payback' : `${nf1.format(s.kpi.paybackYears)} yr payback`);
            label.appendChild(meta);
            li.appendChild(label);

            const load = document.createElement('button');
            load.type = 'button';
            load.textContent = 'Load';
            load.setAttribute('aria-label', `Load ${s.name}`);
            load.addEventListener('click', () => applyConfig(s.config, true));
            const del = document.createElement('button');
            del.type = 'button';
            del.textContent = 'Delete';
            del.setAttribute('aria-label', `Delete ${s.name}`);
            del.addEventListener('click', () => {
                scenarios = scenarios.filter((x) => x.id !== s.id);
                delete compareSlots[s.id];
                saveScenarios(scenarios);
                renderScenarioList();
                renderCompare();
            });
            li.appendChild(load);
            li.appendChild(del);
            ul.appendChild(li);
        });
    }

    function renderCompare() {
        const chosen = scenarios.filter((s) => compareSlots[s.id] !== undefined).sort((a, b) => compareSlots[a.id] - compareSlots[b.id]);
        const host = $('pvs-compare');
        if (!chosen.length) { host.hidden = true; return; }
        host.hidden = false;
        const len = Math.max(...chosen.map((s) => s.cumulative.length));
        const x = Array.from({ length: len }, (_, i) => i);
        C.lines($('pvs-compare-chart'), {
            x, xFormat: (v) => String(v), xFormatLong: (v) => (v === 0 ? 'Day one' : `End of year ${v}`), xTickEvery: 5,
            series: chosen.map((s) => ({
                label: s.name, endLabel: s.name.length > 14 ? s.name.slice(0, 13) + '…' : s.name, color: SCENARIO_SLOTS[compareSlots[s.id]],
                values: x.map((i) => (s.cumulative[i] != null ? s.cumulative[i] : s.cumulative[s.cumulative.length - 1]))
            })),
            unit: '', valueFormat: eur, yFormat: (v) => C.compact(v), endLabels: chosen.length <= 4,
            ariaLabel: 'Cumulative cash position of the compared scenarios by year'
        });
        const fmtPay = (v) => (v == null ? 'none' : nf1.format(v) + ' yr');
        const rows = [
            ['System size', (s) => nf1.format(s.kpi.kwp) + ' kWp'],
            ['Battery', (s) => (s.kpi.battery > 0 ? nf1.format(s.kpi.battery) + ' kWh' : 'none')],
            ['Location', (s) => s.config.location.name || `${s.config.location.lat}, ${s.config.location.lon}`],
            ['Solar yield', (s) => nf0.format(s.kpi.pvKwh) + ' kWh'],
            ['Self-consumption', (s) => nf0.format(s.kpi.selfConsumptionPct) + ' %'],
            ['Self-sufficiency', (s) => nf0.format(s.kpi.autarkyPct) + ' %'],
            ['Investment', (s) => eur(s.kpi.capexEur)],
            ['Savings, year one', (s) => eur(s.kpi.year1NetEur)],
            ['Payback', (s) => fmtPay(s.kpi.paybackYears)],
            ['Net present value', (s) => eur(s.kpi.npvEur)],
            ['Return (IRR)', (s) => (s.kpi.irrPct == null ? 'n/a' : nf1.format(s.kpi.irrPct) + ' %')],
            ['Ahead after lifetime', (s) => eur(s.kpi.lifetimeNetEur)],
            ['CO₂ avoided', (s) => nf1.format(s.kpi.co2AvoidedKg / 1000) + ' t/yr']
        ];
        C.table($('pvs-compare-table'), [''].concat(chosen.map((s) => s.name)), rows.map(([label, f]) => [label].concat(chosen.map(f))));
    }

    /* ------------------------------------------------------------------ *
     * Applying a stored or shared configuration                           *
     * ------------------------------------------------------------------ */

    function applyConfig(cfg, announce) {
        const keepProfile = config.household.customHourly;
        config = E.mergeDeep(E.mergeDeep(E.defaultConfig(), { ui: { areaM2: 140, heatSpecific: 80, heatFromArea: true } }), clone(cfg));
        if (cfg.ui && cfg.ui.hadCustomProfile && keepProfile) config.household.customHourly = keepProfile;
        syncForm();
        drawHorizon();
        const key = `${round2(config.location.lat)},${round2(config.location.lon)}`;
        if (key !== weatherKey) loadWeather(); else runNow();
        if (announce) toast('Scenario loaded');
    }

    /* ------------------------------------------------------------------ *
     * Share link                                                          *
     * ------------------------------------------------------------------ */

    function encodeShare() {
        const payload = { v: 1, m: mode, c: scenarioConfig() };
        const json = JSON.stringify(payload);
        const b64 = btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        return `${location.origin}${location.pathname}#s=${b64}`;
    }

    function decodeShare() {
        const m = /[#&]s=([A-Za-z0-9_-]+)/.exec(location.hash);
        if (!m) return null;
        try {
            const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
            const json = decodeURIComponent(escape(atob(b64 + '==='.slice((b64.length + 3) % 4))));
            const p = JSON.parse(json);
            return p && p.v === 1 && p.c ? p : null;
        } catch (e) {
            return null;
        }
    }

    function bindShare() {
        $('pvs-share').addEventListener('click', async () => {
            const url = encodeShare();
            try { history.replaceState(null, '', url); } catch (e) { /* ignore */ }
            try {
                await navigator.clipboard.writeText(url);
                toast(config.household.customHourly ? 'Link copied. Your uploaded profile stays on this device.' : 'Link copied. Anyone with it sees this exact setup.');
            } catch (e) {
                window.prompt('Copy this link:', url);
            }
        });
    }

    /* ------------------------------------------------------------------ *
     * CSV export                                                          *
     * ------------------------------------------------------------------ */

    function download(name, blob) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    }

    function bindCsv() {
        $('pvs-csv').addEventListener('click', () => {
            if (!result) return;
            const H = result.hourly;
            const off = result.meta.localHourOffset;
            const head = ['hour_of_year', 'date', 'utc_hour', 'local_hour', 'air_temp_c', 'sun_elevation_deg', 'plane_irradiance_w_m2',
                'pv_ac_kwh', 'consumption_kwh', 'household_kwh', 'heat_pump_kwh', 'car_kwh', 'solar_direct_kwh',
                'battery_charge_kwh', 'battery_discharge_kwh', 'battery_soc_pct', 'export_kwh', 'curtailed_kwh', 'import_kwh'];
            const lines = [head.join(',')];
            const f3 = (v) => (Math.round(v * 1000) / 1000).toString();
            for (let i = 0; i < E.HOURS; i++) {
                const doy = Math.floor(i / 24) + 1;
                let m = 11;
                while (m > 0 && E.MONTH_START_DOY[m] > doy) m--;
                const date = `${String(m + 1).padStart(2, '0')}-${String(doy - E.MONTH_START_DOY[m] + 1).padStart(2, '0')}`;
                lines.push([i, date, i % 24, ((i % 24 + off) % 24 + 24) % 24, f3(H.tAmb[i]), f3(H.sunElevation[i]), f3(H.poa[i]),
                    f3(H.pvAc[i]), f3(H.load[i]), f3(H.house[i]), f3(H.hp[i]), f3(H.ev[i]), f3(H.direct[i]),
                    f3(H.battCharge[i]), f3(H.battDischarge[i]), f3(H.socPct[i]), f3(H.exported[i]), f3(H.curtailed[i]), f3(H.imported[i])].join(','));
            }
            download(`greenhub-copilot-hourly-${config.location.lat}_${config.location.lon}.csv`, new Blob([lines.join('\n')], { type: 'text/csv' }));
        });
    }

    /* ------------------------------------------------------------------ *
     * PDF report                                                          *
     * ------------------------------------------------------------------ */

    // Rasterise a chart (SVG or canvas) on its own dark surface for the report.
    function chartImage(hostId) {
        return new Promise((resolve) => {
            const host = $(hostId);
            const canvasEl = host && host.querySelector('canvas');
            if (canvasEl) { resolve({ data: canvasEl.toDataURL('image/png'), w: canvasEl.width, h: canvasEl.height }); return; }
            const svg = host && host.querySelector('svg');
            if (!svg) { resolve(null); return; }
            const w = Number(svg.getAttribute('width'));
            const h = Number(svg.getAttribute('height'));
            const copy = svg.cloneNode(true);
            const srcText = svg.querySelectorAll('text');
            copy.querySelectorAll('text').forEach((t, i) => {
                const cs = getComputedStyle(srcText[i]);
                t.setAttribute('fill', cs.fill);
                t.setAttribute('font-size', cs.fontSize);
                t.setAttribute('font-family', 'Helvetica, Arial, sans-serif');
                t.setAttribute('font-weight', cs.fontWeight);
            });
            copy.querySelectorAll('.pvs-hit').forEach((n) => n.remove());
            const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            bg.setAttribute('width', w); bg.setAttribute('height', h); bg.setAttribute('fill', css('--surface-1'));
            copy.insertBefore(bg, copy.firstChild);
            copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

            // legend as SVG text so the image carries identity, not just colour
            const legendItems = Array.from(host.querySelectorAll('.pvs-legend-item'));
            let legendH = 0;
            if (legendItems.length) {
                legendH = 24;
                copy.setAttribute('height', h + legendH);
                copy.querySelectorAll(':scope > *').forEach((n) => { if (n !== bg) n.setAttribute('transform', `translate(0,${legendH})`); });
                bg.setAttribute('height', h + legendH);
                let lx = 52;
                legendItems.forEach((item) => {
                    const key = item.querySelector('.pvs-key');
                    const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                    r.setAttribute('x', lx); r.setAttribute('y', 8); r.setAttribute('width', 10);
                    r.setAttribute('height', key.classList.contains('pvs-key-line') ? 2 : 10);
                    r.setAttribute('fill', key.style.background);
                    copy.appendChild(r);
                    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                    t.setAttribute('x', lx + 14); t.setAttribute('y', 17); t.setAttribute('fill', css('--text-secondary'));
                    t.setAttribute('font-size', '11'); t.setAttribute('font-family', 'Helvetica, Arial, sans-serif');
                    t.textContent = item.textContent;
                    copy.appendChild(t);
                    lx += 24 + item.textContent.length * 6;
                });
            }

            const xml = new XMLSerializer().serializeToString(copy);
            const img = new Image();
            const scale = 2;
            img.onload = () => {
                const c = document.createElement('canvas');
                c.width = w * scale; c.height = (h + legendH) * scale;
                const ctx = c.getContext('2d');
                ctx.scale(scale, scale);
                ctx.drawImage(img, 0, 0);
                resolve({ data: c.toDataURL('image/png'), w: c.width, h: c.height });
            };
            img.onerror = () => resolve(null);
            img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
        });
    }

    function bindPdf() {
        $('pvs-pdf').addEventListener('click', async () => {
            if (!result) return;
            if (!window.jspdf || !window.jspdf.jsPDF) { toast('The PDF library has not loaded yet. Try again in a moment.'); return; }
            const btn = $('pvs-pdf');
            btn.disabled = true;
            try {
                await buildPdf();
            } finally {
                btn.disabled = false;
            }
        });
    }

    async function buildPdf() {
        const eur = (v) => (v < 0 ? '-€' : '€') + nf0.format(Math.abs(v));   // WinAnsi has no U+2212
        const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4', compress: true });
        const W = doc.internal.pageSize.getWidth();
        const M = 42;
        const k = result.kpi;
        const src = (weather && weather.source) || {};
        let y = 52;

        const h1 = (t) => { doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(20); doc.text(t, M, y); y += 22; };
        const h2 = (t) => { if (y > 760) { doc.addPage(); y = 52; } doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(20); doc.text(t, M, y); y += 16; };
        const p = (t, size) => {
            doc.setFont('helvetica', 'normal'); doc.setFontSize(size || 9.5); doc.setTextColor(70);
            doc.splitTextToSize(t, W - 2 * M).forEach((line) => { if (y > 800) { doc.addPage(); y = 52; } doc.text(line, M, y); y += (size || 9.5) * 1.4; });
        };
        const kv = (rows, cols) => {
            const colW = (W - 2 * M) / cols;
            rows.forEach((r, i) => {
                const cx = M + (i % cols) * colW;
                if (i % cols === 0 && i > 0) y += 34;
                doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(110); doc.text(r[0], cx, y);
                doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(20); doc.text(r[1], cx, y + 15);
            });
            y += 42;
        };
        const table = (cols, rows, widths) => {
            const total = widths.reduce((a, b) => a + b, 0);
            const scale = (W - 2 * M) / total;
            const ws = widths.map((w) => w * scale);
            const line = (cells, bold) => {
                if (y > 790) { doc.addPage(); y = 52; }
                let x = M;
                doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(8.5); doc.setTextColor(bold ? 20 : 60);
                cells.forEach((c, i) => {
                    if (i === 0) doc.text(String(c), x + 2, y);
                    else doc.text(String(c), x + ws[i] - 2, y, { align: 'right' });
                    x += ws[i];
                });
                y += 13;
            };
            line(cols, true);
            doc.setDrawColor(200); doc.line(M, y - 9, W - M, y - 9);
            rows.forEach((r) => line(r, r.bold));
            y += 6;
        };
        const image = async (id, maxH) => {
            const img = await chartImage(id);
            if (!img) return;
            const wPt = W - 2 * M;
            const hPt = Math.min(maxH, wPt * img.h / img.w);
            const wFit = hPt * img.w / img.h;
            if (y + hPt > 800) { doc.addPage(); y = 52; }
            doc.addImage(img.data, 'PNG', M, y, wFit, hPt, undefined, 'MEDIUM');   // deflate; raw PNG pixels are huge
            y += hPt + 26;
        };

        h1('GreenHub Copilot: Solar Home Report');
        p(`${config.location.name ? config.location.name + ' · ' : ''}${config.location.lat}, ${config.location.lon} · created ${new Date().toLocaleDateString('en-GB')} · Renewable Energy Nexus GreenHub Copilot`);
        y += 6;

        h2('Your system');
        const arrays = config.arrays.filter((a) => a.kWp > 0).map((a) => `${nf1.format(a.kWp)} kWp facing ${compassName(a.azimuthDeg)} (${Math.round(a.azimuthDeg)}°) at ${a.tiltDeg}°`).join('; ');
        p(`${arrays}. Inverter ${nf1.format(result.meta.inverterKw)} kW. ` +
            (config.battery.capacityKwh > 0 ? `Battery ${nf1.format(config.battery.capacityKwh)} kWh / ${nf1.format(result.meta.batteryPowerKw)} kW. ` : 'No battery. ') +
            `Household ${nf0.format(config.household.annualKwh)} kWh a year` +
            (config.heatPump.enabled ? `, heat pump (${nf0.format(result.meta.heatDemandKwh)} kWh heat, SCOP ${nf2.format(result.meta.scop)})` : '') +
            (config.ev.enabled ? `, electric car (${nf0.format(config.ev.kmPerYear)} km a year)` : '') + '.');
        y += 4;

        h2('Results');
        kv([
            ['Payback', k.paybackYears == null ? `not within ${result.yearly.length} yr` : `${nf1.format(k.paybackYears)} years`],
            ['Ahead after lifetime', eur(k.lifetimeNetEur)],
            ['Investment', eur(k.capexEur)],
            ['Solar yield', `${nf0.format(k.pvKwh)} kWh/yr`],
            ['Self-consumption', `${nf0.format(k.selfConsumptionPct)} %`],
            ['Self-sufficiency', `${nf0.format(k.autarkyPct)} %`],
            ['Savings, year one', eur(k.year1NetEur)],
            ['Return (IRR)', k.irrPct == null ? 'n/a' : `${nf1.format(k.irrPct)} %`],
            ['CO2 avoided', `${nf1.format(k.co2AvoidedKg / 1000)} t/yr`]
        ], 3);

        h2('Where your solar power goes');
        await image('pvs-chart-solar', 190);
        h2('Where your electricity comes from');
        await image('pvs-chart-supply', 190);

        doc.addPage(); y = 52;
        h2('Money over time');
        await image('pvs-chart-cash', 190);

        h2('Monthly energy (kWh)');
        table(['Month', 'Solar', 'Used directly', 'To battery', 'From battery', 'Exported', 'Imported', 'Consumption'],
            result.monthly.map((m, i) => [MONTHS_LONG[i], nf0.format(m.pvAc), nf0.format(m.direct), nf0.format(m.battCharge), nf0.format(m.battDischarge), nf0.format(m.exported), nf0.format(m.imported), nf0.format(m.load)])
                .concat([Object.assign(['Year', nf0.format(k.pvKwh), nf0.format(result.monthly.reduce((a, m) => a + m.direct, 0)),
                    nf0.format(result.monthly.reduce((a, m) => a + m.battCharge, 0)), nf0.format(result.monthly.reduce((a, m) => a + m.battDischarge, 0)),
                    nf0.format(k.exportKwh), nf0.format(k.importKwh), nf0.format(k.loadKwh)], { bold: true })]),
            [1.4, 1, 1.2, 1, 1.1, 1, 1, 1.2]);

        doc.addPage(); y = 52;
        h2('Year by year (EUR)');
        table(['Year', 'Solar kWh', 'Bill without', 'Bill with', 'Feed-in', 'Costs', 'Net', 'Cumulative'],
            [['0', '', '', '', '', nf0.format(k.capexEur), nf0.format(-k.capexEur), nf0.format(-k.capexEur)]].concat(
                result.yearly.map((r) => [r.year, nf0.format(r.pvKwh), nf0.format(r.billWithoutEur), nf0.format(r.billWithEur), nf0.format(r.feedInEur), nf0.format(r.opexEur + r.replacementEur), nf0.format(r.netEur), nf0.format(r.cumulativeEur)])),
            [0.8, 1.1, 1.2, 1.1, 1, 1, 1, 1.3]);

        h2('Assumptions');
        p(`Electricity ${nf1.format(100 * config.tariff.importEurPerKwh)} ct/kWh rising ${nf1.format(config.tariff.escalationPctPerYear)} % a year` +
            (config.tariff.touEnabled ? ` (peak ${nf1.format(100 * config.tariff.touPeakEurPerKwh)} ct/kWh from ${config.tariff.touPeakStart}:00 to ${config.tariff.touPeakEnd}:00)` : '') +
            `. Feed-in ${nf1.format(100 * config.tariff.feedInEurPerKwh)} ct/kWh for ${config.tariff.feedInYears} years, then ${nf1.format(100 * config.tariff.postFeedInEurPerKwh)} ct/kWh. ` +
            `Running costs ${nf1.format(config.finance.opexPctPerYear)} % of the investment a year; inverter replacement ${eur(k.inverterReplacementEur)} in year ${config.finance.inverterReplacementYear}. ` +
            `Module degradation ${nf2.format(config.finance.pvDegradationPctPerYear)} % a year; battery fade ${nf1.format(config.battery.fadePctPerYear)} % a year. ` +
            `Discount rate ${nf1.format(config.finance.discountRatePct)} %. Grid CO2 ${nf2.format(config.finance.co2KgPerKwh)} kg/kWh. ` +
            `Feed-in limit: ${({ none: 'none', pct60: '60 % of kWp', pct70: '70 % of kWp', zero: 'zero export', custom: nf1.format(config.grid.exportLimitKw || 0) + ' kW' })[config.grid.exportLimit]}.`);
        p(`Weather: PVGIS typical meteorological year (${src.radiationDb || 'PVGIS'}${src.meteoDb ? ', ' + src.meteoDb : ''}${src.yearMin ? ', ' + src.yearMin + '-' + src.yearMax : ''}), (c) European Union. ` +
            `Model: Hay-Davies transposition, ASHRAE incidence losses, Faiman module temperature, ${config.module.technology === 'pvgis' ? 'Huld (2011) c-Si efficiency' : 'modern-module low-light curve'}, hourly battery dispatch, BDEW H0 household profile.`);
        y += 6;
        p('This report is an informed first estimate, not a binding plan or financial advice. Have an installer check your roof, grid connection and subsidies before you buy.', 8.5);

        doc.save(`greenhub-copilot-report-${config.location.lat}_${config.location.lon}.pdf`);
    }

    /* ------------------------------------------------------------------ *
     * Misc bindings                                                       *
     * ------------------------------------------------------------------ */

    function bindMisc() {
        document.querySelectorAll('.pvs-mode-btn').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
        document.querySelector('.pvs-mode').addEventListener('keydown', (e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            setMode(mode === 'simple' ? 'expert' : 'simple');
            document.querySelector(`.pvs-mode-btn[data-mode="${mode}"]`).focus();
            e.preventDefault();
        });

        document.querySelectorAll('.pvs-table-toggle').forEach((btn) => btn.addEventListener('click', () => {
            const on = btn.getAttribute('aria-pressed') !== 'true';
            btn.setAttribute('aria-pressed', String(on));
            const target = btn.dataset.target;
            $(target + '-table').hidden = !on;
        }));

        const monthSel = $('pvs-day-month');
        MONTHS_LONG.forEach((m, i) => {
            const o = document.createElement('option');
            o.value = String(i);
            o.textContent = m;
            monthSel.appendChild(o);
        });
        monthSel.value = '5';
        monthSel.addEventListener('change', () => result && renderDay());
        $('pvs-day-kind').addEventListener('change', () => result && renderDay());

        ['pvs-area', 'pvs-standard'].forEach((id) => $(id).addEventListener(id === 'pvs-area' ? 'input' : 'change', () => {
            const area = Number($('pvs-area').value);
            if (!Number.isFinite(area) || area <= 0) return;
            config.ui.areaM2 = area;
            config.ui.heatSpecific = Number($('pvs-standard').value);
            config.ui.heatFromArea = true;
            updateDisplays();
            scheduleRun();
        }));
    }

    /* ------------------------------------------------------------------ *
     * Start                                                               *
     * ------------------------------------------------------------------ */

    function init() {
        const shared = decodeShare();
        if (shared) {
            config = E.mergeDeep(config, shared.c);
            mode = shared.m === 'expert' ? 'expert' : 'simple';
        } else {
            mode = store.get(MODE_KEY) === 'expert' ? 'expert' : 'simple';
        }

        bindMisc();
        bindInputs();
        bindSimpleRoof();
        bindArrayAdd();
        bindLocation();
        bindHorizon();
        bindCsvUpload();
        bindScenarios();
        bindShare();
        bindCsv();
        bindPdf();

        syncForm();
        setMode(mode, true);
        if (config.location.name) {
            const match = Array.from($('pvs-preset').options).find((o) => o.textContent === config.location.name);
            $('pvs-preset').value = match ? match.value : '';
        } else {
            $('pvs-preset').value = '';
        }
        renderScenarioList();
        loadWeather();
    }

    init();
})();
