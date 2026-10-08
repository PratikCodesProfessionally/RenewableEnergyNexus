/* ============================================================
   Interactive 3D solar home explorer
   Rooftop PV > inverter > home battery > wallbox > electric car.
   Built procedurally with Three.js, no model files needed.

   - Numbered component labels with leader lines + legend
   - Orbit (drag), zoom (buttons / keyboard / wheel after a click)
   - View modes: Exterior, Inside (x-ray) and Exploded
     (a PV module splits into its layers, a solar-cell cross-section
     shows the p-n junction, the car body lifts off its battery)
   - Real sun position for 50 deg N, clear-sky irradiance, clouds
   - Live energy balance: PV, house, wallbox, battery, grid, car SOC,
     with animated power flows whose speed follows the power
   - "Play day" simulation and a guided tour
   - Physics panel, legend and tour still work without WebGL
   - Builds lazily near the viewport, pauses off-screen,
     honours prefers-reduced-motion
   ============================================================ */
(function () {
    'use strict';

    const canvas = document.getElementById('solar-canvas');
    if (!canvas) return;

    const stage = canvas.parentElement;                 // .hero-visual
    const hero = stage.closest('.hero') || document.body;
    const $ = (sel) => hero.querySelector(sel);
    const $$ = (sel) => Array.prototype.slice.call(hero.querySelectorAll(sel));
    const lerp = (a, b, t) => a + (b - a) * t;
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const DEG = Math.PI / 180;

    // ============================================================
    //  The modelled system
    // ============================================================
    const SPEC = {
        latDeg: 50,                 // central Germany
        modules: 18,
        moduleWp: 455,
        kWp: 18 * 0.455,            // 8.19 kWp
        moduleEff: 0.21,
        tiltDeg: 35,                // south-facing roof
        performanceRatio: 0.9,      // temperature, soiling, wiring losses
        inverterKw: 8,
        inverterEff: 0.97,
        batteryKwh: 10,
        batteryKw: 5,
        batteryMinSoc: 10,
        wallboxKw: 11,              // 3 x 16 A x 230 V
        minSurplusKw: 1.4,          // 6 A on one phase, the IEC 61851 minimum
        carBatteryKwh: 77,
        carKwhPerKm: 0.18,
        chargeEff: 0.9
    };
    const TILT = SPEC.tiltDeg * DEG;
    const PANEL_NORMAL = { x: 0, y: Math.cos(TILT), z: Math.sin(TILT) };   // facing south (+z)
    const SEASONS = {
        summer: { label: 'Summer solstice', short: '21 Jun', decl: 23.44 },
        equinox: { label: 'Equinox', short: '21 Mar', decl: 0 },
        winter: { label: 'Winter solstice', short: '21 Dec', decl: -23.44 }
    };

    /** Sun position for solar time `hour`. Azimuth from north, clockwise. */
    function sunPosition(hour, declDeg) {
        const lat = SPEC.latDeg * DEG;
        const decl = declDeg * DEG;
        const H = (hour - 12) * 15 * DEG;
        const sinEl = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H);
        const el = Math.asin(clamp(sinEl, -1, 1));
        const cosAz = (Math.sin(decl) - Math.sin(el) * Math.sin(lat)) / (Math.cos(el) * Math.cos(lat));
        let az = Math.acos(clamp(cosAz, -1, 1));
        if (H > 0) az = 2 * Math.PI - az;
        const ce = Math.cos(el);
        // scene axes: +x east, +y up, +z south
        return { el: el, az: az, x: Math.sin(az) * ce, y: Math.sin(el), z: -Math.cos(az) * ce };
    }

    /** Clear-sky irradiance (Meinel with Kasten-Young air mass), scaled by cloud cover. */
    function irradiance(sun, cloud) {
        if (sun.y <= 0.004) return { dni: 0, dhi: 0, poa: 0, cosInc: 0 };
        const elDeg = sun.el / DEG;
        const airMass = 1 / (Math.sin(sun.el) + 0.50572 * Math.pow(elDeg + 6.07995, -1.6364));
        const dniClear = 1361 * Math.pow(0.7, Math.pow(airMass, 0.678));
        const dni = dniClear * (1 - 0.85 * cloud);
        const dhi = dniClear * sun.y * (0.1 + 0.2 * cloud);
        const cosInc = Math.max(0, sun.x * PANEL_NORMAL.x + sun.y * PANEL_NORMAL.y + sun.z * PANEL_NORMAL.z);
        const poa = dni * cosInc + dhi * (1 + Math.cos(TILT)) / 2;
        return { dni: dni, dhi: dhi, poa: poa, cosInc: cosInc };
    }

    const gauss = (x, m, s) => Math.exp(-0.5 * ((x - m) / s) * ((x - m) / s));
    /** Typical family-home load profile in kW. */
    function houseLoad(hour) {
        return 0.3 + 0.9 * gauss(hour, 7.5, 1) + 0.35 * gauss(hour, 12.5, 1.2) + 1.5 * gauss(hour, 19, 1.6);
    }

    /** Instantaneous energy balance. Priority: house, car, battery, export. */
    function energyBalance(s) {
        const sun = sunPosition(s.hour, SEASONS[s.season].decl);
        const irr = irradiance(sun, s.cloud);
        const pvDc = SPEC.kWp * irr.poa / 1000 * SPEC.performanceRatio;
        const pv = Math.min(pvDc * SPEC.inverterEff, SPEC.inverterKw);
        const house = houseLoad(s.hour);

        let pvLeft = pv;
        const houseFromPv = Math.min(pvLeft, house);
        pvLeft -= houseFromPv;
        let houseDeficit = house - houseFromPv;

        let car = 0;
        if (s.socCar < 99.9) {
            if (s.chargeMode === 'fast') car = SPEC.wallboxKw;
            else if (s.chargeMode === 'solar' && pvLeft >= SPEC.minSurplusKw) car = Math.min(SPEC.wallboxKw, pvLeft);
        }
        const carFromPv = Math.min(pvLeft, car);
        pvLeft -= carFromPv;
        const carFromGrid = car - carFromPv;

        let batt = 0;                                   // + charging, - discharging
        if (pvLeft > 0 && s.socBatt < 99.9) {
            batt = Math.min(SPEC.batteryKw, pvLeft);
            pvLeft -= batt;
        }
        if (houseDeficit > 0 && s.socBatt > SPEC.batteryMinSoc) {
            const d = Math.min(SPEC.batteryKw, houseDeficit);
            batt = -d;
            houseDeficit -= d;
        }
        const grid = houseDeficit + carFromGrid - pvLeft;   // + import, - export
        return {
            sun: sun, irr: irr, pvDc: pvDc, pv: pv, house: house, houseFromPv: houseFromPv,
            car: car, carFromPv: carFromPv, carFromGrid: carFromGrid,
            batt: batt, grid: grid, exported: pvLeft
        };
    }

    // ============================================================
    //  Component descriptions
    //  view = [theta, phi] camera angles used when focusing the part
    // ============================================================
    const PART_INFO = {
        pv: {
            num: 1, name: 'PV modules', group: 'exterior', focus: 14, view: [0.25, 1.05],
            desc: '18 monocrystalline silicon modules of 455 Wp form an 8.2 kWp array. Tilted 35° to the south at 50° N, they face the midday sun almost square-on. Output follows the sunlight on the module plane, P ≈ G·A·η, and about 21% of that light becomes electricity. Heat costs roughly 0.35% of power per °C above 25 °C.'
        },
        mounting: {
            num: 2, name: 'Mounting rails & roof hooks', group: 'exterior', focus: 7, view: [0.1, 1.2],
            desc: 'Stainless-steel hooks reach under the roof tiles to the rafters, and aluminium rails carry the modules. The structure holds the array against wind uplift and snow loads of several kN per m², and leaves a ventilation gap so the modules run cooler and more efficiently.'
        },
        house: {
            num: 3, name: 'Home energy use', group: 'exterior', focus: 18, view: [0.4, 1.3],
            desc: 'A German family home uses about 3,500 to 4,500 kWh a year, with peaks in the morning and evening. The energy manager supplies the home first, then the car and battery, and exports only what is left. Window brightness in the model shows the current household load.'
        },
        meter: {
            num: 4, name: 'Smart meter & grid link', group: 'exterior', focus: 4.5, view: [1.3, 1.4],
            desc: 'A bidirectional smart meter counts imported and exported energy separately. Exported solar earns a feed-in tariff of roughly 8 ct/kWh, while grid power costs about 30 to 40 ct/kWh, so every kWh used at home is worth about four times as much as one exported.'
        },
        wallbox: {
            num: 5, name: 'Wallbox', group: 'exterior', focus: 4.5, view: [1.0, 1.35],
            desc: 'An 11 kW AC charger: three phases × 16 A × 230 V. In solar-surplus mode the energy manager adjusts the charging current every few seconds to match the surplus, down to 6 A on one phase (1.4 kW), the minimum the IEC 61851 standard allows. Its LED glows green while charging.'
        },
        cable: {
            num: 6, name: 'Type 2 charging cable', group: 'exterior', focus: 5, view: [0.9, 1.2],
            desc: 'The Type 2 (IEC 62196) plug carries three phases, neutral and earth, plus two signal pins. The control-pilot signal tells the car the maximum current it may draw, the proximity pin reports the cable rating, and the plug locks while current flows.'
        },
        car: {
            num: 7, name: 'Electric car', group: 'exterior', focus: 10, view: [0.9, 1.25],
            desc: 'A typical electric car uses about 18 kWh per 100 km, so each kWh of rooftop solar adds about 5 km of range, and charging at 11 kW adds about 55 km per hour. Switch to Inside to see its battery, charger and motor.'
        },
        dc: {
            num: 8, name: 'DC string cables', group: 'interior', focus: 9, view: [-1.3, 1.3],
            desc: 'Modules are wired in series into strings so their voltages add: 18 modules × about 34 V at maximum power ≈ 610 V DC. High voltage keeps the current, and the I²R losses in the cables, low. A DC isolator allows safe shutdown.'
        },
        inverter: {
            num: 9, name: 'Hybrid inverter (MPPT)', group: 'interior', focus: 4.5, view: [-1.3, 1.4],
            desc: 'Maximum power point tracking keeps adjusting the operating voltage so the array delivers the most power, P = V·I, as light and temperature change. Fast transistor switching then turns the DC into a grid-synchronous three-phase 400 V, 50 Hz sine wave at about 97% efficiency. The hybrid model also charges and discharges the battery.'
        },
        battery: {
            num: 10, name: 'Home battery', group: 'interior', focus: 4.5, view: [-1.3, 1.4],
            desc: '10 kWh of lithium iron phosphate (LFP) cells store surplus solar at midday and release it in the evening. LFP is thermally stable and lasts 6,000 or more cycles. Round-trip efficiency is about 90 to 95%, and a 10% minimum charge protects the cells. The LED bar shows its state of charge.'
        },
        board: {
            num: 11, name: 'Energy manager & consumer unit', group: 'interior', focus: 4.5, view: [-1.3, 1.4],
            desc: 'The consumer unit splits power to the house circuits behind circuit breakers and a residual-current device (RCD). The energy manager measures every flow and decides in real time: house first, then car, then battery, then export.'
        },
        obc: {
            num: 12, name: 'Onboard charger', group: 'interior', focus: 4, view: [0.9, 1.05],
            desc: 'AC from the wallbox enters the car’s onboard charger, which rectifies it to DC at the battery voltage of about 400 V. Its 11 kW rating caps AC charging speed. DC fast chargers bypass it and feed the battery directly.'
        },
        evbattery: {
            num: 13, name: 'Traction battery', group: 'interior', focus: 6, view: [0.9, 1.05],
            desc: 'About 77 kWh of lithium-ion cells under the floor, arranged in liquid-cooled modules. The battery management system watches every cell’s voltage and temperature, balances them, and slows charging as the battery nears 100%.'
        },
        motor: {
            num: 14, name: 'Electric motor', group: 'interior', focus: 4, view: [0.9, 1.05],
            desc: 'A permanent-magnet synchronous motor turns battery power into torque at over 90% efficiency, against about 30 to 40% for a petrol engine. When braking it works as a generator and returns energy to the battery.'
        },
        cell: {
            num: 15, name: 'Solar cell (p–n junction)', group: 'interior', exploded: true, tint: false, focus: 5, view: [0.3, 1.4],
            desc: 'Silicon doped into a thin n-type top layer and a p-type base forms a p–n junction with a built-in electric field. A photon with more energy than silicon’s 1.12 eV band gap (wavelength below about 1,100 nm) frees an electron–hole pair. The field pushes electrons (blue) to the front contact and holes (pink) to the back, giving about 0.6 to 0.7 V per cell. Cells in series build the module voltage.'
        },
        layers: {
            num: 16, name: 'Module layers', group: 'interior', exploded: true, focus: 7, view: [0.55, 1.1],
            desc: 'From the top: 3.2 mm tempered anti-reflective glass, an EVA encapsulant, the solar cells, a second EVA layer, a polymer backsheet, the aluminium frame, and the junction box whose bypass diodes route current around shaded cells. The laminate is sealed against moisture for a 25 to 30 year life.'
        }
    };
    const PART_IDS = Object.keys(PART_INFO).sort((a, b) => PART_INFO[a].num - PART_INFO[b].num);

    const TOUR_STEPS = [
        { part: 'pv', mode: 'exterior', title: 'Sunlight reaches the modules', text: 'On a clear summer noon about 1,000 W/m² falls on the array. The 35° tilt points the modules almost straight at the midday sun.' },
        { part: 'cell', mode: 'exploded', title: 'Photons free electrons in the cells', text: 'Photons above silicon’s 1.12 eV band gap create electron–hole pairs, and the p–n junction’s field separates them into a direct current.' },
        { part: 'dc', mode: 'inside', title: 'DC flows down the string cables', text: 'Cells and modules in series add up to about 600 V DC, which runs through the roof to the inverter.' },
        { part: 'inverter', mode: 'inside', title: 'The inverter makes grid AC', text: 'MPPT holds the array at its best operating point, and power electronics turn the DC into 400 V, 50 Hz three-phase AC.' },
        { part: 'board', mode: 'inside', title: 'The energy manager shares it out', text: 'Solar power goes to the house first, then to the car and the battery. Only what is left is exported.' },
        { part: 'wallbox', mode: 'exterior', title: 'The wallbox charges the car', text: 'In surplus mode the wallbox follows the solar output, charging at anything from 1.4 to 11 kW.' },
        { part: 'evbattery', mode: 'inside', title: 'Sunshine becomes driving range', text: 'The onboard charger rectifies the AC to DC for the traction battery. Each kWh adds about 5 km of range.' }
    ];

    // ============================================================
    //  UI layer (works with or without WebGL)
    // ============================================================
    const ui = {
        selected: null, mode: 'exterior', tour: -1, labels: true, hover: null,
        hour: 13, season: 'summer', cloud: 0.1, chargeMode: 'solar',
        socBatt: 40, socCar: 35, playing: false
    };
    let viewer = null;
    let tourTimer = 0;
    let playTimer = 0;

    const el = (id) => document.getElementById(id);
    const hud = {
        timeOut: el('sh-time-out'), clock: el('sh-clock'), cloudOut: el('sh-cloud-out'),
        sun: el('sh-sun'), sunSub: el('sh-sun-sub'), irr: el('sh-irr'), irrSub: el('sh-irr-sub'),
        pv: el('sh-pv'), pvTotal: el('sh-pv-total'), house: el('sh-house'), wallbox: el('sh-wallbox'), wallboxSub: el('sh-wallbox-sub'),
        batt: el('sh-batt'), battSub: el('sh-batt-sub'), grid: el('sh-grid'), gridSub: el('sh-grid-sub'),
        car: el('sh-car'), carSub: el('sh-car-sub'), status: el('sh-status'),
        splitHouse: el('sh-split-house'), splitCar: el('sh-split-car'), splitBatt: el('sh-split-batt'), splitGrid: el('sh-split-grid')
    };
    const info = {
        root: el('sh-info'), num: el('sh-info-num'), title: el('sh-info-title'),
        text: el('sh-info-text'), step: el('sh-info-step'), close: el('sh-info-close')
    };
    const timeSlider = el('sh-time');
    const cloudSlider = el('sh-cloud');
    const stepsRoot = $('.wt-steps');
    const legendRoot = $('.wt-legend');
    const tourBtn = $('[data-action="tour"]');
    const playBtn = $('[data-action="play-day"]');
    const labelsBtn = $('[data-action="labels"]');
    const expandBtn = $('[data-action="expand"]');

    function setText(node, text) { if (node) node.textContent = text; }
    function fmt(n, d) { return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); }
    function kw(v) { return fmt(Math.abs(v) < 0.05 ? 0 : Math.abs(v), 1) + ' kW'; }
    function clockText(h) {
        const hh = Math.floor(h);
        const mm = Math.round((h - hh) * 60);
        return String(hh + (mm === 60 ? 1 : 0)).padStart(2, '0') + ':' + String(mm === 60 ? 0 : mm).padStart(2, '0');
    }
    const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

    function statusOf(b) {
        if (b.pv < 0.05) {
            if (b.car > 0.05) return ['import', 'No sun: the car charges at ' + kw(b.car) + ' from the grid'];
            if (b.batt < -0.05) return ['battery', 'No sun: the home battery powers the house'];
            return ['import', 'No sun: the house imports ' + kw(b.grid) + ' from the grid'];
        }
        if (b.car > 0.05) {
            const share = Math.round(b.carFromPv / b.car * 100);
            return [share >= 95 ? 'solar' : 'mixed', 'Charging the car at ' + kw(b.car) + ', ' + share + '% from sunshine'];
        }
        if (b.grid < -0.05) return ['export', 'Surplus: exporting ' + kw(b.grid) + ' of solar to the grid'];
        if (b.grid > 0.05) return ['import', 'Solar covers part of the demand, importing ' + kw(b.grid)];
        if (b.batt > 0.05) return ['solar', 'Solar runs the house and charges the battery'];
        return ['solar', 'Self-sufficient: the house runs entirely on solar'];
    }

    function renderHud() {
        const b = energyBalance(ui);
        const s = SEASONS[ui.season];
        setText(hud.timeOut, clockText(ui.hour));
        setText(hud.clock, clockText(ui.hour) + ' · ' + s.short);
        setText(hud.cloudOut, String(Math.round(ui.cloud * 100)));
        const elDeg = b.sun.el / DEG;
        setText(hud.sun, elDeg < 0 ? 'Set' : fmt(elDeg, 0) + '°');
        setText(hud.sunSub, elDeg < 0 ? 'below horizon' : 'azimuth ' + fmt(b.sun.az / DEG, 0) + '° ' + COMPASS[Math.round(b.sun.az / DEG / 45) % 8]);
        setText(hud.irr, fmt(b.irr.poa, 0) + ' W/m²');
        setText(hud.irrSub, 'on the module plane');
        setText(hud.pv, kw(b.pv));
        setText(hud.pvTotal, kw(b.pv));
        setText(hud.house, kw(b.house));
        setText(hud.wallbox, kw(b.car));
        setText(hud.wallboxSub, b.car > 0.05 ? Math.round(b.carFromPv / b.car * 100) + '% solar' : ui.socCar >= 99.9 ? 'car full' : ui.chargeMode === 'off' ? 'switched off' : 'waiting for surplus');
        setText(hud.batt, (b.batt > 0.05 ? '+' : b.batt < -0.05 ? '−' : '') + kw(b.batt));
        setText(hud.battSub, fmt(ui.socBatt, 0) + '% charged');
        setText(hud.grid, kw(b.grid));
        setText(hud.gridSub, b.grid < -0.05 ? 'exporting' : b.grid > 0.05 ? 'importing' : 'balanced');
        setText(hud.car, fmt(ui.socCar, 0) + '%');
        setText(hud.carSub, b.car > 0.05 ? '+' + fmt(b.car * SPEC.chargeEff / SPEC.carKwhPerKm, 0) + ' km per hour' : 'not charging');
        const total = Math.max(b.pv, 0.0001);
        const pct = (v) => (b.pv > 0.05 ? clamp(v / total * 100, 0, 100) : 0).toFixed(1) + '%';
        if (hud.splitHouse) hud.splitHouse.style.width = pct(b.houseFromPv);
        if (hud.splitCar) hud.splitCar.style.width = pct(b.carFromPv);
        if (hud.splitBatt) hud.splitBatt.style.width = pct(Math.max(0, b.batt));
        if (hud.splitGrid) hud.splitGrid.style.width = pct(b.exported);
        if (hud.status) {
            const st = statusOf(b);
            hud.status.dataset.state = st[0];
            hud.status.textContent = st[1];
        }
        if (timeSlider && Math.abs(parseFloat(timeSlider.value) - ui.hour) > 0.01) timeSlider.value = String(ui.hour);
        return b;
    }

    // ---- Mode, selection, tour (same behaviour as the Windrad explorer) ----
    function setMode(mode, moveCamera) {
        ui.mode = mode;
        $$('button[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
        stage.dataset.viewMode = mode;
        if (ui.selected) {
            const p = PART_INFO[ui.selected];
            if ((mode === 'exterior' && p.group === 'interior') || (mode !== 'exploded' && p.exploded)) select(null);
        }
        if (viewer) viewer.setMode(mode, moveCamera);
    }

    function select(id, opts) {
        opts = opts || {};
        ui.selected = id || null;
        $$('[data-part]').forEach(n => n.classList.toggle('is-active', n.dataset.part === ui.selected));
        if (!ui.selected) {
            if (info.root) info.root.hidden = true;
            stage.classList.remove('has-selection');
            $$('.wt-step').forEach(b => b.classList.remove('is-active'));
            if (viewer) viewer.select(null, false);
            return;
        }
        const p = PART_INFO[ui.selected];
        if (p.exploded && ui.mode !== 'exploded') setMode('exploded', false);
        else if (p.group === 'interior' && ui.mode === 'exterior') setMode('inside', false);
        setText(info.num, String(p.num));
        setText(info.title, p.name);
        setText(info.text, p.desc);
        if (info.root) info.root.classList.toggle('is-interior', p.group === 'interior');
        if (info.step) {
            if (typeof opts.step === 'number') {
                const s = TOUR_STEPS[opts.step];
                info.step.hidden = false;
                info.step.innerHTML = '';
                const strong = document.createElement('strong');
                strong.textContent = 'Step ' + (opts.step + 1) + ' of ' + TOUR_STEPS.length + ': ' + s.title + '. ';
                info.step.appendChild(strong);
                info.step.appendChild(document.createTextNode(s.text));
            } else {
                info.step.hidden = true;
                $$('.wt-step').forEach(b => b.classList.remove('is-active'));
            }
        }
        if (info.root) info.root.hidden = false;
        stage.classList.add('has-selection');
        if (viewer) viewer.select(ui.selected, opts.focus !== false);
    }

    function showStep(i) {
        const s = TOUR_STEPS[i];
        setMode(s.mode, false);
        select(s.part, { focus: true, step: i });
        $$('.wt-step').forEach((b, j) => b.classList.toggle('is-active', j === i));
    }
    function setTourButton(on) {
        if (!tourBtn) return;
        tourBtn.setAttribute('aria-pressed', String(on));
        const label = tourBtn.querySelector('span');
        const icon = tourBtn.querySelector('i');
        if (label) label.textContent = on ? 'Stop tour' : 'Play tour';
        if (icon) icon.className = on ? 'fas fa-stop' : 'fas fa-play';
    }
    function startTour() {
        stopTour();
        ui.tour = 0;
        showStep(0);
        setTourButton(true);
        tourTimer = window.setInterval(() => {
            ui.tour = (ui.tour + 1) % TOUR_STEPS.length;
            showStep(ui.tour);
        }, 7000);
    }
    function stopTour() {
        if (ui.tour < 0) return;
        window.clearInterval(tourTimer);
        ui.tour = -1;
        setTourButton(false);
    }

    // ---- Play a day: time runs 1 h every 2 s and both batteries integrate ----
    function setPlayButton(on) {
        if (!playBtn) return;
        playBtn.setAttribute('aria-pressed', String(on));
        const label = playBtn.querySelector('span');
        const icon = playBtn.querySelector('i');
        if (label) label.textContent = on ? 'Pause' : 'Play day';
        if (icon) icon.className = on ? 'fas fa-pause' : 'fas fa-play';
    }
    function startDay() {
        if (ui.hour >= 21.9) {                          // start a fresh day
            ui.hour = 5;
            ui.socBatt = 20;
            ui.socCar = 30;
        }
        ui.playing = true;
        setPlayButton(true);
        const STEP_H = 0.05;
        playTimer = window.setInterval(() => {
            const b = energyBalance(ui);
            ui.socBatt = clamp(ui.socBatt + b.batt * STEP_H / SPEC.batteryKwh * 100, 0, 100);
            ui.socCar = clamp(ui.socCar + b.car * SPEC.chargeEff * STEP_H / SPEC.carBatteryKwh * 100, 0, 100);
            ui.hour = Math.min(22, ui.hour + STEP_H);
            renderHud();
            if (ui.hour >= 22) stopDay();
        }, 100);
    }
    function stopDay() {
        window.clearInterval(playTimer);
        ui.playing = false;
        setPlayButton(false);
    }

    // ---- Build lists ----
    if (stepsRoot) {
        TOUR_STEPS.forEach((s, i) => {
            const li = document.createElement('li');
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'wt-step';
            const num = document.createElement('span');
            num.className = 'wt-step-num';
            num.textContent = String(i + 1);
            const title = document.createElement('span');
            title.textContent = s.title;
            b.appendChild(num);
            b.appendChild(title);
            b.addEventListener('click', () => { stopTour(); showStep(i); });
            li.appendChild(b);
            stepsRoot.appendChild(li);
        });
    }
    if (legendRoot) {
        PART_IDS.forEach(id => {
            const p = PART_INFO[id];
            const li = document.createElement('li');
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'wt-legend-btn wt-legend-' + p.group;
            b.dataset.part = id;
            const num = document.createElement('span');
            num.className = 'wt-legend-num';
            num.textContent = String(p.num);
            const name = document.createElement('span');
            name.textContent = p.name;
            b.appendChild(num);
            b.appendChild(name);
            b.addEventListener('click', () => { stopTour(); select(id, { focus: true }); });
            li.appendChild(b);
            legendRoot.appendChild(li);
        });
    }

    // ---- Controls ----
    $$('.wt-toolbar button').forEach(b => b.addEventListener('click', () => stage.classList.add('has-interacted')));
    $$('button[data-mode]').forEach(b => b.addEventListener('click', () => { stopTour(); setMode(b.dataset.mode, true); }));
    $$('button[data-zoom]').forEach(b => b.addEventListener('click', () => {
        stopTour();
        if (viewer) viewer.zoomBy(b.dataset.zoom === 'in' ? 0.72 : 1.38);
    }));
    const resetBtn = $('[data-action="reset"]');
    if (resetBtn) resetBtn.addEventListener('click', () => { stopTour(); select(null); setMode('exterior', true); });
    if (labelsBtn) labelsBtn.addEventListener('click', () => {
        ui.labels = !ui.labels;
        labelsBtn.setAttribute('aria-pressed', String(ui.labels));
        const root = el('sh-labels');
        if (root) root.classList.toggle('is-hidden', !ui.labels);
    });
    if (expandBtn) expandBtn.addEventListener('click', () => {
        const on = hero.classList.toggle('is-expanded');
        expandBtn.setAttribute('aria-pressed', String(on));
        expandBtn.setAttribute('aria-label', on ? 'Collapse explorer' : 'Expand explorer');
        expandBtn.title = on ? 'Collapse explorer' : 'Expand explorer';
        const icon = expandBtn.querySelector('i');
        if (icon) icon.className = on ? 'fas fa-compress' : 'fas fa-expand';
        window.requestAnimationFrame(() => stage.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    });
    if (tourBtn) tourBtn.addEventListener('click', () => { if (ui.tour >= 0) stopTour(); else startTour(); });
    if (playBtn) playBtn.addEventListener('click', () => { if (ui.playing) stopDay(); else startDay(); });
    if (info.close) info.close.addEventListener('click', () => { stopTour(); select(null); });
    if (timeSlider) timeSlider.addEventListener('input', () => { stopDay(); ui.hour = parseFloat(timeSlider.value); renderHud(); });
    if (cloudSlider) cloudSlider.addEventListener('input', () => { ui.cloud = parseFloat(cloudSlider.value) / 100; renderHud(); });
    $$('button[data-season]').forEach(b => b.addEventListener('click', () => {
        ui.season = b.dataset.season;
        $$('button[data-season]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        renderHud();
        if (viewer) viewer.seasonChanged();
    }));
    $$('button[data-charge]').forEach(b => b.addEventListener('click', () => {
        ui.chargeMode = b.dataset.charge;
        $$('button[data-charge]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        renderHud();
    }));
    if (timeSlider) ui.hour = parseFloat(timeSlider.value) || ui.hour;
    if (cloudSlider) ui.cloud = (parseFloat(cloudSlider.value) || 0) / 100;
    renderHud();

    // ============================================================
    //  3D bootstrap: build only when the section nears the viewport
    // ============================================================
    function showFallback() {
        stage.classList.add('is-fallback');
        stage.classList.remove('is-ready');
        hero.classList.add('wt-no3d');
        viewer = null;
    }

    // One shared Three.js download for every explorer on the page
    const THREE_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
    function loadThree(onReady) {
        if (typeof window.THREE !== 'undefined') { onReady(); return; }
        if (!window.__rnThreeLoading) {
            window.__rnThreeLoading = new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = THREE_SRC;
                s.async = true;
                s.onload = resolve;
                s.onerror = reject;
                document.head.appendChild(s);
            });
        }
        window.__rnThreeLoading.then(onReady, showFallback);
    }

    const probe = document.createElement('canvas');
    const hasWebGL = !!(window.WebGLRenderingContext &&
        (probe.getContext('webgl') || probe.getContext('experimental-webgl')));
    if (!hasWebGL) {
        showFallback();
        return;
    }
    if ('IntersectionObserver' in window) {
        const io = new IntersectionObserver((entries) => {
            if (!entries.some(e => e.isIntersecting)) return;
            io.disconnect();
            loadThree(init3D);
        }, { rootMargin: '600px 0px' });
        io.observe(stage);
    } else {
        loadThree(init3D);
    }

    // ============================================================
    //  3D scene
    // ============================================================
    function init3D() {
        if (typeof THREE === 'undefined') { showFallback(); return; }

        let renderer;
        try {
            renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
        } catch (err) {
            showFallback();
            return;
        }

        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const motionScale = reduceMotion ? 0 : 1;
        const mqStaticInfo = window.matchMedia('(max-width: 600px)');

        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setClearColor(0x000000, 0);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.outputEncoding = THREE.sRGBEncoding;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.0;

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 300);
        const V = (x, y, z) => new THREE.Vector3(x, y, z);
        const E = (x, y, z) => new THREE.Euler(x, y, z);
        const SCENE_CENTER = V(2, 0, 0);

        // --- Lighting: the sun drives a shadow-casting light ------
        const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x203a2a, 0.5);
        scene.add(hemi);
        const sunLight = new THREE.DirectionalLight(0xfff1d6, 1.2);
        sunLight.castShadow = true;
        sunLight.shadow.mapSize.set(2048, 2048);
        sunLight.shadow.camera.near = 1;
        sunLight.shadow.camera.far = 90;
        sunLight.shadow.camera.left = -16;
        sunLight.shadow.camera.right = 16;
        sunLight.shadow.camera.top = 16;
        sunLight.shadow.camera.bottom = -16;
        sunLight.shadow.bias = -0.0006;
        sunLight.target.position.copy(SCENE_CENTER);
        scene.add(sunLight);
        scene.add(sunLight.target);
        const moonLight = new THREE.DirectionalLight(0x7f9cff, 0.0);
        moonLight.position.set(-10, 14, -6);
        scene.add(moonLight);

        // --- Materials ---------------------------------------------
        const std = (o) => new THREE.MeshStandardMaterial(o);
        const wallMat = std({ color: 0xe8e2d6, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
        const roofMat = std({ color: 0x5b3b33, roughness: 0.8, metalness: 0.05 });
        const trimMat = std({ color: 0x3b3f46, roughness: 0.7, metalness: 0.2 });
        const floorMat = std({ color: 0x8c8a86, roughness: 0.95 });
        const windowMat = std({ color: 0x1d2a38, roughness: 0.15, metalness: 0.6, emissive: 0xffc46b, emissiveIntensity: 0 });
        const doorMat = std({ color: 0x4a3426, roughness: 0.6 });
        const frameMat = std({ color: 0xc8ced6, metalness: 0.85, roughness: 0.3 });
        const railMat = std({ color: 0x9aa3ad, metalness: 0.85, roughness: 0.35 });
        const backMat = std({ color: 0xf2f2f2, roughness: 0.8 });
        const darkMat = std({ color: 0x2a3340, metalness: 0.5, roughness: 0.4 });
        const deviceMat = std({ color: 0xeef1f4, metalness: 0.2, roughness: 0.5 });
        const carMat = std({ color: 0x2f6f8f, metalness: 0.6, roughness: 0.32, side: THREE.DoubleSide });
        const glassMat = std({ color: 0x0d1724, metalness: 0.7, roughness: 0.1, transparent: true, opacity: 0.85 });
        const tyreMat = std({ color: 0x15181c, roughness: 0.9 });
        const rimMat = std({ color: 0xb8c0c8, metalness: 0.9, roughness: 0.25 });
        const packMat = std({ color: 0x3a4250, metalness: 0.5, roughness: 0.45 });
        const hvMat = std({ color: 0xff8a1f, roughness: 0.5, emissive: 0x5a2a00, emissiveIntensity: 0.4 });
        const copperMat = std({ color: 0xb87333, metalness: 0.9, roughness: 0.32 });
        const cableMat = std({ color: 0x20252b, roughness: 0.6 });
        const dcCableMat = std({ color: 0xd84a2b, roughness: 0.6 });
        const ledMat = std({ color: 0x4caf50, emissive: 0x4caf50, emissiveIntensity: 1 });
        const battLedOn = std({ color: 0x9575cd, emissive: 0x9575cd, emissiveIntensity: 1.2 });
        const battLedOff = std({ color: 0x3a3550, roughness: 0.6 });
        const screenMat = std({ color: 0x0b1a10, emissive: 0x4caf50, emissiveIntensity: 0 });
        const lawnMat = std({ color: 0x1f3d2a, roughness: 1, transparent: true });
        const pavingMat = std({ color: 0x4a5059, roughness: 0.95 });
        const xrayMats = [wallMat, roofMat, carMat];

        function mesh(geo, mat, opts) {
            const m = new THREE.Mesh(geo, mat);
            m.castShadow = true;
            m.receiveShadow = true;
            if (opts) {
                if (opts.position) m.position.copy(opts.position);
                if (opts.rotation) m.rotation.copy(opts.rotation);
                if (opts.castShadow === false) m.castShadow = false;
            }
            return m;
        }

        // Solar-cell texture: half-cut mono cells with silver busbars
        function makeCellTexture() {
            const c = document.createElement('canvas');
            c.width = 256;
            c.height = 420;
            const ctx = c.getContext('2d');
            ctx.fillStyle = '#c9d1da';
            ctx.fillRect(0, 0, c.width, c.height);
            const cols = 6;
            const rows = 10;
            const pad = 6;
            const cw = (c.width - pad * 2) / cols;
            const ch = (c.height - pad * 2) / rows;
            for (let r = 0; r < rows; r++) {
                for (let k = 0; k < cols; k++) {
                    const x = pad + k * cw + 1.5;
                    const y = pad + r * ch + 1.5;
                    const g = ctx.createLinearGradient(x, y, x + cw, y + ch);
                    g.addColorStop(0, '#13264d');
                    g.addColorStop(1, '#0b1730');
                    ctx.fillStyle = g;
                    ctx.fillRect(x, y, cw - 3, ch - 3);
                    ctx.strokeStyle = 'rgba(200,215,235,0.55)';
                    ctx.lineWidth = 1;
                    for (let bb = 1; bb <= 3; bb++) {
                        const bx = x + (cw - 3) * bb / 4;
                        ctx.beginPath();
                        ctx.moveTo(bx, y);
                        ctx.lineTo(bx, y + ch - 3);
                        ctx.stroke();
                    }
                }
            }
            const tex = new THREE.CanvasTexture(c);
            tex.encoding = THREE.sRGBEncoding;
            tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
            return tex;
        }
        const cellTex = makeCellTexture();
        const cellMat = std({ map: cellTex, metalness: 0.35, roughness: 0.25 });

        function makeFadeTexture() {
            const c = document.createElement('canvas');
            c.width = c.height = 256;
            const ctx = c.getContext('2d');
            const g = ctx.createRadialGradient(128, 128, 20, 128, 128, 128);
            g.addColorStop(0, '#fff');
            g.addColorStop(0.6, '#fff');
            g.addColorStop(1, '#000');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, 256, 256);
            return new THREE.CanvasTexture(c);
        }
        function makeGlowTexture() {
            const c = document.createElement('canvas');
            c.width = c.height = 128;
            const ctx = c.getContext('2d');
            const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
            g.addColorStop(0, 'rgba(255,255,240,1)');
            g.addColorStop(0.2, 'rgba(255,236,170,0.95)');
            g.addColorStop(0.45, 'rgba(255,200,90,0.35)');
            g.addColorStop(1, 'rgba(255,170,60,0)');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, 128, 128);
            return new THREE.CanvasTexture(c);
        }

        // --- Parts registry -----------------------------------------
        const parts = [];
        const partById = {};
        const tmpBox = new THREE.Box3();
        function registerPart(id, object, anchorFn, centerFn) {
            const def = Object.assign({ id: id }, PART_INFO[id], {
                object: object,
                anchor: anchorFn,
                center: centerFn || ((t) => tmpBox.setFromObject(object).getCenter(t))
            });
            object.userData.partId = id;
            parts.push(def);
            partById[id] = def;
            return def;
        }

        // --- Ground ---------------------------------------------------
        const ground = new THREE.Mesh(new THREE.CircleGeometry(24, 72), lawnMat);
        lawnMat.alphaMap = makeFadeTexture();
        ground.rotation.x = -Math.PI / 2;
        ground.position.set(2, 0, 0);
        ground.receiveShadow = true;
        scene.add(ground);
        const driveway = mesh(new THREE.BoxGeometry(3.6, 0.04, 10), pavingMat, { position: V(7.6, 0.02, 2) });
        driveway.castShadow = false;
        scene.add(driveway);
        const path = mesh(new THREE.BoxGeometry(1.4, 0.03, 4.5), pavingMat, { position: V(-1.2, 0.015, 5.6) });
        path.castShadow = false;
        scene.add(path);

        // --- House ----------------------------------------------------
        const HW = 10;          // width (x)
        const HD = 7;           // depth (z)
        const WALL_H = 3;
        const OVERHANG = 0.4;
        const RISE = (HD / 2) * Math.tan(TILT);
        const RIDGE_Y = WALL_H + RISE;
        const ROOF_RUN = HD / 2 + OVERHANG;
        const ROOF_LEN = ROOF_RUN / Math.cos(TILT);
        const ROOF_W = HW + 0.6;

        const house = new THREE.Group();
        scene.add(house);
        house.add(mesh(new THREE.BoxGeometry(HW, WALL_H, HD), wallMat, { position: V(0, WALL_H / 2, 0) }));
        const slab = mesh(new THREE.BoxGeometry(HW - 0.1, 0.1, HD - 0.1), floorMat, { position: V(0, 0.06, 0) });
        slab.castShadow = false;
        house.add(slab);

        // Gable ends
        const gableShape = new THREE.Shape();
        gableShape.moveTo(-HD / 2, 0);
        gableShape.lineTo(HD / 2, 0);
        gableShape.lineTo(0, RISE);
        gableShape.closePath();
        const gableGeo = new THREE.ExtrudeGeometry(gableShape, { depth: 0.12, bevelEnabled: false });
        [-1, 1].forEach(side => {
            const g = mesh(gableGeo, wallMat, { position: V(side * HW / 2 - 0.06, WALL_H, 0), rotation: E(0, Math.PI / 2, 0) });
            house.add(g);
        });

        // Roof slopes: local +z runs down-slope, local +y is the roof normal
        const roofGeo = new THREE.BoxGeometry(ROOF_W, 0.18, ROOF_LEN);
        const southRoof = new THREE.Group();
        southRoof.position.set(0, RIDGE_Y - (ROOF_RUN / 2) * Math.tan(TILT) + 0.09 / Math.cos(TILT), ROOF_RUN / 2);
        southRoof.rotation.x = TILT;
        southRoof.add(mesh(roofGeo, roofMat));
        house.add(southRoof);
        const northRoof = mesh(roofGeo, roofMat, {
            position: V(0, RIDGE_Y - (ROOF_RUN / 2) * Math.tan(TILT) + 0.09 / Math.cos(TILT), -ROOF_RUN / 2),
            rotation: E(-TILT, 0, 0)
        });
        house.add(northRoof);
        house.add(mesh(new THREE.BoxGeometry(ROOF_W, 0.16, 0.22), trimMat, { position: V(0, RIDGE_Y + 0.12, 0) }));

        // Windows and door on the south facade, one window on the west gable
        const windows = [];
        [[-3.4, 1.7], [-0.4, 1.7], [2.6, 1.7]].forEach(p => {
            const w = mesh(new THREE.BoxGeometry(1.6, 1.2, 0.08), windowMat, { position: V(p[0], p[1], HD / 2 + 0.02) });
            windows.push(w);
            house.add(w);
        });
        house.add(mesh(new THREE.BoxGeometry(1.0, 2.1, 0.08), doorMat, { position: V(-1.9, 1.05, HD / 2 + 0.02) }));
        house.add(mesh(new THREE.BoxGeometry(0.08, 1.2, 1.6), windowMat, { position: V(-HW / 2 - 0.02, 1.7, 0.5) }));
        registerPart('house', house, (t) => t.set(-3.4, 2.55, HD / 2 + 0.05), (t) => t.set(0, 2.4, 0));

        // --- PV array on the south roof slope -------------------------
        // Built in roof-local coordinates: x along the ridge, z down-slope, y = roof normal
        const MOD_W = 1.05;
        const MOD_L = 1.72;
        const MOD_T = 0.04;
        const COLS = 9;
        const ROWS = 2;
        const GAP = 0.025;
        const ARRAY_Y = 0.09 + 0.14;                    // roof surface + rail height
        const ROW_Z = [-0.3 - (MOD_L + GAP) / 2, -0.3 + (MOD_L + GAP) / 2];
        const colX = (k) => (k - (COLS - 1) / 2) * (MOD_W + GAP);

        const pvGroup = new THREE.Group();
        southRoof.add(pvGroup);
        const modGeo = new THREE.BoxGeometry(MOD_W, MOD_T, MOD_L);
        // The array has its own materials so it can fade in x-ray while the exploded module stays solid
        const arrayFrameMat = frameMat.clone();
        const arrayCellMat = cellMat.clone();
        const arrayBackMat = backMat.clone();
        xrayMats.push(arrayFrameMat, arrayCellMat, arrayBackMat);
        const modMats = [arrayFrameMat, arrayFrameMat, arrayCellMat, arrayBackMat, arrayFrameMat, arrayFrameMat];
        const EXPLODE_COL = COLS - 1;
        const EXPLODE_ROW = 1;
        for (let r = 0; r < ROWS; r++) {
            for (let k = 0; k < COLS; k++) {
                if (r === EXPLODE_ROW && k === EXPLODE_COL) continue;   // built separately in layers
                pvGroup.add(mesh(modGeo, modMats, { position: V(colX(k), ARRAY_Y, ROW_Z[r]) }));
            }
        }
        registerPart('pv', pvGroup, (t) => southRoof.localToWorld(t.set(colX(1), ARRAY_Y + 0.05, ROW_Z[0])),
            (t) => southRoof.localToWorld(t.set(0, ARRAY_Y, -0.3)));

        // Rails and hooks
        const rails = new THREE.Group();
        southRoof.add(rails);
        const railLen = COLS * (MOD_W + GAP) + 0.2;
        const mountMat = railMat.clone();
        xrayMats.push(mountMat);
        ROW_Z.forEach(z => {
            [-0.5, 0.5].forEach(o => {
                rails.add(mesh(new THREE.BoxGeometry(railLen, 0.05, 0.06), mountMat, { position: V(0, 0.09 + 0.09, z + o) }));
                for (let k = -2; k <= 2; k++) {
                    rails.add(mesh(new THREE.BoxGeometry(0.06, 0.1, 0.05), mountMat, { position: V(k * 2.1, 0.09 + 0.04, z + o) }));
                }
            });
        });
        registerPart('mounting', rails, (t) => southRoof.localToWorld(t.set(-railLen / 2 + 0.05, 0.2, ROW_Z[1] + 0.5)),
            (t) => southRoof.localToWorld(t.set(-railLen / 2 + 1.2, 0.2, ROW_Z[1])));

        // The module that explodes into its layers
        const xMod = new THREE.Group();
        const X_MOD_BASE = V(colX(EXPLODE_COL), ARRAY_Y, ROW_Z[EXPLODE_ROW]);
        xMod.position.copy(X_MOD_BASE);
        southRoof.add(xMod);
        const layerDefs = [
            // [name, geometry, material, assembled y, exploded y]
            ['glass', new THREE.BoxGeometry(MOD_W - 0.02, 0.008, MOD_L - 0.02), std({ color: 0xbfe3ff, transparent: true, opacity: 0.28, metalness: 0.1, roughness: 0.05, depthWrite: false }), 0.017, 1.9],
            ['evaTop', new THREE.BoxGeometry(MOD_W - 0.03, 0.004, MOD_L - 0.03), std({ color: 0xffffff, transparent: true, opacity: 0.35, roughness: 0.9, depthWrite: false }), 0.011, 1.5],
            ['cells', new THREE.BoxGeometry(MOD_W - 0.04, 0.004, MOD_L - 0.04), [frameMat, frameMat, cellMat, backMat, frameMat, frameMat], 0.006, 1.1],
            ['evaBot', new THREE.BoxGeometry(MOD_W - 0.03, 0.004, MOD_L - 0.03), std({ color: 0xffffff, transparent: true, opacity: 0.35, roughness: 0.9, depthWrite: false }), 0.001, 0.75],
            ['back', new THREE.BoxGeometry(MOD_W - 0.02, 0.006, MOD_L - 0.02), backMat, -0.006, 0.42]
        ];
        const layers = layerDefs.map(d => {
            const m = mesh(d[1], d[2], { position: V(0, d[3], 0) });
            m.userData.layer = { a: d[3], b: d[4] };
            xMod.add(m);
            return m;
        });
        const xFrame = new THREE.Group();
        xFrame.userData.layer = { a: 0, b: 0.1 };
        [[0, MOD_L / 2], [0, -MOD_L / 2]].forEach(p => xFrame.add(mesh(new THREE.BoxGeometry(MOD_W, MOD_T, 0.03), frameMat, { position: V(p[0], 0, p[1]) })));
        [[MOD_W / 2, 0], [-MOD_W / 2, 0]].forEach(p => xFrame.add(mesh(new THREE.BoxGeometry(0.03, MOD_T, MOD_L), frameMat, { position: V(p[0], 0, p[1]) })));
        xMod.add(xFrame);
        layers.push(xFrame);
        const jbox = mesh(new THREE.BoxGeometry(0.18, 0.05, 0.12), darkMat, { position: V(0, -0.035, -MOD_L / 2 + 0.2) });
        jbox.userData.layer = { a: -0.035, b: -0.25 };
        xMod.add(jbox);
        layers.push(jbox);
        registerPart('layers', xMod, (t) => xMod.localToWorld(t.set(-MOD_W / 2, layers[0].position.y, -MOD_L / 2)));
        const X_MOD_LIFT = 1.2;

        // Solar-cell cross-section with drifting electrons and holes
        const cellX = new THREE.Group();            // upright, so its layers read side-on
        scene.add(cellX);
        cellX.position.set(7.4, 5.4, 3.0);
        const CX = 1.4;
        const CZ = 1.0;
        const N_T = 0.12;
        const P_T = 0.5;
        cellX.add(mesh(new THREE.BoxGeometry(CX, N_T, CZ), std({ color: 0x3f6fd8, transparent: true, opacity: 0.72, roughness: 0.4, depthWrite: false }), { position: V(0, P_T + N_T / 2, 0) }));
        cellX.add(mesh(new THREE.BoxGeometry(CX, P_T, CZ), std({ color: 0xd84a6a, transparent: true, opacity: 0.4, roughness: 0.4, depthWrite: false }), { position: V(0, P_T / 2, 0) }));
        cellX.add(mesh(new THREE.BoxGeometry(CX, 0.03, CZ), railMat, { position: V(0, -0.015, 0) }));                  // back contact
        for (let i = -2; i <= 2; i++) {
            cellX.add(mesh(new THREE.BoxGeometry(0.03, 0.03, CZ), frameMat, { position: V(i * 0.3, P_T + N_T + 0.015, 0) }));   // front fingers
        }
        // Junction plane
        const junction = new THREE.Mesh(new THREE.PlaneGeometry(CX, CZ), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }));
        junction.rotation.x = -Math.PI / 2;
        junction.position.y = P_T;
        cellX.add(junction);
        function makeCarriers(count, color, size) {
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
            const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: color, size: size, transparent: true, opacity: 1, depthWrite: false, sizeAttenuation: true }));
            pts.userData = { count: count, seeds: Array.from({ length: count }, () => ({ x: (Math.random() - 0.5) * CX * 0.9, z: (Math.random() - 0.5) * CZ * 0.9, p: Math.random(), s: 0.6 + Math.random() * 0.8 })) };
            cellX.add(pts);
            return pts;
        }
        const electrons = makeCarriers(36, 0x8fe3ff, 0.09);
        const holes = makeCarriers(36, 0xff7ab0, 0.07);
        const cellPhotons = makeCarriers(24, 0xfff3a0, 0.09);
        // In-scene text labels for the layers
        function textSprite(text, color) {
            const c = document.createElement('canvas');
            const ctx = c.getContext('2d');
            const font = '600 40px Inter, "Segoe UI", sans-serif';
            ctx.font = font;
            c.width = Math.ceil(ctx.measureText(text).width) + 28;
            c.height = 60;
            ctx.font = font;
            ctx.fillStyle = 'rgba(10,16,26,0.8)';
            ctx.fillRect(0, 0, c.width, c.height);
            ctx.fillStyle = color;
            ctx.textBaseline = 'middle';
            ctx.fillText(text, 14, 31);
            const tex = new THREE.CanvasTexture(c);
            tex.encoding = THREE.sRGBEncoding;
            const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
            const hgt = 0.085;
            sp.scale.set(hgt * c.width / c.height, hgt, 1);
            sp.userData.halfW = hgt * c.width / c.height / 2;
            return sp;
        }
        [['n-type Si (phosphorus)', '#8fb4ff', P_T + N_T + 0.07], ['p–n junction: built-in field', '#ffffff', P_T - 0.04], ['p-type Si (boron)', '#ff9ec0', 0.16]].forEach(d => {
            const sp = textSprite(d[0], d[1]);
            sp.position.set(CX / 2 + 0.08 + sp.userData.halfW, d[2], CZ / 2);
            cellX.add(sp);
        });
        registerPart('cell', cellX, (t) => cellX.localToWorld(t.set(-CX / 2, P_T + N_T, CZ / 2)),
            (t) => cellX.localToWorld(t.set(0.45, P_T / 2 + 0.05, 0)));

        // --- Utility wall (east side) ---------------------------------
        const EAST_IN = HW / 2 - 0.13;                 // just inside the east wall
        const EAST_OUT = HW / 2 + 0.01;

        const inverter = new THREE.Group();
        inverter.position.set(EAST_IN, 1.85, -1.2);
        inverter.add(mesh(new THREE.BoxGeometry(0.2, 0.75, 0.55), deviceMat));
        for (let i = 0; i < 6; i++) inverter.add(mesh(new THREE.BoxGeometry(0.06, 0.62, 0.02), railMat, { position: V(0.12, 0, -0.22 + i * 0.088) }));
        const invScreen = mesh(new THREE.BoxGeometry(0.01, 0.12, 0.2), screenMat, { position: V(-0.105, 0.18, 0) });
        inverter.add(invScreen);
        house.add(inverter);
        registerPart('inverter', inverter, (t) => inverter.localToWorld(t.set(-0.1, 0.42, 0)));

        const battery = new THREE.Group();
        battery.position.set(EAST_IN - 0.08, 0.66, -2.45);
        battery.add(mesh(new THREE.BoxGeometry(0.36, 1.2, 0.7), deviceMat));
        const battLeds = [];
        for (let i = 0; i < 5; i++) {
            const led = mesh(new THREE.BoxGeometry(0.01, 0.07, 0.24), battLedOff, { position: V(-0.185, -0.25 + i * 0.12, 0) });
            battLeds.push(led);
            battery.add(led);
        }
        house.add(battery);
        registerPart('battery', battery, (t) => battery.localToWorld(t.set(-0.18, 0.66, 0)));

        const board = new THREE.Group();
        board.position.set(EAST_IN, 1.65, 0.15);
        board.add(mesh(new THREE.BoxGeometry(0.14, 0.7, 0.55), deviceMat));
        for (let i = 0; i < 8; i++) board.add(mesh(new THREE.BoxGeometry(0.02, 0.09, 0.04), darkMat, { position: V(-0.08, 0.12, -0.21 + i * 0.06) }));
        const boardScreen = mesh(new THREE.BoxGeometry(0.01, 0.1, 0.18), screenMat, { position: V(-0.075, -0.15, 0) });
        board.add(boardScreen);
        house.add(board);
        registerPart('board', board, (t) => board.localToWorld(t.set(-0.08, 0.38, 0)));

        const meter = new THREE.Group();
        meter.position.set(EAST_OUT + 0.11, 1.5, 1.25);
        meter.add(mesh(new THREE.BoxGeometry(0.22, 0.85, 0.55), std({ color: 0xb9bec4, roughness: 0.6, metalness: 0.3 })));
        meter.add(mesh(new THREE.BoxGeometry(0.01, 0.16, 0.26), std({ color: 0x0c1410, emissive: 0x9be7a0, emissiveIntensity: 0.6 }), { position: V(0.115, 0.15, 0) }));
        house.add(meter);
        registerPart('meter', meter, (t) => meter.localToWorld(t.set(0.12, 0.44, 0)));

        const wallbox = new THREE.Group();
        wallbox.position.set(EAST_OUT + 0.09, 1.25, 2.65);
        wallbox.add(mesh(new THREE.BoxGeometry(0.16, 0.5, 0.36), std({ color: 0xf4f6f8, roughness: 0.35, metalness: 0.1 })));
        const wbLedMat = std({ color: 0x4caf50, emissive: 0x4caf50, emissiveIntensity: 1 });
        const wbLed = mesh(new THREE.TorusGeometry(0.06, 0.012, 8, 32), wbLedMat, { position: V(0.085, 0.1, 0), rotation: E(0, Math.PI / 2, 0) });
        wallbox.add(wbLed);
        wallbox.add(mesh(new THREE.BoxGeometry(0.06, 0.12, 0.12), darkMat, { position: V(0.1, -0.16, 0) }));
        house.add(wallbox);
        registerPart('wallbox', wallbox, (t) => wallbox.localToWorld(t.set(0.09, 0.27, 0)));

        // --- Electric car ----------------------------------------------
        // Car-local: +x forward, +y up, +z towards the car's left side
        const car = new THREE.Group();
        car.position.set(7.55, 0, 1.25);
        car.rotation.y = -Math.PI / 2;                 // nose faces +z (south)
        scene.add(car);

        const carBody = new THREE.Group();             // lifts off in the exploded view
        car.add(carBody);
        const CAR_W = 1.66;
        const bodyShape = new THREE.Shape();
        bodyShape.moveTo(-2.3, 0.32);
        bodyShape.lineTo(-1.45 - 0.42, 0.32);
        bodyShape.absarc(-1.45, 0.32, 0.42, Math.PI, 0, true);
        bodyShape.lineTo(1.45 - 0.42, 0.32);
        bodyShape.absarc(1.45, 0.32, 0.42, Math.PI, 0, true);
        bodyShape.lineTo(2.25, 0.32);
        bodyShape.quadraticCurveTo(2.42, 0.36, 2.4, 0.62);
        bodyShape.quadraticCurveTo(2.35, 0.86, 2.0, 0.92);
        bodyShape.lineTo(0.95, 1.0);
        bodyShape.lineTo(-1.95, 1.04);
        bodyShape.quadraticCurveTo(-2.32, 1.0, -2.36, 0.72);
        bodyShape.closePath();
        const bodyGeo = new THREE.ExtrudeGeometry(bodyShape, { depth: CAR_W, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.06, bevelSegments: 3, curveSegments: 18 });
        bodyGeo.translate(0, 0, -CAR_W / 2);
        carBody.add(mesh(bodyGeo, carMat));
        const cabinShape = new THREE.Shape();
        cabinShape.moveTo(0.95, 1.0);
        cabinShape.quadraticCurveTo(0.5, 1.38, 0.15, 1.46);
        cabinShape.lineTo(-1.25, 1.46);
        cabinShape.quadraticCurveTo(-1.75, 1.36, -1.98, 1.04);
        cabinShape.closePath();
        const cabinGeo = new THREE.ExtrudeGeometry(cabinShape, { depth: CAR_W - 0.16, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2, curveSegments: 12 });
        cabinGeo.translate(0, 0, -(CAR_W - 0.16) / 2);
        carBody.add(mesh(cabinGeo, glassMat));
        [0.62, -0.62].forEach(z => carBody.add(mesh(new THREE.BoxGeometry(0.06, 0.07, 0.36), std({ color: 0xe8f4ff, emissive: 0xbfe0ff, emissiveIntensity: 0.4 }), { position: V(2.4, 0.78, z) })));
        [0.62, -0.62].forEach(z => carBody.add(mesh(new THREE.BoxGeometry(0.05, 0.06, 0.4), std({ color: 0x8a1010, emissive: 0x6a0808, emissiveIntensity: 0.5 }), { position: V(-2.38, 0.86, z) })));
        registerPart('car', carBody, (t) => car.localToWorld(t.set(-0.6, 1.5 + carBody.position.y, 0)), (t) => car.localToWorld(t.set(0, 0.8, 0)));
        const CAR_LIFT = 1.6;

        const chassis = new THREE.Group();
        car.add(chassis);
        [[1.45, 0.83], [1.45, -0.83], [-1.45, 0.83], [-1.45, -0.83]].forEach(p => {
            const wheel = new THREE.Group();
            wheel.position.set(p[0], 0.36, p[1]);
            wheel.add(mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.24, 28), tyreMat, { rotation: E(Math.PI / 2, 0, 0) }));
            wheel.add(mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.25, 20), rimMat, { rotation: E(Math.PI / 2, 0, 0) }));
            chassis.add(wheel);
        });
        // Traction battery: flat pack with module grid
        const pack = new THREE.Group();
        pack.position.set(0, 0.36, 0);
        pack.add(mesh(new THREE.BoxGeometry(2.5, 0.14, 1.4), packMat));
        for (let i = 0; i < 6; i++) {
            for (let j = 0; j < 2; j++) {
                pack.add(mesh(new THREE.BoxGeometry(0.36, 0.05, 0.62), std({ color: 0x4fc3a1, emissive: 0x1f6b55, emissiveIntensity: 0.4, metalness: 0.3, roughness: 0.5 }), { position: V(-1.0 + i * 0.4, 0.09, j ? 0.34 : -0.34) }));
            }
        }
        chassis.add(pack);
        registerPart('evbattery', pack, (t) => car.localToWorld(t.set(-0.3, 0.55, -0.7)), (t) => car.localToWorld(t.set(0, 0.45, 0)));
        // Motor on the rear axle
        const motor = new THREE.Group();
        motor.position.set(-1.45, 0.42, 0);
        motor.add(mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.5, 24), std({ color: 0x8792a0, metalness: 0.8, roughness: 0.3 }), { rotation: E(Math.PI / 2, 0, 0) }));
        motor.add(mesh(new THREE.TorusGeometry(0.18, 0.025, 8, 32), copperMat, { position: V(0, 0, 0.2) }));
        motor.add(mesh(new THREE.TorusGeometry(0.18, 0.025, 8, 32), copperMat, { position: V(0, 0, -0.2) }));
        motor.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.5, 12), rimMat, { rotation: E(Math.PI / 2, 0, 0) }));
        chassis.add(motor);
        registerPart('motor', motor, (t) => car.localToWorld(t.set(-1.45, 0.65, 0)));
        // Onboard charger next to the charge port (front left)
        const obc = new THREE.Group();
        obc.position.set(1.55, 0.62, 0.35);
        obc.add(mesh(new THREE.BoxGeometry(0.4, 0.14, 0.32), std({ color: 0x5e6b7a, metalness: 0.6, roughness: 0.4 })));
        chassis.add(obc);
        registerPart('obc', obc, (t) => car.localToWorld(t.set(1.55, 0.72, 0.35)));
        const PORT_LOCAL = V(1.62, 0.84, CAR_W / 2 + 0.1);
        chassis.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.08, 16), darkMat, { position: PORT_LOCAL, rotation: E(Math.PI / 2, 0, 0) }));
        // HV cables (orange): port > charger > pack > motor
        const hvCurves = [
            [PORT_LOCAL, V(1.6, 0.75, 0.6), V(1.55, 0.62, 0.35)],
            [V(1.35, 0.6, 0.35), V(1.2, 0.5, 0.3), V(1.0, 0.45, 0.3)],
            [V(-1.0, 0.45, 0), V(-1.25, 0.45, 0), V(-1.45, 0.42, 0)]
        ].map(pts => new THREE.CatmullRomCurve3(pts));
        hvCurves.forEach(c => chassis.add(mesh(new THREE.TubeGeometry(c, 16, 0.025, 8, false), hvMat, { castShadow: false })));

        // --- Charging cable from wallbox to car port ---------------------
        scene.updateMatrixWorld(true);
        const portWorld = car.localToWorld(PORT_LOCAL.clone());
        const wbBottom = wallbox.localToWorld(V(0.1, -0.22, 0));
        const chargeCurve = new THREE.CatmullRomCurve3([
            wbBottom, V(wbBottom.x + 0.25, 0.45, wbBottom.z + 0.05), V((wbBottom.x + portWorld.x) / 2, 0.12, (wbBottom.z + portWorld.z) / 2 + 0.15),
            V(portWorld.x - 0.25, 0.45, portWorld.z), V(portWorld.x - 0.05, portWorld.y, portWorld.z)
        ]);
        const chargeCable = new THREE.Group();
        chargeCable.add(mesh(new THREE.TubeGeometry(chargeCurve, 48, 0.03, 8, false), cableMat));
        chargeCable.add(mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.16, 16), darkMat, { position: V(portWorld.x - 0.1, portWorld.y, portWorld.z), rotation: E(0, 0, Math.PI / 2) }));
        scene.add(chargeCable);
        registerPart('cable', chargeCable, (t) => chargeCurve.getPointAt(0.5, t).add(V(0, 0.05, 0)));

        // --- Grid connection: roof stand, overhead line, utility pole -------
        const pole = new THREE.Group();
        pole.position.set(11.5, 0, -3);
        pole.add(mesh(new THREE.CylinderGeometry(0.12, 0.16, 7.5, 12), std({ color: 0x6b5644, roughness: 0.9 }), { position: V(0, 3.75, 0) }));
        pole.add(mesh(new THREE.BoxGeometry(0.1, 0.1, 1.4), darkMat, { position: V(0, 7.1, 0) }));
        scene.add(pole);
        const roofStand = mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.4, 10), railMat, { position: V(HW / 2 - 0.4, RIDGE_Y - 0.4, -1.2) });
        house.add(roofStand);
        const poleTop = V(11.5, 7.1, -3);
        const standTop = V(HW / 2 - 0.4, RIDGE_Y + 0.28, -1.2);
        const lineCurve = new THREE.CatmullRomCurve3([standTop, V((standTop.x + poleTop.x) / 2, (standTop.y + poleTop.y) / 2 - 0.5, (standTop.z + poleTop.z) / 2), poleTop]);
        scene.add(mesh(new THREE.TubeGeometry(lineCurve, 24, 0.018, 6, false), cableMat, { castShadow: false }));

        // --- DC string cables (through the roof, down to the inverter) --------
        const dcStart = southRoof.localToWorld(V(colX(COLS - 1) + MOD_W / 2 + 0.05, 0.12, ROW_Z[0]));
        const dcCurve = new THREE.CatmullRomCurve3([
            dcStart, V(HW / 2 - 0.45, WALL_H + 0.6, dcStart.z - 0.2), V(EAST_IN - 0.02, WALL_H - 0.2, -0.6), V(EAST_IN - 0.02, 2.35, -1.2)
        ]);
        const dcGroup = new THREE.Group();
        dcGroup.add(mesh(new THREE.TubeGeometry(dcCurve, 40, 0.025, 8, false), dcCableMat, { castShadow: false }));
        house.add(dcGroup);
        registerPart('dc', dcGroup, (t) => dcCurve.getPointAt(0.55, t), (t) => dcCurve.getPointAt(0.5, t));

        // ===========================================================
        //  Energy flows (particles along the power paths)
        // ===========================================================
        const C = (pts) => new THREE.CatmullRomCurve3(pts);
        const at = (o, x, y, z) => o.localToWorld(V(x, y, z));
        const boardPt = at(board, -0.08, 0, 0);
        const flowDefs = {
            dc: { curve: dcCurve, color: 0xffd54f, count: 26, size: 0.13 },
            ac: { curve: C([at(inverter, -0.12, -0.38, 0), V(EAST_IN - 0.12, 1.15, -0.6), boardPt]), color: 0xffe082, count: 12, size: 0.11 },
            house: { curve: C([boardPt, V(3.2, 2.7, 0.3), V(0, 2.75, 0.6), V(-3.4, 2.4, 2.4)]), color: 0x64b5f6, count: 26, size: 0.12 },
            batt: { curve: C([boardPt, V(EAST_IN - 0.15, 0.6, -0.9), at(battery, -0.2, 0.2, 0)]), color: 0xb39ddb, count: 16, size: 0.11 },
            toWallbox: { curve: C([boardPt, V(EAST_IN + 0.06, 1.35, 1.4), at(wallbox, -0.05, 0, 0)]), color: 0x81c784, count: 16, size: 0.11 },
            charge: { curve: chargeCurve, color: 0x81c784, count: 20, size: 0.12 },
            inCar: { curve: C([portWorld, car.localToWorld(V(1.55, 0.7, 0.35)), car.localToWorld(V(1.0, 0.5, 0.3)), car.localToWorld(V(0, 0.48, 0))]), color: 0x81c784, count: 14, size: 0.11 },
            grid: { curve: C([boardPt, at(meter, 0, 0, 0), V(EAST_OUT + 0.05, 3.2, 0), V(HW / 2 - 0.4, RIDGE_Y + 0.28, -1.2), lineCurve.getPointAt(0.5), poleTop]), color: 0xffc107, count: 40, size: 0.13 }
        };
        const flows = {};
        Object.keys(flowDefs).forEach(k => {
            const d = flowDefs[k];
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(d.count * 3), 3));
            const mat = new THREE.PointsMaterial({ color: d.color, size: d.size, transparent: true, opacity: 0.95, depthWrite: false, sizeAttenuation: true });
            const pts = new THREE.Points(geo, mat);
            pts.frustumCulled = false;
            scene.add(pts);
            flows[k] = { pts: pts, curve: d.curve, count: d.count, phase: Math.random(), len: d.curve.getLength(), tmp: V(0, 0, 0) };
        });
        function driveFlow(f, powerKw, dt) {
            const visible = Math.abs(powerKw) > 0.04;
            f.pts.visible = visible;
            if (!visible) return;
            const speed = (0.6 + Math.min(Math.abs(powerKw), 11) * 0.35) / f.len;   // metres per second along the path
            f.phase = (f.phase + Math.sign(powerKw) * speed * dt * motionScale + 1) % 1;
            const arr = f.pts.geometry.attributes.position.array;
            for (let i = 0; i < f.count; i++) {
                f.curve.getPointAt((i / f.count + f.phase) % 1, f.tmp);
                arr[i * 3] = f.tmp.x;
                arr[i * 3 + 1] = f.tmp.y;
                arr[i * 3 + 2] = f.tmp.z;
            }
            f.pts.geometry.attributes.position.needsUpdate = true;
        }

        // Photons raining onto the array along the sun direction
        const PHOTONS = 90;
        const photonGeo = new THREE.BufferGeometry();
        photonGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PHOTONS * 3), 3));
        const photonMat = new THREE.PointsMaterial({ color: 0xfff1a8, size: 0.14, transparent: true, opacity: 0.9, depthWrite: false, sizeAttenuation: true });
        const photons = new THREE.Points(photonGeo, photonMat);
        photons.frustumCulled = false;
        scene.add(photons);
        const photonSeeds = Array.from({ length: PHOTONS }, () => ({ target: V(0, 0, 0), s: Math.random(), speed: 0.5 + Math.random() * 0.5 }));
        function respawnPhoton(p) {
            const k = Math.floor(Math.random() * COLS);
            const r = Math.floor(Math.random() * ROWS);
            southRoof.localToWorld(p.target.set(colX(k) + (Math.random() - 0.5) * MOD_W, ARRAY_Y + 0.03, ROW_Z[r] + (Math.random() - 0.5) * MOD_L));
            p.s = 0;
        }
        photonSeeds.forEach(p => { respawnPhoton(p); p.s = Math.random(); });

        // Sun disc, sun path arc, stars and clouds
        const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowTexture(), color: 0xffffff, transparent: true, depthWrite: false }));
        sunSprite.scale.set(7, 7, 1);
        scene.add(sunSprite);
        const SUN_DIST = 34;
        const pathMat = new THREE.LineDashedMaterial({ color: 0xffc107, dashSize: 0.8, gapSize: 0.6, transparent: true, opacity: 0.45 });
        let sunPath = null;
        function buildSunPath() {
            if (sunPath) { scene.remove(sunPath); sunPath.geometry.dispose(); }
            const pts = [];
            for (let h = 3; h <= 21; h += 0.25) {
                const s = sunPosition(h, SEASONS[ui.season].decl);
                if (s.y > -0.02) pts.push(V(s.x, s.y, s.z).multiplyScalar(SUN_DIST).add(SCENE_CENTER));
            }
            sunPath = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), pathMat);
            sunPath.computeLineDistances();
            scene.add(sunPath);
        }
        buildSunPath();

        const STARS = 160;
        const starGeo = new THREE.BufferGeometry();
        const starPos = new Float32Array(STARS * 3);
        for (let i = 0; i < STARS; i++) {
            const a = Math.random() * Math.PI * 2;
            const e = 0.15 + Math.random() * 1.3;
            starPos[i * 3] = Math.cos(a) * Math.cos(e) * 60 + 2;
            starPos[i * 3 + 1] = Math.sin(e) * 60;
            starPos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * 60;
        }
        starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
        const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.35, transparent: true, opacity: 0, depthWrite: false });
        scene.add(new THREE.Points(starGeo, starMat));

        const cloudMat = std({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0, depthWrite: false });
        const clouds = [];
        for (let i = 0; i < 6; i++) {
            const c = new THREE.Group();
            for (let j = 0; j < 5; j++) {
                const puff = new THREE.Mesh(new THREE.DodecahedronGeometry(1 + Math.random() * 0.9, 1), cloudMat);
                puff.position.set(j * 1.3 - 2.6, Math.random() * 0.6, (Math.random() - 0.5) * 1.4);
                c.add(puff);
            }
            c.position.set(-22 + i * 8 + Math.random() * 3, 13 + Math.random() * 3, -8 + Math.random() * 16);
            c.userData.speed = 0.5 + Math.random() * 0.5;
            clouds.push(c);
            scene.add(c);
        }

        // ===========================================================
        //  View state
        // ===========================================================
        const state = { xray: 0, xrayGoal: 0, explode: 0, explodeGoal: 0, shift: 0, active: false, skyClock: 0, hudClock: 0 };
        const cam = { theta: 0.62, phi: 1.2, radius: 27, target: V(2.4, 2.2, 0.6) };
        const goal = { theta: cam.theta, phi: cam.phi, radius: cam.radius, target: cam.target.clone() };
        const RADIUS_MIN = 2.5;
        const RADIUS_MAX = 55;
        let focusPart = null;

        function wrapAngle(a) {
            while (a > Math.PI) a -= Math.PI * 2;
            while (a < -Math.PI) a += Math.PI * 2;
            return a;
        }
        function viewFor(mode) {
            if (mode === 'inside') return { theta: -1.15, phi: 1.22, radius: 15, target: V(4.9, 1.2, -0.2) };
            if (mode === 'exploded') return { theta: 0.62, phi: 1.12, radius: 19, target: V(5.0, 3.6, 1.4) };
            return { theta: 0.62, phi: 1.2, radius: 27, target: V(2.4, 2.2, 0.6) };
        }
        function setView(v) {
            goal.theta = cam.theta + wrapAngle(v.theta - cam.theta);
            goal.phi = v.phi;
            goal.radius = v.radius;
            goal.target.copy(v.target);
            focusPart = null;
        }

        // ===========================================================
        //  Labels (same layout engine as the Windrad explorer)
        // ===========================================================
        const labelsRoot = el('sh-labels');
        const measureCtx = document.createElement('canvas').getContext('2d');
        function measureTag(text) {
            measureCtx.font = '600 11.52px Inter, "Segoe UI", sans-serif';
            return Math.ceil(measureCtx.measureText(text).width) + 24;
        }
        const labels = PART_IDS.map(id => {
            const p = partById[id];
            const node = document.createElement('button');
            node.type = 'button';
            node.className = 'wt-label wt-label-' + p.group + ' is-off';
            node.dataset.part = id;
            node.setAttribute('aria-label', p.num + '. ' + p.name + ': show details');
            const line = document.createElement('span');
            line.className = 'wt-line';
            const tag = document.createElement('span');
            tag.className = 'wt-tag';
            tag.textContent = p.name;
            const pin = document.createElement('span');
            pin.className = 'wt-pin';
            pin.textContent = String(p.num);
            node.appendChild(line);
            node.appendChild(tag);
            node.appendChild(pin);
            node.addEventListener('click', (e) => { e.stopPropagation(); stopTour(); select(id, { focus: true }); });
            node.addEventListener('mouseenter', () => setHover(id));
            node.addEventListener('mouseleave', () => setHover(null));
            if (labelsRoot) labelsRoot.appendChild(node);
            return { id: id, part: p, el: node, tag: tag, line: line, tw: measureTag(p.name), cand: -1, off: true, tagOn: true, ax: 0, ay: 0, dist: 0 };
        });
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(() => labels.forEach(L => { L.tw = measureTag(L.part.name); }));
        }
        function setHover(id) {
            if (ui.hover === id) return;
            ui.hover = id;
            labels.forEach(L => L.el.classList.toggle('is-hover', L.id === id));
        }
        function setOff(L, off) {
            if (L.off === off) return;
            L.off = off;
            L.el.classList.toggle('is-off', off);
        }
        function setTag(L, on) {
            if (L.tagOn === on) return;
            L.tagOn = on;
            L.el.classList.toggle('no-tag', !on);
        }
        const CANDS = [[18, -30], [18, 30], [-18, -30], [-18, 30], [28, -58], [-28, -58], [28, 58], [-28, 58], [34, 0], [-34, 0]];
        const TAG_H = 24;
        const uiRects = [];
        function overlaps(x, y, w, h, r) {
            return x < r[0] + r[2] + 3 && x + w + 3 > r[0] && y < r[1] + r[3] + 3 && y + h + 3 > r[1];
        }
        const tmpV = V(0, 0, 0);
        function labelVisible(p) {
            if (p.exploded) return state.explode > 0.5;
            if (p.group === 'interior') return state.xray > 0.3;
            return true;
        }
        function layoutLabels(w, h, infoTop) {
            if (!ui.labels) return;
            const narrow = w < 440;
            const compactExterior = state.xray > 0.5;
            const vis = [];
            labels.forEach(L => {
                const p = L.part;
                if (!labelVisible(p)) { setOff(L, true); return; }
                p.anchor(tmpV);
                L.dist = tmpV.distanceTo(camera.position);
                tmpV.project(camera);
                if (tmpV.z > 1 || Math.abs(tmpV.x) > 1.02 || Math.abs(tmpV.y) > 1.02) { setOff(L, true); return; }
                L.ax = (tmpV.x * 0.5 + 0.5) * w;
                L.ay = (-tmpV.y * 0.5 + 0.5) * h;
                if (L.ay > infoTop) { setOff(L, true); return; }
                setOff(L, false);
                vis.push(L);
            });
            const obstacles = uiRects.slice();
            if (infoTop < h) obstacles.push([0, infoTop, w, h - infoTop]);
            const pins = vis.map(L => [L.ax - 11, L.ay - 11, 22, 22, L]);
            const rank = (L) => (L.id === ui.selected ? 0 : L.id === ui.hover ? 1 : 2) * 100 +
                (compactExterior && L.part.group === 'exterior' ? 50 : 0) + L.part.num;
            vis.sort((a, b) => rank(a) - rank(b));
            const placed = [];
            vis.forEach(L => {
                L.el.style.transform = 'translate(' + L.ax.toFixed(1) + 'px,' + L.ay.toFixed(1) + 'px)';
                L.el.style.zIndex = String(Math.max(1, Math.round(1000 - L.dist * 10)));
                const pinned = L.id === ui.selected || L.id === ui.hover;
                const wantTag = pinned || (!narrow && !(compactExterior && L.part.group === 'exterior'));
                if (!wantTag) { setTag(L, false); return; }
                const tw = L.tw;
                let chosen = -1;
                let rx = 0;
                let ry = 0;
                const tryOrder = L.cand >= 0 ? [L.cand] : [];
                for (let i = 0; i < CANDS.length; i++) if (i !== L.cand) tryOrder.push(i);
                for (let n = 0; n < tryOrder.length && chosen < 0; n++) {
                    const c = CANDS[tryOrder[n]];
                    const x = c[0] >= 0 ? L.ax + c[0] : L.ax + c[0] - tw;
                    const y = L.ay + c[1] - TAG_H / 2;
                    if (x < 4 || y < 4 || x + tw > w - 4 || y + TAG_H > h - 4) continue;
                    let blocked = false;
                    for (let j = 0; j < placed.length && !blocked; j++) blocked = overlaps(x, y, tw, TAG_H, placed[j]);
                    for (let j = 0; j < obstacles.length && !blocked; j++) blocked = overlaps(x, y, tw, TAG_H, obstacles[j]);
                    for (let j = 0; j < pins.length && !blocked; j++) blocked = pins[j][4] !== L && overlaps(x, y, tw, TAG_H, pins[j]);
                    if (!blocked) { chosen = tryOrder[n]; rx = x; ry = y; }
                }
                if (chosen < 0) { setTag(L, false); L.cand = -1; return; }
                L.cand = chosen;
                placed.push([rx, ry, tw, TAG_H]);
                setTag(L, true);
                const tx = rx - L.ax;
                const ty = ry - L.ay;
                L.tag.style.transform = 'translate(' + tx.toFixed(1) + 'px,' + ty.toFixed(1) + 'px)';
                const ex = rx >= L.ax ? tx : tx + tw;
                const ey = ty + TAG_H / 2;
                L.line.style.width = Math.max(0, Math.hypot(ex, ey) - 11).toFixed(1) + 'px';
                L.line.style.transform = 'rotate(' + Math.atan2(ey, ex).toFixed(4) + 'rad) translateX(11px)';
            });
        }

        // ===========================================================
        //  Selection highlight
        // ===========================================================
        const highlightCache = [];
        function clearHighlight() {
            highlightCache.forEach(e => {
                const m = e.mesh.material;
                if (Array.isArray(m)) m.forEach(x => x.dispose()); else m.dispose();
                e.mesh.material = e.mat;
            });
            highlightCache.length = 0;
        }
        function tint(mat, color) {
            const m = mat.clone();
            if (m.emissive) {                          // basic materials have no emissive uniform
                m.emissive = new THREE.Color(color);
                m.emissiveIntensity = 0.22;
            }
            return m;
        }
        function highlight(part) {
            clearHighlight();
            if (part.tint === false) return;            // keep the cell's n/p colours readable
            const color = part.group === 'interior' ? 0xffb300 : 0x4caf50;
            part.object.traverse(o => {
                if (!o.isMesh) return;
                let owner = o;
                while (owner && !owner.userData.partId) owner = owner.parent;
                if (!owner || owner.userData.partId !== part.id) return;
                highlightCache.push({ mesh: o, mat: o.material });
                o.material = Array.isArray(o.material) ? o.material.map(m => tint(m, color)) : tint(o.material, color);
            });
        }

        // ===========================================================
        //  Interaction
        // ===========================================================
        const pointer = { x: 0, y: 0, tx: 0, ty: 0, cx: 0, cy: 0, pending: false };
        const raycaster = new THREE.Raycaster();
        const ndc = new THREE.Vector2();
        const SHELLS = { house: true, car: true };
        const pickables = parts.map(p => p.object);
        let drag = null;

        function pickAt(clientX, clientY) {
            const rect = canvas.getBoundingClientRect();
            ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
            raycaster.setFromCamera(ndc, camera);
            const hits = raycaster.intersectObjects(pickables, true);
            let shellHit = null;
            for (let i = 0; i < hits.length; i++) {
                const obj = hits[i].object;
                if (!obj.isMesh) continue;
                let o = obj;
                let shown = true;
                while (o) { if (!o.visible) { shown = false; break; } o = o.parent; }
                if (!shown) continue;
                o = obj;
                while (o && !o.userData.partId) o = o.parent;
                if (!o) continue;
                let id = o.userData.partId;
                if (PART_INFO[id].exploded && state.explode < 0.5) id = 'pv';
                if (SHELLS[id] && state.xray > 0.5) { if (!shellHit) shellHit = id; continue; }
                return id;
            }
            return shellHit;
        }

        canvas.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            state.active = true;
            stage.classList.add('is-active', 'has-interacted');
            drag = { x: e.clientX, y: e.clientY, moved: 0, theta: cam.theta, phi: cam.phi };
            try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
            canvas.style.cursor = 'grabbing';
        });
        canvas.addEventListener('pointermove', (e) => {
            if (drag) {
                const dx = e.clientX - drag.x;
                const dy = e.clientY - drag.y;
                drag.moved = Math.max(drag.moved, Math.abs(dx) + Math.abs(dy));
                if (drag.moved > 4) stopTour();
                goal.theta = cam.theta = drag.theta - dx * 0.006;
                goal.phi = cam.phi = clamp(drag.phi - dy * 0.004, 0.25, 1.52);
                return;
            }
            const rect = canvas.getBoundingClientRect();
            if (!reduceMotion) {
                pointer.tx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                pointer.ty = ((e.clientY - rect.top) / rect.height) * 2 - 1;
            }
            pointer.cx = e.clientX;
            pointer.cy = e.clientY;
            pointer.pending = true;
        }, { passive: true });
        canvas.addEventListener('pointerup', (e) => {
            if (!drag) return;
            const wasClick = drag.moved < 5;
            drag = null;
            canvas.style.cursor = 'grab';
            if (wasClick) {
                stopTour();
                select(pickAt(e.clientX, e.clientY), { focus: true });
            }
        });
        canvas.addEventListener('pointercancel', () => { drag = null; canvas.style.cursor = 'grab'; });
        stage.addEventListener('pointerleave', () => {
            pointer.tx = 0;
            pointer.ty = 0;
            state.active = false;
            stage.classList.remove('is-active');
            setHover(null);
        });
        stage.addEventListener('wheel', (e) => {
            if (!state.active) return;
            e.preventDefault();
            stopTour();
            zoomBy(Math.pow(1.0015, e.deltaY));
        }, { passive: false });
        canvas.addEventListener('keydown', (e) => {
            const k = e.key;
            if (k === '+' || k === '=') zoomBy(0.8);
            else if (k === '-' || k === '_') zoomBy(1.25);
            else if (k === 'ArrowLeft') goal.theta -= 0.15;
            else if (k === 'ArrowRight') goal.theta += 0.15;
            else if (k === 'ArrowUp') goal.phi = Math.max(0.25, goal.phi - 0.1);
            else if (k === 'ArrowDown') goal.phi = Math.min(1.52, goal.phi + 0.1);
            else if (k === 'Escape') select(null);
            else return;
            e.preventDefault();
            stopTour();
        });
        function zoomBy(factor) {
            goal.radius = clamp(goal.radius * factor, RADIUS_MIN, RADIUS_MAX);
        }

        // ===========================================================
        //  Sizing
        // ===========================================================
        const size = { w: 1, h: 1 };
        let radiusScale = 1;
        function measureUi() {
            uiRects.length = 0;
            const s = stage.getBoundingClientRect();
            ['.wt-modes', '.wt-tools', '.wt-hint', '.sh-clock'].forEach(sel => {
                const n = stage.querySelector(sel);
                if (!n) return;
                const r = n.getBoundingClientRect();
                if (r.width) uiRects.push([r.left - s.left, r.top - s.top, r.width, r.height]);
            });
        }
        function resize() {
            size.w = stage.clientWidth || 1;
            size.h = stage.clientHeight || 1;
            renderer.setSize(size.w, size.h, false);
            camera.aspect = size.w / size.h;
            camera.updateProjectionMatrix();
            radiusScale = 1 + clamp(1.1 - camera.aspect, 0, 0.6) * 0.55;
            measureUi();
        }
        if ('ResizeObserver' in window) new ResizeObserver(resize).observe(stage);
        else window.addEventListener('resize', resize);

        // ===========================================================
        //  Sky colours follow the sun
        // ===========================================================
        const SKY = {
            night: ['#060b16', '#0e1a2c'],
            dusk: ['#24224a', '#a8583a'],
            day: ['#1d4f7a', '#5b93bd']
        };
        const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
        const mix = (a, b, t) => { const A = hex(a); const B = hex(b); return 'rgb(' + A.map((v, i) => Math.round(lerp(v, B[i], t))).join(',') + ')'; };
        function skyColors(elDeg, cloud) {
            let top;
            let bottom;
            if (elDeg < -6) { top = SKY.night[0]; bottom = SKY.night[1]; }
            else if (elDeg < 4) { const t = (elDeg + 6) / 10; top = mix(SKY.night[0], SKY.dusk[0], t); bottom = mix(SKY.night[1], SKY.dusk[1], t); }
            else if (elDeg < 18) { const t = (elDeg - 4) / 14; top = mix(SKY.dusk[0], SKY.day[0], t); bottom = mix(SKY.dusk[1], SKY.day[1], t); }
            else { top = SKY.day[0]; bottom = SKY.day[1]; }
            if (cloud > 0.05 && elDeg > 0) {
                const grey = '#5a6672';
                const toHex = (rgb) => '#' + rgb.match(/\d+/g).map(n => Number(n).toString(16).padStart(2, '0')).join('');
                top = mix(top.startsWith('#') ? top : toHex(top), grey, cloud * 0.6);
                bottom = mix(bottom.startsWith('#') ? bottom : toHex(bottom), grey, cloud * 0.6);
            }
            return [top, bottom];
        }

        // ===========================================================
        //  Frame update
        // ===========================================================
        const clock = new THREE.Clock();
        let running = false;
        let visible = true;
        let rafId = 0;
        const focusTmp = V(0, 0, 0);
        const sunVec = V(0, 1, 0);
        const sunCol = new THREE.Color();

        function render(dt) {
            const t = clock.elapsedTime;
            const k = 1 - Math.exp(-dt * 4.5);
            const w = size.w;
            const h = size.h;
            const infoOverlay = !!(ui.selected && info.root && !info.root.hidden && !mqStaticInfo.matches);
            const infoH = infoOverlay ? info.root.offsetHeight : 0;
            const infoTop = infoOverlay ? h - infoH - 12 : h;

            if (pointer.pending && !drag) {
                pointer.pending = false;
                const id = pickAt(pointer.cx, pointer.cy);
                setHover(id);
                canvas.style.cursor = id ? 'pointer' : 'grab';
            }

            // --- Physics snapshot -----------------------------------
            const b = energyBalance(ui);
            const sun = b.sun;
            const elDeg = sun.el / DEG;
            const daylight = clamp((elDeg + 4) / 14, 0, 1);             // 0 night, 1 full day
            const darkness = 1 - daylight;
            sunVec.set(sun.x, sun.y, sun.z);

            // Sun light, sprite and sky
            sunLight.position.copy(sunVec).multiplyScalar(40).add(SCENE_CENTER);
            const beam = sun.y > 0 ? (b.irr.dni * Math.max(sun.y, 0.05)) / 900 : 0;
            sunLight.intensity = clamp(beam, 0, 1.3) * 1.25;
            sunLight.castShadow = sun.y > 0.03;
            sunCol.setHSL(lerp(0.07, 0.12, clamp(elDeg / 30, 0, 1)), 0.9, lerp(0.62, 0.92, clamp(elDeg / 30, 0, 1)));
            sunLight.color.copy(sunCol);
            hemi.intensity = 0.12 + daylight * (0.45 - ui.cloud * 0.1);
            moonLight.intensity = darkness * 0.25;
            sunSprite.visible = elDeg > -3;
            sunSprite.position.copy(sunVec).multiplyScalar(SUN_DIST).add(SCENE_CENTER);
            sunSprite.material.opacity = clamp((elDeg + 3) / 6, 0, 1) * (1 - ui.cloud * 0.7);
            sunSprite.material.color.copy(sunCol);
            pathMat.opacity = 0.2 + daylight * 0.3;
            starMat.opacity = clamp(darkness * 1.2 - 0.2, 0, 0.9);
            cloudMat.opacity = ui.cloud * 0.8;
            clouds.forEach(c => {
                c.visible = ui.cloud > 0.02;
                c.position.x += c.userData.speed * dt * motionScale * (0.4 + ui.cloud);
                if (c.position.x > 26) c.position.x = -24;
            });
            state.skyClock += dt;
            if (state.skyClock > 0.2) {
                state.skyClock = 0;
                const sky = skyColors(elDeg, ui.cloud);
                stage.style.setProperty('--sky-top', sky[0]);
                stage.style.setProperty('--sky-bottom', sky[1]);
            }

            // Photons onto the modules
            const photonRate = b.irr.poa / 1000;
            photons.visible = photonRate > 0.02;
            if (photons.visible) {
                photonMat.opacity = clamp(0.35 + photonRate * 0.65, 0, 1);
                const arr = photonGeo.attributes.position.array;
                const L = 9;
                photonSeeds.forEach((p, i) => {
                    p.s += dt * p.speed * 0.9 * motionScale;
                    if (p.s >= 1) respawnPhoton(p);
                    const d = (1 - p.s) * L;
                    arr[i * 3] = p.target.x + sun.x * d;
                    arr[i * 3 + 1] = p.target.y + sun.y * d;
                    arr[i * 3 + 2] = p.target.z + sun.z * d;
                });
                photonGeo.attributes.position.needsUpdate = true;
            }

            // Device indicators
            windowMat.emissiveIntensity = darkness * (0.35 + b.house * 0.35);
            screenMat.emissiveIntensity = b.pv > 0.05 ? 0.9 : 0.15;
            const charging = b.car > 0.05;
            const pulse = 0.75 + Math.sin(t * 4) * 0.25 * motionScale;
            wbLedMat.color.setHex(charging ? 0x4caf50 : ui.socCar >= 99.9 ? 0x4caf50 : 0x42a5f5);
            wbLedMat.emissive.setHex(charging ? 0x4caf50 : ui.socCar >= 99.9 ? 0x4caf50 : 0x42a5f5);
            wbLedMat.emissiveIntensity = charging ? pulse * 1.4 : 0.6;
            const lit = Math.ceil(ui.socBatt / 20 - 0.001);
            battLeds.forEach((led, i) => { led.material = i < lit ? battLedOn : battLedOff; });
            battLedOn.emissiveIntensity = Math.abs(b.batt) > 0.05 ? 0.8 + Math.sin(t * 3) * 0.4 * motionScale : 0.9;

            // Energy flows
            driveFlow(flows.dc, b.pvDc, dt);
            driveFlow(flows.ac, b.pv, dt);
            driveFlow(flows.house, b.house, dt);
            driveFlow(flows.batt, b.batt, dt);
            driveFlow(flows.toWallbox, b.car, dt);
            driveFlow(flows.charge, b.car, dt);
            driveFlow(flows.inCar, b.car, dt);
            driveFlow(flows.grid, -b.grid, dt);
            flows.grid.pts.material.color.setHex(b.grid > 0 ? 0xef5350 : 0xffc107);
            flows.inCar.pts.visible = flows.inCar.pts.visible && state.xray > 0.3;

            // --- View modes -------------------------------------------
            state.xray += (state.xrayGoal - state.xray) * k;
            state.explode += (state.explodeGoal - state.explode) * k;
            const x = state.xray;
            xrayMats.forEach(m => {
                m.transparent = x > 0.01;
                m.depthWrite = x < 0.5;
            });
            wallMat.opacity = lerp(1, 0.14, x);
            roofMat.opacity = lerp(1, 0.18, x);
            carMat.opacity = lerp(1, 0.16, x);
            glassMat.opacity = lerp(0.85, 0.2, x);
            arrayFrameMat.opacity = arrayCellMat.opacity = arrayBackMat.opacity = mountMat.opacity = lerp(1, 0.16, x);
            house.traverse(o => { if (o.isMesh && (o.material === wallMat || o.material === roofMat)) o.castShadow = x < 0.5; });
            const ex = state.explode;
            xMod.position.copy(X_MOD_BASE).y += ex * X_MOD_LIFT;
            layers.forEach(m => { m.position.y = lerp(m.userData.layer.a, m.userData.layer.b, ex); });
            cellX.visible = ex > 0.02;
            cellX.scale.setScalar(Math.max(0.001, ex));
            carBody.position.y = ex * CAR_LIFT;

            // Cell cross-section carriers
            if (cellX.visible) {
                const anim = dt * motionScale * (0.25 + photonRate);
                [[electrons, 1], [holes, -1], [cellPhotons, 0]].forEach(pair => {
                    const pts = pair[0];
                    const dir = pair[1];
                    const arr = pts.geometry.attributes.position.array;
                    pts.userData.seeds.forEach((s, i) => {
                        s.p = (s.p + anim * s.s) % 1;
                        let y;
                        if (dir === 1) y = lerp(P_T * 0.75, P_T + N_T, s.p);          // electrons rise to the front contact
                        else if (dir === -1) y = lerp(P_T * 0.95, 0.02, s.p);          // holes sink to the back contact
                        else y = lerp(P_T + N_T + 1.2, P_T * 0.8, s.p);                // photons arrive from above
                        arr[i * 3] = s.x;
                        arr[i * 3 + 1] = y;
                        arr[i * 3 + 2] = s.z;
                    });
                    pts.geometry.attributes.position.needsUpdate = true;
                    pts.visible = photonRate > 0.02;
                });
            }

            // Highlight follows the x-ray fade of the original materials
            const glow = 0.22 + Math.sin(t * 4) * 0.08 * motionScale;
            highlightCache.forEach(e => {
                const src = Array.isArray(e.mat) ? e.mat : [e.mat];
                const dst = Array.isArray(e.mesh.material) ? e.mesh.material : [e.mesh.material];
                dst.forEach((m, i) => {
                    m.opacity = src[i].opacity;
                    m.transparent = src[i].transparent;
                    m.depthWrite = src[i].depthWrite;
                    if (m.emissive) m.emissiveIntensity = glow;
                });
            });

            // --- Camera ------------------------------------------------
            if (focusPart) goal.target.copy(focusPart.center(focusTmp));
            if (!drag) {
                cam.theta += (goal.theta - cam.theta) * k;
                cam.phi += (goal.phi - cam.phi) * k;
            }
            cam.radius += (goal.radius - cam.radius) * k;
            cam.target.lerp(goal.target, k);
            pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 4);
            pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 4);
            const theta = cam.theta + pointer.x * 0.04;
            const phi = clamp(cam.phi - pointer.y * 0.02, 0.2, 1.54);
            const r = cam.radius * radiusScale;
            camera.position.set(r * Math.sin(phi) * Math.sin(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.cos(theta)).add(cam.target);
            camera.lookAt(cam.target);
            const shiftGoal = infoOverlay ? clamp((infoH + 12) / h * 0.5, 0, 0.24) : 0;
            state.shift += (shiftGoal - state.shift) * k;
            if (state.shift > 0.002) camera.setViewOffset(w, h, 0, state.shift * h, w, h);
            else if (camera.view && camera.view.enabled) camera.clearViewOffset();

            renderer.render(scene, camera);
            layoutLabels(w, h, infoTop);
        }

        function loop() {
            if (!running) return;
            rafId = requestAnimationFrame(loop);
            render(Math.min(clock.getDelta(), 0.05));
        }
        function start() { if (running) return; running = true; clock.getDelta(); loop(); }
        function stop() { running = false; cancelAnimationFrame(rafId); }
        function updateRunState() { if (visible && !document.hidden) start(); else stop(); }
        if ('IntersectionObserver' in window) {
            new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; /* newest entry wins when several are batched */ updateRunState(); }, { threshold: 0.05 }).observe(stage);
        }
        document.addEventListener('visibilitychange', updateRunState);
        canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); stop(); showFallback(); });

        // ===========================================================
        //  Hooks for the UI layer
        // ===========================================================
        viewer = {
            setMode(mode, moveCamera) {
                state.xrayGoal = mode === 'exterior' ? 0 : 1;
                state.explodeGoal = mode === 'exploded' ? 1 : 0;
                if (moveCamera) setView(viewFor(mode));
            },
            select(id, focusCamera) {
                if (!id) { clearHighlight(); focusPart = null; return; }
                const p = partById[id];
                highlight(p);
                if (focusCamera) {
                    focusPart = p;
                    goal.radius = p.focus;
                    goal.theta = cam.theta + wrapAngle(p.view[0] - cam.theta);
                    goal.phi = p.view[1];
                }
            },
            zoomBy: zoomBy,
            seasonChanged: buildSunPath
        };

        resize();
        const startView = viewFor(ui.mode);
        cam.theta = goal.theta = startView.theta;
        cam.phi = goal.phi = startView.phi;
        cam.radius = goal.radius = startView.radius;
        cam.target.copy(startView.target);
        goal.target.copy(startView.target);
        viewer.setMode(ui.mode, false);
        state.xray = state.xrayGoal;
        state.explode = state.explodeGoal;
        if (ui.selected) select(ui.selected, { focus: true });
        clock.start();
        render(0.016);
        stage.classList.add('is-ready');
        updateRunState();
    }
})();
