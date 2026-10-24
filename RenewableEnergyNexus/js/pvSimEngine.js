/* ==========================================================================
 * GreenHub Copilot: simulation engine
 *
 * Pure functions, no DOM. Runs a full hourly year (8760 h) from a PVGIS
 * typical meteorological year, then repeats the energy balance for every
 * year of the system's life with module degradation, battery fade, price
 * escalation and the end of the feed-in tariff.
 *
 * Model chain per hour and per roof face:
 *   sun position (Spencer / NOAA)  ->  terrain horizon test
 *   ->  plane-of-array irradiance (Hay-Davies: beam, circumsolar, isotropic
 *       sky, ground reflection)  ->  incidence-angle loss (ASHRAE)
 *   ->  cell temperature (Faiman)  ->  DC power with temperature coefficient
 *   ->  shared inverter (efficiency + AC clipping)
 * Loads: household (BDEW H0 shape), heat pump (degree-hours, Carnot COP),
 * electric car (daily need, selectable charging strategy).
 * Dispatch: PV -> loads -> battery -> grid, with an optional feed-in limit.
 *
 * Works in the browser (window.PVSimEngine) and in Node (module.exports),
 * so it can be tested against PVGIS reference yields.
 * ========================================================================== */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else {
        root.PVSimEngine = api;
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const HOURS = 8760;
    const DEG = Math.PI / 180;
    const SOLAR_CONSTANT = 1361;                 // W/m2
    const MIN_COS_ZENITH = Math.cos(85 * DEG);   // caps the beam ratio near sunrise and sunset
    const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const MONTH_START_DOY = MONTH_DAYS.reduce((acc, d, i) => {
        acc.push(i === 0 ? 1 : acc[i - 1] + MONTH_DAYS[i - 1]);
        return acc;
    }, []);

    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

    function monthOfDoy(doy) {
        for (let m = 11; m >= 0; m--) {
            if (doy >= MONTH_START_DOY[m]) return m;
        }
        return 0;
    }

    /* ------------------------------------------------------------------ *
     * Defaults. Prices and costs match the site's GreenPlan assumptions   *
     * (German market, 2026) so the two tools agree with each other.       *
     * ------------------------------------------------------------------ */
    const MOUNTING = {
        rack: { label: 'Open rack', u0: 25.0, u1: 6.84 },
        roof: { label: 'Rooftop with air gap', u0: 20.0, u1: 5.0 },
        integrated: { label: 'In-roof (integrated)', u0: 15.0, u1: 3.0 }
    };

    function defaultConfig() {
        return {
            location: { lat: 50.94, lon: 6.96, name: 'Cologne' },
            arrays: [
                { name: 'South roof', kWp: 8, tiltDeg: 35, azimuthDeg: 180, mounting: 'roof', shadingLossPct: 0 }
            ],
            module: { technology: 'modern', tempCoeffPctPerK: -0.35, systemLossPct: 10, albedo: 0.2 },
            inverter: { acKw: null, efficiencyPct: 96 },               // null = sized automatically
            horizon: { useTerrain: true, custom: null },               // custom: 36 elevations, 0..350 deg from north
            battery: {
                capacityKwh: 0, powerKw: null, roundTripPct: 92, minSocPct: 10,
                fadePctPerYear: 1.5, chargesEv: false
            },
            household: { annualKwh: 4000, profile: 'h0', peaks: true, customHourly: null },
            heatPump: {
                enabled: false, heatDemandKwh: 12000, dhwKwh: 2000, flowTempC: 35,
                carnotQuality: 0.45, heatingLimitC: 15, smartDhw: false
            },
            ev: {
                enabled: false, kmPerYear: 12000, kwhPer100km: 18, wallboxKw: 11,
                chargingEffPct: 90, mode: 'solar', homeDaysPerWeek: 2
            },
            grid: { exportLimit: 'none', exportLimitKw: null },        // none | pct60 | pct70 | zero | custom
            tariff: {
                importEurPerKwh: 0.34, escalationPctPerYear: 2,
                touEnabled: false, touPeakEurPerKwh: 0.42, touPeakStart: 17, touPeakEnd: 21,
                feedInEurPerKwh: 0.08, feedInYears: 20, postFeedInEurPerKwh: 0.05
            },
            finance: {
                capexOverrideEur: null, opexPctPerYear: 1.2, discountRatePct: 3,
                lifetimeYears: 25, pvDegradationPctPerYear: 0.5,
                inverterReplacementYear: 15, inverterReplacementEur: null,
                co2KgPerKwh: 0.38
            }
        };
    }

    /* ------------------------------------------------------------------ *
     * Solar geometry                                                      *
     * ------------------------------------------------------------------ */

    // Sun position for a day of year and a UTC decimal hour.
    // Returns cosine of the zenith, elevation (deg) and azimuth (deg from north, clockwise).
    function sunPosition(doy, hourUtc, latDeg, lonDeg) {
        const g = 2 * Math.PI / 365 * (doy - 1 + (hourUtc - 12) / 24);
        const eqTimeMin = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
            - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
        const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g)
            - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
            - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);

        const trueSolarMin = hourUtc * 60 + eqTimeMin + 4 * lonDeg;
        const hourAngle = (trueSolarMin / 4 - 180) * DEG;
        const lat = latDeg * DEG;

        const cosZ = clamp(Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle), -1, 1);
        const elevationDeg = 90 - Math.acos(cosZ) / DEG;
        let azimuthDeg = Math.atan2(Math.sin(hourAngle),
            Math.cos(hourAngle) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)) / DEG + 180;
        azimuthDeg = ((azimuthDeg % 360) + 360) % 360;

        return { cosZ, elevationDeg, azimuthDeg };
    }

    function extraterrestrialNormal(doy) {
        const b = 2 * Math.PI * (doy - 1) / 365;
        return SOLAR_CONSTANT * (1.00011 + 0.034221 * Math.cos(b) + 0.00128 * Math.sin(b)
            + 0.000719 * Math.cos(2 * b) + 0.000077 * Math.sin(2 * b));
    }

    /* ------------------------------------------------------------------ *
     * Horizon                                                             *
     * ------------------------------------------------------------------ */

    // A horizon is 36 elevations (deg) at azimuths 0, 10, ..., 350 from north.
    function horizonElevationAt(horizon, azimuthDeg) {
        if (!horizon) return 0;
        const pos = (((azimuthDeg % 360) + 360) % 360) / 10;
        const i0 = Math.floor(pos) % 36;
        const i1 = (i0 + 1) % 36;
        const t = pos - Math.floor(pos);
        return horizon[i0] * (1 - t) + horizon[i1] * t;
    }

    // Fraction of the isotropic sky dome still visible over the horizon.
    function skyViewFactor(horizon) {
        if (!horizon) return 1;
        let sum = 0;
        for (let i = 0; i < 36; i++) {
            const c = Math.cos(Math.max(0, horizon[i]) * DEG);
            sum += c * c;
        }
        return sum / 36;
    }

    // Resample an arbitrary {azimuthDeg, elevationDeg}[] profile to the 36-step grid.
    function resampleHorizon(points) {
        if (!Array.isArray(points) || points.length < 2) return null;
        const sorted = points
            .map((p) => ({ az: ((p.azimuthDeg % 360) + 360) % 360, el: Number(p.elevationDeg) || 0 }))
            .sort((a, b) => a.az - b.az);
        const out = new Array(36);
        for (let i = 0; i < 36; i++) {
            const az = i * 10;
            let lo = sorted[sorted.length - 1];
            let hi = sorted[0];
            for (let k = 0; k < sorted.length; k++) {
                if (sorted[k].az <= az) lo = sorted[k];
                if (sorted[k].az >= az) { hi = sorted[k]; break; }
            }
            const span = ((hi.az - lo.az) + 360) % 360;
            const off = ((az - lo.az) + 360) % 360;
            const t = span === 0 ? 0 : off / span;
            out[i] = Math.max(0, lo.el * (1 - t) + hi.el * t);
        }
        return out;
    }

    function combineHorizons(a, b) {
        if (!a) return b ? b.slice() : null;
        if (!b) return a.slice();
        return a.map((v, i) => Math.max(v, b[i]));
    }

    /* ------------------------------------------------------------------ *
     * Plane-of-array irradiance and module model                          *
     * ------------------------------------------------------------------ */

    function iamAshrae(cosAoi, b0) {
        if (cosAoi <= 0.05) return 0;
        return clamp(1 - b0 * (1 / cosAoi - 1), 0, 1);
    }

    const IAM_B0 = 0.05;
    const IAM_DIFFUSE = 0.95;   // ASHRAE b0 = 0.05 integrated over the sky hemisphere

    // Returns effective plane-of-array irradiance (W/m2) after incidence losses,
    // plus the beam that the horizon removed (for loss accounting).
    function planeOfArray(w, sun, surf, horizon, svf) {
        const { ghi, dni, dhi, e0 } = w;
        if (ghi <= 0 && dhi <= 0) return { poa: 0, poaRaw: 0, beamBlocked: 0 };

        const cosB = surf.cosTilt;
        const sinB = surf.sinTilt;
        const sunUp = sun.cosZ > 0;
        const sinZ = Math.sqrt(Math.max(0, 1 - sun.cosZ * sun.cosZ));
        const cosAoi = sunUp
            ? sun.cosZ * cosB + sinZ * sinB * Math.cos((sun.azimuthDeg - surf.azimuthDeg) * DEG)
            : 0;

        const blocked = sunUp && sun.elevationDeg < horizonElevationAt(horizon, sun.azimuthDeg);
        const anisotropy = e0 > 0 ? clamp(dni / e0, 0, 1) : 0;
        const rb = sunUp ? Math.max(0, cosAoi) / Math.max(sun.cosZ, MIN_COS_ZENITH) : 0;

        const beamRaw = sunUp ? dni * Math.max(0, cosAoi) : 0;
        const circumRaw = dhi * anisotropy * rb;
        const isoRaw = dhi * (1 - anisotropy) * (1 + cosB) / 2;
        const groundRaw = ghi * surf.albedo * (1 - cosB) / 2;

        const beam = blocked ? 0 : beamRaw;
        const circum = blocked ? 0 : circumRaw;
        const iso = isoRaw * svf;
        const iam = iamAshrae(cosAoi, IAM_B0);

        // unobstructed plane irradiance, and what the horizon removes from it:
        // the direct sun while it is behind an obstruction, plus the hidden sky
        const poaRaw = beamRaw + circumRaw + isoRaw + groundRaw;
        const horizonLoss = (blocked ? beamRaw + circumRaw : 0) + isoRaw * (1 - svf);
        const poa = (beam + circum) * iam + (iso + groundRaw) * IAM_DIFFUSE;

        return { poa: poa * (1 - surf.shadingLoss), poaRaw, beamBlocked: horizonLoss };
    }

    /* ------------------------------------------------------------------ *
     * Module efficiency versus irradiance and temperature                 *
     * ------------------------------------------------------------------ */

    // Relative efficiency at irradiance G (W/m2) and cell temperature Tc (C),
    // normalised to 1 at standard test conditions (1000 W/m2, 25 C).
    //
    // 'modern'  - a gentle low-light curve typical of current PERC/TOPCon
    //             datasheets (about -3 % at 200 W/m2), with the user's
    //             temperature coefficient.
    // 'pvgis'   - Huld et al. (2011) crystalline-silicon model, the one PVGIS
    //             uses; reproduces PVGIS yields when chosen.
    const HULD_CSI = { k1: -0.017237, k2: -0.040465, k3: -0.004702, k4: 0.000149, k5: 0.000170, k6: 0.000005 };
    const PVGIS_FAIMAN = { u0: 26.9, u1: 6.2 };

    function relativeEfficiency(technology, g, tCell, gamma) {
        const gp = g / 1000;
        if (gp < 0.005) return 0;
        const lg = Math.log(gp);
        if (technology === 'pvgis') {
            const k = HULD_CSI;
            const tp = tCell - 25;
            return Math.max(0, 1 + k.k1 * lg + k.k2 * lg * lg + k.k3 * tp + k.k4 * tp * lg + k.k5 * tp * lg * lg + k.k6 * tp * tp);
        }
        const lowLight = 1 + 0.008 * lg - 0.006 * lg * lg;
        return Math.max(0, lowLight * (1 + gamma * (tCell - 25)));
    }

    /* ------------------------------------------------------------------ *
     * Loads                                                               *
     * ------------------------------------------------------------------ */

    // Hourly shapes in the spirit of the BDEW H0 standard household profile
    // (watts per 1,000 kWh/a); only their shape is used, the level comes from
    // the BDEW dynamisation polynomial and the user's annual consumption.
    const H0 = {
        winter: {
            weekday: [68, 55, 49, 47, 47, 52, 77, 112, 122, 118, 117, 125, 140, 132, 118, 110, 117, 152, 180, 185, 172, 152, 125, 95],
            saturday: [80, 62, 53, 50, 49, 51, 58, 78, 110, 140, 155, 162, 170, 158, 138, 128, 132, 158, 180, 182, 168, 150, 128, 100],
            sunday: [85, 66, 55, 51, 49, 49, 53, 66, 95, 135, 160, 178, 190, 170, 140, 128, 130, 150, 172, 175, 162, 145, 122, 95]
        },
        summer: {
            weekday: [72, 57, 49, 46, 45, 48, 64, 88, 98, 100, 104, 113, 127, 121, 108, 101, 103, 116, 128, 132, 135, 140, 125, 95],
            saturday: [82, 64, 54, 50, 48, 49, 55, 70, 96, 120, 132, 140, 150, 140, 122, 112, 112, 124, 134, 136, 140, 142, 128, 100],
            sunday: [88, 68, 56, 51, 48, 48, 51, 60, 84, 115, 138, 155, 165, 150, 124, 112, 110, 118, 130, 134, 138, 138, 122, 95]
        }
    };

    function normalise(arr) {
        const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
        return arr.map((v) => v / mean);
    }

    const H0_NORM = {
        winter: { weekday: normalise(H0.winter.weekday), saturday: normalise(H0.winter.saturday), sunday: normalise(H0.winter.sunday) },
        summer: { weekday: normalise(H0.summer.weekday), saturday: normalise(H0.summer.saturday), sunday: normalise(H0.summer.sunday) }
    };

    function bdewDynamisation(doy) {
        const t = doy;
        return -3.92e-10 * t ** 4 + 3.2e-7 * t ** 3 - 7.02e-5 * t ** 2 + 2.1e-3 * t + 1.24;
    }

    // Day of week with day 1 treated as a Monday (TMY years are stitched together).
    function dayType(doy) {
        const dow = (doy - 1) % 7;    // 0 = Monday
        if (dow === 5) return 'saturday';
        if (dow === 6) return 'sunday';
        return 'weekday';
    }

    function householdLoad(cfg, localHourOffset) {
        const out = new Float64Array(HOURS);
        const custom = cfg.household.customHourly;

        if (Array.isArray(custom) && custom.length === HOURS) {
            const total = custom.reduce((a, b) => a + Math.max(0, Number(b) || 0), 0);
            const scale = total > 0 ? cfg.household.annualKwh / total : 0;
            for (let i = 0; i < HOURS; i++) out[i] = Math.max(0, Number(custom[i]) || 0) * scale;
            return out;
        }

        const profile = cfg.household.profile;
        for (let i = 0; i < HOURS; i++) {
            const doy = Math.floor(i / 24) + 1;
            // the profile is defined in local clock time; weather is in UTC
            const localHour = (i % 24 + localHourOffset + 24) % 24;
            const season = 0.5 + 0.5 * Math.cos(2 * Math.PI * (doy - 15) / 365);   // 1 = mid-winter, 0 = mid-summer
            let type = dayType(doy);
            let shapeW = H0_NORM.winter[type][localHour];
            let shapeS = H0_NORM.summer[type][localHour];

            if (profile === 'home' && type === 'weekday') {
                shapeW = 0.4 * shapeW + 0.6 * H0_NORM.winter.saturday[localHour];
                shapeS = 0.4 * shapeS + 0.6 * H0_NORM.summer.saturday[localHour];
            }

            let shape = season * shapeW + (1 - season) * shapeS;

            if (profile === 'away' && type === 'weekday') {
                if (localHour >= 9 && localHour < 16) shape *= 0.6;
                if (localHour >= 18 && localHour < 22) shape *= 1.25;
            }

            out[i] = shape * bdewDynamisation(doy);
        }

        const total = out.reduce((a, b) => a + b, 0);
        const scale = cfg.household.annualKwh / total;
        for (let i = 0; i < HOURS; i++) out[i] *= scale;

        return cfg.household.peaks === false ? out : addAppliancePeaks(out);
    }

    // Deterministic pseudo-random numbers, so every run (and every saved
    // scenario) sees the same household and comparisons stay fair.
    function mulberry32(seed) {
        let a = seed >>> 0;
        return function () {
            a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    // The H0 profile averages thousands of homes, so its hourly peaks are far
    // flatter than any single home's. That flatters self-consumption and the
    // battery. Here half of each day's energy stays as the smooth base load
    // (fridge, standby, lighting) and half becomes discrete appliance runs
    // (cooking, kettle, washing, dishwasher, dryer), placed at random hours
    // weighted by the profile itself. Daily and yearly totals are unchanged.
    const APPLIANCE_EVENTS = [
        { kwh: 0.25, weight: 0.30 },    // kettle, coffee, vacuum, hair dryer
        { kwh: 0.8, weight: 0.30 },     // hob, microwave, small wash
        { kwh: 1.3, weight: 0.25 },     // oven, dishwasher
        { kwh: 2.0, weight: 0.15 }      // washing machine on hot, tumble dryer
    ];
    const EVENT_SHARE = 0.5;
    const PEAK_SEED = 20260611;

    function addAppliancePeaks(smooth) {
        const rand = mulberry32(PEAK_SEED);
        const out = new Float64Array(HOURS);
        const weights = new Array(24);
        const cumW = APPLIANCE_EVENTS.reduce((acc, e, i) => { acc.push((i ? acc[i - 1] : 0) + e.weight); return acc; }, []);

        for (let d = 0; d < 365; d++) {
            const base = d * 24;
            let dayTotal = 0;
            let wSum = 0;
            for (let h = 0; h < 24; h++) {
                const v = smooth[base + h];
                dayTotal += v;
                out[base + h] = v * (1 - EVENT_SHARE);
                weights[h] = Math.pow(v, 2);           // sharpen towards meal times and evenings
                wSum += weights[h];
            }

            const target = dayTotal * EVENT_SHARE;
            const events = [];
            let drawn = 0;
            while (drawn < target) {
                const r = rand() * cumW[cumW.length - 1];
                const kind = APPLIANCE_EVENTS[cumW.findIndex((c) => r <= c)];
                const kwh = kind.kwh * (0.7 + 0.6 * rand());
                let pick = rand() * wSum;
                let hour = 0;
                while (hour < 23 && pick > weights[hour]) { pick -= weights[hour]; hour++; }
                events.push({ hour, kwh });
                drawn += kwh;
            }

            const fit = drawn > 0 ? target / drawn : 0;    // land exactly on the day's energy
            events.forEach((e) => {
                const kwh = e.kwh * fit;
                if (kwh > 1.2 && e.hour < 23) {             // long runs spill into the next hour
                    out[base + e.hour] += kwh * 0.6;
                    out[base + e.hour + 1] += kwh * 0.4;
                } else {
                    out[base + e.hour] += kwh;
                }
            });
        }
        return out;
    }

    // Heat pump: space heating follows degree-hours of the 24-hour mean outdoor
    // temperature; hot water follows a morning and evening draw pattern (or the
    // sunniest hours when "smart DHW" pre-heats on PV). COP is a Carnot fraction.
    function heatPumpLoad(cfg, weather, localHourOffset) {
        const hp = cfg.heatPump;
        const elec = new Float64Array(HOURS);
        const heat = new Float64Array(HOURS);
        if (!hp.enabled) return { elec, heat, scop: 0, heatTotal: 0 };

        const t = weather.tAmb;
        const mean24 = new Float64Array(HOURS);
        let run = 0;
        for (let i = 0; i < HOURS; i++) {
            run += t[i];
            if (i >= 24) run -= t[i - 24];
            mean24[i] = run / Math.min(i + 1, 24);
        }

        const degreeHours = new Float64Array(HOURS);
        let dhSum = 0;
        for (let i = 0; i < HOURS; i++) {
            degreeHours[i] = Math.max(0, hp.heatingLimitC - mean24[i]);
            dhSum += degreeHours[i];
        }

        const dhwShape = new Array(24).fill(0);
        if (hp.smartDhw) {
            [11, 12, 13, 14].forEach((h) => { dhwShape[h] = 1; });
        } else {
            [6, 7, 8].forEach((h) => { dhwShape[h] = 1.6; });
            [18, 19, 20, 21].forEach((h) => { dhwShape[h] = 1; });
            for (let h = 0; h < 24; h++) dhwShape[h] += 0.1;
        }
        const dhwShapeSum = dhwShape.reduce((a, b) => a + b, 0);
        const dhwPerDay = hp.dhwKwh / 365;

        const designOutdoor = -12;
        const toK = (c) => c + 273.15;
        const cop = (sinkC, sourceC) => {
            const sink = toK(sinkC + 5);
            const source = toK(sourceC - 5);
            return clamp(hp.carnotQuality * sink / Math.max(5, sink - source), 1.5, 6.5);
        };

        let heatTotal = 0;
        let elecTotal = 0;
        for (let i = 0; i < HOURS; i++) {
            const localHour = (i % 24 + localHourOffset + 24) % 24;
            const space = dhSum > 0 ? hp.heatDemandKwh * degreeHours[i] / dhSum : 0;
            const dhw = dhwPerDay * dhwShape[localHour] / dhwShapeSum;

            // heating curve: design flow temperature at -12 C, 25 C at the heating limit
            const span = Math.max(1, hp.heatingLimitC - designOutdoor);
            const f = clamp((hp.heatingLimitC - t[i]) / span, 0, 1);
            const flowSpace = 25 + (hp.flowTempC - 25) * f;

            const e = (space > 0 ? space / cop(flowSpace, t[i]) : 0) + (dhw > 0 ? dhw / cop(52, t[i]) : 0);
            heat[i] = space + dhw;
            elec[i] = e;
            heatTotal += space + dhw;
            elecTotal += e;
        }

        return { elec, heat, scop: elecTotal > 0 ? heatTotal / elecTotal : 0, heatTotal };
    }

    /* ------------------------------------------------------------------ *
     * Weather preparation and PV production (computed once per config)   *
     * ------------------------------------------------------------------ */

    function autoInverterKw(totalKwp) {
        // a DC/AC ratio of about 1.15 is common practice for German rooftops
        return Math.max(1.5, Math.round((totalKwp / 1.15) * 10) / 10);
    }

    function totalKwp(cfg) {
        return cfg.arrays.reduce((a, arr) => a + Math.max(0, Number(arr.kWp) || 0), 0);
    }

    function effectiveHorizon(cfg, terrainHorizon) {
        const terrain = cfg.horizon.useTerrain ? terrainHorizon : null;
        const custom = Array.isArray(cfg.horizon.custom) && cfg.horizon.custom.length === 36 ? cfg.horizon.custom : null;
        return combineHorizons(terrain, custom);
    }

    // DC production per hour (kW, before inverter), plus irradiation and loss bookkeeping.
    function simulatePvDc(cfg, weather, terrainHorizon) {
        const horizon = effectiveHorizon(cfg, terrainHorizon);
        const svf = skyViewFactor(horizon);
        const offset = Number(weather.timeOffsetH) || 0;
        const lat = cfg.location.lat;
        const lon = cfg.location.lon;

        const surfaces = cfg.arrays
            .filter((a) => Number(a.kWp) > 0)
            .map((a) => {
                const tilt = clamp(Number(a.tiltDeg) || 0, 0, 90) * DEG;
                const mount = cfg.module.technology === 'pvgis' && a.mounting === 'rack'
                    ? PVGIS_FAIMAN
                    : (MOUNTING[a.mounting] || MOUNTING.roof);
                return {
                    kWp: Number(a.kWp),
                    cosTilt: Math.cos(tilt),
                    sinTilt: Math.sin(tilt),
                    azimuthDeg: ((Number(a.azimuthDeg) % 360) + 360) % 360,
                    albedo: cfg.module.albedo,
                    shadingLoss: clamp((Number(a.shadingLossPct) || 0) / 100, 0, 0.95),
                    u0: mount.u0,
                    u1: mount.u1
                };
            });

        const gamma = cfg.module.tempCoeffPctPerK / 100;
        const dcFactor = 1 - clamp(cfg.module.systemLossPct, 0, 60) / 100;

        const dc = new Float64Array(HOURS);
        const poaPerKwp = new Float64Array(HOURS);   // kWp-weighted plane irradiance, W/m2
        const sunElevation = new Float32Array(HOURS);
        const sunAzimuth = new Float32Array(HOURS);
        let irrPoaRaw = 0;          // kWh/m2 summed over arrays, kWp-weighted
        let irrPoaEff = 0;
        let beamBlockedSum = 0;
        let tempLossKwh = 0;
        let stcKwh = 0;

        const kwpSum = surfaces.reduce((a, s) => a + s.kWp, 0) || 1;

        for (let i = 0; i < HOURS; i++) {
            const doy = Math.floor(i / 24) + 1;
            const sun = sunPosition(doy, (i % 24) + offset, lat, lon);
            sunElevation[i] = sun.elevationDeg;
            sunAzimuth[i] = sun.azimuthDeg;

            const w = {
                ghi: weather.ghi[i], dni: weather.dni[i], dhi: weather.dhi[i],
                e0: extraterrestrialNormal(doy)
            };

            let p = 0;
            let poaWeighted = 0;
            for (let s = 0; s < surfaces.length; s++) {
                const surf = surfaces[s];
                const r = planeOfArray(w, sun, surf, horizon, svf);
                irrPoaRaw += r.poaRaw * surf.kWp / kwpSum / 1000;
                beamBlockedSum += r.beamBlocked * surf.kWp / kwpSum / 1000;
                if (r.poa <= 0) continue;
                const tCell = weather.tAmb[i] + r.poa / (surf.u0 + surf.u1 * Math.max(0, weather.ws[i]));
                const relEff = relativeEfficiency(cfg.module.technology, r.poa, tCell, gamma);
                const stc = surf.kWp * r.poa / 1000;
                const pSurf = stc * relEff * dcFactor;
                p += pSurf;
                stcKwh += stc;
                tempLossKwh += stc * (1 - relEff);
                poaWeighted += r.poa * surf.kWp / kwpSum;
                irrPoaEff += r.poa * surf.kWp / kwpSum / 1000;
            }
            dc[i] = Math.max(0, p);
            poaPerKwp[i] = poaWeighted;
        }

        return {
            dc, poaPerKwp, sunElevation, sunAzimuth, horizon, svf,
            irradiation: {
                poaRawKwhM2: irrPoaRaw,
                poaEffKwhM2: irrPoaEff,
                horizonBlockedKwhM2: beamBlockedSum,
                tempLossKwh,
                stcKwh
            }
        };
    }

    /* ------------------------------------------------------------------ *
     * Dispatch for one year                                               *
     * ------------------------------------------------------------------ */

    function exportLimitKw(cfg, kwp) {
        switch (cfg.grid.exportLimit) {
            case 'pct60': return 0.6 * kwp;
            case 'pct70': return 0.7 * kwp;
            case 'zero': return 0;
            case 'custom': return Math.max(0, Number(cfg.grid.exportLimitKw) || 0);
            default: return Infinity;
        }
    }

    function importPriceAt(cfg, localHour) {
        const t = cfg.tariff;
        if (!t.touEnabled) return t.importEurPerKwh;
        const start = t.touPeakStart;
        const end = t.touPeakEnd;
        const inPeak = start <= end ? (localHour >= start && localHour < end) : (localHour >= start || localHour < end);
        return inPeak ? t.touPeakEurPerKwh : t.importEurPerKwh;
    }

    function runDispatch(ctx, yearIndex, keepHourly) {
        const { cfg, dc, house, hpElec, localHourOffset, kwp, inverterKw } = ctx;
        const pvScale = Math.pow(1 - cfg.finance.pvDegradationPctPerYear / 100, yearIndex);
        const invEff = clamp(cfg.inverter.efficiencyPct, 50, 100) / 100;

        const batt = cfg.battery;
        const capacity = Math.max(0, batt.capacityKwh) * Math.pow(1 - batt.fadePctPerYear / 100, yearIndex);
        const hasBattery = capacity > 0.05;
        const battPower = hasBattery ? (batt.powerKw ? batt.powerKw : Math.min(Math.max(2.5, batt.capacityKwh / 2), 10)) : 0;
        const legEff = Math.sqrt(clamp(batt.roundTripPct, 50, 100) / 100);
        const socMin = capacity * clamp(batt.minSocPct, 0, 90) / 100;
        let soc = socMin;

        const limitKw = exportLimitKw(cfg, kwp);

        const ev = cfg.ev;
        const evDaily = ev.enabled ? (ev.kmPerYear / 365) * (ev.kwhPer100km / 100) / (clamp(ev.chargingEffPct, 50, 100) / 100) : 0;
        const wallbox = Math.max(1.4, ev.wallboxKw);
        const MIN_EV_KW = 1.4;   // 6 A on one phase, the IEC 61851 minimum

        const T = {
            pvDc: 0, pvAc: 0, clipped: 0, direct: 0, battCharge: 0, battDischarge: 0, exported: 0, curtailed: 0,
            imported: 0, load: 0, house: 0, hp: 0, ev: 0, evFromPv: 0, importCost: 0, noPvCost: 0, cycles: 0
        };
        const M = Array.from({ length: 12 }, () => ({
            pvAc: 0, direct: 0, battCharge: 0, battDischarge: 0, exported: 0, curtailed: 0, imported: 0,
            load: 0, house: 0, hp: 0, ev: 0
        }));
        const H = keepHourly ? {
            pvAc: new Float32Array(HOURS), load: new Float32Array(HOURS), ev: new Float32Array(HOURS),
            hp: new Float32Array(HOURS), house: new Float32Array(HOURS), direct: new Float32Array(HOURS),
            battCharge: new Float32Array(HOURS), battDischarge: new Float32Array(HOURS),
            exported: new Float32Array(HOURS), curtailed: new Float32Array(HOURS), imported: new Float32Array(HOURS),
            soc: new Float32Array(HOURS), socPct: new Float32Array(HOURS)
        } : null;

        let evNeed = 0;
        let evAtHomeToday = false;

        for (let i = 0; i < HOURS; i++) {
            const doy = Math.floor(i / 24) + 1;
            const localHour = (i % 24 + localHourOffset + 24) % 24;
            const m = monthOfDoy(doy);

            // a new driving day starts at local 06:00
            if (ev.enabled && localHour === 6) {
                evNeed += evDaily;
                const dow = (doy - 1) % 7;
                const homeDays = clamp(Math.round(ev.homeDaysPerWeek), 0, 7);
                // weekends first, then from Friday backwards
                const homeSet = [6, 5, 4, 3, 2, 1, 0].slice(0, homeDays);
                evAtHomeToday = homeSet.indexOf(dow) !== -1;
            }

            const dcNow = dc[i] * pvScale;
            const acRaw = dcNow * invEff;
            const ac = Math.min(acRaw, inverterKw);
            const clipped = acRaw - ac;

            const hNow = house[i];
            const hpNow = hpElec[i];
            const fixed = hNow + hpNow;
            const pvAfterFixed = Math.max(0, ac - fixed);

            // electric car
            let evNow = 0;
            if (ev.enabled && evNeed > 0) {
                const evening = localHour >= 18 || localHour < 6;
                const night = localHour >= 0 && localHour < 6;
                if (ev.mode === 'evening') {
                    if (evening) evNow = Math.min(evNeed, wallbox);
                } else if (ev.mode === 'night') {
                    if (night) evNow = Math.min(evNeed, wallbox);
                } else {
                    // solar: daytime surplus on home days, top up overnight
                    if (evAtHomeToday && localHour >= 9 && localHour < 17) {
                        const surplus = Math.min(pvAfterFixed, wallbox);
                        if (surplus >= MIN_EV_KW) evNow = Math.min(evNeed, surplus);
                    } else if (night) {
                        evNow = Math.min(evNeed, wallbox);
                    }
                }
                evNeed -= evNow;
            }

            const load = fixed + evNow;
            const directFixed = Math.min(ac, fixed);
            const evFromPv = Math.min(evNow, pvAfterFixed);
            const direct = directFixed + evFromPv;
            let surplus = ac - direct;
            const deficitFixed = fixed - directFixed;
            const deficitEv = evNow - evFromPv;

            let charge = 0;
            let discharge = 0;
            if (hasBattery) {
                charge = Math.min(surplus, battPower, Math.max(0, (capacity - soc) / legEff));
                soc += charge * legEff;
                surplus -= charge;

                const want = deficitFixed + (batt.chargesEv ? deficitEv : 0);
                discharge = Math.min(want, battPower, Math.max(0, (soc - socMin) * legEff));
                soc -= discharge / legEff;
            }

            const exported = Math.min(surplus, limitKw);
            const curtailed = surplus - exported;
            const imported = deficitFixed + deficitEv - discharge;

            const price = importPriceAt(cfg, localHour);
            T.pvDc += dcNow; T.pvAc += ac; T.clipped += clipped; T.direct += direct;
            T.battCharge += charge; T.battDischarge += discharge; T.exported += exported; T.curtailed += curtailed;
            T.imported += imported; T.load += load; T.house += hNow; T.hp += hpNow; T.ev += evNow; T.evFromPv += evFromPv;
            T.importCost += imported * price;
            T.noPvCost += load * price;

            const mm = M[m];
            mm.pvAc += ac; mm.direct += direct; mm.battCharge += charge; mm.battDischarge += discharge;
            mm.exported += exported; mm.curtailed += curtailed; mm.imported += imported;
            mm.load += load; mm.house += hNow; mm.hp += hpNow; mm.ev += evNow;

            if (H) {
                H.pvAc[i] = ac; H.load[i] = load; H.ev[i] = evNow; H.hp[i] = hpNow; H.house[i] = hNow;
                H.direct[i] = direct; H.battCharge[i] = charge; H.battDischarge[i] = discharge;
                H.exported[i] = exported; H.curtailed[i] = curtailed; H.imported[i] = imported;
                H.soc[i] = soc; H.socPct[i] = capacity > 0 ? 100 * soc / capacity : 0;
            }
        }

        T.cycles = capacity > 0 ? T.battDischarge / capacity : 0;
        T.capacityKwh = capacity;
        T.batteryPowerKw = battPower;
        return { totals: T, monthly: M, hourly: H };
    }

    /* ------------------------------------------------------------------ *
     * Finance                                                             *
     * ------------------------------------------------------------------ */

    function estimateCapex(cfg, kwp) {
        const pv = kwp > 0 ? 1200 + 1450 * kwp : 0;
        const battery = cfg.battery.capacityKwh > 0 ? 760 * cfg.battery.capacityKwh : 0;
        return { pv, battery, total: pv + battery };
    }

    function irr(cashflows) {
        const npvAt = (r) => cashflows.reduce((acc, cf, t) => acc + cf / Math.pow(1 + r, t), 0);
        let lo = -0.99;
        let hi = 1.0;
        let fLo = npvAt(lo);
        let fHi = npvAt(hi);
        if (fLo * fHi > 0) return null;
        for (let k = 0; k < 200; k++) {
            const mid = (lo + hi) / 2;
            const fMid = npvAt(mid);
            if (Math.abs(fMid) < 1e-6) return mid;
            if (fLo * fMid < 0) { hi = mid; fHi = fMid; } else { lo = mid; fLo = fMid; }
        }
        return (lo + hi) / 2;
    }

    function paybackYear(cumulative) {
        // cumulative[0] is the investment (negative); interpolate the zero crossing
        for (let y = 1; y < cumulative.length; y++) {
            if (cumulative[y] >= 0 && cumulative[y - 1] < 0) {
                const span = cumulative[y] - cumulative[y - 1];
                return (y - 1) + (span > 0 ? -cumulative[y - 1] / span : 0);
            }
        }
        return cumulative.length && cumulative[0] >= 0 ? 0 : null;
    }

    /* ------------------------------------------------------------------ *
     * Public entry point                                                  *
     * ------------------------------------------------------------------ */

    function localHourOffsetFor(lon) {
        // weather is in UTC; household routines follow local mean time, rounded to the hour
        return Math.round(lon / 15);
    }

    function simulate(cfgIn, weather, terrainHorizon) {
        const cfg = mergeDeep(defaultConfig(), cfgIn || {});
        validateWeather(weather);

        const kwp = totalKwp(cfg);
        const inverterKw = cfg.inverter.acKw ? Math.max(0.5, cfg.inverter.acKw) : autoInverterKw(kwp);
        const localHourOffset = localHourOffsetFor(cfg.location.lon);

        const pv = simulatePvDc(cfg, weather, terrainHorizon);
        const house = householdLoad(cfg, localHourOffset);
        const hp = heatPumpLoad(cfg, weather, localHourOffset);

        const ctx = { cfg, dc: pv.dc, house, hpElec: hp.elec, localHourOffset, kwp, inverterKw };

        const lifetime = clamp(Math.round(cfg.finance.lifetimeYears), 5, 40);
        const years = [];
        for (let y = 0; y < lifetime; y++) {
            years.push(runDispatch(ctx, y, y === 0));
        }
        const y1 = years[0];

        // ---- finance
        const capexEst = estimateCapex(cfg, kwp);
        const capex = cfg.finance.capexOverrideEur != null && cfg.finance.capexOverrideEur !== ''
            ? Math.max(0, Number(cfg.finance.capexOverrideEur))
            : capexEst.total;
        const inverterReplacementEur = cfg.finance.inverterReplacementEur != null && cfg.finance.inverterReplacementEur !== ''
            ? Math.max(0, Number(cfg.finance.inverterReplacementEur))
            : Math.round(600 + 120 * inverterKw);

        const r = cfg.finance.discountRatePct / 100;
        const esc = cfg.tariff.escalationPctPerYear / 100;
        const cash = [-capex];
        const cumulative = [-capex];
        const yearly = [];
        let npv = -capex;
        let discCost = capex;
        let discEnergy = 0;

        years.forEach((yr, idx) => {
            const t = idx + 1;
            const priceFactor = Math.pow(1 + esc, idx);
            const fit = t <= cfg.tariff.feedInYears ? cfg.tariff.feedInEurPerKwh : cfg.tariff.postFeedInEurPerKwh;
            const billWithout = yr.totals.noPvCost * priceFactor;
            const billWith = yr.totals.importCost * priceFactor;
            const feedIn = yr.totals.exported * fit;
            const opex = capex * cfg.finance.opexPctPerYear / 100 * Math.pow(1.02, idx);
            const replacement = t === Math.round(cfg.finance.inverterReplacementYear) ? inverterReplacementEur : 0;
            const net = billWithout - billWith + feedIn - opex - replacement;

            cash.push(net);
            cumulative.push(cumulative[cumulative.length - 1] + net);
            npv += net / Math.pow(1 + r, t);
            discCost += (opex + replacement) / Math.pow(1 + r, t);
            discEnergy += yr.totals.pvAc / Math.pow(1 + r, t);

            yearly.push({
                year: t,
                pvKwh: yr.totals.pvAc,
                selfUsedKwh: yr.totals.direct + yr.totals.battDischarge,
                exportedKwh: yr.totals.exported,
                importedKwh: yr.totals.imported,
                billWithoutEur: billWithout,
                billWithEur: billWith,
                feedInEur: feedIn,
                opexEur: opex,
                replacementEur: replacement,
                netEur: net,
                cumulativeEur: cumulative[cumulative.length - 1]
            });
        });

        const discountedCumulative = [-capex];
        cash.slice(1).forEach((cf, idx) => {
            discountedCumulative.push(discountedCumulative[idx] + cf / Math.pow(1 + r, idx + 1));
        });

        // ---- headline KPIs (year 1)
        const T = y1.totals;
        const selfUsed = T.direct + T.battDischarge;
        const hp1 = hp;
        const poaAfterHorizon = pv.irradiation.poaRawKwhM2 - pv.irradiation.horizonBlockedKwhM2;
        const performanceRatio = poaAfterHorizon > 0 && kwp > 0
            ? T.pvAc / (kwp * poaAfterHorizon)
            : 0;

        return {
            config: cfg,
            meta: {
                kwp,
                inverterKw,
                dcAcRatio: inverterKw > 0 ? kwp / inverterKw : 0,
                localHourOffset,
                batteryPowerKw: T.batteryPowerKw,
                horizon: pv.horizon,
                skyViewFactor: pv.svf,
                scop: hp1.scop,
                heatDemandKwh: hp1.heatTotal,
                evAnnualKwh: T.ev
            },
            kpi: {
                pvKwh: T.pvAc,
                specificYield: kwp > 0 ? T.pvAc / kwp : 0,
                performanceRatio,
                loadKwh: T.load,
                selfUsedKwh: selfUsed,
                selfConsumptionPct: T.pvAc > 0 ? 100 * selfUsed / T.pvAc : 0,
                autarkyPct: T.load > 0 ? 100 * selfUsed / T.load : 0,
                importKwh: T.imported,
                exportKwh: T.exported,
                curtailedKwh: T.curtailed,
                clippedKwh: T.clipped,
                batteryCycles: T.cycles,
                evSolarSharePct: T.ev > 0 ? 100 * T.evFromPv / T.ev : 0,
                co2AvoidedKg: T.pvAc * cfg.finance.co2KgPerKwh,
                year1SavingsEur: yearly[0].netEur + yearly[0].opexEur,  // before running costs, for the headline
                year1NetEur: yearly[0].netEur,
                capexEur: capex,
                capexEstimate: capexEst,
                inverterReplacementEur,
                paybackYears: paybackYear(cumulative),
                discountedPaybackYears: paybackYear(discountedCumulative),
                npvEur: npv,
                irrPct: (() => { const v = irr(cash); return v == null ? null : v * 100; })(),
                lcoeEurPerKwh: discEnergy > 0 ? discCost / discEnergy : null,
                lifetimeNetEur: cumulative[cumulative.length - 1]
            },
            losses: {
                poaRawKwhM2: pv.irradiation.poaRawKwhM2,
                poaEffKwhM2: pv.irradiation.poaEffKwhM2,
                horizonBlockedKwhM2: pv.irradiation.horizonBlockedKwhM2,
                nominalKwh: kwp * pv.irradiation.poaRawKwhM2,       // all sunlight on the panels at rated efficiency
                stcKwh: pv.irradiation.stcKwh,                      // after horizon, shading and reflection
                temperatureLossKwh: pv.irradiation.tempLossKwh,      // heat and weak light
                dcKwh: T.pvDc,                                       // after cables, mismatch and soiling
                inverterLossKwh: T.pvDc - T.pvAc - T.clipped,
                clippedKwh: T.clipped,
                acKwh: T.pvAc
            },
            monthly: y1.monthly,
            hourly: Object.assign({}, y1.hourly, {
                poa: pv.poaPerKwp,
                tAmb: weather.tAmb,
                sunElevation: pv.sunElevation
            }),
            yearly,
            cumulative,
            discountedCumulative
        };
    }

    function validateWeather(w) {
        const fields = ['ghi', 'dni', 'dhi', 'tAmb', 'ws'];
        if (!w) throw new Error('No weather data');
        fields.forEach((f) => {
            if (!w[f] || w[f].length !== HOURS) throw new Error(`Weather field ${f} must have ${HOURS} hourly values`);
        });
    }

    function isPlainObject(v) {
        return v && typeof v === 'object' && !Array.isArray(v) && !(ArrayBuffer.isView(v));
    }

    function mergeDeep(base, override) {
        const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
        Object.keys(override || {}).forEach((k) => {
            const v = override[k];
            if (v === undefined) return;
            if (isPlainObject(v) && isPlainObject(base[k])) out[k] = mergeDeep(base[k], v);
            else out[k] = v;
        });
        return out;
    }

    return {
        HOURS,
        MONTH_DAYS,
        MONTH_START_DOY,
        MOUNTING,
        defaultConfig,
        mergeDeep,
        sunPosition,
        resampleHorizon,
        horizonElevationAt,
        skyViewFactor,
        autoInverterKw,
        estimateCapex,
        totalKwp,
        simulate
    };
});
