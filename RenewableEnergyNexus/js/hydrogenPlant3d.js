/* ============================================================
   Interactive 3D green hydrogen explorer
   Wind farm + solar park > substation > 10 MW PEM electrolyser
   > separators > deoxo/dryer > compressor > 300 bar storage > trailer
   Built procedurally with Three.js, no model files needed.

   - Numbered component labels with leader lines + legend
   - Orbit (drag), zoom (buttons / keyboard / wheel after a click)
   - View modes: Exterior, Inside (x-ray) and Exploded
     (a stack fans out into its plates, a membrane-electrode cross-
     section shows water splitting, proton transport and gas release)
   - Live physics: wind power curve, PV output, polarisation curve
     U = U0 + R*j, Faraday's law for H2, efficiency, heat, water, O2
   - Storage level integrates production minus trailer offtake
   - Physics panel, legend and tour still work without WebGL
   - Builds lazily near the viewport, pauses off-screen,
     honours prefers-reduced-motion
   ============================================================ */
(function () {
    'use strict';

    const canvas = document.getElementById('h2-canvas');
    if (!canvas) return;

    const stage = canvas.parentElement;                 // .hero-visual
    const hero = stage.closest('.hero') || document.body;
    const $ = (sel) => hero.querySelector(sel);
    const $$ = (sel) => Array.prototype.slice.call(hero.querySelectorAll(sel));
    const lerp = (a, b, t) => a + (b - a) * t;
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

    // ============================================================
    //  The modelled plant
    // ============================================================
    const SPEC = {
        turbines: 3, turbineMw: 4.2, cutIn: 3, ratedWind: 12, cutOut: 25,
        solarMwp: 10, solarPr: 0.85,
        elRatedMw: 10, minLoad: 0.1,
        cells: 800,                 // 4 stacks x 200 cells, electrically in series per stack
        cellAreaCm2: 3000,
        u0: 1.45,                   // V, cell voltage extrapolated to zero current (incl. activation)
        rArea: 0.25,                // V per (A/cm2), area-specific resistance incl. transport losses
        jMax: 2.0,                  // A/cm2 at rated load
        rectEff: 0.97,
        bopMw: 0.4,                 // pumps, cooling, controls at full load
        faradayEff: 0.99,
        F: 96485,                   // C/mol
        lhv: 33.33,                 // kWh/kg
        storageKg: 1500,            // at 300 bar
        offtakeKgH: 120             // trailer collections averaged over the day
    };
    const N_A = SPEC.cells * SPEC.cellAreaCm2;

    function windFarmMw(v) {
        let p = 0;
        if (v >= SPEC.cutIn && v < SPEC.cutOut) {
            p = v >= SPEC.ratedWind ? SPEC.turbineMw
                : SPEC.turbineMw * (Math.pow(v, 3) - Math.pow(SPEC.cutIn, 3)) / (Math.pow(SPEC.ratedWind, 3) - Math.pow(SPEC.cutIn, 3));
        }
        return p * SPEC.turbines;
    }
    function rotorRpm(v) {
        if (v < SPEC.cutIn || v >= SPEC.cutOut) return v < SPEC.cutIn ? v * 0.6 : 0;
        return 12 * Math.min(v, SPEC.ratedWind) / SPEC.ratedWind;
    }

    /** Operating point of the whole plant. */
    function plantBalance(s) {
        const wind = windFarmMw(s.wind);
        const solar = SPEC.solarMwp * s.sun / 1000 * SPEC.solarPr;
        const renew = wind + solar;
        let pIn;
        if (s.plantMode === 'grid') pIn = SPEC.elRatedMw;
        else pIn = Math.min(renew, SPEC.elRatedMw);
        if (pIn < SPEC.minLoad * SPEC.elRatedMw) pIn = 0;           // standby below minimum load
        const imported = Math.max(0, pIn - renew);
        const exported = Math.max(0, renew - pIn);
        const load = pIn / SPEC.elRatedMw;
        const bop = pIn > 0 ? SPEC.bopMw * (0.3 + 0.7 * load) : 0;
        const pDc = Math.max(0, (pIn - bop) * SPEC.rectEff);         // MW
        // Solve P_dc = N*A*j*(U0 + R*j) for the current density j
        const a = SPEC.rArea * N_A;
        const b = SPEC.u0 * N_A;
        const j = pDc > 0 ? clamp((-b + Math.sqrt(b * b + 4 * a * pDc * 1e6)) / (2 * a), 0, SPEC.jMax) : 0;
        const uCell = j > 0 ? SPEC.u0 + SPEC.rArea * j : 0;
        const current = j * SPEC.cellAreaCm2;                         // A through each series cell
        const molS = SPEC.cells * current * SPEC.faradayEff / (2 * SPEC.F);
        const h2KgH = molS * 2.016e-3 * 3600;
        const h2Mw = h2KgH * SPEC.lhv / 1000;
        const heatMw = j > 0 ? Math.max(0, SPEC.cells * current * (uCell - 1.48) / 1e6) : 0;
        return {
            wind: wind, solar: solar, renew: renew, pIn: pIn, load: load, bop: bop, pDc: pDc,
            j: j, uCell: uCell, current: current, h2KgH: h2KgH, h2Mw: h2Mw, heatMw: heatMw,
            effLhv: pIn > 0 ? h2Mw / pIn : 0, sec: h2KgH > 0 ? pIn * 1000 / h2KgH : 0,
            waterLH: h2KgH * 8.94, o2KgH: h2KgH * 7.94,
            imported: imported, exported: exported,
            green: pIn > 0 ? (pIn - imported) / pIn : 1
        };
    }

    // ============================================================
    //  Component descriptions
    // ============================================================
    const PART_INFO = {
        wind: {
            num: 1, name: 'Wind farm', group: 'exterior', focus: 46, view: [0.25, 1.3],
            desc: 'Three 4.2 MW turbines, 12.6 MW in total. Between cut-in (3 m/s) and rated speed (12 m/s) the output rises roughly with the cube of the wind speed; above that, blade pitch holds it constant until storm cut-out at 25 m/s. Wind is often strongest at night and in winter, which complements solar.'
        },
        solar: {
            num: 2, name: 'Solar park', group: 'exterior', focus: 30, view: [0.2, 1.0],
            desc: 'A 10 MWp ground-mounted solar park tilted 25° south. Output follows the sunlight: P ≈ G / 1000 W/m² × 10 MWp × 0.85 performance ratio. Central inverters feed the plant’s medium-voltage network.'
        },
        substation: {
            num: 3, name: 'Substation & grid link', group: 'exterior', focus: 15, view: [0.75, 1.15],
            desc: 'Collects wind and solar power at medium voltage and connects the plant to the public grid. Surplus power is exported. In grid top-up mode the missing power is imported, which lowers the green share of the hydrogen.'
        },
        hall: {
            num: 4, name: 'Electrolysis hall', group: 'exterior', focus: 28, view: [0.45, 1.15],
            desc: 'Houses the 10 MW PEM electrolyser: four stacks with their power electronics, water treatment, separators and gas cleaning. Plants like this are built from modules, so capacity can grow in steps. Switch to Inside to see the process.'
        },
        cooler: {
            num: 5, name: 'Dry coolers', group: 'exterior', focus: 14, view: [0.5, 0.85],
            desc: 'Above the thermoneutral voltage of 1.48 V, every cell turns the extra voltage into heat: P_heat = I · (U_cell − 1.48 V). The stacks run at about 60–80 °C, and these fans reject the surplus heat to air. The heat could instead supply a district heating network.'
        },
        vent: {
            num: 6, name: 'Oxygen vent', group: 'exterior', focus: 14, view: [0.6, 1.2],
            desc: 'Splitting water gives one O₂ molecule for every two H₂, which is 8 kg of oxygen per kilogram of hydrogen. Here it is vented safely above the roof. It could also be sold to hospitals, steelworks or wastewater plants.'
        },
        water: {
            num: 7, name: 'Water supply tank', group: 'exterior', focus: 13, view: [0.4, 1.25],
            desc: 'By stoichiometry, electrolysis consumes 8.94 litres of water per kilogram of hydrogen, and about 10–15 litres including treatment losses. A 10 MW plant at full load needs roughly 2 m³ an hour, far less than a power station’s cooling water.'
        },
        storage: {
            num: 8, name: 'Hydrogen storage (300 bar)', group: 'exterior', focus: 17, view: [0.9, 1.2],
            desc: 'Hydrogen is stored compressed at about 300 bar. It holds 33.3 kWh per kilogram, almost three times more than petrol, but very little energy per litre at normal pressure. That is why it is compressed, liquefied or converted to ammonia or methanol for transport.'
        },
        trailer: {
            num: 9, name: 'Tube trailer', group: 'exterior', focus: 18, view: [0.6, 1.25],
            desc: 'A tube trailer carries about 1,000 kg of hydrogen at 300–500 bar to filling stations or industry. Larger plants feed pipelines. Green hydrogen can replace fossil fuels in steelmaking, ammonia fertiliser, refineries, heavy transport and seasonal energy storage.'
        },
        rectifier: {
            num: 10, name: 'Transformer-rectifiers', group: 'interior', focus: 9, view: [0.3, 0.95],
            desc: 'Electrolysis needs direct current. Transformer-rectifiers convert the medium-voltage AC into several thousand amperes of DC. By setting the current they set the hydrogen output, within seconds, so the plant can follow fluctuating wind and solar power.'
        },
        treatment: {
            num: 11, name: 'Water treatment (RO + DI)', group: 'interior', focus: 8, view: [0.2, 1.0],
            desc: 'The stacks need ultrapure water with a conductivity below 1 µS/cm, because dissolved ions poison the membrane and catalysts. Reverse osmosis removes most of the salts, then ion-exchange deionisation polishes the water.'
        },
        stack: {
            num: 12, name: 'PEM electrolyser stacks', group: 'interior', focus: 10, view: [0.35, 1.0],
            desc: 'Four stacks of 200 cells, each cell with 3,000 cm² of active area. A voltage of 1.5–2.0 V per cell splits water. By Faraday’s law each cell produces I / (2F) moles of hydrogen per second, so the output follows the current. Higher current density needs a higher cell voltage, which lowers efficiency. The plates glow brighter in the model as the current rises.'
        },
        separator: {
            num: 13, name: 'Gas–liquid separators', group: 'interior', focus: 8, view: [0.6, 1.05],
            desc: 'Water leaves the stacks full of gas bubbles. In the separators the gas rises out, and the water is cooled, polished and pumped back. Hydrogen (blue) and oxygen (red) circuits stay strictly apart, because hydrogen in oxygen is explosive above about 4%.'
        },
        dryer: {
            num: 14, name: 'Deoxidiser & dryer', group: 'interior', focus: 8, view: [0.75, 1.05],
            desc: 'Raw hydrogen is saturated with water and holds traces of oxygen. A catalytic deoxidiser turns the oxygen into water (2H₂ + O₂ → 2H₂O), and twin adsorption columns take turns drying the gas. The result is 99.999% (grade 5.0) hydrogen, pure enough for fuel cells.'
        },
        compressor: {
            num: 15, name: 'Compressor', group: 'interior', focus: 9, view: [1.0, 1.1],
            desc: 'A diaphragm or piston compressor raises the pressure from about 30 bar at the stack outlet to 300 bar for storage. Compression takes roughly 2–3 kWh per kilogram, about 5–8% of the energy stored in the hydrogen.'
        },
        mea: {
            num: 16, name: 'PEM cell: inside the membrane', group: 'interior', exploded: true, tint: false, isolate: true, focus: 15, view: [0.12, 1.4],
            desc: 'At the anode, an iridium-oxide catalyst splits water: 2H₂O → O₂ + 4H⁺ + 4e⁻. Only protons (H⁺) can cross the 0.1 mm Nafion membrane, while the electrons go round the external DC circuit. At the platinum cathode they recombine: 4H⁺ + 4e⁻ → 2H₂. The minimum voltage is 1.23 V, but real cells need 1.6–2.0 V to overcome activation, resistive and transport losses.'
        },
        stacklayers: {
            num: 17, name: 'Stack layers', group: 'interior', exploded: true, focus: 12, view: [0.3, 1.25],
            desc: 'A stack is a sandwich: thick end plates clamped together by tie rods, with hundreds of repeating units in between. Each unit has a titanium bipolar plate with flow channels, a porous transport layer, the membrane electrode assembly and a gas diffusion layer. The plates connect the cells in series while keeping hydrogen and oxygen apart.'
        }
    };
    const PART_IDS = Object.keys(PART_INFO).sort((a, b) => PART_INFO[a].num - PART_INFO[b].num);

    const TOUR_STEPS = [
        { part: 'wind', mode: 'exterior', title: 'Wind and sun make electricity', text: 'The wind farm and solar park generate up to 22.6 MW of renewable power, rising and falling with the weather.' },
        { part: 'substation', mode: 'exterior', title: 'The substation collects it', text: 'Green power is gathered at medium voltage. What the electrolyser cannot use is exported to the grid.' },
        { part: 'rectifier', mode: 'inside', title: 'Rectifiers make direct current', text: 'Transformer-rectifiers turn AC into thousands of amperes of DC and set the current, and so the hydrogen output.' },
        { part: 'treatment', mode: 'inside', title: 'Water is purified', text: 'Reverse osmosis and deionisation produce ultrapure water so the membranes and catalysts last.' },
        { part: 'mea', mode: 'exploded', title: 'Electrolysis splits water', text: 'At the anode water becomes oxygen, protons and electrons; protons cross the membrane and become hydrogen at the cathode.' },
        { part: 'separator', mode: 'inside', title: 'Gas and water separate', text: 'Bubbles rise out of the circulating water; hydrogen and oxygen leave in separate circuits.' },
        { part: 'dryer', mode: 'inside', title: 'Hydrogen is cleaned and dried', text: 'A deoxidiser removes oxygen traces and adsorption dryers remove water, giving 99.999% purity.' },
        { part: 'storage', mode: 'exterior', title: 'Compressed, stored and shipped', text: 'The compressor raises it to 300 bar for storage, and tube trailers deliver it to industry and filling stations.' }
    ];

    // ============================================================
    //  UI layer (works with or without WebGL)
    // ============================================================
    const ui = {
        selected: null, mode: 'exterior', tour: -1, labels: true, hover: null,
        wind: 9, sun: 600, plantMode: 'green', storageKg: 600
    };
    let viewer = null;
    let tourTimer = 0;

    const el = (id) => document.getElementById(id);
    const hud = {
        windOut: el('h2-wind-out'), sunOut: el('h2-sun-out'),
        windMw: el('h2-windmw'), windSub: el('h2-windmw-sub'), solarMw: el('h2-solarmw'), solarSub: el('h2-solarmw-sub'),
        el: el('h2-el'), elSub: el('h2-el-sub'), cell: el('h2-cell'), cellSub: el('h2-cell-sub'),
        h2: el('h2-h2'), h2Sub: el('h2-h2-sub'), eff: el('h2-eff'), effSub: el('h2-eff-sub'),
        water: el('h2-water'), waterSub: el('h2-water-sub'), store: el('h2-store'), storeSub: el('h2-store-sub'),
        total: el('h2-total'), status: el('h2-status'),
        splitH2: el('h2-split-h2'), splitHeat: el('h2-split-heat'), splitBop: el('h2-split-bop'), splitExp: el('h2-split-exp')
    };
    const info = {
        root: el('h2-info'), num: el('h2-info-num'), title: el('h2-info-title'),
        text: el('h2-info-text'), step: el('h2-info-step'), close: el('h2-info-close')
    };
    const windSlider = el('h2-wind');
    const sunSlider = el('h2-sun');
    const stepsRoot = $('.wt-steps');
    const legendRoot = $('.wt-legend');
    const tourBtn = $('[data-action="tour"]');
    const labelsBtn = $('[data-action="labels"]');
    const expandBtn = $('[data-action="expand"]');

    function setText(node, text) { if (node) node.textContent = text; }
    function fmt(n, d) { return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); }
    function mw(v) { return fmt(Math.abs(v) < 0.005 ? 0 : Math.abs(v), 1) + ' MW'; }

    function statusOf(b) {
        if (b.pIn <= 0) return ['idle', 'Standby: below the 1 MW minimum load' + (b.exported > 0.05 ? ', exporting ' + mw(b.exported) : '')];
        if (b.imported > 0.05) return [b.green > 0.5 ? 'mixed' : 'import', 'Grid top-up of ' + mw(b.imported) + ': the hydrogen is ' + Math.round(b.green * 100) + '% green'];
        if (b.exported > 0.05) return ['export', 'Full load on green power, exporting ' + mw(b.exported) + ' of surplus'];
        if (b.load >= 0.995) return ['solar', 'Full load: 100% green hydrogen'];
        return ['solar', 'Following the weather at ' + Math.round(b.load * 100) + '% load: 100% green hydrogen'];
    }

    function renderHud() {
        const b = plantBalance(ui);
        setText(hud.windOut, fmt(ui.wind, 1));
        setText(hud.sunOut, fmt(ui.sun, 0));
        setText(hud.windMw, mw(b.wind));
        setText(hud.windSub, fmt(rotorRpm(ui.wind), 1) + ' rpm rotors');
        setText(hud.solarMw, mw(b.solar));
        setText(hud.solarSub, fmt(ui.sun, 0) + ' W/m²');
        setText(hud.el, mw(b.pIn));
        setText(hud.elSub, Math.round(b.load * 100) + '% load');
        setText(hud.cell, b.uCell > 0 ? fmt(b.uCell, 2) + ' V' : '–');
        setText(hud.cellSub, b.j > 0 ? fmt(b.j, 2) + ' A/cm² · ' + fmt(b.current / 1000, 1) + ' kA' : 'no current');
        setText(hud.h2, fmt(b.h2KgH, 0) + ' kg/h');
        setText(hud.h2Sub, fmt(b.h2KgH * 24 / 1000, 1) + ' t/day at this rate');
        setText(hud.eff, b.pIn > 0 ? fmt(b.effLhv * 100, 0) + '%' : '–');
        setText(hud.effSub, b.pIn > 0 ? fmt(b.sec, 1) + ' kWh/kg (LHV)' : 'standby');
        setText(hud.water, fmt(b.waterLH, 0) + ' L/h');
        setText(hud.waterSub, 'O₂ ' + fmt(b.o2KgH, 0) + ' kg/h');
        setText(hud.store, fmt(ui.storageKg / SPEC.storageKg * 100, 0) + '%');
        setText(hud.storeSub, fmt(ui.storageKg, 0) + ' kg at 300 bar');
        setText(hud.total, mw(b.renew + b.imported));
        const total = Math.max(b.renew + b.imported, 0.0001);
        const pct = (v) => clamp(v / total * 100, 0, 100).toFixed(1) + '%';
        if (hud.splitH2) hud.splitH2.style.width = pct(b.h2Mw);
        if (hud.splitHeat) hud.splitHeat.style.width = pct(Math.max(0, b.pDc - b.h2Mw));
        if (hud.splitBop) hud.splitBop.style.width = pct(b.pIn - b.pDc);
        if (hud.splitExp) hud.splitExp.style.width = pct(b.exported);
        if (hud.status) {
            const st = statusOf(b);
            hud.status.dataset.state = st[0];
            hud.status.textContent = st[1];
        }
        return b;
    }

    // Storage integrates production minus trailer offtake (1 s = 6 simulated minutes)
    window.setInterval(() => {
        if (document.hidden) return;
        const b = plantBalance(ui);
        ui.storageKg = clamp(ui.storageKg + (b.h2KgH - SPEC.offtakeKgH) * 0.025, 0, SPEC.storageKg);
        setText(hud.store, fmt(ui.storageKg / SPEC.storageKg * 100, 0) + '%');
        setText(hud.storeSub, fmt(ui.storageKg, 0) + ' kg at 300 bar');
    }, 250);

    // ---- Mode, selection, tour ----
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
        const root = el('h2-labels');
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
    if (info.close) info.close.addEventListener('click', () => { stopTour(); select(null); });
    if (windSlider) windSlider.addEventListener('input', () => { ui.wind = parseFloat(windSlider.value); renderHud(); });
    if (sunSlider) sunSlider.addEventListener('input', () => { ui.sun = parseFloat(sunSlider.value); renderHud(); });
    $$('button[data-plant]').forEach(b => b.addEventListener('click', () => {
        ui.plantMode = b.dataset.plant;
        $$('button[data-plant]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        renderHud();
    }));
    if (windSlider) ui.wind = parseFloat(windSlider.value);
    if (sunSlider) ui.sun = parseFloat(sunSlider.value);
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
        const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 400);
        const V = (x, y, z) => new THREE.Vector3(x, y, z);
        const E = (x, y, z) => new THREE.Euler(x, y, z);

        // --- Lighting -------------------------------------------------
        const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x2a4030, 0.55);
        scene.add(hemi);
        const sunLight = new THREE.DirectionalLight(0xfff1d6, 1.1);
        sunLight.position.set(30, 45, 35);
        sunLight.castShadow = true;
        sunLight.shadow.mapSize.set(2048, 2048);
        sunLight.shadow.camera.near = 5;
        sunLight.shadow.camera.far = 140;
        sunLight.shadow.camera.left = -48;
        sunLight.shadow.camera.right = 48;
        sunLight.shadow.camera.top = 40;
        sunLight.shadow.camera.bottom = -40;
        sunLight.shadow.bias = -0.0008;
        sunLight.target.position.set(-6, 0, -4);
        scene.add(sunLight);
        scene.add(sunLight.target);

        // --- Materials -------------------------------------------------
        const std = (o) => new THREE.MeshStandardMaterial(o);
        const lawnMat = std({ color: 0x24432d, roughness: 1, transparent: true });
        const padMat = std({ color: 0x6a7078, roughness: 0.95 });
        const wallMat = std({ color: 0xd3d9d6, roughness: 0.75, metalness: 0.1, side: THREE.DoubleSide });
        const roofMat = std({ color: 0x8a949c, roughness: 0.7, metalness: 0.3 });
        const coolerMat = std({ color: 0xc9d0d6, roughness: 0.6, metalness: 0.4 });
        const enclosureMat = std({ color: 0x9fb4a7, roughness: 0.7, metalness: 0.2, side: THREE.DoubleSide });
        const vesselMat = std({ color: 0xeef1f4, roughness: 0.45, metalness: 0.35, transparent: true, side: THREE.DoubleSide });
        const darkMat = std({ color: 0x2a3340, metalness: 0.5, roughness: 0.45 });
        const steelMat = std({ color: 0x9aa5b1, metalness: 0.85, roughness: 0.3 });
        const whiteMat = std({ color: 0xf1f3f5, metalness: 0.15, roughness: 0.45 });
        const bladeMat = std({ color: 0xf7f8fb, metalness: 0.1, roughness: 0.35, side: THREE.DoubleSide });
        const copperMat = std({ color: 0xb87333, metalness: 0.9, roughness: 0.32 });
        const h2Mat = std({ color: 0x4fc3f7, roughness: 0.5, metalness: 0.2 });
        const o2Mat = std({ color: 0xef5350, roughness: 0.5, metalness: 0.2 });
        const waterMat = std({ color: 0x42a5f5, roughness: 0.5, metalness: 0.2 });
        const plateMat = std({ color: 0x9aa7b4, metalness: 0.8, roughness: 0.35 });
        const meaMat = std({ color: 0x2b2533, roughness: 0.6, emissive: 0xff7a2a, emissiveIntensity: 0 });
        const endPlateMat = std({ color: 0x3b4a5c, metalness: 0.6, roughness: 0.4 });
        const ledMat = std({ color: 0x4caf50, emissive: 0x4caf50, emissiveIntensity: 1 });
        const glassMat = std({ color: 0x9fd8ff, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.35 });
        const xrayMats = [wallMat, roofMat, coolerMat, enclosureMat, vesselMat];

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
        function makeFadeTexture() {
            const c = document.createElement('canvas');
            c.width = c.height = 256;
            const ctx = c.getContext('2d');
            const g = ctx.createRadialGradient(128, 128, 20, 128, 128, 128);
            g.addColorStop(0, '#fff');
            g.addColorStop(0.65, '#fff');
            g.addColorStop(1, '#000');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, 256, 256);
            return new THREE.CanvasTexture(c);
        }
        function makeCellTexture() {
            const c = document.createElement('canvas');
            c.width = 256;
            c.height = 144;
            const ctx = c.getContext('2d');
            ctx.fillStyle = '#c9d1da';
            ctx.fillRect(0, 0, c.width, c.height);
            const cols = 12;
            const rows = 6;
            const cw = (c.width - 8) / cols;
            const ch = (c.height - 8) / rows;
            for (let r = 0; r < rows; r++) {
                for (let k = 0; k < cols; k++) {
                    ctx.fillStyle = (r + k) % 2 ? '#13264d' : '#102142';
                    ctx.fillRect(4 + k * cw + 1, 4 + r * ch + 1, cw - 2, ch - 2);
                }
            }
            const tex = new THREE.CanvasTexture(c);
            tex.encoding = THREE.sRGBEncoding;
            return tex;
        }
        function textSprite(text, color, height) {
            const c = document.createElement('canvas');
            const ctx = c.getContext('2d');
            const font = '600 40px Inter, "Segoe UI", sans-serif';
            ctx.font = font;
            c.width = Math.ceil(ctx.measureText(text).width) + 28;
            c.height = 60;
            ctx.font = font;
            ctx.fillStyle = 'rgba(10,16,26,0.82)';
            ctx.fillRect(0, 0, c.width, c.height);
            ctx.fillStyle = color;
            ctx.textBaseline = 'middle';
            ctx.fillText(text, 14, 31);
            const tex = new THREE.CanvasTexture(c);
            tex.encoding = THREE.sRGBEncoding;
            const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
            sp.scale.set(height * c.width / c.height, height, 1);
            return sp;
        }

        // --- Parts registry ------------------------------------------------
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

        // --- Ground ------------------------------------------------------------
        lawnMat.alphaMap = makeFadeTexture();
        const ground = new THREE.Mesh(new THREE.CircleGeometry(70, 80), lawnMat);
        ground.rotation.x = -Math.PI / 2;
        ground.position.set(-8, 0, -4);
        ground.receiveShadow = true;
        scene.add(ground);
        const pad = mesh(new THREE.BoxGeometry(34, 0.06, 20), padMat, { position: V(3, 0.03, 0.5) });
        pad.castShadow = false;
        scene.add(pad);

        // ===============================================================
        //  Generation: wind farm and solar park
        // ===============================================================
        function makeBladeGeometry(length) {
            const shape = new THREE.Shape();
            shape.moveTo(0, 0);
            shape.bezierCurveTo(0.22, 0.15, 0.3, length * 0.2, 0.26, length * 0.3);
            shape.bezierCurveTo(0.22, length * 0.6, 0.12, length * 0.9, 0.03, length);
            shape.lineTo(-0.03, length);
            shape.bezierCurveTo(-0.1, length * 0.9, -0.16, length * 0.6, -0.17, length * 0.3);
            shape.bezierCurveTo(-0.19, length * 0.2, -0.16, 0.15, -0.1, 0);
            shape.lineTo(0, 0);
            const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: false, curveSegments: 12 });
            geo.translate(0, 0, -0.025);
            return geo;
        }
        const TURBINE_SCALE = 2.3;
        const bladeGeo = makeBladeGeometry(3.1);
        const turbines = [];
        const windGroup = new THREE.Group();
        scene.add(windGroup);
        [[-30, -24], [-16, -30], [-2, -27]].forEach(p => {
            const t = new THREE.Group();
            t.position.set(p[0], 0, p[1]);
            t.scale.setScalar(TURBINE_SCALE);
            t.add(mesh(new THREE.CylinderGeometry(0.17, 0.36, 6.2, 24), whiteMat, { position: V(0, 3.1, 0) }));
            const nacelle = new THREE.Group();
            nacelle.position.y = 6.3;
            nacelle.rotation.y = 0.15;
            nacelle.add(mesh(new THREE.BoxGeometry(0.6, 0.55, 1.4), whiteMat, { position: V(0, 0, -0.2) }));
            const rotor = new THREE.Group();
            rotor.position.z = 0.65;
            rotor.add(mesh(new THREE.SphereGeometry(0.28, 20, 14), whiteMat));
            for (let i = 0; i < 3; i++) {
                const pivot = new THREE.Group();
                pivot.rotation.z = (i * Math.PI * 2) / 3;
                pivot.add(mesh(bladeGeo, bladeMat, { position: V(0, 0.2, 0) }));
                rotor.add(pivot);
            }
            nacelle.add(rotor);
            t.add(nacelle);
            windGroup.add(t);
            turbines.push({ group: t, rotor: rotor, nacelle: nacelle });
        });
        registerPart('wind', windGroup, (t) => turbines[1].nacelle.localToWorld(t.set(0, 0.6, 0)),
            (t) => t.set(-16, 10, -27));

        const solarGroup = new THREE.Group();
        scene.add(solarGroup);
        const cellMat = std({ map: makeCellTexture(), metalness: 0.35, roughness: 0.3 });
        const ROWS = 6;
        const TABLES = 6;
        const tableGeo = new THREE.BoxGeometry(3.2, 0.06, 1.8);
        const tables = new THREE.InstancedMesh(tableGeo, cellMat, ROWS * TABLES);
        const legs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 1, 0.08), steelMat, ROWS * TABLES * 2);
        tables.castShadow = legs.castShadow = true;
        const m4 = new THREE.Matrix4();
        const q = new THREE.Quaternion().setFromEuler(E(25 * Math.PI / 180, 0, 0));
        let n = 0;
        let ln = 0;
        for (let r = 0; r < ROWS; r++) {
            for (let k = 0; k < TABLES; k++) {
                const x = -38 + k * 3.5;
                const z = -9 + r * 3.4;
                m4.compose(V(x, 1.15, z), q, V(1, 1, 1));
                tables.setMatrixAt(n++, m4);
                m4.compose(V(x, 0.5, z - 0.5), new THREE.Quaternion(), V(1, 1.3, 1));
                legs.setMatrixAt(ln++, m4);
                m4.compose(V(x, 0.35, z + 0.5), new THREE.Quaternion(), V(1, 0.7, 1));
                legs.setMatrixAt(ln++, m4);
            }
        }
        solarGroup.add(tables);
        solarGroup.add(legs);
        const pvInverter = mesh(new THREE.BoxGeometry(2.4, 2.2, 2), std({ color: 0xdfe5ea, roughness: 0.6 }), { position: V(-17.5, 1.1, 0) });
        solarGroup.add(pvInverter);
        registerPart('solar', solarGroup, (t) => t.set(-29.5, 1.9, -6), (t) => t.set(-29.5, 1, -1));

        // ===============================================================
        //  Substation and grid
        // ===============================================================
        const substation = new THREE.Group();
        scene.add(substation);
        const trafo = new THREE.Group();
        trafo.position.set(-13, 0, -6.5);
        trafo.add(mesh(new THREE.BoxGeometry(2.6, 2.2, 1.8), std({ color: 0x7c8a7a, roughness: 0.6, metalness: 0.3 }), { position: V(0, 1.1, 0) }));
        for (let i = 0; i < 6; i++) trafo.add(mesh(new THREE.BoxGeometry(0.06, 1.8, 0.5), steelMat, { position: V(-1.0 + i * 0.4, 1.1, 1.15) }));
        [-0.7, 0, 0.7].forEach(x => trafo.add(mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.8, 10), std({ color: 0x8b5a3c, roughness: 0.4 }), { position: V(x, 2.6, -0.3) })));
        substation.add(trafo);
        substation.add(mesh(new THREE.BoxGeometry(4.2, 2.6, 2.4), std({ color: 0xe4e8eb, roughness: 0.6 }), { position: V(-17.2, 1.3, -6.5) }));
        // lattice pylon
        const pylon = new THREE.Group();
        pylon.position.set(-21, 0, -13);
        [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]].forEach(p => {
            const leg = mesh(new THREE.CylinderGeometry(0.06, 0.09, 14.2, 6), steelMat, { position: V(p[0] * 0.55, 7, p[1] * 0.55) });
            leg.rotation.set(-p[1] * 0.06, 0, p[0] * 0.06);
            pylon.add(leg);
        });
        pylon.add(mesh(new THREE.BoxGeometry(5, 0.12, 0.12), steelMat, { position: V(0, 12.5, 0) }));
        pylon.add(mesh(new THREE.BoxGeometry(3.6, 0.12, 0.12), steelMat, { position: V(0, 10.5, 0) }));
        substation.add(pylon);
        const lineMat = std({ color: 0x20252b, roughness: 0.6 });
        const gridCurve = new THREE.CatmullRomCurve3([V(-13, 3.0, -6.8), V(-16.5, 7.5, -10), V(-21, 12.4, -13), V(-40, 11, -16), V(-62, 12.4, -19)]);
        scene.add(mesh(new THREE.TubeGeometry(gridCurve, 60, 0.04, 6, false), lineMat, { castShadow: false }));
        registerPart('substation', substation, (t) => t.set(-13, 2.9, -6.5), (t) => t.set(-16, 2, -8));

        // ===============================================================
        //  Electrolysis hall
        // ===============================================================
        const HW = 16;
        const HD = 8;
        const HH = 5.5;
        const hall = new THREE.Group();
        scene.add(hall);
        hall.add(mesh(new THREE.BoxGeometry(HW, HH, HD), wallMat, { position: V(0, HH / 2, 0) }));
        hall.add(mesh(new THREE.BoxGeometry(4, 4, 0.08), std({ color: 0x7d8790, roughness: 0.6, metalness: 0.3 }), { position: V(-3.5, 2, HD / 2 + 0.03) }));
        for (let i = 0; i < 5; i++) hall.add(mesh(new THREE.BoxGeometry(1.6, 0.5, 0.08), glassMat, { position: V(1 + i * 1.9, 4.6, HD / 2 + 0.03) }));
        const signSprite = textSprite('H₂  ELECTROLYSIS', '#8fe3ff', 0.55);
        signSprite.position.set(4.6, 3.3, HD / 2 + 0.2);
        hall.add(signSprite);

        // Roof group: roof slab, dry coolers and the oxygen vent top (lifts when exploded)
        const roof = new THREE.Group();
        hall.add(roof);
        roof.add(mesh(new THREE.BoxGeometry(HW + 0.4, 0.25, HD + 0.4), roofMat, { position: V(0, HH + 0.12, 0) }));
        const coolers = new THREE.Group();
        const fans = [];
        [-5, -1, 3].forEach(x => {
            const c = new THREE.Group();
            c.position.set(x, HH + 0.25, -1.4);
            c.add(mesh(new THREE.BoxGeometry(3.2, 0.9, 2.2), coolerMat, { position: V(0, 0.45, 0) }));
            [-0.75, 0.75].forEach(fx => {
                const fan = new THREE.Group();
                fan.position.set(fx, 0.93, 0);
                fan.add(mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.04, 28), darkMat));
                for (let b = 0; b < 5; b++) {
                    const blade = mesh(new THREE.BoxGeometry(0.5, 0.02, 0.14), steelMat, { position: V(0.25, 0.04, 0) });
                    const pivot = new THREE.Group();
                    pivot.rotation.y = b * Math.PI * 2 / 5;
                    pivot.add(blade);
                    fan.add(pivot);
                }
                fans.push(fan);
                c.add(fan);
            });
            coolers.add(c);
        });
        roof.add(coolers);
        registerPart('cooler', coolers, (t) => coolers.localToWorld(t.set(-1, HH + 1.5, -1.4)), (t) => coolers.localToWorld(t.set(-1, HH + 0.8, -1.4)));
        const vent = new THREE.Group();
        vent.add(mesh(new THREE.CylinderGeometry(0.16, 0.16, 4.2, 14), steelMat, { position: V(6.2, HH + 2.1, -1.6) }));
        vent.add(mesh(new THREE.CylinderGeometry(0.3, 0.22, 0.4, 14), o2Mat, { position: V(6.2, HH + 4.3, -1.6) }));
        roof.add(vent);
        registerPart('vent', vent, (t) => vent.localToWorld(t.set(6.2, HH + 4.5, -1.6)), (t) => vent.localToWorld(t.set(6.2, HH + 2.5, -1.6)));
        registerPart('hall', hall, (t) => t.set(-6.5, 4.6, HD / 2 + 0.05), (t) => t.set(0, 2.8, 0));
        const ROOF_LIFT = 5;

        // --- Interior: transformer-rectifiers along the north wall ---------
        const STACK_X = [-4.5, -1.5, 1.5, 4.5];
        const rectifiers = new THREE.Group();
        STACK_X.forEach(x => {
            const r = new THREE.Group();
            r.position.set(x, 1.1, -3.1);
            r.add(mesh(new THREE.BoxGeometry(1.7, 2.2, 1.0), std({ color: 0xdfe4e8, roughness: 0.5, metalness: 0.2 })));
            for (let i = 0; i < 5; i++) r.add(mesh(new THREE.BoxGeometry(1.2, 0.05, 0.02), darkMat, { position: V(0, 0.5 + i * 0.12, 0.51) }));
            r.add(mesh(new THREE.SphereGeometry(0.05, 8, 6), ledMat, { position: V(0.6, -0.6, 0.52) }));
            rectifiers.add(r);
        });
        hall.add(rectifiers);
        registerPart('rectifier', rectifiers, (t) => t.set(-4.5, 2.35, -3.1), (t) => t.set(-1.5, 1.1, -3.1));

        // DC busbars from each rectifier to its stack
        STACK_X.forEach(x => {
            hall.add(mesh(new THREE.BoxGeometry(0.12, 0.06, 3.0), copperMat, { position: V(x - 0.25, 2.25, -1.1) }));
            hall.add(mesh(new THREE.BoxGeometry(0.12, 0.06, 3.0), copperMat, { position: V(x + 0.25, 2.25, -1.1) }));
        });

        // --- Stacks ----------------------------------------------------------
        const PLATES = 22;
        function makeStack() {
            const g = new THREE.Group();
            const plates = [];
            const ends = [];
            const endGeo = new THREE.BoxGeometry(0.16, 1.15, 1.15);
            [-1, 1].forEach(s => {
                const e = mesh(endGeo, endPlateMat, { position: V(s * 0.92, 0, 0) });
                e.userData.baseX = s * 0.92;
                ends.push(e);
                g.add(e);
            });
            const plateGeo = new THREE.BoxGeometry(0.035, 1.0, 1.0);
            for (let i = 0; i < PLATES; i++) {
                const x = -0.8 + i * (1.6 / (PLATES - 1));
                const p = mesh(plateGeo, i % 2 ? meaMat : plateMat, { position: V(x, 0, 0) });
                p.userData.baseX = x;
                plates.push(p);
                g.add(p);
            }
            const rods = new THREE.Group();
            [[0.5, 0.5], [0.5, -0.5], [-0.5, 0.5], [-0.5, -0.5]].forEach(p => rods.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.05, 8), steelMat, { position: V(0, p[0], p[1]), rotation: E(0, 0, Math.PI / 2) })));
            g.add(rods);
            g.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 10), h2Mat, { position: V(0.6, 0.78, 0.3) }));
            g.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 10), o2Mat, { position: V(-0.6, 0.78, -0.3) }));
            g.userData = { plates: plates, ends: ends, rods: rods };
            return g;
        }
        const stacksGroup = new THREE.Group();
        const stacks = STACK_X.map(x => {
            const s = makeStack();
            s.position.set(x, 1.25, 0.6);
            const frame = mesh(new THREE.BoxGeometry(2.1, 0.7, 1.3), darkMat, { position: V(x, 0.35, 0.6) });
            stacksGroup.add(frame);
            return s;
        });
        stacks.forEach((s, i) => { if (i !== 1) stacksGroup.add(s); });
        hall.add(stacksGroup);
        registerPart('stack', stacksGroup, (t) => t.set(4.5, 1.95, 0.6), (t) => t.set(1.5, 1.2, 0.6));
        // Stack 2 explodes into its layers
        const xStack = stacks[1];
        hall.add(xStack);
        const X_STACK_BASE = xStack.position.clone();
        const X_STACK_OUT = V(-1.5, 3.2, 8.5);
        registerPart('stacklayers', xStack, (t) => xStack.localToWorld(t.set(xStack.userData.ends[0].position.x, 0.62, 0)));

        // --- Water treatment skid --------------------------------------------
        const treatment = new THREE.Group();
        treatment.position.set(-6.6, 0, -0.6);
        treatment.add(mesh(new THREE.BoxGeometry(2.0, 1.0, 2.0), std({ color: 0x5c6b78, roughness: 0.6, metalness: 0.3 }), { position: V(0, 0.5, 0) }));
        [-0.55, 0, 0.55].forEach(z => treatment.add(mesh(new THREE.CylinderGeometry(0.18, 0.18, 1.8, 14), std({ color: 0xe8f1fa, roughness: 0.4 }), { position: V(0, 1.2, z), rotation: E(0, 0, Math.PI / 2) })));
        [-0.5, 0.5].forEach(z => treatment.add(mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.3, 14), waterMat, { position: V(0.7, 1.65, z) })));
        hall.add(treatment);
        registerPart('treatment', treatment, (t) => treatment.localToWorld(t.set(0, 2.35, 0)));

        // --- Separators with bubbles ------------------------------------------
        const separators = new THREE.Group();
        const SEP = [{ x: 6.2, z: -1.6, mat: o2Mat }, { x: 6.2, z: 0.6, mat: h2Mat }];
        SEP.forEach(sp => {
            separators.add(mesh(new THREE.CylinderGeometry(0.55, 0.55, 3.2, 24, 1, true), vesselMat, { position: V(sp.x, 1.9, sp.z) }));
            separators.add(mesh(new THREE.SphereGeometry(0.55, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), vesselMat, { position: V(sp.x, 3.5, sp.z) }));
            separators.add(mesh(new THREE.CylinderGeometry(0.57, 0.57, 0.18, 24), sp.mat, { position: V(sp.x, 2.6, sp.z) }));
            separators.add(mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.4, 20), std({ color: 0x5aa9e6, transparent: true, opacity: 0.45, roughness: 0.2, depthWrite: false }), { position: V(sp.x, 1.0, sp.z) }));
            separators.add(mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.3, 20), darkMat, { position: V(sp.x, 0.15, sp.z) }));
        });
        hall.add(separators);
        registerPart('separator', separators, (t) => t.set(6.2, 4.15, 0.6), (t) => t.set(6.2, 2, -0.5));
        function makeBubbles(x, z, color, count) {
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
            const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: color, size: 0.11, transparent: true, opacity: 0.95, depthWrite: false }));
            pts.userData = { x: x, z: z, seeds: Array.from({ length: count }, () => ({ a: Math.random() * Math.PI * 2, r: Math.random() * 0.42, p: Math.random(), s: 0.5 + Math.random() })) };
            pts.frustumCulled = false;
            hall.add(pts);
            return pts;
        }
        const bubblesO2 = makeBubbles(6.2, -1.6, 0xff8a80, 40);
        const bubblesH2 = makeBubbles(6.2, 0.6, 0x80deea, 60);

        // --- Deoxo and twin dryer --------------------------------------------
        const dryer = new THREE.Group();
        dryer.add(mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.2, 16), steelMat, { position: V(6.3, 0.8, 2.6) }));
        [1.9, 2.9].forEach(z => dryer.add(mesh(new THREE.CylinderGeometry(0.3, 0.3, 2.6, 18), std({ color: 0xdfe6ec, roughness: 0.4, metalness: 0.4 }), { position: V(7.25, 1.3, z) })));
        hall.add(dryer);
        registerPart('dryer', dryer, (t) => t.set(7.25, 2.75, 2.4), (t) => t.set(7.0, 1.3, 2.4));

        // --- Compressor in its own enclosure (east) ------------------------------
        const compressor = new THREE.Group();
        compressor.position.set(10.3, 0, -1.5);
        compressor.add(mesh(new THREE.BoxGeometry(2.6, 2.6, 3.2), enclosureMat, { position: V(0, 1.3, 0) }));
        compressor.add(mesh(new THREE.BoxGeometry(1.6, 0.8, 1.2), darkMat, { position: V(0, 0.45, -0.4) }));
        compressor.add(mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.0, 16), std({ color: 0x3f6fd8, metalness: 0.6, roughness: 0.4 }), { position: V(0, 0.9, 0.8), rotation: E(Math.PI / 2, 0, 0) }));
        [-0.45, 0.45].forEach(x => compressor.add(mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.7, 16), steelMat, { position: V(x, 1.25, -0.4) })));
        scene.add(compressor);
        registerPart('compressor', compressor, (t) => compressor.localToWorld(t.set(0, 2.7, 0)));

        // --- Storage tanks ------------------------------------------------------
        const storage = new THREE.Group();
        const tankMat = std({ color: 0xf2f4f6, roughness: 0.35, metalness: 0.4 });
        [[13.0, 0.95], [14.7, 0.95], [13.0, 2.55], [14.7, 2.55]].forEach(p => {
            storage.add(mesh(new THREE.CylinderGeometry(0.75, 0.75, 7, 24), tankMat, { position: V(p[0], p[1], -1.5), rotation: E(Math.PI / 2, 0, 0) }));
            [-1.6, 1.6].forEach(z => storage.add(mesh(new THREE.TorusGeometry(0.76, 0.05, 6, 24), h2Mat, { position: V(p[0], p[1], -1.5 + z) })));
        });
        [-3, 0, 3].forEach(z => storage.add(mesh(new THREE.BoxGeometry(3.6, 0.3, 0.4), darkMat, { position: V(13.85, 0.15, -1.5 + z) })));
        scene.add(storage);
        registerPart('storage', storage, (t) => t.set(13.85, 3.35, -3.5), (t) => t.set(13.85, 1.7, -1.5));

        // --- Tube trailer -------------------------------------------------------
        const trailer = new THREE.Group();
        trailer.position.set(13.5, 0, 7.2);
        trailer.add(mesh(new THREE.BoxGeometry(8.4, 0.3, 2.3), darkMat, { position: V(-0.6, 0.9, 0) }));
        for (let r = 0; r < 3; r++) {
            for (let k = 0; k < 3; k++) {
                trailer.add(mesh(new THREE.CylinderGeometry(0.33, 0.33, 7.6, 16), tankMat, { position: V(-0.6, 1.4 + r * 0.68, -0.68 + k * 0.68), rotation: E(0, 0, Math.PI / 2) }));
            }
        }
        trailer.add(mesh(new THREE.BoxGeometry(2.2, 2.4, 2.3), std({ color: 0x2f6f8f, metalness: 0.5, roughness: 0.35 }), { position: V(4.7, 1.6, 0) }));
        trailer.add(mesh(new THREE.BoxGeometry(0.05, 0.9, 1.9), glassMat, { position: V(5.82, 2.2, 0) }));
        [[-3.4, 1.15], [-3.4, -1.15], [-2.2, 1.15], [-2.2, -1.15], [4.2, 1.15], [4.2, -1.15]].forEach(p => trailer.add(mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 18), std({ color: 0x15181c, roughness: 0.9 }), { position: V(p[0], 0.42, p[1]), rotation: E(Math.PI / 2, 0, 0) })));
        scene.add(trailer);
        registerPart('trailer', trailer, (t) => trailer.localToWorld(t.set(4.7, 2.9, 0)));

        // --- Water tank ---------------------------------------------------------
        const waterTank = new THREE.Group();
        waterTank.add(mesh(new THREE.CylinderGeometry(1.6, 1.6, 4.4, 28), std({ color: 0x8fa6b8, roughness: 0.5, metalness: 0.4 }), { position: V(-12.2, 2.2, 1.8) }));
        waterTank.add(mesh(new THREE.CylinderGeometry(1.64, 1.64, 0.25, 28), waterMat, { position: V(-12.2, 3.6, 1.8) }));
        scene.add(waterTank);
        registerPart('water', waterTank, (t) => t.set(-12.2, 4.5, 1.8));

        // --- Piping (static meshes) ---------------------------------------------
        const C = (pts) => new THREE.CatmullRomCurve3(pts, false, 'centripetal');
        function pipe(curve, radius, mat, parent) {
            (parent || scene).add(mesh(new THREE.TubeGeometry(curve, 32, radius, 8, false), mat, { castShadow: false }));
        }
        const waterCurve = C([V(-12.2, 0.6, 1.8), V(-10, 0.4, 1.0), V(-8.2, 0.6, 0.0), V(-7.6, 0.9, -0.6)]);
        pipe(waterCurve, 0.08, waterMat);
        const feedCurve = C([V(-5.6, 0.9, -0.6), V(-5.2, 0.6, 1.6), V(-1.5, 0.6, 1.7), V(4.5, 0.6, 1.7)]);
        pipe(feedCurve, 0.06, waterMat, hall);
        const h2Curve = C([V(-4.5, 2.05, 0.9), V(-1.5, 2.7, 1.3), V(4.5, 2.7, 1.3), V(6.2, 3.2, 0.9), V(6.2, 3.9, 0.6), V(6.3, 3.2, 2.6), V(7.25, 2.7, 2.4), V(8.6, 1.9, 2.0), V(9.4, 1.4, -0.4)]);
        pipe(h2Curve, 0.07, h2Mat);
        const o2Curve = C([V(-4.5, 2.05, 0.3), V(-1.5, 2.9, -0.2), V(4.5, 2.9, -0.2), V(6.2, 3.3, -1.3), V(6.2, 4.0, -1.6)]);
        pipe(o2Curve, 0.07, o2Mat);
        const storeCurve = C([V(11.2, 1.0, -1.0), V(12.1, 0.9, 0.6), V(13.0, 0.95, 1.9)]);
        pipe(storeCurve, 0.07, h2Mat);
        const fillCurve = C([V(14.7, 0.95, 2.0), V(14.6, 0.5, 4.2), V(13.5, 1.0, 5.8), V(12.9, 1.6, 6.5)]);
        pipe(fillCurve, 0.06, h2Mat);

        // ===============================================================
        //  Flows (particles)
        // ===============================================================
        const flows = {};
        function addFlow(name, curve, color, count, size) {
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
            const mat = new THREE.PointsMaterial({ color: color, size: size, transparent: true, opacity: 0.95, depthWrite: false });
            const pts = new THREE.Points(geo, mat);
            pts.frustumCulled = false;
            scene.add(pts);
            flows[name] = { pts: pts, curve: curve, count: count, phase: Math.random(), len: curve.getLength(), tmp: V(0, 0, 0) };
        }
        function driveFlow(f, rate, dt, visible) {
            f.pts.visible = Math.abs(rate) > 0.02 && visible !== false;
            if (!f.pts.visible) return;
            const speed = (1.2 + Math.min(Math.abs(rate), 1.5) * 4) / f.len;
            f.phase = (f.phase + Math.sign(rate) * speed * dt * motionScale + 1) % 1;
            const arr = f.pts.geometry.attributes.position.array;
            for (let i = 0; i < f.count; i++) {
                f.curve.getPointAt((i / f.count + f.phase) % 1, f.tmp);
                arr[i * 3] = f.tmp.x;
                arr[i * 3 + 1] = f.tmp.y;
                arr[i * 3 + 2] = f.tmp.z;
            }
            f.pts.geometry.attributes.position.needsUpdate = true;
        }
        const SUB = V(-13, 0.25, -5.2);
        turbines.forEach((tb, i) => addFlow('wind' + i, C([V(tb.group.position.x, 0.25, tb.group.position.z + 1), V((tb.group.position.x + SUB.x) / 2, 0.25, (tb.group.position.z + SUB.z) / 2 + 2), SUB]), 0xaed581, 30, 0.35));
        addFlow('solar', C([V(-17.5, 0.3, 1.1), V(-16, 0.25, -2), V(-13.5, 0.25, -4.4)]), 0xffd54f, 18, 0.32);
        addFlow('grid', gridCurve, 0xffc107, 50, 0.35);
        addFlow('ac', C([V(-12, 2.4, -6.2), V(-9.5, 2.0, -4.6), V(-8.2, 2.0, -3.4), V(-4.5, 2.4, -3.0), V(4.5, 2.4, -3.0)]), 0xffe082, 40, 0.24);
        STACK_X.forEach((x, i) => addFlow('dc' + i, C([V(x, 2.3, -2.6), V(x, 2.3, -1.1), V(x, 1.9, 0.2)]), 0xff8a65, 10, 0.2));
        addFlow('water', C(waterCurve.points.concat(feedCurve.points)), 0x64b5f6, 40, 0.22);
        addFlow('h2', C(h2Curve.points.concat(storeCurve.points)), 0x80deea, 60, 0.24);
        addFlow('fill', fillCurve, 0x80deea, 14, 0.22);
        addFlow('o2', C(o2Curve.points.concat([V(6.2, HH + 4.5, -1.6)])), 0xff8a80, 40, 0.24);
        addFlow('heat', C([V(0, 2.0, 0.6), V(0, 4.2, -0.4), V(-1, HH + 1.3, -1.4)]), 0xffab40, 18, 0.26);

        // ===============================================================
        //  Membrane-electrode cross-section (exploded only)
        // ===============================================================
        const mea = new THREE.Group();
        scene.add(mea);
        mea.position.set(7.5, 10, 11.5);
        const MEA_SCALE = 1.7;
        const MH = 1.9;
        const MD = 1.2;
        const LAYERS = [
            ['Ti bipolar plate', 0.32, 0x8d99a6, 1],
            ['porous transport layer', 0.24, 0xb8c4d0, 0.85],
            ['IrO₂ anode', 0.09, 0x51406a, 1],
            ['Nafion membrane', 0.2, 0xf3df8a, 0.55],
            ['Pt cathode', 0.09, 0x1c1c1c, 1],
            ['gas diffusion layer', 0.24, 0x4a4f55, 0.9],
            ['Ti bipolar plate', 0.32, 0x8d99a6, 1]
        ];
        const totalW = LAYERS.reduce((s, l) => s + l[1], 0);
        let cursor = -totalW / 2;
        const layerX = [];
        LAYERS.forEach(l => {
            const w = l[1];
            const m = mesh(new THREE.BoxGeometry(w, MH, MD), std({ color: l[2], roughness: 0.55, metalness: l[2] === 0x8d99a6 ? 0.7 : 0.1, transparent: l[3] < 1, opacity: l[3], depthWrite: l[3] >= 1 }), { position: V(cursor + w / 2, MH / 2, 0) });
            mea.add(m);
            layerX.push([cursor, cursor + w]);
            cursor += w;
        });
        // flow channels in the bipolar plates
        [0, 6].forEach(i => {
            for (let k = 0; k < 4; k++) mea.add(mesh(new THREE.BoxGeometry(0.12, MH * 0.96, 0.12), darkMat, { position: V((layerX[i][0] + layerX[i][1]) / 2 + (i === 0 ? 0.06 : -0.06), MH / 2, -0.42 + k * 0.28) }));
        });
        // external circuit with DC supply
        const xA = (layerX[0][0] + layerX[0][1]) / 2;
        const xC = (layerX[6][0] + layerX[6][1]) / 2;
        const circuit = C([V(xA, MH, 0), V(xA, MH + 0.75, 0), V(0, MH + 1.05, 0), V(xC, MH + 0.75, 0), V(xC, MH, 0)]);
        mea.add(mesh(new THREE.TubeGeometry(circuit, 40, 0.025, 8, false), copperMat, { castShadow: false }));
        mea.add(mesh(new THREE.BoxGeometry(0.5, 0.32, 0.3), std({ color: 0x263238, roughness: 0.5 }), { position: V(0, MH + 1.05, 0) }));
        const txt = [
            ['DC supply', '#ffe082', V(0, MH + 1.45, 0)],
            ['−', '#ffffff', V(0.17, MH + 1.05, 0.2)],
            ['+', '#ffffff', V(-0.17, MH + 1.05, 0.2)],
            ['Anode (+), oxidation', '#ff9e9e', 'left', 0.62],
            ['2H₂O → O₂ + 4H⁺ + 4e⁻', '#ffffff', 'left', 0.47],
            ['Cathode (−), reduction', '#8fe3ff', 'right', 0.62],
            ['4H⁺ + 4e⁻ → 2H₂', '#ffffff', 'right', 0.47],
            ['Membrane: only H⁺ passes', '#f3df8a', V(0, MH + 0.25, MD / 2)]
        ];
        txt.forEach(t => {
            const side = t[2] === 'left' || t[2] === 'right';
            const sp = textSprite(t[0], t[1], t[0].length <= 1 ? 0.18 : side ? 0.17 : 0.15);
            if (t[2] === 'left') sp.position.set(-totalW / 2 - 0.12 - sp.scale.x / 2, MH * t[3], 0);
            else if (t[2] === 'right') sp.position.set(totalW / 2 + 0.12 + sp.scale.x / 2, MH * t[3], 0);
            else sp.position.copy(t[2]);
            mea.add(sp);
        });
        function makeCarriers(count, color, size) {
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
            const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: color, size: size, transparent: true, depthWrite: false }));
            pts.frustumCulled = false;
            pts.userData.seeds = Array.from({ length: count }, () => ({ y: Math.random(), z: (Math.random() - 0.5) * MD * 0.85, p: Math.random(), s: 0.6 + Math.random() * 0.8 }));
            mea.add(pts);
            return pts;
        }
        const anodeX = layerX[2];
        const memX = layerX[3];
        const cathX = layerX[4];
        const carriers = {
            water: makeCarriers(30, 0x64b5f6, 0.08),
            o2: makeCarriers(22, 0xff6b6b, 0.12),
            proton: makeCarriers(30, 0xffe066, 0.07),
            h2: makeCarriers(30, 0x80deea, 0.1),
            electron: makeCarriers(16, 0xffffff, 0.07)
        };
        registerPart('mea', mea, (t) => mea.localToWorld(t.set(-totalW / 2, MH, MD / 2)), (t) => mea.localToWorld(t.set(0, MH * 0.95, 0)));

        // ===============================================================
        //  Wind particles
        // ===============================================================
        const WIND_N = 220;
        const windGeo = new THREE.BufferGeometry();
        const windPos = new Float32Array(WIND_N * 3);
        const windSpd = new Float32Array(WIND_N);
        for (let i = 0; i < WIND_N; i++) {
            windPos[i * 3] = -45 + Math.random() * 60;
            windPos[i * 3 + 1] = 1 + Math.random() * 22;
            windPos[i * 3 + 2] = -45 + Math.random() * 50;
            windSpd[i] = 0.6 + Math.random() * 0.8;
        }
        windGeo.setAttribute('position', new THREE.BufferAttribute(windPos, 3));
        const windPts = new THREE.Points(windGeo, new THREE.PointsMaterial({ color: 0xd9f2df, size: 0.22, transparent: true, opacity: 0.5, depthWrite: false }));
        windPts.frustumCulled = false;
        scene.add(windPts);

        // ===============================================================
        //  View state
        // ===============================================================
        const state = { xray: 0, xrayGoal: 0, explode: 0, explodeGoal: 0, shift: 0, active: false, skyClock: 0 };
        const cam = { theta: 0.45, phi: 1.13, radius: 72, target: V(-5, 3.5, -3.5) };
        const goal = { theta: cam.theta, phi: cam.phi, radius: cam.radius, target: cam.target.clone() };
        const RADIUS_MIN = 2.5;
        const RADIUS_MAX = 110;
        let focusPart = null;
        function wrapAngle(a) {
            while (a > Math.PI) a -= Math.PI * 2;
            while (a < -Math.PI) a += Math.PI * 2;
            return a;
        }
        function viewFor(mode) {
            if (mode === 'inside') return { theta: 0.35, phi: 0.9, radius: 26, target: V(1.5, 1.4, 0.2) };
            if (mode === 'exploded') return { theta: 0.3, phi: 1.2, radius: 38, target: V(3, 5, 5) };
            return { theta: 0.45, phi: 1.13, radius: 72, target: V(-5, 3.5, -3.5) };
        }
        function setView(v) {
            goal.theta = cam.theta + wrapAngle(v.theta - cam.theta);
            goal.phi = v.phi;
            goal.radius = v.radius;
            goal.target.copy(v.target);
            focusPart = null;
        }

        // ===============================================================
        //  Labels
        // ===============================================================
        const labelsRoot = el('h2-labels');
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
            const sel = ui.selected && partById[ui.selected];
            if (sel && sel.isolate && p.id !== sel.id) return false;
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
                L.el.style.zIndex = String(Math.max(1, Math.round(1000 - L.dist * 5)));
                const pinned = L.id === ui.selected || L.id === ui.hover;
                const wantTag = pinned || (!narrow && !(compactExterior && L.part.group === 'exterior'));
                if (!wantTag) { setTag(L, false); return; }
                const tw = L.tw;
                let chosen = -1;
                let rx = 0;
                let ry = 0;
                const tryOrder = L.cand >= 0 ? [L.cand] : [];
                for (let i = 0; i < CANDS.length; i++) if (i !== L.cand) tryOrder.push(i);
                for (let k = 0; k < tryOrder.length && chosen < 0; k++) {
                    const c = CANDS[tryOrder[k]];
                    const x = c[0] >= 0 ? L.ax + c[0] : L.ax + c[0] - tw;
                    const y = L.ay + c[1] - TAG_H / 2;
                    if (x < 4 || y < 4 || x + tw > w - 4 || y + TAG_H > h - 4) continue;
                    let blocked = false;
                    for (let j = 0; j < placed.length && !blocked; j++) blocked = overlaps(x, y, tw, TAG_H, placed[j]);
                    for (let j = 0; j < obstacles.length && !blocked; j++) blocked = overlaps(x, y, tw, TAG_H, obstacles[j]);
                    for (let j = 0; j < pins.length && !blocked; j++) blocked = pins[j][4] !== L && overlaps(x, y, tw, TAG_H, pins[j]);
                    if (!blocked) { chosen = tryOrder[k]; rx = x; ry = y; }
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

        // ===============================================================
        //  Selection highlight
        // ===============================================================
        const highlightCache = [];
        function clearHighlight() {
            highlightCache.forEach(e => { e.mesh.material.dispose(); e.mesh.material = e.mat; });
            highlightCache.length = 0;
        }
        function highlight(part) {
            clearHighlight();
            if (part.tint === false) return;
            const color = part.group === 'interior' ? 0xffb300 : 0x4caf50;
            part.object.traverse(o => {
                if (!o.isMesh || Array.isArray(o.material)) return;
                let owner = o;
                while (owner && !owner.userData.partId) owner = owner.parent;
                if (!owner || owner.userData.partId !== part.id) return;
                const m = o.material.clone();
                if (!m.emissive) { m.dispose(); return; }        // basic materials have no emissive uniform
                m.emissive = new THREE.Color(color);
                m.emissiveIntensity = 0.22;
                highlightCache.push({ mesh: o, mat: o.material });
                o.material = m;
            });
        }

        // ===============================================================
        //  Interaction
        // ===============================================================
        const pointer = { x: 0, y: 0, tx: 0, ty: 0, cx: 0, cy: 0, pending: false };
        const raycaster = new THREE.Raycaster();
        const ndc = new THREE.Vector2();
        const SHELLS = { hall: true, compressor: true };
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
                if (id === 'stacklayers' && state.explode < 0.5) id = 'stack';
                if (PART_INFO[id].group === 'interior' && state.xray < 0.3 && id !== 'compressor') id = 'hall';
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

        // ===============================================================
        //  Sizing
        // ===============================================================
        const size = { w: 1, h: 1 };
        let radiusScale = 1;
        function measureUi() {
            uiRects.length = 0;
            const s = stage.getBoundingClientRect();
            ['.wt-modes', '.wt-tools', '.wt-hint'].forEach(sel => {
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

        // ===============================================================
        //  Frame update
        // ===============================================================
        const clock = new THREE.Clock();
        let running = false;
        let visible = true;
        let rafId = 0;
        const focusTmp = V(0, 0, 0);
        const hexMix = (a, b, t) => {
            const pa = [a >> 16, (a >> 8) & 255, a & 255];
            const pb = [b >> 16, (b >> 8) & 255, b & 255];
            return 'rgb(' + pa.map((v, i) => Math.round(lerp(v, pb[i], t))).join(',') + ')';
        };

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

            const b = plantBalance(ui);
            const sunF = ui.sun / 1000;

            // Weather: light and sky follow the sunshine slider
            sunLight.intensity = 0.25 + sunF * 1.0;
            hemi.intensity = 0.4 + sunF * 0.2;
            state.skyClock += dt;
            if (state.skyClock > 0.25) {
                state.skyClock = 0;
                stage.style.setProperty('--sky-top', hexMix(0x46525e, 0x1d4f7a, sunF));
                stage.style.setProperty('--sky-bottom', hexMix(0x7f8a94, 0x5b93bd, sunF));
            }

            // Turbines turn with the wind (visual speed scaled for legibility)
            const omega = rotorRpm(ui.wind) * 2 * Math.PI / 60 * 1.6 * motionScale;
            turbines.forEach(tb => { tb.rotor.rotation.z -= omega * dt; });
            const arr = windGeo.attributes.position.array;
            const ws = (0.6 + ui.wind * 0.35) * motionScale;
            for (let i = 0; i < WIND_N; i++) {
                arr[i * 3 + 2] -= windSpd[i] * ws * dt;
                if (arr[i * 3 + 2] < -45) arr[i * 3 + 2] += 50;
            }
            windGeo.attributes.position.needsUpdate = true;
            windPts.material.opacity = 0.15 + Math.min(0.5, ui.wind * 0.03);

            // Plant animation
            fans.forEach(f => { f.rotation.y += (0.5 + b.heatMw * 6) * dt * motionScale; });
            meaMat.emissiveIntensity = b.load * (0.55 + Math.sin(t * 5) * 0.12 * motionScale);
            ledMat.emissiveIntensity = b.pIn > 0 ? 1.1 : 0.2;
            const rate = b.h2KgH / 180;                        // 0..1 of rated production
            [[bubblesH2, rate], [bubblesO2, rate * 0.6]].forEach(pair => {
                const pts = pair[0];
                const r = pair[1];
                pts.visible = r > 0.01 && state.xray > 0.3;
                if (!pts.visible) return;
                const pa = pts.geometry.attributes.position.array;
                pts.userData.seeds.forEach((s, i) => {
                    s.p = (s.p + dt * s.s * (0.3 + r) * motionScale) % 1;
                    pa[i * 3] = pts.userData.x + Math.cos(s.a + s.p * 3) * s.r;
                    pa[i * 3 + 1] = 0.5 + s.p * 2.9;
                    pa[i * 3 + 2] = pts.userData.z + Math.sin(s.a + s.p * 3) * s.r;
                });
                pts.geometry.attributes.position.needsUpdate = true;
            });

            // Flows
            const xr = state.xray > 0.3;
            turbines.forEach((tb, i) => driveFlow(flows['wind' + i], b.wind / SPEC.turbines / 4.2, dt));
            driveFlow(flows.solar, b.solar / 10, dt);
            driveFlow(flows.grid, (b.exported - b.imported) / 6, dt);
            flows.grid.pts.material.color.setHex(b.imported > b.exported ? 0xef5350 : 0xffc107);
            driveFlow(flows.ac, b.pIn / 10, dt);
            STACK_X.forEach((x, i) => driveFlow(flows['dc' + i], b.pDc / 9.4, dt, xr));
            driveFlow(flows.water, rate, dt);
            driveFlow(flows.h2, rate, dt);
            driveFlow(flows.fill, ui.storageKg > 5 ? 0.6 : 0, dt);
            driveFlow(flows.o2, rate, dt);
            driveFlow(flows.heat, b.heatMw / 2.5, dt, xr);

            // MEA carriers
            if (state.explode > 0.02) {
                const anim = dt * motionScale * (0.2 + b.load);
                const live = b.j > 0;
                Object.keys(carriers).forEach(key => {
                    const pts = carriers[key];
                    pts.visible = live;
                    if (!live) return;
                    const pa = pts.geometry.attributes.position.array;
                    pts.userData.seeds.forEach((s, i) => {
                        s.p = (s.p + anim * s.s) % 1;
                        let x;
                        let y;
                        let z = s.z;
                        if (key === 'water') { x = lerp(layerX[1][0] - 0.05, anodeX[1], s.p); y = MH * (0.1 + 0.8 * s.y); }
                        else if (key === 'o2') { x = lerp(anodeX[0], layerX[0][1] - 0.08, s.p); y = MH * (0.1 + 0.8 * s.y) + s.p * 0.5; }
                        else if (key === 'proton') { x = lerp(anodeX[1], cathX[0], s.p); y = MH * (0.1 + 0.8 * s.y); }
                        else if (key === 'h2') { x = lerp(cathX[1], layerX[6][0] + 0.08, s.p); y = MH * (0.1 + 0.8 * s.y) + s.p * 0.5; }
                        else {
                            circuit.getPointAt(s.p, focusTmp);
                            x = focusTmp.x; y = focusTmp.y; z = focusTmp.z;
                        }
                        pa[i * 3] = x;
                        pa[i * 3 + 1] = Math.min(y, MH - 0.02 + (key === 'electron' ? 2 : 0));
                        pa[i * 3 + 2] = z;
                    });
                    pts.geometry.attributes.position.needsUpdate = true;
                });
            }

            // --- View modes -----------------------------------------------------
            state.xray += (state.xrayGoal - state.xray) * k;
            state.explode += (state.explodeGoal - state.explode) * k;
            const x = state.xray;
            xrayMats.forEach(m => { m.transparent = x > 0.01; m.depthWrite = x < 0.5; });
            wallMat.opacity = lerp(1, 0.12, x);
            roofMat.opacity = lerp(1, 0.12, x);
            coolerMat.opacity = lerp(1, 0.35, x);
            enclosureMat.opacity = lerp(1, 0.15, x);
            vesselMat.opacity = lerp(1, 0.35, x);
            signSprite.material.opacity = 1 - x;
            signSprite.visible = x < 0.95;
            const ex = state.explode;
            roof.position.y = ex * ROOF_LIFT;
            xStack.position.lerpVectors(X_STACK_BASE, X_STACK_OUT, ex);
            xStack.userData.plates.forEach(p => { p.position.x = p.userData.baseX * (1 + ex * 3.2); });
            xStack.userData.ends.forEach(e => { e.position.x = e.userData.baseX * (1 + ex * 3.6); });
            xStack.userData.rods.visible = ex < 0.3;
            mea.visible = ex > 0.02;
            mea.scale.setScalar(Math.max(0.001, ex) * MEA_SCALE);

            const glow = 0.22 + Math.sin(t * 4) * 0.08 * motionScale;
            highlightCache.forEach(e => {
                const m = e.mesh.material;
                m.opacity = e.mat.opacity;
                m.transparent = e.mat.transparent;
                m.depthWrite = e.mat.depthWrite;
                m.emissiveIntensity = glow;
            });

            // --- Camera ------------------------------------------------------------
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
            new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; /* newest entry wins */ updateRunState(); }, { threshold: 0.05 }).observe(stage);
        }
        document.addEventListener('visibilitychange', updateRunState);
        canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); stop(); showFallback(); });

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
            zoomBy: zoomBy
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
