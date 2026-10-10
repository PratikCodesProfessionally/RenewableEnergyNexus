/* ============================================================
   Interactive 3D Himalayan hydropower explorer
   Glacier > river > diversion weir > desander > headrace tunnel >
   surge shaft > penstock > powerhouse > tailrace, with the risks of
   building in a young, seismic, glaciated mountain range and the
   harm to the river ecosystem.
   Built procedurally with Three.js, no model files needed.

   - Numbered component labels with leader lines + legend
   - View modes: Exterior, Inside (x-ray), Exploded (Francis unit)
     and Risks (hazards to the plant + harm to river and people)
   - "Simulate glacial lake outburst": a flood wave runs the valley
   - Live physics: P = rho*g*Q*H*eta, unit dispatch, head loss,
     environmental flow, spill, sediment shutdown, hydropeaking and a
     river-ecosystem stress rating; the river narrows in the bypassed
     reach as the environmental flow falls
   - Physics panel, legend, risks and tour work without WebGL
   - Builds lazily near the viewport, pauses off-screen,
     honours prefers-reduced-motion
   ============================================================ */
(function () {
    'use strict';

    const canvas = document.getElementById('hy-canvas');
    if (!canvas) return;

    const stage = canvas.parentElement;                 // .hero-visual
    const hero = stage.closest('.hero') || document.body;
    const $ = (sel) => hero.querySelector(sel);
    const $$ = (sel) => Array.prototype.slice.call(hero.querySelectorAll(sel));
    const lerp = (a, b, t) => a + (b - a) * t;
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

    // ============================================================
    //  The modelled plant: 90 MW high-head run-of-river scheme
    // ============================================================
    const SPEC = {
        grossHead: 350,             // m
        designQ: 30,                // m3/s through all units
        unitQ: 10,                  // m3/s per unit
        units: 3,
        headLoss: 18,               // m at design flow (tunnel + penstock friction)
        etaGen: 0.98,
        rho: 1000,
        g: 9.81,
        sedimentLimit: 5,           // kg/m3: units shut down above this
        peakHours: 4,               // evening peak when storing water
        bypassKm: 7                 // river length between weir and tailrace
    };
    const SEASONS = {
        dry: { label: 'Dry winter', flow: 15 },
        pre: { label: 'Pre-monsoon melt', flow: 45 },
        monsoon: { label: 'Monsoon', flow: 180 }
    };

    /** Suspended sediment rises steeply with discharge (fitted rating curve). */
    function sedimentOf(Q) { return 4.06e-4 * Math.pow(Q, 1.78); }

    function unitPoint(q) {
        if (q < 0.3 * SPEC.unitQ) return { n: 0, eta: 0, head: SPEC.grossHead, power: 0, q: 0 };
        const n = Math.min(SPEC.units, Math.ceil(q / SPEC.unitQ - 1e-9));
        const load = q / (n * SPEC.unitQ);
        const eta = 0.94 - 0.4 * (1 - load) * (1 - load);       // Francis efficiency hill, simplified
        const head = SPEC.grossHead - SPEC.headLoss * Math.pow(q / SPEC.designQ, 2);
        return { n: n, eta: eta, head: head, power: SPEC.rho * SPEC.g * q * head * eta * SPEC.etaGen / 1e6, q: q };
    }

    function hydroBalance(s) {
        const Q = s.flow;
        const eflow = Q * s.eflow / 100;
        const avail = Math.max(0, Q - eflow);
        const sed = sedimentOf(Q);
        const shutdown = sed > SPEC.sedimentLimit;
        let qAvg = shutdown ? 0 : Math.min(avail, SPEC.designQ);   // daily mean turbine flow
        const peaking = s.operation === 'peaking' && qAvg > 0 && qAvg < SPEC.designQ * 0.999;
        let qPeak = qAvg;
        let qOff = qAvg;
        if (peaking) {
            qPeak = Math.min(SPEC.designQ, qAvg * 24 / SPEC.peakHours);
            qOff = Math.max(0, (qAvg * 24 - qPeak * SPEC.peakHours) / (24 - SPEC.peakHours));
        } else if (qAvg < 0.3 * SPEC.unitQ) {
            qAvg = qPeak = qOff = 0;                                // too little water for one unit
        }
        const spill = avail - qAvg;
        const bypass = eflow + spill;
        const now = unitPoint(peaking ? qPeak : qAvg);
        const energy = peaking
            ? unitPoint(qPeak).power * SPEC.peakHours + unitPoint(qOff).power * (24 - SPEC.peakHours)
            : now.power * 24;
        const downPeak = bypass + qPeak;
        const downOff = bypass + qOff;
        const swing = downPeak / Math.max(downOff, 0.01);
        const bypassPct = Q > 0 ? bypass / Q : 1;
        let stress = bypassPct >= 0.5 ? 0 : bypassPct >= 0.25 ? 1 : bypassPct >= 0.1 ? 2 : 3;
        if (peaking && swing > 3) stress = Math.min(3, stress + 1);
        return {
            Q: Q, eflow: eflow, sediment: sed, shutdown: shutdown, qAvg: qAvg, qPeak: qPeak, qOff: qOff,
            peaking: peaking, spill: spill, bypass: bypass, bypassPct: bypassPct, now: now, energy: energy,
            downPeak: downPeak, downOff: downOff, swing: swing, stress: stress
        };
    }

    // ============================================================
    //  Components and risks
    //  group: exterior | interior | risk (hazard to the plant) | eco (harm to river and people)
    // ============================================================
    const PART_INFO = {
        glacier: {
            num: 1, name: 'Glacier & snowfields', group: 'exterior', focus: 60, view: [0.55, 1.05],
            desc: 'Snow and glacier melt feed Himalayan rivers in spring and summer, and the monsoon brings most of the rain from June to September. Flow can change more than tenfold between the dry winter and the monsoon, which sets how much power a run-of-river plant can make.'
        },
        dam: {
            num: 2, name: 'Diversion weir & spillway', group: 'exterior', focus: 30, view: [0.95, 1.1],
            desc: 'A low concrete weir raises the river just enough to divert water into the intake. Radial gates on the spillway pass floods and flush sediment. Unlike a large storage dam it holds only a few hours of water, so output follows the river.'
        },
        reservoir: {
            num: 3, name: 'Headpond', group: 'exterior', focus: 34, view: [0.7, 1.05],
            desc: 'The small pond behind the weir lets sand settle and stores a few hours of water. In Peaking mode it fills through the night and day so the plant can run at full power in the evening.'
        },
        penstock: {
            num: 4, name: 'Penstock', group: 'exterior', focus: 32, view: [1.2, 1.15],
            desc: 'A steel pipe drops the water about 350 m down the slope to the powerhouse, where the pressure reaches about 35 bar. The power available is P = ρ · g · Q · H · η, so a high head lets a modest flow make a lot of electricity.'
        },
        powerhouse: {
            num: 5, name: 'Powerhouse', group: 'exterior', focus: 26, view: [1.0, 1.15],
            desc: 'Holds three 30 MW turbine-generator units and the control room. Many Himalayan plants place the powerhouse underground, partly to protect it from landslides and floods. Switch to Inside to see the units.'
        },
        transmission: {
            num: 6, name: 'Transmission line', group: 'exterior', focus: 50, view: [0.6, 1.1],
            desc: 'High-voltage lines carry the power out of the valley to the national grid and to export markets, often the main reason a project is built. The lines need forest clearing and are exposed to landslides and avalanches.'
        },
        intake: {
            num: 7, name: 'Intake & desander', group: 'interior', focus: 26, view: [2.3, 1.0],
            desc: 'Water enters through trash racks into long desander chambers, where it slows down so sand grains larger than about 0.2 mm settle and can be flushed back to the river. This protects the turbines from abrasion.'
        },
        tunnel: {
            num: 8, name: 'Headrace tunnel', group: 'interior', focus: 70, view: [2.4, 0.95],
            desc: 'A tunnel several kilometres long carries the water through the mountain at a gentle slope, so it keeps its height until the penstock. Tunnelling through weak, fractured Himalayan rock is slow and risky, with collapses and sudden water inflows.'
        },
        surge: {
            num: 9, name: 'Surge shaft', group: 'interior', focus: 24, view: [2.3, 1.05],
            desc: 'A vertical shaft near the end of the tunnel absorbs the pressure surges, or water hammer, when the turbines start or stop suddenly. The water level in the shaft swings up and down for several minutes after each change.'
        },
        units: {
            num: 10, name: 'Turbine-generator units', group: 'interior', focus: 18, view: [1.0, 1.0],
            desc: 'Three Francis turbines turn the water’s pressure into rotation, and generators on the same shafts make electricity. A Francis turbine is about 93–94% efficient near its design flow and less at part load, so units are switched on and off as the river changes.'
        },
        tailrace: {
            num: 11, name: 'Tailrace', group: 'interior', focus: 20, view: [1.0, 1.05],
            desc: 'Returns the water to the river below the powerhouse, several kilometres downstream of the weir. Everything between the weir and this point is the bypassed reach.'
        },
        runner: {
            num: 12, name: 'Francis turbine unit', group: 'interior', exploded: true, isolate: true, tint: false, focus: 58, view: [0.9, 1.42],
            desc: 'Water spirals in through the spiral casing; adjustable guide vanes set the flow and swirl, and the curved runner blades take up its pressure and turn. The water leaves through the draft tube, which recovers part of the remaining energy, and the shaft carries the torque up to the generator rotor inside the stator.'
        },
        glof: {
            num: 13, name: 'Glacial lake outburst (GLOF)', group: 'risk', focus: 60, view: [0.5, 1.0],
            desc: 'As glaciers retreat, meltwater collects in lakes held back by loose moraine. An avalanche, landslide or earthquake can breach the moraine and release millions of cubic metres of water and debris within minutes. In October 2023 an outburst of South Lhonak Lake in Sikkim destroyed the 1,200 MW Teesta-III dam at Chungthang. Use “Simulate glacial lake outburst” to watch a flood wave run the valley.'
        },
        cloudburst: {
            num: 14, name: 'Cloudbursts & flash floods', group: 'risk', focus: 60, view: [0.8, 1.1],
            desc: 'Monsoon storms can drop more than 100 mm of rain in an hour on a small catchment, and steep slopes turn it into flash floods and debris flows within minutes. In June 2013 extreme rain and a lake outburst at Kedarnath in Uttarakhand killed thousands of people and damaged several hydropower projects.'
        },
        landslide: {
            num: 15, name: 'Landslides & slope failure', group: 'risk', focus: 45, view: [1.2, 1.1],
            desc: 'Young, fractured rock, deep weathering and heavy rain make Himalayan slopes unstable, and road cuts, blasting and tunnelling can make them worse. A landslide can bury an intake or penstock, or dam the river and create a lake that bursts later. In February 2021 a rock-and-ice avalanche in Chamoli, Uttarakhand, destroyed the Rishiganga plant and flooded the Tapovan-Vishnugad project; more than 200 people died or went missing.'
        },
        quake: {
            num: 16, name: 'Earthquakes & active faults', group: 'risk', focus: 80, view: [0.9, 0.95],
            desc: 'The Himalaya is still rising as the Indian plate pushes beneath Eurasia at about 4–5 cm a year along great thrust faults. Weirs, tunnels and penstocks must survive strong shaking and the landslides it triggers. The magnitude 7.8 Gorkha earthquake in Nepal in 2015 damaged many hydropower plants, mostly through landslides.'
        },
        sediment: {
            num: 17, name: 'Sediment & turbine abrasion', group: 'risk', focus: 30, view: [0.8, 1.05],
            desc: 'Himalayan rivers carry some of the highest sediment loads on Earth, mostly in the monsoon. Quartz sand acts like a sandblaster on turbine blades, so plants shut down when sediment exceeds a few kilograms per cubic metre. The weir also traps sediment that the riverbed and farmland downstream need. Raise the river flow to see the plant shut down.'
        },
        climate: {
            num: 18, name: 'Glacier retreat & changing flows', group: 'risk', focus: 55, view: [0.4, 1.0],
            desc: 'Himalayan glaciers are losing ice faster than in earlier decades; the dashed line shows a larger past extent. In the short term melt adds water and grows glacial lakes; over the coming decades dry-season flows may fall as the ice disappears. Plants designed on past river records may face both bigger floods and lower winter output.'
        },
        dewatered: {
            num: 19, name: 'Dewatered river stretch', group: 'eco', focus: 55, view: [0.9, 0.95],
            desc: 'A run-of-river plant diverts most of the water into its tunnel, leaving several kilometres of river between the weir and the powerhouse with only the environmental flow. Rules often require roughly 10–30% of the lean-season flow to stay in the river. Shallower, warmer water and lost riffles harm aquatic insects, fish and the people who use the river. Lower the environmental flow and watch this stretch shrink.'
        },
        fish: {
            num: 20, name: 'Blocked fish migration', group: 'eco', focus: 26, view: [1.0, 1.15],
            desc: 'Fish such as the endangered golden mahseer and snow trout migrate along Himalayan rivers to spawn and feed. A weir without a working fish pass cuts the river in two, and a cascade of dams can isolate populations completely. Fish passes for steep mountain rivers are difficult to build and are often missing.'
        },
        peaking: {
            num: 21, name: 'Hydropeaking downstream', group: 'eco', focus: 45, view: [0.8, 1.05],
            desc: 'When a plant stores water and releases it only for the evening peak, the river below the powerhouse rises and falls sharply every day. The surges strand fish and insects on drying banks, wash out spawning gravel and endanger people crossing or working in the river. Switch to Peaking to see the daily swing.'
        },
        people: {
            num: 22, name: 'Communities & livelihoods', group: 'eco', focus: 32, view: [0.8, 1.1],
            desc: 'Mountain villages rely on the river for drinking water, irrigation, water mills and fishing, and many rivers are sacred. Projects can bring roads, jobs and electricity, but also displacement, lost farmland and greater exposure to landslides and floods. Fair benefit-sharing and genuine consultation decide whether a project is welcome.'
        }
    };
    const PART_IDS = Object.keys(PART_INFO).sort((a, b) => PART_INFO[a].num - PART_INFO[b].num);
    const isRisk = (p) => p.group === 'risk' || p.group === 'eco';

    const TOUR_STEPS = [
        { part: 'glacier', mode: 'exterior', title: 'Glaciers and the monsoon feed the river', text: 'Meltwater and monsoon rain make Himalayan rivers powerful but very seasonal.' },
        { part: 'dam', mode: 'exterior', title: 'A weir diverts the river', text: 'A low weir lifts the water into the intake; gates pass floods and flush sediment.' },
        { part: 'intake', mode: 'inside', title: 'The desander settles out sand', text: 'In long chambers the water slows so abrasive sand drops out before it reaches the turbines.' },
        { part: 'tunnel', mode: 'inside', title: 'A tunnel keeps the water high', text: 'The headrace tunnel runs kilometres through the mountain at a gentle slope to keep the head.' },
        { part: 'penstock', mode: 'exterior', title: 'The penstock drops 350 m', text: 'The fall builds about 35 bar of pressure at the turbines: P = ρ · g · Q · H · η.' },
        { part: 'runner', mode: 'exploded', title: 'The turbine turns pressure into power', text: 'Guide vanes steer the water onto the runner blades, which spin the generator.' },
        { part: 'dewatered', mode: 'risks', title: 'The river below the weir runs low', text: 'Between the weir and the powerhouse only the environmental flow and any spill remain.' },
        { part: 'glof', mode: 'risks', title: 'Glacial lakes can burst', text: 'Retreating glaciers leave fragile lakes whose outburst floods can destroy plants downstream.' },
        { part: 'quake', mode: 'risks', title: 'The mountains are still moving', text: 'Active faults, earthquakes and landslides threaten weirs, tunnels and penstocks.' }
    ];

    // ============================================================
    //  UI layer (works with or without WebGL)
    // ============================================================
    const ui = {
        selected: null, mode: 'exterior', tour: -1, labels: true, hover: null,
        flow: 45, eflow: 10, operation: 'ror', season: 'pre'
    };
    let viewer = null;
    let tourTimer = 0;

    const el = (id) => document.getElementById(id);
    const hud = {
        flowOut: el('hy-flow-out'), eflowOut: el('hy-eflow-out'),
        inflow: el('hy-inflow'), inflowSub: el('hy-inflow-sub'), turb: el('hy-turb'), turbSub: el('hy-turb-sub'),
        power: el('hy-power'), powerSub: el('hy-power-sub'), energy: el('hy-energy'), energySub: el('hy-energy-sub'),
        bypass: el('hy-bypass'), bypassSub: el('hy-bypass-sub'), spill: el('hy-spill'), spillSub: el('hy-spill-sub'),
        sed: el('hy-sed'), sedSub: el('hy-sed-sub'), swing: el('hy-swing'), swingSub: el('hy-swing-sub'),
        status: el('hy-status'), total: el('hy-total'), stress: el('hy-stress'), stressText: el('hy-stress-text'),
        splitTurb: el('hy-split-turb'), splitEflow: el('hy-split-eflow'), splitSpill: el('hy-split-spill')
    };
    const info = {
        root: el('hy-info'), num: el('hy-info-num'), title: el('hy-info-title'),
        text: el('hy-info-text'), step: el('hy-info-step'), close: el('hy-info-close')
    };
    const flowSlider = el('hy-flow');
    const eflowSlider = el('hy-eflow');
    const stepsRoot = $('.wt-steps');
    const legendRoot = $('.wt-legend');
    const riskRoots = { risk: el('hy-risk-list'), eco: el('hy-eco-list') };
    const tourBtn = $('[data-action="tour"]');
    const labelsBtn = $('[data-action="labels"]');
    const expandBtn = $('[data-action="expand"]');

    function setText(node, text) { if (node) node.textContent = text; }
    function fmt(n, d) { return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); }
    function q(v) { return fmt(v, v < 10 ? 1 : 0) + ' m³/s'; }
    const STRESS = ['Low', 'Moderate', 'High', 'Severe'];
    const STRESS_STATE = ['solar', 'mixed', 'export', 'import'];

    function statusOf(b) {
        if (b.shutdown) return ['idle', 'Sediment at ' + fmt(b.sediment, 1) + ' kg/m³: units shut down to protect the turbines; the whole river is spilled'];
        if (b.now.power <= 0) return ['idle', 'Too little water to run a turbine: all of it stays in the river'];
        return [STRESS_STATE[b.stress], 'Generating ' + fmt(b.now.power, 0) + ' MW; the ' + SPEC.bypassKm + ' km bypassed reach keeps ' + Math.round(b.bypassPct * 100) + '% of the natural flow'];
    }

    function renderHud() {
        const b = hydroBalance(ui);
        setText(hud.flowOut, fmt(ui.flow, 0));
        setText(hud.eflowOut, fmt(ui.eflow, 0));
        setText(hud.inflow, q(b.Q));
        setText(hud.inflowSub, SEASONS[ui.season] && Math.abs(SEASONS[ui.season].flow - ui.flow) < 0.5 ? SEASONS[ui.season].label : 'natural river flow');
        setText(hud.turb, q(b.now.q));
        setText(hud.turbSub, b.now.n ? b.now.n + ' of 3 units running' : 'units stopped');
        setText(hud.power, fmt(b.now.power, 1) + ' MW');
        setText(hud.powerSub, b.now.n ? 'η ' + Math.round(b.now.eta * 100) + '% · net head ' + Math.round(b.now.head) + ' m' : 'no generation');
        setText(hud.energy, fmt(b.energy, 0) + ' MWh');
        setText(hud.energySub, b.peaking ? 'per day, saved for the evening peak' : 'per day at this flow');
        setText(hud.bypass, q(b.bypass));
        setText(hud.bypassSub, Math.round(b.bypassPct * 100) + '% of natural flow');
        setText(hud.spill, q(b.spill));
        setText(hud.spillSub, b.spill > 0.05 ? 'over the weir gates' : 'none, all diverted');
        setText(hud.sed, fmt(b.sediment, b.sediment < 1 ? 2 : 1) + ' kg/m³');
        setText(hud.sedSub, b.shutdown ? 'plant shut down' : b.sediment >= 1 ? 'heavy turbine abrasion' : 'desander copes');
        setText(hud.swing, fmt(b.peaking ? b.swing : 1, 1) + '×');
        setText(hud.swingSub, b.peaking ? 'daily peak ÷ off-peak flow' : 'steady flow downstream');
        setText(hud.total, q(b.Q));
        const pct = (v) => clamp(v / Math.max(b.Q, 0.001) * 100, 0, 100).toFixed(1) + '%';
        if (hud.splitTurb) hud.splitTurb.style.width = pct(b.qAvg);
        if (hud.splitEflow) hud.splitEflow.style.width = pct(b.eflow);
        if (hud.splitSpill) hud.splitSpill.style.width = pct(b.spill);
        if (hud.stress) hud.stress.dataset.level = String(b.stress);
        setText(hud.stressText, STRESS[b.stress]);
        if (hud.status) {
            const st = statusOf(b);
            hud.status.dataset.state = st[0];
            hud.status.textContent = st[1];
        }
        if (flowSlider && Math.abs(parseFloat(flowSlider.value) - ui.flow) > 0.4) flowSlider.value = String(ui.flow);
        return b;
    }

    // ---- Mode, selection, tour ----
    function partAllowed(p, mode) {
        if (isRisk(p)) return mode === 'risks';
        if (p.exploded) return mode === 'exploded';
        if (p.group === 'interior') return mode === 'inside' || mode === 'exploded';
        return true;
    }
    function setMode(mode, moveCamera) {
        ui.mode = mode;
        $$('button[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
        stage.dataset.viewMode = mode;
        if (ui.selected && !partAllowed(PART_INFO[ui.selected], mode)) select(null);
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
        if (!partAllowed(p, ui.mode)) {
            setMode(isRisk(p) ? 'risks' : p.exploded ? 'exploded' : 'inside', false);
        }
        setText(info.num, String(p.num));
        setText(info.title, p.name);
        setText(info.text, p.desc);
        if (info.root) {
            info.root.classList.toggle('is-interior', p.group === 'interior');
            info.root.classList.toggle('is-risk', p.group === 'risk');
            info.root.classList.toggle('is-eco', p.group === 'eco');
        }
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
    function partButton(id) {
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
        return li;
    }
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
    PART_IDS.forEach(id => {
        const p = PART_INFO[id];
        if (isRisk(p)) { if (riskRoots[p.group]) riskRoots[p.group].appendChild(partButton(id)); }
        else if (legendRoot) legendRoot.appendChild(partButton(id));
    });

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
        const root = el('hy-labels');
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
    $$('[data-action="glof"]').forEach(b => b.addEventListener('click', () => {
        stopTour();
        setMode('risks', !ui.selected);
        select('glof', { focus: false });
        if (viewer) {
            viewer.simulateGlof();
            stage.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }));
    if (flowSlider) flowSlider.addEventListener('input', () => {
        ui.flow = parseFloat(flowSlider.value);
        ui.season = '';
        $$('button[data-season]').forEach(x => x.setAttribute('aria-pressed', 'false'));
        renderHud();
    });
    if (eflowSlider) eflowSlider.addEventListener('input', () => { ui.eflow = parseFloat(eflowSlider.value); renderHud(); });
    $$('button[data-season]').forEach(b => b.addEventListener('click', () => {
        ui.season = b.dataset.season;
        ui.flow = SEASONS[ui.season].flow;
        $$('button[data-season]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        renderHud();
    }));
    $$('button[data-operation]').forEach(b => b.addEventListener('click', () => {
        ui.operation = b.dataset.operation;
        $$('button[data-operation]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        renderHud();
    }));
    if (flowSlider) ui.flow = parseFloat(flowSlider.value);
    if (eflowSlider) ui.eflow = parseFloat(eflowSlider.value);
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
        const camera = new THREE.PerspectiveCamera(36, 1, 0.5, 900);
        const V = (x, y, z) => new THREE.Vector3(x, y, z);
        const E = (x, y, z) => new THREE.Euler(x, y, z);

        // --- Lighting ------------------------------------------------------
        const hemi = new THREE.HemisphereLight(0xdbe8ff, 0x34402f, 0.6);
        scene.add(hemi);
        const sunLight = new THREE.DirectionalLight(0xfff1dc, 1.15);
        sunLight.position.set(70, 120, 60);
        sunLight.castShadow = true;
        sunLight.shadow.mapSize.set(2048, 2048);
        sunLight.shadow.camera.near = 10;
        sunLight.shadow.camera.far = 320;
        sunLight.shadow.camera.left = -110;
        sunLight.shadow.camera.right = 110;
        sunLight.shadow.camera.top = 110;
        sunLight.shadow.camera.bottom = -110;
        sunLight.shadow.bias = -0.0012;
        sunLight.target.position.set(0, 0, 0);
        scene.add(sunLight);
        scene.add(sunLight.target);

        // --- Materials -----------------------------------------------------
        const std = (o) => new THREE.MeshStandardMaterial(o);
        const terrainMat = std({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: false });
        const concreteMat = std({ color: 0xc9c5bd, roughness: 0.85 });
        const steelMat = std({ color: 0x8d99a6, metalness: 0.75, roughness: 0.35 });
        const darkMat = std({ color: 0x2a3340, metalness: 0.4, roughness: 0.5 });
        const penstockMat = std({ color: 0x5e6b78, metalness: 0.7, roughness: 0.4 });
        const houseWallMat = std({ color: 0xe9e1d2, roughness: 0.85 });
        const phMat = std({ color: 0xd9dcd5, roughness: 0.7, metalness: 0.1, side: THREE.DoubleSide });
        const roofMats = [0xa63a2c, 0x2f5f8f, 0x4c7a3a, 0x8a5a2b].map(c => std({ color: c, roughness: 0.7 }));
        const waterMat = std({ color: 0xffffff, roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.9, vertexColors: true, side: THREE.DoubleSide });
        const pondMat = std({ color: 0x3f8fc9, roughness: 0.12, metalness: 0.25, transparent: true, opacity: 0.88 });
        const lakeMat = std({ color: 0x46c0c0, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.92 });
        const iceMat = std({ color: 0xe8f4ff, roughness: 0.35, metalness: 0.05 });
        const moraineMat = std({ color: 0x7b6f63, roughness: 1 });
        const copperMat = std({ color: 0xb87333, metalness: 0.9, roughness: 0.32 });
        const xrayMats = [terrainMat, phMat];

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
        function makeBlobTexture() {
            const c = document.createElement('canvas');
            c.width = c.height = 128;
            const ctx = c.getContext('2d');
            const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
            g.addColorStop(0, '#fff');
            g.addColorStop(0.55, '#ddd');
            g.addColorStop(1, '#000');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, 128, 128);
            return new THREE.CanvasTexture(c);
        }
        const blobTex = makeBlobTexture();
        function makeDotTexture() {
            const c = document.createElement('canvas');
            c.width = c.height = 64;
            const ctx = c.getContext('2d');
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(32, 32, 30, 0, Math.PI * 2);
            ctx.fill();
            return new THREE.CanvasTexture(c);
        }
        const dotTex = makeDotTexture();
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

        // ===================================================================
        //  River centreline (x, elevation, z) and terrain
        // ===================================================================
        const RIVER = new THREE.CatmullRomCurve3([
            V(-62, 46, -58), V(-50, 40, -45), V(-36, 32, -31), V(-22, 24, -18), V(-10, 19, -7),
            V(2, 15, 2), V(14, 12, 10), V(26, 9, 18), V(38, 6.5, 28), V(52, 4.5, 40), V(70, 3, 54)
        ], false, 'centripetal');
        const NS = 400;
        const riverPts = RIVER.getSpacedPoints(NS);
        function riverAt(u) { return riverPts[Math.round(clamp(u, 0, 1) * NS)]; }
        function riverNormal(u) {
            const i = Math.round(clamp(u, 0, 1) * NS);
            const a = riverPts[Math.max(0, i - 2)];
            const b = riverPts[Math.min(NS, i + 2)];
            const tx = b.x - a.x;
            const tz = b.z - a.z;
            const l = Math.hypot(tx, tz) || 1;
            return { tx: tx / l, tz: tz / l, nx: tz / l, nz: -tx / l };     // n: right bank looking downstream
        }
        function nearestRiver(x, z) {
            let best = Infinity;
            let bi = 0;
            for (let i = 0; i <= NS; i += 4) {
                const p = riverPts[i];
                const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
                if (d < best) { best = d; bi = i; }
            }
            for (let i = Math.max(0, bi - 4); i <= Math.min(NS, bi + 4); i++) {
                const p = riverPts[i];
                const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
                if (d < best) { best = d; bi = i; }
            }
            return { d: Math.sqrt(best), i: bi, elev: riverPts[bi].y };
        }
        const U_DAM = 0.3;
        const U_PH = 0.64;
        const U_VILLAGE = 0.84;
        const atOffset = (u, off) => { const p = riverAt(u); const n = riverNormal(u); return V(p.x + n.nx * off, p.y, p.z + n.nz * off); };
        const DAM_P = riverAt(U_DAM);
        const DAM_CREST = DAM_P.y + 6;
        const PH_P = atOffset(U_PH, 5);
        const FLATS = [
            { x: PH_P.x, z: PH_P.z, r: 7, y: riverAt(U_PH).y + 0.8 },
            { x: atOffset(U_VILLAGE, 6.5).x, z: atOffset(U_VILLAGE, 6.5).z, r: 6, y: riverAt(U_VILLAGE).y + 1.4 },
            { x: atOffset(U_VILLAGE, -6.5).x, z: atOffset(U_VILLAGE, -6.5).z, r: 6, y: riverAt(U_VILLAGE).y + 1.4 },
            { x: -63, z: -60, r: 9, y: 45.6 }
        ];
        const smooth = (t) => t * t * (3 - 2 * t);
        function noise(x, z) {
            return 0.6 * Math.sin(x * 0.09 + 1.7) * Math.cos(z * 0.085 - 0.4) + 0.4 * Math.sin(x * 0.21 + z * 0.17) + 0.25 * Math.cos(x * 0.37 - z * 0.29 + 2.1);
        }
        function heightAt(x, z) {
            const n = nearestRiver(x, z);
            let h;
            if (n.d < 2.6) h = n.elev - 0.9;
            else {
                const d = n.d - 2.6;
                h = n.elev + 38 * (1 - Math.exp(-d / 13)) + 0.3 * d + noise(x, z) * Math.min(1, d / 18) * 13
                    + 16 * Math.max(0, Math.sin(x * 0.05 + 0.6) * Math.cos(z * 0.047 - 0.3)) * Math.min(1, d / 30)
                    + 0.8 * Math.sin(x * 0.7) * Math.cos(z * 0.6) * Math.min(1, d / 6);
            }
            for (let k = 0; k < FLATS.length; k++) {
                const f = FLATS[k];
                const dd = Math.hypot(x - f.x, z - f.z);
                if (dd < f.r) h = lerp(h, f.y, Math.min(1, smooth(1 - dd / f.r) * 1.6));
            }
            return h;
        }

        const TERRAIN = 170;
        const SEG = 150;
        const terrainGeo = new THREE.PlaneGeometry(TERRAIN, TERRAIN, SEG, SEG);
        terrainGeo.rotateX(-Math.PI / 2);
        const tpos = terrainGeo.attributes.position;
        for (let i = 0; i < tpos.count; i++) tpos.setY(i, heightAt(tpos.getX(i), tpos.getZ(i)));
        terrainGeo.computeVertexNormals();
        const tcol = new Float32Array(tpos.count * 3);
        const nrm = terrainGeo.attributes.normal;
        const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();     // vertex colours are linear
        const cForest = lin(0x2d5530);
        const cMeadow = lin(0x5b7440);
        const cRock = lin(0x6f655b);
        const cRockDark = lin(0x4a4542);
        const cSnow = lin(0xf2f6fa);
        const cBed = lin(0x5c564e);
        const tc = new THREE.Color();
        for (let i = 0; i < tpos.count; i++) {
            const y = tpos.getY(i);
            const ny = nrm.getY(i);
            const x = tpos.getX(i);
            const z = tpos.getZ(i);
            const rv = nearestRiver(x, z);
            if (rv.d < 3.4) tc.copy(cBed);
            else if (y > 64 + noise(z, x) * 5) tc.copy(cSnow).lerp(cRock, ny < 0.5 ? 0.55 : 0);
            else if (y > 44) tc.copy(cRock).lerp(cRockDark, clamp((0.75 - ny) * 2, 0, 1));
            else tc.copy(y < 26 ? cForest : cMeadow).lerp(cRock, clamp((0.72 - ny) * 2.2, 0, 1));
            tcol[i * 3] = tc.r;
            tcol[i * 3 + 1] = tc.g;
            tcol[i * 3 + 2] = tc.b;
        }
        terrainGeo.setAttribute('color', new THREE.BufferAttribute(tcol, 3));
        const terrain = new THREE.Mesh(terrainGeo, terrainMat);
        terrain.receiveShadow = true;
        terrain.castShadow = true;
        scene.add(terrain);
        // A dark skirt makes the terrain read as a diorama block
        const skirt = mesh(new THREE.BoxGeometry(TERRAIN, 6, TERRAIN), std({ color: 0x3a3532, roughness: 1 }), { position: V(0, -3.1, 0) });
        skirt.castShadow = false;
        scene.add(skirt);

        function terrainPatch(cx, cz, rx, rz, mat, lift) {
            const geo = new THREE.PlaneGeometry(rx * 2, rz * 2, 18, 18);
            geo.rotateX(-Math.PI / 2);
            const p = geo.attributes.position;
            for (let i = 0; i < p.count; i++) p.setY(i, heightAt(p.getX(i) + cx, p.getZ(i) + cz) + lift);
            geo.computeVertexNormals();
            const m = new THREE.Mesh(geo, mat);
            m.position.set(cx, 0, cz);
            m.receiveShadow = true;
            return m;
        }

        // ===================================================================
        //  Glacier, glacial lake and moraine
        // ===================================================================
        const glacier = new THREE.Group();
        scene.add(glacier);
        const ice = mesh(new THREE.SphereGeometry(1, 32, 16), iceMat, { position: V(-73, 58, -71) });
        ice.scale.set(13, 7, 17);
        ice.rotation.y = 0.7;
        glacier.add(ice);
        const tongue = mesh(new THREE.SphereGeometry(1, 24, 12), iceMat, { position: V(-67, 49, -65) });
        tongue.scale.set(5, 2.5, 8);
        tongue.rotation.y = 0.75;
        glacier.add(tongue);
        registerPart('glacier', glacier, (t) => t.set(-75, 67, -73), (t) => t.set(-66, 54, -62));

        const glofGroup = new THREE.Group();
        scene.add(glofGroup);
        const lake = mesh(new THREE.CircleGeometry(6.5, 40), lakeMat, { position: V(-63.5, 46.3, -60.5), rotation: E(-Math.PI / 2, 0, 0) });
        lake.castShadow = false;
        glofGroup.add(lake);
        const moraine = mesh(new THREE.TorusGeometry(7, 1.6, 10, 30, Math.PI * 0.9), moraineMat, { position: V(-62.5, 45.6, -59.5), rotation: E(-Math.PI / 2, 0, 0.55) });
        glofGroup.add(moraine);
        const MORAINE_Y = moraine.position.y;
        const LAKE_Y = lake.position.y;
        registerPart('glof', glofGroup, (t) => t.set(-58, 50, -55), (t) => t.set(-55, 42, -50));

        // ===================================================================
        //  River ribbon (widths follow the flows), headpond and weir
        // ===================================================================
        const RIB_START = 8;                                   // skip the lake basin
        const ribCount = NS - RIB_START + 1;
        const ribGeo = new THREE.BufferGeometry();
        const ribPos = new Float32Array(ribCount * 2 * 3);
        const ribCol = new Float32Array(ribCount * 2 * 3);
        const ribNrm = new Float32Array(ribCount * 2 * 3);
        for (let i = 0; i < ribCount * 2; i++) ribNrm[i * 3 + 1] = 1;
        const ribIdx = [];
        for (let i = 0; i < ribCount - 1; i++) {
            const a = i * 2;
            ribIdx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
        ribGeo.setIndex(ribIdx);
        ribGeo.setAttribute('position', new THREE.BufferAttribute(ribPos, 3));
        ribGeo.setAttribute('color', new THREE.BufferAttribute(ribCol, 3));
        ribGeo.setAttribute('normal', new THREE.BufferAttribute(ribNrm, 3));
        const river = new THREE.Mesh(ribGeo, waterMat);
        river.receiveShadow = true;
        river.frustumCulled = false;
        scene.add(river);
        const ribNormals = [];
        for (let i = 0; i < ribCount; i++) ribNormals.push(riverNormal((i + RIB_START) / NS));

        const pondCenter = atOffset(U_DAM - 0.035, 0);
        const pondN = riverNormal(U_DAM - 0.035);
        const pond = mesh(new THREE.PlaneGeometry(22, 26), pondMat, { position: V(pondCenter.x, DAM_CREST - 0.7, pondCenter.z) });
        pond.rotation.set(-Math.PI / 2, 0, Math.atan2(pondN.tx, pondN.tz));
        pond.castShadow = false;
        scene.add(pond);
        registerPart('reservoir', pond, (t) => t.set(pondCenter.x - 2, DAM_CREST + 1, pondCenter.z - 2), (t) => t.set(pondCenter.x, DAM_CREST, pondCenter.z));

        const damN = riverNormal(U_DAM);
        const damYaw = Math.atan2(damN.nx, damN.nz);
        const dam = new THREE.Group();
        dam.position.set(DAM_P.x, DAM_P.y - 1, DAM_P.z);
        dam.rotation.y = damYaw;
        dam.add(mesh(new THREE.BoxGeometry(2.6, 7, 20), concreteMat, { position: V(0, 3.5, 0) }));
        const gates = [];
        for (let i = 0; i < 4; i++) {
            const g = mesh(new THREE.BoxGeometry(0.5, 2.2, 1.6), steelMat, { position: V(1.1, 6.2, -3 + i * 2) });
            gates.push(g);
            dam.add(g);
        }
        for (let i = 0; i < 5; i++) dam.add(mesh(new THREE.BoxGeometry(2.8, 1.2, 0.4), concreteMat, { position: V(0, 7.4, -4 + i * 2) }));
        dam.add(mesh(new THREE.BoxGeometry(3.4, 0.3, 20), darkMat, { position: V(0, 8.1, 0) }));
        scene.add(dam);
        const GATE_Y = gates.map(g => g.position.y);
        registerPart('dam', dam, (t) => dam.localToWorld(t.set(0, 9, -6)), (t) => dam.localToWorld(t.set(0, 4, 0)));

        // ===================================================================
        //  Waterway: intake/desander, tunnel, surge shaft, penstock, powerhouse
        // ===================================================================
        const TUNNEL_OFF = 12;
        const U_SURGE = U_PH - 0.035;
        const intakeP = atOffset(U_DAM - 0.01, 6.5);
        const tunnelPts = [V(intakeP.x, DAM_CREST - 2.5, intakeP.z)];
        for (let k = 1; k <= 12; k++) {
            const u = lerp(U_DAM + 0.02, U_SURGE, k / 12);
            const p = atOffset(u, TUNNEL_OFF);
            tunnelPts.push(V(p.x, lerp(DAM_CREST - 3, DAM_CREST - 5, k / 12), p.z));
        }
        const tunnelCurve = new THREE.CatmullRomCurve3(tunnelPts, false, 'centripetal');
        const tunnelEnd = tunnelPts[tunnelPts.length - 1];

        const intake = new THREE.Group();
        intake.position.copy(intakeP);
        intake.add(mesh(new THREE.BoxGeometry(4, 3, 4), concreteMat, { position: V(0, DAM_CREST - 2.4 - intakeP.y + 1, 0) }));
        const desN = riverNormal(U_DAM + 0.03);
        [-1.2, 0, 1.2].forEach(o => {
            const ch = mesh(new THREE.BoxGeometry(1, 1.4, 12), std({ color: 0x9fb6c8, roughness: 0.6, transparent: true, opacity: 0.85 }));
            const c = atOffset(U_DAM + 0.035, 9 + o);
            ch.position.set(c.x - intakeP.x, DAM_CREST - 3 - intakeP.y, c.z - intakeP.z);
            ch.rotation.y = Math.atan2(desN.tx, desN.tz);
            intake.add(ch);
        });
        scene.add(intake);
        registerPart('intake', intake, (t) => t.set(intakeP.x, DAM_CREST + 0.5, intakeP.z), (t) => t.set(intakeP.x, DAM_CREST - 3, intakeP.z));

        const tunnelGroup = new THREE.Group();
        tunnelGroup.add(mesh(new THREE.TubeGeometry(tunnelCurve, 80, 0.9, 12, false), std({ color: 0x7e8a95, roughness: 0.6, transparent: true, opacity: 0.9 }), { castShadow: false }));
        scene.add(tunnelGroup);
        registerPart('tunnel', tunnelGroup, (t) => tunnelCurve.getPointAt(0.5, t).add(V(0, 1.2, 0)), (t) => tunnelCurve.getPointAt(0.5, t));

        const surgeTopY = heightAt(tunnelEnd.x, tunnelEnd.z) + 1.5;
        const surge = new THREE.Group();
        const surgeH = surgeTopY - tunnelEnd.y;
        surge.add(mesh(new THREE.CylinderGeometry(1.3, 1.3, surgeH, 20, 1, true), std({ color: 0x9aa6b1, roughness: 0.5, side: THREE.DoubleSide }), { position: V(tunnelEnd.x, tunnelEnd.y + surgeH / 2, tunnelEnd.z) }));
        const surgeWater = mesh(new THREE.CylinderGeometry(1.2, 1.2, 1, 20), pondMat, { position: V(tunnelEnd.x, tunnelEnd.y, tunnelEnd.z) });
        surge.add(surgeWater);
        surge.add(mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.6, 20), concreteMat, { position: V(tunnelEnd.x, surgeTopY, tunnelEnd.z) }));
        scene.add(surge);
        const SURGE_LEVEL = lerp(tunnelEnd.y, surgeTopY, 0.65);
        registerPart('surge', surge, (t) => t.set(tunnelEnd.x, surgeTopY + 1.5, tunnelEnd.z), (t) => t.set(tunnelEnd.x, lerp(tunnelEnd.y, surgeTopY, 0.5), tunnelEnd.z));

        const phGround = FLATS[0].y;
        const penstockPts = [];
        for (let k = 0; k <= 30; k++) {
            const t = k / 30;
            const x = lerp(tunnelEnd.x, PH_P.x, t);
            const z = lerp(tunnelEnd.z, PH_P.z, t);
            const y = Math.min(tunnelEnd.y, heightAt(x, z) + 0.9);
            penstockPts.push(V(x, Math.max(y, phGround + 1.4), z));
        }
        const penstockCurve = new THREE.CatmullRomCurve3(penstockPts, false, 'centripetal');
        const penstock = new THREE.Group();
        penstock.add(mesh(new THREE.TubeGeometry(penstockCurve, 60, 0.6, 12, false), penstockMat));
        for (let k = 3; k < 30; k += 4) penstock.add(mesh(new THREE.BoxGeometry(1.6, 0.8, 1.6), concreteMat, { position: penstockPts[k].clone().add(V(0, -0.6, 0)) }));
        scene.add(penstock);
        registerPart('penstock', penstock, (t) => penstockCurve.getPointAt(0.55, t).add(V(0, 1.5, 0)), (t) => penstockCurve.getPointAt(0.5, t));

        // Powerhouse and units
        const phN = riverNormal(U_PH);
        const powerhouse = new THREE.Group();
        powerhouse.position.set(PH_P.x, phGround, PH_P.z);
        powerhouse.rotation.y = Math.atan2(phN.tx, phN.tz);
        powerhouse.add(mesh(new THREE.BoxGeometry(6, 5, 11), phMat, { position: V(0, 2.5, 0) }));
        powerhouse.add(mesh(new THREE.BoxGeometry(6.6, 0.5, 11.6), std({ color: 0x8a949c, roughness: 0.6, metalness: 0.3 }), { position: V(0, 5.2, 0) }));
        scene.add(powerhouse);
        registerPart('powerhouse', powerhouse, (t) => powerhouse.localToWorld(t.set(0, 6.2, 3)), (t) => powerhouse.localToWorld(t.set(0, 2.5, 0)));
        const unitsGroup = new THREE.Group();
        const unitRunners = [];
        [-3.3, 0, 3.3].forEach(z => {
            const u = new THREE.Group();
            u.position.set(0, 0, z);
            u.add(mesh(new THREE.TorusGeometry(1.0, 0.35, 10, 28), steelMat, { position: V(0, 0.9, 0), rotation: E(-Math.PI / 2, 0, 0) }));
            const r = mesh(new THREE.CylinderGeometry(0.55, 0.3, 0.6, 12), copperMat, { position: V(0, 0.9, 0) });
            unitRunners.push(r);
            u.add(r);
            u.add(mesh(new THREE.CylinderGeometry(0.15, 0.15, 1.6, 10), steelMat, { position: V(0, 1.9, 0) }));
            u.add(mesh(new THREE.CylinderGeometry(1.1, 1.1, 1.2, 24), std({ color: 0x3f6fd8, metalness: 0.5, roughness: 0.4 }), { position: V(0, 3.2, 0) }));
            unitsGroup.add(u);
        });
        powerhouse.add(unitsGroup);
        registerPart('units', unitsGroup, (t) => powerhouse.localToWorld(t.set(0, 4.2, -3.3)), (t) => powerhouse.localToWorld(t.set(0, 2, 0)));

        const tailEnd = riverAt(U_PH + 0.012);
        const tailCurve = new THREE.CatmullRomCurve3([powerhouse.localToWorld(V(-2, 0.4, 0)), V((PH_P.x + tailEnd.x) / 2, phGround - 0.3, (PH_P.z + tailEnd.z) / 2), V(tailEnd.x, tailEnd.y - 0.1, tailEnd.z)]);
        const tailrace = new THREE.Group();
        tailrace.add(mesh(new THREE.TubeGeometry(tailCurve, 20, 0.7, 10, false), concreteMat, { castShadow: false }));
        scene.add(tailrace);
        registerPart('tailrace', tailrace, (t) => tailCurve.getPointAt(0.5, t).add(V(0, 1, 0)), (t) => tailCurve.getPointAt(0.5, t));

        // Transmission line across the valley
        const transmission = new THREE.Group();
        const towerTops = [];
        [-8, -22, -38, -56].forEach((off, i) => {
            const p = atOffset(U_PH + 0.02 + i * 0.015, off);
            const base = heightAt(p.x, p.z);
            const tw = new THREE.Group();
            tw.position.set(p.x, base, p.z);
            [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]].forEach(l => {
                const leg = mesh(new THREE.CylinderGeometry(0.08, 0.12, 9, 5), steelMat, { position: V(l[0] * 0.5, 4.5, l[1] * 0.5) });
                leg.rotation.set(-l[1] * 0.06, 0, l[0] * 0.06);
                tw.add(leg);
            });
            tw.add(mesh(new THREE.BoxGeometry(3.6, 0.15, 0.15), steelMat, { position: V(0, 8.6, 0) }));
            transmission.add(tw);
            towerTops.push(V(p.x, base + 8.6, p.z));
        });
        const wireCurve = new THREE.CatmullRomCurve3([powerhouse.localToWorld(V(0, 5.6, 4))].concat(towerTops), false, 'centripetal');
        transmission.add(mesh(new THREE.TubeGeometry(wireCurve, 80, 0.06, 5, false), std({ color: 0x20252b }), { castShadow: false }));
        scene.add(transmission);
        registerPart('transmission', transmission, (t) => t.copy(towerTops[1]).add(V(0, 1.2, 0)), (t) => t.copy(towerTops[1]));

        // ===================================================================
        //  Village (people)
        // ===================================================================
        const village = new THREE.Group();
        const houseSpots = [];
        [6.5, -6.5].forEach(side => {
            for (let k = 0; k < 5; k++) {
                const u = U_VILLAGE + (k - 2) * 0.008;
                const p = atOffset(u, side + (k % 2 ? 1.8 : -1.2) * Math.sign(side));
                houseSpots.push(V(p.x, heightAt(p.x, p.z), p.z));
            }
        });
        houseSpots.forEach((p, i) => {
            const h = new THREE.Group();
            h.position.copy(p);
            h.rotation.y = i * 0.7;
            h.add(mesh(new THREE.BoxGeometry(2, 1.5, 1.6), houseWallMat, { position: V(0, 0.75, 0) }));
            const roof = mesh(new THREE.ConeGeometry(1.5, 1, 4), roofMats[i % roofMats.length], { position: V(0, 2, 0) });
            roof.rotation.y = Math.PI / 4;
            h.add(roof);
            village.add(h);
        });
        // A footbridge
        const vb = atOffset(U_VILLAGE + 0.02, 0);
        const vbN = riverNormal(U_VILLAGE + 0.02);
        village.add(mesh(new THREE.BoxGeometry(0.6, 0.15, 9), std({ color: 0x6b4f37, roughness: 0.8 }), { position: V(vb.x, vb.y + 1.6, vb.z), rotation: E(0, Math.atan2(vbN.nx, vbN.nz), 0) }));
        scene.add(village);
        registerPart('people', village, (t) => t.copy(houseSpots[2]).add(V(0, 3.2, 0)), (t) => t.copy(atOffset(U_VILLAGE, 0)).add(V(0, 2, 0)));

        // ===================================================================
        //  Risk overlays (visible in Risks mode)
        // ===================================================================
        const riskMats = [];
        const overlayMat = (color, opacity) => {
            const m = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0, alphaMap: blobTex, depthWrite: false });
            m.userData.base = opacity;
            riskMats.push(m);
            return m;
        };
        const riskGroups = [];
        function riskGroup() { const g = new THREE.Group(); g.visible = false; scene.add(g); riskGroups.push(g); return g; }

        // Landslide scars (always visible as terrain scars, red halo in Risks mode)
        const scarMat = std({ color: 0x8a6a4c, roughness: 1, transparent: true, opacity: 0.95, alphaMap: blobTex, depthWrite: false });
        const scars = [atOffset(U_PH - 0.025, 20), atOffset(U_DAM + 0.14, -10)];
        const landslide = riskGroup();
        scars.forEach((c, i) => {
            scene.add(terrainPatch(c.x, c.z, 5 + i, 8, scarMat, 0.25));
            landslide.add(terrainPatch(c.x, c.z, 9 + i, 12, overlayMat(0xff3b30, 0.45), 0.45));
            for (let k = 0; k < 6; k++) {
                const bx = c.x + (Math.random() - 0.5) * 6;
                const bz = c.z + (Math.random() - 0.5) * 6;
                scene.add(mesh(new THREE.DodecahedronGeometry(0.5 + Math.random() * 0.6, 0), moraineMat, { position: V(bx, heightAt(bx, bz) + 0.3, bz) }));
            }
        });
        registerPart('landslide', landslide, (t) => t.set(scars[0].x, heightAt(scars[0].x, scars[0].z) + 3, scars[0].z), (t) => t.set(scars[0].x, heightAt(scars[0].x, scars[0].z), scars[0].z));

        // Active fault line across the valley
        const quake = riskGroup();
        const faultPts = [];
        const fc = atOffset(0.47, 0);
        const fn = riverNormal(0.47);
        for (let k = -50; k <= 50; k += 1.5) {
            const x = fc.x + fn.nx * k + fn.tx * Math.sin(k * 0.08) * 4;
            const z = fc.z + fn.nz * k + fn.tz * Math.sin(k * 0.08) * 4;
            faultPts.push(V(x, heightAt(x, z) + 0.6, z));
        }
        const faultMat = new THREE.LineDashedMaterial({ color: 0xff3b30, dashSize: 2.2, gapSize: 1.2, transparent: true, opacity: 0 });
        faultMat.userData.base = 1;
        riskMats.push(faultMat);
        const faultLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(faultPts), faultMat);
        faultLine.computeLineDistances();
        quake.add(faultLine);
        quake.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(faultPts), 120, 0.35, 6, false), overlayMat(0xff3b30, 0.0)));
        registerPart('quake', quake, (t) => t.copy(faultPts[Math.round(faultPts.length * 0.7)]).add(V(0, 2, 0)), (t) => t.copy(fc).add(V(0, 8, 0)));

        // Cloudburst: dark storm cell with heavy rain over a side valley
        const cloudburst = riskGroup();
        const cbC = atOffset(U_DAM + 0.1, -26);
        const cbY = heightAt(cbC.x, cbC.z) + 24;
        const stormMat = std({ color: 0x4b5563, roughness: 1, transparent: true, opacity: 0 });
        stormMat.userData.base = 0.92;
        riskMats.push(stormMat);
        for (let k = 0; k < 9; k++) cloudburst.add(mesh(new THREE.DodecahedronGeometry(3 + Math.random() * 2.5, 1), stormMat, { position: V(cbC.x + (Math.random() - 0.5) * 14, cbY + Math.random() * 3, cbC.z + (Math.random() - 0.5) * 10), castShadow: false }));
        const RAIN = 200;
        const rainGeo = new THREE.BufferGeometry();
        const rainPos = new Float32Array(RAIN * 3);
        const rainSeeds = [];
        for (let i = 0; i < RAIN; i++) {
            const rx = cbC.x + (Math.random() - 0.5) * 16;
            const rz = cbC.z + (Math.random() - 0.5) * 12;
            rainSeeds.push({ x: rx, z: rz, ground: heightAt(rx, rz), p: Math.random() });
        }
        rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
        const rainMat = new THREE.PointsMaterial({ map: dotTex, alphaTest: 0.4, color: 0x9cc7ff, size: 0.35, transparent: true, opacity: 0, depthWrite: false });
        rainMat.userData.base = 0.85;
        riskMats.push(rainMat);
        const rain = new THREE.Points(rainGeo, rainMat);
        rain.frustumCulled = false;
        cloudburst.add(rain);
        registerPart('cloudburst', cloudburst, (t) => t.set(cbC.x, cbY + 5, cbC.z));

        // Sediment plume in the headpond
        const sediment = riskGroup();
        sediment.add(terrainPatch(pondCenter.x, pondCenter.z, 10, 12, overlayMat(0x9b6b3f, 0.75), 0));
        sediment.children[0].geometry.attributes.position.array.forEach((v, i, a) => { if (i % 3 === 1) a[i] = DAM_CREST - 0.5; });
        sediment.children[0].geometry.attributes.position.needsUpdate = true;
        registerPart('sediment', sediment, (t) => t.set(pondCenter.x + 4, DAM_CREST + 1.5, pondCenter.z + 4), (t) => t.set(pondCenter.x, DAM_CREST, pondCenter.z));

        // Former glacier extent
        const climate = riskGroup();
        const extentPts = [];
        for (let k = 0; k <= 64; k++) {
            const a = (k / 64) * Math.PI * 2;
            const x = -68 + Math.cos(a) * 24;
            const z = -64 + Math.sin(a) * 18;
            extentPts.push(V(x, heightAt(x, z) + 1, z));
        }
        const extentMat = new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 2, gapSize: 1.5, transparent: true, opacity: 0 });
        extentMat.userData.base = 0.95;
        riskMats.push(extentMat);
        const extentLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(extentPts), extentMat);
        extentLine.computeLineDistances();
        climate.add(extentLine);
        const extentLabel = textSprite('earlier glacier extent', '#e3f2ff', 2.2);
        extentLabel.position.copy(extentPts[12]).add(V(0, 3, 0));
        climate.add(extentLabel);
        registerPart('climate', climate, (t) => t.copy(extentPts[48]).add(V(0, 2, 0)), (t) => t.set(-66, 52, -62));

        // Dewatered reach and hydropeaking reach highlights along the river
        function riverOverlay(u0, u1, color, opacity, radius) {
            const pts = [];
            for (let u = u0; u <= u1 + 1e-6; u += 0.01) { const p = riverAt(u); pts.push(V(p.x, p.y + 0.4, p.z)); }
            return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 80, radius, 8, false), overlayMat(color, opacity));
        }
        const dewatered = riskGroup();
        dewatered.add(riverOverlay(U_DAM + 0.02, U_PH + 0.01, 0xff8a3d, 0.42, 2.6));
        registerPart('dewatered', dewatered, (t) => t.copy(riverAt((U_DAM + U_PH) / 2 + 0.05)).add(V(0, 2.5, 0)), (t) => t.copy(riverAt((U_DAM + U_PH) / 2)));
        const peaking = riskGroup();
        peaking.add(riverOverlay(U_PH + 0.015, 0.99, 0xb388ff, 0.4, 2.8));
        registerPart('peaking', peaking, (t) => t.copy(riverAt(0.75)).add(V(0, 2.5, 0)), (t) => t.copy(riverAt(0.8)));

        // Fish barrier sign at the weir
        const fish = riskGroup();
        const fishSign = textSprite('✕  no fish pass', '#ff8a80', 2.4);
        fishSign.position.copy(dam.localToWorld(V(3, 11, 4)));
        fish.add(fishSign);
        fish.add(mesh(new THREE.TorusGeometry(2.2, 0.25, 8, 28), overlayMat(0xff3b30, 0.9), { position: dam.localToWorld(V(2.5, 3, 4)), castShadow: false }));
        registerPart('fish', fish, (t) => dam.localToWorld(t.set(3, 6, 4)), (t) => dam.localToWorld(t.set(2, 3, 0)));

        // GLOF halo around the lake
        const glofHalo = riskGroup();
        glofHalo.add(terrainPatch(-60, -57, 14, 14, overlayMat(0xff3b30, 0.4), 0.6));

        // ===================================================================
        //  Exploded Francis unit (above the powerhouse)
        // ===================================================================
        const runner = new THREE.Group();
        scene.add(runner);
        const UNIT_POS = powerhouse.localToWorld(V(0, 88, 0));
        runner.position.copy(UNIT_POS);
        const comps = [];
        function comp(name, y, dy, build, labelSide) {
            const g = new THREE.Group();
            g.position.y = y;
            g.userData = { y: y, dy: dy };
            build(g);
            const sp = textSprite(name, '#ffe082', 0.85);
            sp.position.set(labelSide * (3.6 + sp.scale.x / 2), 0, 0);
            g.add(sp);
            runner.add(g);
            comps.push(g);
            return g;
        }
        comp('Generator stator', 6, 7.5, (g) => {
            g.add(mesh(new THREE.CylinderGeometry(2.4, 2.4, 1.4, 40, 1, true), std({ color: 0x35506e, metalness: 0.6, roughness: 0.4, side: THREE.DoubleSide })));
            [-0.4, 0, 0.4].forEach(y => g.add(mesh(new THREE.TorusGeometry(2.42, 0.08, 6, 40), copperMat, { position: V(0, y, 0), rotation: E(Math.PI / 2, 0, 0) })));
        }, 1);
        const rotor = comp('Rotor with magnet poles', 6, 5, (g) => {
            g.add(mesh(new THREE.CylinderGeometry(1.8, 1.8, 1.1, 32), steelMat));
            for (let k = 0; k < 12; k++) {
                const a = k / 12 * Math.PI * 2;
                g.add(mesh(new THREE.BoxGeometry(0.4, 1.0, 0.5), k % 2 ? std({ color: 0x3f6fd8 }) : std({ color: 0xd84343 }), { position: V(Math.cos(a) * 1.85, 0, Math.sin(a) * 1.85), rotation: E(0, -a, 0) }));
            }
        }, -1);
        comp('Shaft', 3, 2.6, (g) => { g.add(mesh(new THREE.CylinderGeometry(0.3, 0.3, 5, 16), steelMat)); }, 1);
        comp('Guide vanes', 0.2, 1.6, (g) => {
            for (let k = 0; k < 20; k++) {
                const a = k / 20 * Math.PI * 2;
                g.add(mesh(new THREE.BoxGeometry(0.08, 0.7, 0.55), steelMat, { position: V(Math.cos(a) * 2.0, 0, Math.sin(a) * 2.0), rotation: E(0, -a + 0.6, 0) }));
            }
        }, -1);
        const runnerWheel = comp('Runner', 0, 0, (g) => {
            g.add(mesh(new THREE.ConeGeometry(0.7, 1.2, 20), copperMat, { position: V(0, -0.2, 0), rotation: E(Math.PI, 0, 0) }));
            for (let k = 0; k < 13; k++) {
                const a = k / 13 * Math.PI * 2;
                const blade = mesh(new THREE.BoxGeometry(0.9, 0.06, 0.55), copperMat, { position: V(Math.cos(a) * 0.95, 0, Math.sin(a) * 0.95) });
                blade.rotation.set(0.7, -a, 0.35);
                g.add(blade);
            }
            g.add(mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.12, 32), copperMat, { position: V(0, 0.32, 0) }));
        }, 1);
        comp('Spiral casing', 0, -2.2, (g) => {
            g.add(mesh(new THREE.TorusGeometry(2.7, 0.75, 14, 48, Math.PI * 1.8), std({ color: 0x6b7a8a, metalness: 0.6, roughness: 0.4 }), { rotation: E(Math.PI / 2, 0, 0) }));
            g.add(mesh(new THREE.CylinderGeometry(0.75, 0.75, 3, 16), std({ color: 0x6b7a8a, metalness: 0.6, roughness: 0.4 }), { position: V(2.7, 0, 1.4), rotation: E(Math.PI / 2, 0, 0) }));
        }, -1);
        comp('Draft tube', -1.8, -4.5, (g) => {
            g.add(mesh(new THREE.CylinderGeometry(0.9, 1.6, 2.6, 32, 1, true), std({ color: 0x5e6b78, metalness: 0.6, roughness: 0.4, side: THREE.DoubleSide })));
        }, 1);
        registerPart('runner', runner, (t) => runner.localToWorld(t.set(-2.5, comps[0].position.y + 1.2, 0)), (t) => runner.localToWorld(t.set(0, 4.2, 0)));

        // ===================================================================
        //  Particles: river foam, waterway flow, spill, GLOF debris
        // ===================================================================
        const FOAM = 200;
        const foamGeo = new THREE.BufferGeometry();
        foamGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(FOAM * 3), 3));
        const foam = new THREE.Points(foamGeo, new THREE.PointsMaterial({ map: dotTex, alphaTest: 0.4, color: 0xe8f6ff, size: 0.32, transparent: true, opacity: 0.6, depthWrite: false }));
        foam.frustumCulled = false;
        scene.add(foam);
        const foamSeeds = Array.from({ length: FOAM }, () => ({ u: 0.03 + Math.random() * 0.96, lat: Math.random() * 2 - 1, s: 0.6 + Math.random() * 0.8 }));

        const wayCurve = new THREE.CatmullRomCurve3(tunnelPts.concat(penstockPts.slice(1)).concat([powerhouse.localToWorld(V(0, 1, 0))]).concat(tailCurve.points.slice(1)), false, 'centripetal');
        const WAY = 160;
        const wayGeo = new THREE.BufferGeometry();
        wayGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(WAY * 3), 3));
        const wayPts = new THREE.Points(wayGeo, new THREE.PointsMaterial({ map: dotTex, alphaTest: 0.4, color: 0x7fd8ff, size: 0.6, transparent: true, opacity: 0.95, depthWrite: false }));
        wayPts.frustumCulled = false;
        scene.add(wayPts);
        let wayPhase = 0;
        const wayLen = wayCurve.getLength();

        const SPILL = 120;
        const spillGeo = new THREE.BufferGeometry();
        spillGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPILL * 3), 3));
        const spillPts = new THREE.Points(spillGeo, new THREE.PointsMaterial({ map: dotTex, alphaTest: 0.4, color: 0xf2fbff, size: 0.45, transparent: true, opacity: 0.9, depthWrite: false }));
        spillPts.frustumCulled = false;
        scene.add(spillPts);
        const spillSeeds = Array.from({ length: SPILL }, () => ({ z: -3 + Math.floor(Math.random() * 4) * 2 + (Math.random() - 0.5) * 1.2, p: Math.random(), s: 0.7 + Math.random() * 0.6 }));

        const DEBRIS = 420;
        const debrisGeo = new THREE.BufferGeometry();
        debrisGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DEBRIS * 3), 3));
        const debris = new THREE.Points(debrisGeo, new THREE.PointsMaterial({ map: dotTex, alphaTest: 0.4, color: 0xd2a676, size: 2.1, transparent: true, opacity: 0.95, depthWrite: false }));
        debris.frustumCulled = false;
        debris.visible = false;
        scene.add(debris);
        const debrisSeeds = Array.from({ length: DEBRIS }, () => ({ back: Math.random() * Math.random() * 0.12, lat: Math.random() * 2 - 1, h: Math.random() }));

        // ===================================================================
        //  View state
        // ===================================================================
        const state = { xray: 0, xrayGoal: 0, explode: 0, explodeGoal: 0, risk: 0, riskGoal: 0, shift: 0, active: false, skyClock: 0, glofT: -1 };
        const cam = { theta: 0.78, phi: 1.2, radius: 150, target: V(-10, 24, -16) };
        const goal = { theta: cam.theta, phi: cam.phi, radius: cam.radius, target: cam.target.clone() };
        const RADIUS_MIN = 6;
        const RADIUS_MAX = 330;
        let focusPart = null;
        function wrapAngle(a) {
            while (a > Math.PI) a -= Math.PI * 2;
            while (a < -Math.PI) a += Math.PI * 2;
            return a;
        }
        const tunnelMid = tunnelCurve.getPointAt(0.5);
        function viewFor(mode) {
            if (mode === 'inside') return { theta: 2.35, phi: 0.98, radius: 120, target: V(tunnelMid.x, tunnelMid.y - 2, tunnelMid.z) };
            if (mode === 'exploded') return { theta: 0.9, phi: 1.42, radius: 60, target: runner.localToWorld(V(0, 4.2, 0)) };
            if (mode === 'risks') return { theta: 0.72, phi: 0.98, radius: 215, target: V(-4, 18, -6) };
            return { theta: 0.78, phi: 1.2, radius: 150, target: V(-10, 24, -16) };
        }
        function setView(v) {
            goal.theta = cam.theta + wrapAngle(v.theta - cam.theta);
            goal.phi = v.phi;
            goal.radius = v.radius;
            goal.target.copy(v.target);
            focusPart = null;
        }

        // ===================================================================
        //  Labels
        // ===================================================================
        const labelsRoot = el('hy-labels');
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
            if (isRisk(p)) return state.risk > 0.5;
            if (p.exploded) return state.explode > 0.5;
            if (state.explode > 0.5) return false;                        // the unit floats alone in the sky
            if (p.group === 'interior') return state.xray > 0.3;
            return true;
        }
        function layoutLabels(w, h, infoTop) {
            if (!ui.labels) return;
            const narrow = w < 440;
            const compactExterior = state.xray > 0.5 || state.risk > 0.5 || state.explode > 0.5;
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
                L.el.style.zIndex = String(Math.max(1, Math.round(1000 - L.dist * 2)));
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

        // ===================================================================
        //  Selection highlight
        // ===================================================================
        const highlightCache = [];
        function clearHighlight() {
            highlightCache.forEach(e => { e.mesh.material.dispose(); e.mesh.material = e.mat; });
            highlightCache.length = 0;
        }
        function highlight(part) {
            clearHighlight();
            if (part.tint === false || isRisk(part)) return;
            const color = part.group === 'interior' ? 0xffb300 : 0x4caf50;
            part.object.traverse(o => {
                if (!o.isMesh || Array.isArray(o.material)) return;
                let owner = o;
                while (owner && !owner.userData.partId) owner = owner.parent;
                if (!owner || owner.userData.partId !== part.id) return;
                const m = o.material.clone();
                if (!m.emissive) { m.dispose(); return; }
                m.emissive = new THREE.Color(color);
                m.emissiveIntensity = 0.22;
                highlightCache.push({ mesh: o, mat: o.material });
                o.material = m;
            });
        }

        // ===================================================================
        //  Interaction
        // ===================================================================
        const pointer = { x: 0, y: 0, tx: 0, ty: 0, cx: 0, cy: 0, pending: false };
        const raycaster = new THREE.Raycaster();
        const ndc = new THREE.Vector2();
        const pickables = parts.map(p => p.object);
        let drag = null;
        function pickAt(clientX, clientY) {
            const rect = canvas.getBoundingClientRect();
            ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
            raycaster.setFromCamera(ndc, camera);
            const hits = raycaster.intersectObjects(pickables.concat([terrain]), true);
            for (let i = 0; i < hits.length; i++) {
                const obj = hits[i].object;
                if (obj === terrain) {
                    if (state.xray > 0.5) continue;                 // see-through mountain
                    return null;
                }
                if (!obj.isMesh) continue;
                let o = obj;
                let shown = true;
                while (o) { if (!o.visible) { shown = false; break; } o = o.parent; }
                if (!shown) continue;
                o = obj;
                while (o && !o.userData.partId) o = o.parent;
                if (!o) continue;
                const id = o.userData.partId;
                if (id === 'powerhouse' && state.xray > 0.5) continue;
                if (!partAllowed(PART_INFO[id], ui.mode) && !(PART_INFO[id].group === 'exterior')) {
                    if (isRisk(PART_INFO[id])) return id;
                    continue;
                }
                return id;
            }
            return null;
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
                goal.phi = cam.phi = clamp(drag.phi - dy * 0.004, 0.25, 1.48);
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
            else if (k === 'ArrowDown') goal.phi = Math.min(1.48, goal.phi + 0.1);
            else if (k === 'Escape') select(null);
            else return;
            e.preventDefault();
            stopTour();
        });
        function zoomBy(factor) {
            goal.radius = clamp(goal.radius * factor, RADIUS_MIN, RADIUS_MAX);
        }

        // ===================================================================
        //  Sizing
        // ===================================================================
        const size = { w: 1, h: 1 };
        let radiusScale = 1;
        function measureUi() {
            uiRects.length = 0;
            const s = stage.getBoundingClientRect();
            ['.wt-modes', '.wt-tools', '.wt-hint', '.hy-banner'].forEach(sel => {
                const n = stage.querySelector(sel);
                if (!n || n.hidden) return;
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

        // ===================================================================
        //  Glacial lake outburst simulation
        // ===================================================================
        const banner = el('hy-banner');
        const M_PER_UNIT = 100;                                  // diorama scale along the valley
        const WAVE_MS = 8;                                       // typical GLOF front speed, m/s
        const riverLenM = RIVER.getLength() * M_PER_UNIT;
        const minutesTo = (u) => Math.round(u * riverLenM / WAVE_MS / 60);
        const GLOF_DUR = 16;
        function setBanner(text) {
            if (!banner) return;
            if (!text) { banner.hidden = true; return; }
            banner.hidden = false;
            banner.textContent = text;
        }

        // ===================================================================
        //  Frame update
        // ===================================================================
        const clock = new THREE.Clock();
        let running = false;
        let visible = true;
        let rafId = 0;
        const focusTmp = V(0, 0, 0);
        const colA = new THREE.Color();
        const colB = new THREE.Color();
        const cClear = lin(0x5bb0e8);
        const cSilt = lin(0xa98256);
        const cDry = lin(0xff9a4a);
        const cFlood = lin(0xb08550);
        const hexMix = (a, b, t) => {
            const pa = [a >> 16, (a >> 8) & 255, a & 255];
            const pb = [b >> 16, (b >> 8) & 255, b & 255];
            return 'rgb(' + pa.map((v, i) => Math.round(lerp(v, pb[i], t))).join(',') + ')';
        };
        let peakPhase = 0;

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

            const b = hydroBalance(ui);
            const monsoon = clamp((ui.flow - 60) / 140, 0, 1);

            // Peaking time-lapse: one day every 8 s, a 4 h evening peak
            peakPhase = (peakPhase + dt * motionScale / 8) % 1;
            const inPeak = peakPhase > 1 - SPEC.peakHours / 24;
            const qTurbNow = b.peaking ? (inPeak ? b.qPeak : b.qOff) : b.qAvg;
            const downNow = b.bypass + qTurbNow;

            // --- GLOF ---------------------------------------------------------
            let front = -1;
            let flood = 0;
            if (state.glofT >= 0) {
                state.glofT = (performance.now() - state.glofStart) / 1000 * (reduceMotion ? 3 : 1);   // real time, not frame time
                const gt = state.glofT;
                if (gt < 1.2) {
                    flood = 0;
                    setBanner('Moraine breached: millions of cubic metres of water and debris released');
                } else if (gt < 10) {
                    front = lerp(0.02, 1, (gt - 1.2) / 8.8);
                    flood = 1;
                    const where = front < U_DAM ? 'heading for the weir (' + minutesTo(U_DAM) + ' min after the breach)'
                        : front < U_PH ? 'weir overtopped; reaching the powerhouse after ' + minutesTo(U_PH) + ' min'
                            : 'powerhouse flooded; reaching the village after ' + minutesTo(U_VILLAGE) + ' min';
                    setBanner('Flood wave ' + where);
                } else if (gt < GLOF_DUR) {
                    front = 1;
                    flood = 1 - (gt - 10) / (GLOF_DUR - 10);
                    setBanner('Flood receding: weir gates, powerhouse and riverside homes damaged');
                } else {
                    state.glofT = -1;
                    setBanner(null);
                }
            }
            const breach = state.glofT >= 0 ? clamp(state.glofT / 1.2, 0, 1) : 0;
            moraine.position.y = MORAINE_Y - breach * 2.4 * (state.glofT >= 0 ? 1 : 0);
            lake.position.y = LAKE_Y - (state.glofT >= 0 ? clamp(state.glofT / 6, 0, 1) * 1.6 : 0);
            gates.forEach((g, i) => {
                const hit = front > U_DAM ? flood : 0;
                g.position.y = GATE_Y[i] + (b.spill > 0.05 ? Math.min(1.4, 0.3 + b.spill / 60) : 0);
                g.rotation.x = hit * (0.4 + i * 0.15);
            });
            const phHit = front > U_PH ? flood : 0;
            phMat.color.setHex(0xd9dcd5).lerp(cFlood, phHit * 0.6);

            // --- River ribbon --------------------------------------------------
            const sedT = clamp(b.sediment / 4, 0, 1);
            colA.copy(cClear).lerp(cSilt, sedT);
            const risk = state.risk;
            for (let i = 0; i < ribCount; i++) {
                const idx = i + RIB_START;
                const u = idx / NS;
                const p = riverPts[idx];
                const n = ribNormals[i];
                let qLocal;
                if (u < U_DAM) qLocal = b.Q;
                else if (u < U_PH + 0.012) qLocal = b.bypass;
                else qLocal = downNow;
                let width = clamp(3.2 * Math.pow(Math.max(qLocal, 0.2) / 45, 0.35), 0.4, 10);
                let y = p.y - 0.35 + 0.45 * Math.pow(Math.max(qLocal, 0.2) / 45, 0.4);
                let fl = 0;
                if (front >= 0) {
                    const behind = front - u;
                    if (behind >= 0) fl = flood * Math.exp(-behind * 2.5);
                    if (behind < 0 && behind > -0.02) fl = flood * (1 + behind / 0.02);
                }
                width *= 1 + fl * 6;
                y += fl * 4;
                colB.copy(colA);
                if (u > U_DAM && u < U_PH + 0.012) colB.lerp(cDry, risk * 0.55);
                colB.lerp(cFlood, fl);
                const half = width / 2;
                const j = i * 6;
                ribPos[j] = p.x + n.nx * half;
                ribPos[j + 1] = y;
                ribPos[j + 2] = p.z + n.nz * half;
                ribPos[j + 3] = p.x - n.nx * half;
                ribPos[j + 4] = y;
                ribPos[j + 5] = p.z - n.nz * half;
                ribCol[j] = ribCol[j + 3] = colB.r;
                ribCol[j + 1] = ribCol[j + 4] = colB.g;
                ribCol[j + 2] = ribCol[j + 5] = colB.b;
            }
            ribGeo.attributes.position.needsUpdate = true;
            ribGeo.attributes.color.needsUpdate = true;
            pondMat.color.copy(colA);

            // --- Foam -----------------------------------------------------------
            const fArr = foamGeo.attributes.position.array;
            foamSeeds.forEach((s, i) => {
                const qLocal = s.u < U_DAM ? b.Q : s.u < U_PH + 0.012 ? b.bypass : downNow;
                s.u += dt * motionScale * s.s * 0.006 * Math.pow(Math.max(qLocal, 0.5), 0.3);
                if (s.u > 0.995) s.u = 0.03;
                const idx = Math.round(s.u * NS);
                const p = riverPts[idx];
                const n = ribNormals[Math.max(0, idx - RIB_START)] || ribNormals[0];
                const width = clamp(3.2 * Math.pow(Math.max(qLocal, 0.2) / 45, 0.35), 0.4, 10);
                const inPond = s.u > U_DAM - 0.07 && s.u < U_DAM;
                fArr[i * 3] = p.x + n.nx * s.lat * width * 0.4;
                fArr[i * 3 + 1] = inPond ? -50 : p.y - 0.25 + 0.45 * Math.pow(Math.max(qLocal, 0.2) / 45, 0.4);
                fArr[i * 3 + 2] = p.z + n.nz * s.lat * width * 0.4;
            });
            foamGeo.attributes.position.needsUpdate = true;

            // --- Waterway, spill, units ------------------------------------------
            wayPts.visible = state.xray > 0.3 && qTurbNow > 0.1;
            if (wayPts.visible) {
                wayPhase = (wayPhase + dt * motionScale * (4 + qTurbNow * 0.8) / wayLen) % 1;
                const wa = wayGeo.attributes.position.array;
                for (let i = 0; i < WAY; i++) {
                    wayCurve.getPointAt((i / WAY + wayPhase) % 1, focusTmp);
                    wa[i * 3] = focusTmp.x;
                    wa[i * 3 + 1] = focusTmp.y;
                    wa[i * 3 + 2] = focusTmp.z;
                }
                wayGeo.attributes.position.needsUpdate = true;
            }
            spillPts.visible = b.spill > 0.3;
            if (spillPts.visible) {
                const sa = spillGeo.attributes.position.array;
                const rate = clamp(b.spill / 80, 0.15, 1);
                spillSeeds.forEach((s, i) => {
                    s.p = (s.p + dt * motionScale * s.s * (0.6 + rate)) % 1;
                    focusTmp.set(1.6 + s.p * 3.5, 7.2 - s.p * s.p * 7.5, s.z);
                    dam.localToWorld(focusTmp);
                    sa[i * 3] = focusTmp.x;
                    sa[i * 3 + 1] = focusTmp.y;
                    sa[i * 3 + 2] = focusTmp.z;
                });
                spillGeo.attributes.position.needsUpdate = true;
            }
            const spin = qTurbNow > 0 ? (2 + qTurbNow * 0.25) * motionScale : 0;
            unitRunners.forEach(r => { r.rotation.y += spin * dt; });
            [runnerWheel, rotor].forEach(g => g.children.forEach(c => { if (c.isMesh) c.rotation.y += spin * dt * 0.6; }));
            surgeWater.position.y = lerp(tunnelEnd.y, SURGE_LEVEL, 1) + Math.sin(t * 1.3) * 0.5 * motionScale;

            // --- Debris for the GLOF -------------------------------------------------
            debris.visible = front >= 0 && flood > 0.05;
            if (debris.visible) {
                const da = debrisGeo.attributes.position.array;
                debrisSeeds.forEach((s, i) => {
                    const u = clamp(front - s.back, 0.02, 0.995);
                    const idx = Math.round(u * NS);
                    const p = riverPts[idx];
                    const n = ribNormals[Math.max(0, idx - RIB_START)] || ribNormals[0];
                    const wdt = 2.4 * (1 + 6 * flood);
                    da[i * 3] = p.x + n.nx * s.lat * wdt * 0.5;
                    da[i * 3 + 1] = p.y + 1 + s.h * 3 * flood + Math.sin(t * 8 + i) * 0.3 * motionScale;
                    da[i * 3 + 2] = p.z + n.nz * s.lat * wdt * 0.5;
                });
                debrisGeo.attributes.position.needsUpdate = true;
            }

            // --- Rain -------------------------------------------------------------------
            if (cloudburst.visible) {
                const ra = rainGeo.attributes.position.array;
                rainSeeds.forEach((s, i) => {
                    s.p = (s.p + dt * motionScale * 1.4) % 1;
                    ra[i * 3] = s.x;
                    ra[i * 3 + 1] = lerp(cbY - 1, s.ground, s.p);
                    ra[i * 3 + 2] = s.z;
                });
                rainGeo.attributes.position.needsUpdate = true;
            }

            // --- View modes ----------------------------------------------------------
            state.xray += (state.xrayGoal - state.xray) * k;
            state.explode += (state.explodeGoal - state.explode) * k;
            state.risk += (state.riskGoal - state.risk) * k;
            const x = state.xray;
            const fade = x;
            xrayMats.forEach(m => { m.transparent = fade > 0.01; m.depthWrite = fade < 0.5; });
            terrainMat.opacity = lerp(1, 0.2, fade);
            phMat.opacity = lerp(1, 0.18, x);
            terrain.castShadow = fade < 0.5;
            const ex = state.explode;
            runner.visible = ex > 0.02;
            runner.scale.setScalar(Math.max(0.001, ex));
            comps.forEach(c => { c.position.y = c.userData.y + c.userData.dy * ex; });
            const pulse = 0.75 + Math.sin(t * 3) * 0.25 * motionScale;
            riskGroups.forEach(g => { g.visible = state.risk > 0.02; });
            riskMats.forEach(m => { m.opacity = m.userData.base * state.risk * (m.alphaMap ? pulse : 1); });

            // Sky follows season, risk and floods
            state.skyClock += dt;
            if (state.skyClock > 0.25) {
                state.skyClock = 0;
                const storm = Math.max(monsoon * 0.6, state.risk * 0.45, flood * 0.8);
                stage.style.setProperty('--sky-top', hexMix(0x1d4f7a, 0x2b313b, storm));
                stage.style.setProperty('--sky-bottom', hexMix(0x9cc3e0, 0x5c6470, storm));
            }
            sunLight.intensity = 1.15 - Math.max(monsoon * 0.35, flood * 0.4);

            // Highlight follows the x-ray fade
            const glow = 0.22 + Math.sin(t * 4) * 0.08 * motionScale;
            highlightCache.forEach(e => {
                const m = e.mesh.material;
                m.opacity = e.mat.opacity;
                m.transparent = e.mat.transparent;
                m.depthWrite = e.mat.depthWrite;
                m.emissiveIntensity = glow;
            });

            // --- Camera -----------------------------------------------------------------
            if (focusPart) goal.target.copy(focusPart.center(focusTmp));
            if (front >= 0 && state.glofT < 10 && !drag) {                 // follow the flood wave
                const fp = riverAt(Math.min(front, 0.95));
                goal.target.set(fp.x, fp.y + 6, fp.z);
                goal.radius = 110;
                goal.phi = 1.05;
            }
            if (!drag) {
                cam.theta += (goal.theta - cam.theta) * k;
                cam.phi += (goal.phi - cam.phi) * k;
            }
            cam.radius += (goal.radius - cam.radius) * k;
            cam.target.lerp(goal.target, k);
            pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 4);
            pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 4);
            const theta = cam.theta + pointer.x * 0.035;
            const phi = clamp(cam.phi - pointer.y * 0.02, 0.2, 1.5);
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
                state.xrayGoal = mode === 'inside' ? 1 : 0;
                state.explodeGoal = mode === 'exploded' ? 1 : 0;
                state.riskGoal = mode === 'risks' ? 1 : 0;
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
            simulateGlof() {
                state.glofT = 0;
                state.glofStart = performance.now();
                setView(viewFor('risks'));
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
        state.risk = state.riskGoal;
        if (ui.selected) select(ui.selected, { focus: true });
        clock.start();
        render(0.016);
        stage.classList.add('is-ready');
        updateRunState();
    }
})();
