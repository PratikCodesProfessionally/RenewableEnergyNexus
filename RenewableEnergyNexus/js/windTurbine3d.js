/* ============================================================
   Interactive 3D Windrad (wind turbine) explorer
   Built procedurally with Three.js, no model files needed.

   - Numbered component labels with leader lines + legend
   - Orbit (drag), zoom (buttons / keyboard / wheel after a click)
   - View modes: Exterior, Inside (x-ray) and Exploded
   - Animated drive train: rotor > main shaft > planetary gearbox >
     high-speed shaft > brake > generator > cable > transformer
   - Live physics: P = 1/2 * rho * A * v^3 * Cp * eta, rpm, pitch,
     cut-in / rated / cut-out behaviour driven by a wind slider
   - Guided "how electricity is generated" tour
   - Physics panel, legend and tour still work without WebGL
   - Pauses off-screen, honours prefers-reduced-motion
   ============================================================ */
(function () {
    'use strict';

    const canvas = document.getElementById('windrad-canvas');
    if (!canvas) return;

    const stage = canvas.parentElement;                 // .hero-visual
    const hero = stage.closest('.hero') || document.body;
    const $ = (sel) => hero.querySelector(sel);
    const $$ = (sel) => Array.prototype.slice.call(hero.querySelectorAll(sel));
    const lerp = (a, b, t) => a + (b - a) * t;
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

    // ============================================================
    //  Reference turbine the model represents
    // ============================================================
    const SPEC = {
        ratedPowerW: 2.5e6,     // 2.5 MW class
        rotorDiameterM: 100,
        hubHeightM: 80,
        airDensity: 1.225,      // kg/m3, sea level at 15 C
        cpMax: 0.45,            // peak power coefficient (Betz limit 16/27 = 0.593)
        tipSpeedRatio: 7.5,     // lambda = omega * R / v
        cutIn: 3,               // m/s
        cutOut: 25,             // m/s
        gearRatio: 97,          // low-speed to high-speed shaft
        drivetrainEff: 0.95
    };
    SPEC.rotorRadiusM = SPEC.rotorDiameterM / 2;
    SPEC.sweptAreaM2 = Math.PI * SPEC.rotorRadiusM * SPEC.rotorRadiusM;
    // Wind speed at which the rotor first reaches rated power (about 10.7 m/s)
    SPEC.ratedWind = Math.cbrt(SPEC.ratedPowerW /
        (0.5 * SPEC.airDensity * SPEC.sweptAreaM2 * SPEC.cpMax * SPEC.drivetrainEff));

    /** Steady-state operating point for a wind speed v (m/s). */
    function operatingPoint(v) {
        const pAvail = 0.5 * SPEC.airDensity * SPEC.sweptAreaM2 * v * v * v;
        const out = { v: v, pAvail: pAvail, powerW: 0, cp: 0, omega: 0, rpm: 0, genRpm: 0, pitchDeg: 0, state: 'idle' };

        if (v >= SPEC.cutOut) {
            out.state = 'parked';
            out.pitchDeg = 90;                      // feathered, rotor stops
            return out;
        }
        if (v < SPEC.cutIn) {
            out.omega = 0.08 * v;                   // slow idling, no power
            out.rpm = out.omega * 60 / (2 * Math.PI);
            return out;
        }
        // Below rated: hold the optimum tip-speed ratio. Above: hold rated speed.
        const vTrack = Math.min(v, SPEC.ratedWind);
        out.omega = SPEC.tipSpeedRatio * vTrack / SPEC.rotorRadiusM;
        out.rpm = out.omega * 60 / (2 * Math.PI);
        out.genRpm = out.rpm * SPEC.gearRatio;
        out.powerW = Math.min(pAvail * SPEC.cpMax * SPEC.drivetrainEff, SPEC.ratedPowerW);
        out.cp = out.powerW / (pAvail * SPEC.drivetrainEff);
        if (v > SPEC.ratedWind) {
            out.state = 'rated';
            out.pitchDeg = lerp(0, 25, (v - SPEC.ratedWind) / (SPEC.cutOut - SPEC.ratedWind));
        } else {
            out.state = 'generating';
        }
        return out;
    }

    // ============================================================
    //  Component descriptions
    //  view = [theta offset from rotor axis, polar angle] for focusing
    // ============================================================
    const PART_INFO = {
        blade: {
            num: 1, name: 'Rotor blades', group: 'exterior', focus: 14, view: [0.18, 1.5],
            desc: 'Airfoil-shaped composite blades of glass or carbon fibre, 50 to 100 m long. Air flowing faster over the curved suction side lowers its pressure and creates lift, which becomes torque at the hub. The swept area A = πR² sets how much power the rotor can capture: P = ½·ρ·A·v³·Cp, where Cp can never exceed 0.593 (the Betz limit).'
        },
        hub: {
            num: 2, name: 'Hub & pitch system', group: 'exterior', focus: 4.5, view: [0.6, 1.45],
            desc: 'A cast-iron hub joins the three blades to the main shaft. Inside it, pitch bearings and motors turn each blade about its long axis. Pitching regulates power above rated wind and feathers the blades to 90° in a storm, which is the turbine’s primary brake.'
        },
        nacelle: {
            num: 3, name: 'Nacelle', group: 'exterior', focus: 6.5, view: [1.1, 1.32],
            desc: 'The housing on top of the tower that holds the drive train: main shaft, gearbox, brake, generator, power converter and controller. On a utility-scale turbine it weighs 70 to 300 t. Switch to Inside or Exploded to see what is in it.'
        },
        anemometer: {
            num: 4, name: 'Anemometer & wind vane', group: 'exterior', focus: 3.2, view: [1.3, 1.05],
            desc: 'A cup anemometer and a wind vane measure wind speed and direction behind the rotor. The controller uses them to yaw the nacelle into the wind, to start generating at cut-in (about 3 m/s) and to shut down above cut-out (about 25 m/s).'
        },
        tower: {
            num: 5, name: 'Tubular steel tower', group: 'exterior', focus: 14, view: [0.2, 1.5],
            desc: 'An 80 to 120 m tower lifts the rotor into stronger, steadier wind. Wind speed grows with height following the shear law v₂ = v₁·(h₂/h₁)^α, and power grows with v³, so height pays off. The tower carries the power cables and a ladder or lift, and passes thrust and bending loads to the foundation.'
        },
        foundation: {
            num: 6, name: 'Foundation', group: 'exterior', focus: 5.5, view: [0.35, 1.15],
            desc: 'A reinforced-concrete gravity base of roughly 400 to 600 m³, or a steel monopile offshore. It anchors several hundred tonnes of structure against the overturning moment created by rotor thrust.'
        },
        transformer: {
            num: 7, name: 'Transformer & grid link', group: 'exterior', focus: 5, view: [0.9, 1.2],
            desc: 'The generator delivers about 690 V. A transformer steps this up to the wind-farm collector voltage of 10 to 35 kV, which cuts resistive I²R losses. The farm substation raises it again to 110 to 400 kV for the transmission grid.'
        },
        shaft: {
            num: 8, name: 'Main (low-speed) shaft', group: 'interior', focus: 3.4, view: [1.3, 1.32],
            desc: 'Carries rotor torque, several meganewton-metres on a large turbine, into the gearbox at only 10 to 20 rpm. The main bearing on the cast bedplate supports it and also takes the rotor thrust.'
        },
        gearbox: {
            num: 9, name: 'Planetary gearbox', group: 'interior', focus: 3, view: [1.3, 1.32],
            desc: 'Raises the speed about 1:100, for example 15 rpm to 1,500 rpm, so a compact generator can run near grid-synchronous speed. In the planetary stage the carrier turns with the main shaft, the planets roll inside a fixed ring gear and spin the central sun gear faster, with ratio 1 + R_ring / R_sun. The model shows one stage; real gearboxes add helical stages, and direct-drive turbines have none.'
        },
        brake: {
            num: 10, name: 'Mechanical disc brake', group: 'interior', focus: 2.6, view: [1.3, 1.32],
            desc: 'Sits on the high-speed shaft, where torque is about 100 times lower than at the rotor, so a small caliper can hold it. It parks the rotor for maintenance and backs up the aerodynamic brake of feathered blades.'
        },
        generator: {
            num: 11, name: 'Generator', group: 'interior', focus: 3, view: [1.3, 1.32],
            desc: 'Turns rotation into electricity by electromagnetic induction. Magnets on the spinning rotor (red north, blue south poles) sweep past copper stator windings, and the changing magnetic flux induces a voltage, as Faraday’s law states: ε = −N·dΦ/dt. Three windings spaced 120° apart give three-phase AC at about 690 V, typically from a doubly-fed induction or permanent-magnet synchronous generator.'
        },
        converter: {
            num: 12, name: 'Power converter & controller', group: 'interior', focus: 2.8, view: [1.3, 1.32],
            desc: 'An AC to DC to AC converter decouples the variable rotor speed from the fixed 50 Hz grid frequency and controls active and reactive power. The same cabinet runs the control loops that command blade pitch and nacelle yaw.'
        },
        yaw: {
            num: 13, name: 'Yaw system', group: 'interior', focus: 3.4, view: [1.3, 1.5],
            desc: 'A toothed slewing ring between tower and nacelle, turned by electric yaw motors, points the rotor into the wind reported by the vane. Captured power falls roughly with cos³ of the yaw error, so even 10° of misalignment costs about 4%.'
        },
        cable: {
            num: 14, name: 'Power cables', group: 'interior', focus: 12, view: [1.0, 1.5],
            desc: 'Flexible cables carry the generator output down the tower to the transformer. A hanging loop lets the nacelle yaw. After a few full turns in one direction, the controller yaws back to untwist them.'
        }
    };
    const PART_IDS = Object.keys(PART_INFO).sort((a, b) => PART_INFO[a].num - PART_INFO[b].num);

    const TOUR_STEPS = [
        { part: 'blade', mode: 'exterior', title: 'Wind creates lift on the blades', text: 'Moving air flows over the airfoil blades. The pressure difference creates lift and torque, turning the rotor at 10 to 20 rpm.' },
        { part: 'shaft', mode: 'inside', title: 'The rotor turns the main shaft', text: 'The hub drives the low-speed main shaft, which delivers large torque at low speed into the nacelle.' },
        { part: 'gearbox', mode: 'inside', title: 'The gearbox raises the speed', text: 'Gear stages raise the speed about 1:100, to roughly 1,500 rpm at the generator.' },
        { part: 'generator', mode: 'inside', title: 'The generator induces current', text: 'Spinning magnets change the magnetic flux through copper windings, and by Faraday’s law this induces a three-phase AC voltage of about 690 V.' },
        { part: 'cable', mode: 'inside', title: 'Cables carry power to the grid', text: 'The converter matches the grid frequency, cables carry the current down the tower, and a transformer raises the voltage for long-distance transmission.' },
        { part: 'yaw', mode: 'exploded', title: 'Control keeps it efficient and safe', text: 'The anemometer and vane feed the controller, which yaws the nacelle into the wind and pitches the blades, feathering them above 25 m/s.' }
    ];

    const STATUS_TEXT = {
        idle: 'Idling: wind is below the 3 m/s cut-in speed',
        generating: 'Generating: rotor tracks the optimum tip-speed ratio λ = 7.5',
        rated: 'Rated 2.5 MW: blades pitch to shed the excess power',
        parked: 'Storm shutdown: above 25 m/s the blades feather to 90°'
    };

    // ============================================================
    //  UI layer (works with or without WebGL)
    // ============================================================
    const ui = { selected: null, mode: 'exterior', tour: -1, windBase: 8, labels: true, hover: null };
    let viewer = null;                                  // set once the 3D scene is ready
    let tourTimer = 0;

    const hud = {
        windMean: $('#wt-wind-mean'), wind: $('#wt-wind'), rpm: $('#wt-rpm'), gen: $('#wt-gen'),
        power: $('#wt-power'), avail: $('#wt-avail'), pitch: $('#wt-pitch'), cp: $('#wt-cp'),
        status: $('#wt-status'), bar: $('#wt-power-bar')
    };
    const info = {
        root: $('#wt-info'), num: $('#wt-info-num'), title: $('#wt-info-title'),
        text: $('#wt-info-text'), step: $('#wt-info-step'), close: $('#wt-info-close')
    };
    const slider = $('#wt-wind-slider');
    const stepsRoot = $('.wt-steps');
    const legendRoot = $('.wt-legend');
    const tourBtn = $('[data-action="tour"]');
    const labelsBtn = $('[data-action="labels"]');
    const expandBtn = $('[data-action="expand"]');

    function setText(el, text) { if (el) el.textContent = text; }
    function fmt(n, d) { return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); }
    function formatPower(w) { return w >= 1e6 ? fmt(w / 1e6, 2) + ' MW' : fmt(Math.round(w / 1e3), 0) + ' kW'; }

    function renderHud(op) {
        setText(hud.wind, fmt(op.v, 1) + ' m/s');
        setText(hud.rpm, fmt(op.rpm, 1) + ' rpm');
        setText(hud.gen, fmt(Math.round(op.genRpm), 0) + ' rpm');
        setText(hud.power, formatPower(op.powerW));
        setText(hud.avail, formatPower(op.pAvail));
        setText(hud.pitch, fmt(op.pitchDeg, 0) + '°');
        setText(hud.cp, fmt(op.cp, 2));
        if (hud.bar) hud.bar.style.width = (op.powerW / SPEC.ratedPowerW * 100).toFixed(1) + '%';
        if (hud.status) {
            hud.status.textContent = STATUS_TEXT[op.state];
            hud.status.dataset.state = op.state;
        }
    }

    function setMode(mode, moveCamera) {
        ui.mode = mode;
        $$('button[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
        stage.dataset.viewMode = mode;
        if (mode === 'exterior' && ui.selected && PART_INFO[ui.selected].group === 'interior') select(null);
        if (viewer) viewer.setMode(mode, moveCamera);
    }

    function select(id, opts) {
        opts = opts || {};
        ui.selected = id || null;
        $$('[data-part]').forEach(el => el.classList.toggle('is-active', el.dataset.part === ui.selected));
        if (!ui.selected) {
            if (info.root) info.root.hidden = true;
            stage.classList.remove('has-selection');
            $$('.wt-step').forEach(b => b.classList.remove('is-active'));
            if (viewer) viewer.select(null, false);
            return;
        }
        const p = PART_INFO[ui.selected];
        if (p.group === 'interior' && ui.mode === 'exterior') setMode('inside', false);
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

    // Steps list
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

    // Legend (numbered parts list)
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

    // Toolbar and panel controls
    $$('button[data-mode]').forEach(b => b.addEventListener('click', () => { stopTour(); setMode(b.dataset.mode, true); }));
    $$('.wt-toolbar button').forEach(b => b.addEventListener('click', () => stage.classList.add('has-interacted')));
    $$('button[data-zoom]').forEach(b => b.addEventListener('click', () => {
        stopTour();
        if (viewer) viewer.zoomBy(b.dataset.zoom === 'in' ? 0.72 : 1.38);
    }));
    const resetBtn = $('[data-action="reset"]');
    if (resetBtn) resetBtn.addEventListener('click', () => {
        stopTour();
        select(null);
        setMode('exterior', true);
    });
    if (labelsBtn) labelsBtn.addEventListener('click', () => {
        ui.labels = !ui.labels;
        labelsBtn.setAttribute('aria-pressed', String(ui.labels));
        const root = $('#wt-labels');
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
    if (slider) {
        ui.windBase = parseFloat(slider.value) || ui.windBase;
        slider.addEventListener('input', () => {
            ui.windBase = parseFloat(slider.value);
            setText(hud.windMean, fmt(ui.windBase, 1));
            if (!viewer) renderHud(operatingPoint(ui.windBase));
        });
    }
    setText(hud.windMean, fmt(ui.windBase, 1));
    renderHud(operatingPoint(ui.windBase));

    // ============================================================
    //  3D bootstrap
    // ============================================================
    function showFallback() {
        stage.classList.add('is-fallback');
        stage.classList.remove('is-ready');
        hero.classList.add('wt-no3d');
        viewer = null;
        renderHud(operatingPoint(ui.windBase));
    }

    // Three.js is loaded on demand so other scripts never wait on it.
    // The promise is shared with the other explorers on the page.
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

    // Skip the download entirely when WebGL is unavailable
    const probe = document.createElement('canvas');
    const hasWebGL = !!(window.WebGLRenderingContext &&
        (probe.getContext('webgl') || probe.getContext('experimental-webgl')));
    if (!hasWebGL) {
        showFallback();
        return;
    }
    loadThree(init3D);

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
        const mqStaticInfo = window.matchMedia('(max-width: 600px)');   // info card sits below the stage

        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setClearColor(0x000000, 0);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.outputEncoding = THREE.sRGBEncoding;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 120);

        // --- Lighting -------------------------------------------
        scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x1d3a2a, 0.55));
        const key = new THREE.DirectionalLight(0xfff4e0, 1.15);
        key.position.set(6, 10, 7);
        key.castShadow = true;
        key.shadow.mapSize.set(1024, 1024);
        key.shadow.camera.near = 1;
        key.shadow.camera.far = 40;
        key.shadow.camera.left = -8;
        key.shadow.camera.right = 8;
        key.shadow.camera.top = 10;
        key.shadow.camera.bottom = -4;
        key.shadow.bias = -0.0005;
        scene.add(key);
        const fill = new THREE.DirectionalLight(0x8fd3ff, 0.35);
        fill.position.set(-8, 4, -2);
        scene.add(fill);
        const rim = new THREE.DirectionalLight(0xffc107, 0.6);   // brand amber rim light
        rim.position.set(-4, 6, -9);
        scene.add(rim);

        // --- Materials ------------------------------------------
        const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf3f5f8, metalness: 0.15, roughness: 0.42 });
        const bladeMat = new THREE.MeshStandardMaterial({ color: 0xf7f8fb, metalness: 0.1, roughness: 0.35, side: THREE.DoubleSide });
        const darkMat = new THREE.MeshStandardMaterial({ color: 0x2a3340, metalness: 0.6, roughness: 0.35 });
        const steelMat = new THREE.MeshStandardMaterial({ color: 0x9aa5b1, metalness: 0.85, roughness: 0.3 });
        const copperMat = new THREE.MeshStandardMaterial({ color: 0xb87333, metalness: 0.9, roughness: 0.32 });
        const brakeMat = new THREE.MeshStandardMaterial({ color: 0x8a3b2e, metalness: 0.7, roughness: 0.4 });
        const magnetN = new THREE.MeshStandardMaterial({ color: 0xd84343, metalness: 0.4, roughness: 0.45 });
        const magnetS = new THREE.MeshStandardMaterial({ color: 0x3f6fd8, metalness: 0.4, roughness: 0.45 });
        const caseMat = new THREE.MeshStandardMaterial({ color: 0x3a7ca5, metalness: 0.4, roughness: 0.5, transparent: true, opacity: 0.28, depthWrite: false });
        const statorMat = new THREE.MeshStandardMaterial({
            color: 0x35506e, metalness: 0.6, roughness: 0.4, emissive: 0x2a6fb0, emissiveIntensity: 0,
            transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide
        });
        const cableMat = new THREE.MeshStandardMaterial({ color: 0xffc107, emissive: 0x7a5a00, emissiveIntensity: 0.6, roughness: 0.6 });
        const accentMat = new THREE.MeshStandardMaterial({ color: 0xffc107, metalness: 0.3, roughness: 0.4, emissive: 0x3a2a00, emissiveIntensity: 0.6 });
        const ledMat = new THREE.MeshStandardMaterial({ color: 0x4caf50, emissive: 0x2e7d32, emissiveIntensity: 1.2 });
        const housingMat = whiteMat.clone();         // fades in x-ray mode
        const towerMat = whiteMat.clone();           // fades in x-ray mode

        // --- Ground ---------------------------------------------
        function makeFadeTexture() {
            const c = document.createElement('canvas');
            c.width = c.height = 256;
            const ctx = c.getContext('2d');
            const g = ctx.createRadialGradient(128, 128, 20, 128, 128, 128);
            g.addColorStop(0, '#fff');
            g.addColorStop(0.55, '#fff');
            g.addColorStop(1, '#000');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, 256, 256);
            return new THREE.CanvasTexture(c);
        }
        const ground = new THREE.Mesh(
            new THREE.CircleGeometry(8, 64),
            new THREE.MeshStandardMaterial({ color: 0x1b3b2a, roughness: 1, metalness: 0, transparent: true, opacity: 0.9, alphaMap: makeFadeTexture() })
        );
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        scene.add(ground);
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.9, 1.25, 64),
            new THREE.MeshBasicMaterial({ color: 0x4caf50, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.01;
        scene.add(ring);

        // --- Helpers --------------------------------------------
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
        const V = (x, y, z) => new THREE.Vector3(x, y, z);
        const E = (x, y, z) => new THREE.Euler(x, y, z);

        const parts = [];
        const partById = {};
        const tmpBox = new THREE.Box3();
        function registerPart(id, object, anchorFn, explode, centerFn) {
            const def = Object.assign({ id: id }, PART_INFO[id], {
                object: object,
                anchor: anchorFn,
                center: centerFn || ((t) => tmpBox.setFromObject(object).getCenter(t)),
                explode: explode || null,
                base: object.position.clone()
            });
            object.userData.partId = id;
            parts.push(def);
            partById[id] = def;
            return def;
        }

        // --- Turbine --------------------------------------------
        const turbine = new THREE.Group();
        scene.add(turbine);

        const NACELLE_Y = 6.5;
        const TOWER_BASE = 0.18;
        const TOWER_H = NACELLE_Y - 0.3 - TOWER_BASE;      // tower top meets the nacelle floor

        // Foundation
        const foundation = new THREE.Group();
        foundation.add(mesh(new THREE.CylinderGeometry(0.55, 0.7, 0.18, 48), darkMat, { position: V(0, 0.09, 0) }));
        turbine.add(foundation);
        registerPart('foundation', foundation, (t) => t.set(0.62, 0.1, 0.3));

        // Tower (tapered)
        const tower = mesh(new THREE.CylinderGeometry(0.17, 0.36, TOWER_H, 48), towerMat, { position: V(0, TOWER_H / 2 + TOWER_BASE, 0) });
        turbine.add(tower);
        registerPart('tower', tower, (t) => t.set(0.27, 3.3, 0.05));

        // Transformer kiosk near the tower base
        const transformer = new THREE.Group();
        transformer.position.set(1.75, 0, -1.05);
        transformer.add(mesh(new THREE.BoxGeometry(0.62, 0.5, 0.46), new THREE.MeshStandardMaterial({ color: 0x5f6f66, metalness: 0.5, roughness: 0.5 }), { position: V(0, 0.25, 0) }));
        for (let i = 0; i < 5; i++) {
            transformer.add(mesh(new THREE.BoxGeometry(0.02, 0.4, 0.42), steelMat, { position: V(-0.33 - i * 0.045, 0.25, 0) }));
        }
        transformer.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.18, 12), accentMat, { position: V(0.12, 0.59, 0) }));
        transformer.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.18, 12), accentMat, { position: V(-0.08, 0.59, 0) }));
        turbine.add(transformer);
        registerPart('transformer', transformer, (t) => transformer.localToWorld(t.set(0.02, 0.62, 0)));

        // Nacelle (yaws to face the wind)
        const nacelle = new THREE.Group();
        nacelle.position.y = NACELLE_Y;
        turbine.add(nacelle);

        // Cover: housing, tail, beacon, anemometer. Lifts off when exploded.
        const cover = new THREE.Group();
        nacelle.add(cover);
        const housing = mesh(new THREE.BoxGeometry(0.68, 0.6, 1.55), housingMat, { position: V(0, 0, -0.25) });
        cover.add(housing);
        const edgeMat = new THREE.LineBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0 });
        const housingEdges = new THREE.LineSegments(new THREE.EdgesGeometry(housing.geometry), edgeMat);
        housingEdges.position.copy(housing.position);
        cover.add(housingEdges);
        const tail = mesh(new THREE.SphereGeometry(0.31, 32, 16, 0, Math.PI * 2, 0, Math.PI), housingMat, { position: V(0, 0, -1.02), rotation: E(-Math.PI / 2, 0, 0) });
        tail.scale.set(1.08, 0.97, 1.1);
        cover.add(tail);
        cover.add(mesh(new THREE.SphereGeometry(0.05, 16, 12), accentMat, { position: V(0, 0.34, -0.45) }));
        registerPart('nacelle', cover, (t) => cover.localToWorld(t.set(0, 0.3, -0.2)), V(0, 1.5, 0),
            (t) => housing.getWorldPosition(t));

        // Anemometer and wind vane on the rear of the cover
        const anemometer = new THREE.Group();
        anemometer.position.set(0, 0.3, -0.82);
        anemometer.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.34, 10), steelMat, { position: V(0, 0.17, 0) }));
        const cups = new THREE.Group();
        cups.position.y = 0.34;
        for (let i = 0; i < 3; i++) {
            const a = (i * Math.PI * 2) / 3;
            cups.add(mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.07, 6), steelMat, { position: V(Math.cos(a) * 0.035, 0, Math.sin(a) * 0.035), rotation: E(0, -a, Math.PI / 2) }));
            cups.add(mesh(new THREE.SphereGeometry(0.022, 10, 8, 0, Math.PI), darkMat, { position: V(Math.cos(a) * 0.07, 0, Math.sin(a) * 0.07), rotation: E(0, -a + Math.PI / 2, 0) }));
        }
        anemometer.add(cups);
        anemometer.add(mesh(new THREE.BoxGeometry(0.01, 0.06, 0.16), darkMat, { position: V(0.06, 0.2, -0.08) }));
        cover.add(anemometer);
        registerPart('anemometer', anemometer, (t) => cups.localToWorld(t.set(0, 0.03, 0)), null,
            (t) => cups.getWorldPosition(t));

        // Front bearing housing (the nacelle nose)
        nacelle.add(mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.3, 32), darkMat, { position: V(0, 0, 0.65), rotation: E(Math.PI / 2, 0, 0) }));

        // --- Drive train ----------------------------------------
        const interior = new THREE.Group();
        nacelle.add(interior);

        // Bedplate
        interior.add(mesh(new THREE.BoxGeometry(0.56, 0.04, 1.4), darkMat, { position: V(0, -0.26, -0.25) }));

        // Main shaft and main bearing
        const shaftGroup = new THREE.Group();
        const mainShaft = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.72, 24), steelMat, { position: V(0, 0, 0.29), rotation: E(Math.PI / 2, 0, 0) });
        shaftGroup.add(mainShaft);
        shaftGroup.add(mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.1, 32), darkMat, { position: V(0, 0, 0.46), rotation: E(Math.PI / 2, 0, 0) }));
        shaftGroup.add(mesh(new THREE.BoxGeometry(0.2, 0.12, 0.1), darkMat, { position: V(0, -0.19, 0.46) }));
        interior.add(shaftGroup);
        registerPart('shaft', shaftGroup, (t) => shaftGroup.localToWorld(t.set(0, 0.07, 0.2)), V(0, 0, 0.9),
            (t) => shaftGroup.localToWorld(t.set(0, 0, 0.29)));

        // Planetary gearbox
        function makeGearGeometry(teeth, radius, depth) {
            const shape = new THREE.Shape();
            const inner = radius * 0.8;
            const step = (Math.PI * 2) / teeth;
            for (let i = 0; i < teeth; i++) {
                const a0 = i * step;
                const pts = [[radius, a0], [radius, a0 + step * 0.3], [inner, a0 + step * 0.5], [inner, a0 + step * 0.8]];
                pts.forEach((p, j) => {
                    const x = Math.cos(p[1]) * p[0];
                    const y = Math.sin(p[1]) * p[0];
                    if (i === 0 && j === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
                });
            }
            shape.closePath();
            const hole = new THREE.Path();
            hole.absarc(0, 0, radius * 0.22, 0, Math.PI * 2, true);
            shape.holes.push(hole);
            const g = new THREE.ExtrudeGeometry(shape, { depth: depth, bevelEnabled: false, curveSegments: 4 });
            g.translate(0, 0, -depth / 2);
            return g;
        }
        const gearbox = new THREE.Group();
        gearbox.position.z = -0.1;
        const R_RING = 0.19;
        const R_SUN = 0.05;
        const R_PLANET = (R_RING - R_SUN) / 2;
        const R_CARRIER = R_SUN + R_PLANET;
        const SUN_RATIO = 1 + R_RING / R_SUN;              // sun speed / carrier speed with a fixed ring
        const caseGeo = new THREE.BoxGeometry(0.5, 0.5, 0.3);
        gearbox.add(mesh(caseGeo, caseMat, { castShadow: false }));
        gearbox.add(new THREE.LineSegments(new THREE.EdgesGeometry(caseGeo), new THREE.LineBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.5 })));
        gearbox.add(mesh(new THREE.TorusGeometry(R_RING + 0.02, 0.02, 10, 56), steelMat));
        const carrier = new THREE.Group();
        const planets = [];
        for (let i = 0; i < 3; i++) {
            const a = (i * Math.PI * 2) / 3;
            const pos = V(Math.cos(a) * R_CARRIER, Math.sin(a) * R_CARRIER, 0);
            const p = mesh(makeGearGeometry(11, R_PLANET, 0.09), steelMat, { position: pos });
            planets.push(p);
            carrier.add(p);
            carrier.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.2, 8), darkMat, { position: pos, rotation: E(Math.PI / 2, 0, 0) }));
        }
        gearbox.add(carrier);
        const sun = mesh(makeGearGeometry(8, R_SUN, 0.1), copperMat);
        gearbox.add(sun);
        interior.add(gearbox);
        registerPart('gearbox', gearbox, (t) => gearbox.localToWorld(t.set(0, 0.25, 0)), V(0, 0, 0.42));

        // High-speed shaft
        const hsShaft = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.5, 20), steelMat, { position: V(0, 0, -0.45), rotation: E(Math.PI / 2, 0, 0) });
        interior.add(hsShaft);

        // Disc brake and caliper
        const brake = new THREE.Group();
        brake.position.z = -0.3;
        const brakeDisc = mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.025, 40), brakeMat, { rotation: E(Math.PI / 2, 0, 0) });
        brake.add(brakeDisc);
        for (let i = 0; i < 8; i++) {              // vent holes make the disc rotation visible
            const a = (i / 8) * Math.PI * 2;
            brakeDisc.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 8), darkMat, { position: V(Math.cos(a) * 0.09, 0, Math.sin(a) * 0.09) }));
        }
        brake.add(mesh(new THREE.BoxGeometry(0.06, 0.08, 0.07), darkMat, { position: V(0, 0.13, 0) }));
        interior.add(brake);
        registerPart('brake', brake, (t) => brake.localToWorld(t.set(0, 0.17, 0)), V(0, 0, 0.12));

        // Generator: translucent stator with copper windings, spinning magnet rotor
        const generator = new THREE.Group();
        generator.position.z = -0.7;
        generator.add(mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.38, 40, 1, true), statorMat, { rotation: E(Math.PI / 2, 0, 0), castShadow: false }));
        [-0.12, 0, 0.12].forEach(z => generator.add(mesh(new THREE.TorusGeometry(0.172, 0.016, 10, 56), copperMat, { position: V(0, 0, z) })));
        const genRotor = new THREE.Group();
        genRotor.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.34, 24), steelMat, { rotation: E(Math.PI / 2, 0, 0) }));
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            genRotor.add(mesh(new THREE.BoxGeometry(0.05, 0.04, 0.3), i % 2 ? magnetS : magnetN, { position: V(Math.cos(a) * 0.09, Math.sin(a) * 0.09, 0), rotation: E(0, 0, a + Math.PI / 2) }));
        }
        generator.add(genRotor);
        generator.add(mesh(new THREE.BoxGeometry(0.3, 0.05, 0.38), darkMat, { position: V(0, -0.2, 0) }));
        interior.add(generator);
        registerPart('generator', generator, (t) => generator.localToWorld(t.set(0, 0.19, 0)), V(0, 0, -0.55));

        // Converter / control cabinet
        const converter = new THREE.Group();
        converter.position.set(0.25, -0.1, -0.78);
        converter.add(mesh(new THREE.BoxGeometry(0.12, 0.22, 0.3), darkMat));
        converter.add(mesh(new THREE.SphereGeometry(0.014, 8, 6), ledMat, { position: V(0.062, 0.06, 0.08) }));
        converter.add(mesh(new THREE.SphereGeometry(0.014, 8, 6), accentMat, { position: V(0.062, 0.02, 0.08) }));
        interior.add(converter);
        registerPart('converter', converter, (t) => converter.localToWorld(t.set(0, 0.11, 0)), V(0.45, 0, -0.2));

        // Yaw system: slewing ring and motors at the tower top
        const yaw = new THREE.Group();
        yaw.position.y = -0.31;
        yaw.add(mesh(new THREE.TorusGeometry(0.21, 0.03, 10, 64), steelMat, { rotation: E(Math.PI / 2, 0, 0) }));
        [[0.17, 0.08], [-0.17, 0.08]].forEach(p => yaw.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 14), darkMat, { position: V(p[0], 0.07, p[1]) })));
        interior.add(yaw);
        registerPart('yaw', yaw, (t) => yaw.localToWorld(t.set(0.21, 0, 0)), V(0, -0.9, 0));

        // Cable inside the nacelle: generator down to the yaw centre
        const nacelleCurve = new THREE.CatmullRomCurve3([V(0, -0.2, -0.72), V(0.04, -0.27, -0.4), V(0, -0.3, -0.05), V(0, -0.4, 0)]);
        const nacelleCable = mesh(new THREE.TubeGeometry(nacelleCurve, 24, 0.012, 8, false), cableMat, { castShadow: false });
        interior.add(nacelleCable);

        // Cable down the tower and over to the transformer (turbine space)
        const towerCurve = new THREE.CatmullRomCurve3([
            V(0, NACELLE_Y - 0.4, 0), V(0, 1.2, 0), V(0.05, 0.35, -0.05), V(0.6, 0.22, -0.4), V(1.42, 0.2, -1.0)
        ]);
        const cableGroup = new THREE.Group();
        cableGroup.add(mesh(new THREE.TubeGeometry(towerCurve, 48, 0.02, 8, false), cableMat, { castShadow: false }));
        turbine.add(cableGroup);
        registerPart('cable', cableGroup, (t) => t.set(0, 2.1, 0), null, (t) => t.set(0.3, 3, -0.2));

        // Electricity flow particles along both cables
        function makeFlow(curve, count, size) {
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
            const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffd54f, size: size, transparent: true, opacity: 0.95, sizeAttenuation: true, depthWrite: false }));
            pts.userData = { curve: curve, count: count, phase: 0, tmp: V(0, 0, 0) };
            return pts;
        }
        function updateFlow(flow, advance) {
            const d = flow.userData;
            d.phase = (d.phase + advance) % 1;
            const arr = flow.geometry.attributes.position.array;
            for (let i = 0; i < d.count; i++) {
                d.curve.getPointAt((i / d.count + d.phase) % 1, d.tmp);
                arr[i * 3] = d.tmp.x;
                arr[i * 3 + 1] = d.tmp.y;
                arr[i * 3 + 2] = d.tmp.z;
            }
            flow.geometry.attributes.position.needsUpdate = true;
        }
        const nacelleFlow = makeFlow(nacelleCurve, 14, 0.045);
        interior.add(nacelleFlow);
        const towerFlow = makeFlow(towerCurve, 60, 0.07);
        cableGroup.add(towerFlow);
        updateFlow(nacelleFlow, 0);
        updateFlow(towerFlow, 0);

        // --- Rotor: hub and blades ------------------------------
        const rotor = new THREE.Group();
        const ROTOR_BASE = V(0, 0, 0.8);
        const ROTOR_EXPLODE = V(0, 0, 1.5);
        rotor.position.copy(ROTOR_BASE);
        nacelle.add(rotor);

        const hubGroup = new THREE.Group();
        const hub = mesh(new THREE.SphereGeometry(0.3, 32, 24), whiteMat);
        hub.scale.set(1, 1, 1.25);
        hubGroup.add(hub);
        hubGroup.add(mesh(new THREE.ConeGeometry(0.22, 0.42, 32), whiteMat, { position: V(0, 0, 0.42), rotation: E(Math.PI / 2, 0, 0) }));
        rotor.add(hubGroup);
        registerPart('hub', hubGroup, (t) => nacelle.localToWorld(t.copy(rotor.position).add(V(0, 0, 0.5))), null,
            (t) => rotor.getWorldPosition(t));

        function makeBladeGeometry(length) {
            const shape = new THREE.Shape();
            shape.moveTo(0, 0);
            shape.bezierCurveTo(0.22, 0.15, 0.3, length * 0.2, 0.26, length * 0.3);
            shape.bezierCurveTo(0.22, length * 0.6, 0.12, length * 0.9, 0.03, length);
            shape.lineTo(-0.03, length);
            shape.bezierCurveTo(-0.1, length * 0.9, -0.16, length * 0.6, -0.17, length * 0.3);
            shape.bezierCurveTo(-0.19, length * 0.2, -0.16, 0.15, -0.1, 0);
            shape.lineTo(0, 0);
            const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.055, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.02, bevelSegments: 3, curveSegments: 24 });
            geo.translate(0, 0, -0.0275);
            // Twist along the span: more pitch at the root, less at the tip
            const pos = geo.attributes.position;
            const v = V(0, 0, 0);
            for (let i = 0; i < pos.count; i++) {
                v.fromBufferAttribute(pos, i);
                const twist = lerp(0.55, 0.08, clamp(v.y / length, 0, 1));
                const c = Math.cos(twist);
                const s = Math.sin(twist);
                pos.setXYZ(i, v.x * c - v.z * s, v.y, v.x * s + v.z * c);
            }
            pos.needsUpdate = true;
            geo.computeVertexNormals();
            return geo;
        }
        const bladeGeo = makeBladeGeometry(3.1);
        const bladesGroup = new THREE.Group();
        const pitchPivots = [];
        for (let i = 0; i < 3; i++) {
            const pivot = new THREE.Group();
            pivot.rotation.z = (i * Math.PI * 2) / 3;
            const pitchPivot = new THREE.Group();          // turns about the blade's long axis
            pitchPivot.position.y = 0.22;
            pitchPivot.add(mesh(bladeGeo, bladeMat));
            pivot.add(pitchPivot);
            pivot.add(mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.16, 24), darkMat, { position: V(0, 0.26, 0) }));
            pitchPivots.push(pitchPivot);
            bladesGroup.add(pivot);
        }
        rotor.add(bladesGroup);
        registerPart('blade', bladesGroup, (t) => nacelle.localToWorld(t.copy(rotor.position).add(V(-1.15, 1.85, 0))), null,
            (t) => rotor.getWorldPosition(t));

        // --- Wind particles -------------------------------------
        const PARTICLES = 160;
        const pGeo = new THREE.BufferGeometry();
        const pPos = new Float32Array(PARTICLES * 3);
        const pSpeed = new Float32Array(PARTICLES);
        for (let i = 0; i < PARTICLES; i++) {
            pPos[i * 3] = (Math.random() - 0.5) * 18;
            pPos[i * 3 + 1] = Math.random() * 9.5 + 0.3;
            pPos[i * 3 + 2] = (Math.random() - 0.5) * 18;
            pSpeed[i] = 0.6 + Math.random() * 0.8;
        }
        pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
        const particles = new THREE.Points(pGeo, new THREE.PointsMaterial({ color: 0xbfe8c6, size: 0.06, transparent: true, opacity: 0.55, sizeAttenuation: true, depthWrite: false }));
        scene.add(particles);

        // ========================================================
        //  View state
        // ========================================================
        const YAW_MEAN = 0.35;                             // rotor faces roughly +z
        const windDir = V(-Math.sin(YAW_MEAN), 0, -Math.cos(YAW_MEAN));   // upwind rotor: air moves front to back

        const state = {
            xray: 0, xrayGoal: 0, explode: 0, explodeGoal: 0,
            gust: 0, gustGoal: 0, nextGust: 3,
            op: operatingPoint(ui.windBase),
            rotorOmegaVis: operatingPoint(ui.windBase).omega * 1.5 * motionScale,
            pitch: 0, shift: 0, active: false
        };

        const cam = { theta: 0.526, phi: 1.53, radius: 17.1, target: V(0, 4.9, 0) };
        const goal = { theta: cam.theta, phi: cam.phi, radius: cam.radius, target: cam.target.clone() };
        const RADIUS_MIN = 2.2;
        const RADIUS_MAX = 32;
        let focusPart = null;

        function wrapAngle(a) {
            while (a > Math.PI) a -= Math.PI * 2;
            while (a < -Math.PI) a += Math.PI * 2;
            return a;
        }
        function viewFor(mode) {
            scene.updateMatrixWorld();
            if (mode === 'inside') return { theta: YAW_MEAN + 1.3, phi: 1.36, radius: 5.6, target: nacelle.localToWorld(V(0, 0, -0.3)) };
            if (mode === 'exploded') return { theta: YAW_MEAN + 1.05, phi: 1.28, radius: 9.2, target: nacelle.localToWorld(V(0, 0.25, 0.35)) };
            return { theta: 0.526, phi: 1.53, radius: 17.1, target: V(0, 4.9, 0) };
        }
        function setView(v) {
            goal.theta = cam.theta + wrapAngle(v.theta - cam.theta);
            goal.phi = v.phi;
            goal.radius = v.radius;
            goal.target.copy(v.target);
            focusPart = null;
        }

        // ========================================================
        //  Labels
        // ========================================================
        const labelsRoot = $('#wt-labels');
        const measureCtx = document.createElement('canvas').getContext('2d');
        function measureTag(text) {
            measureCtx.font = '600 11.52px Inter, "Segoe UI", sans-serif';
            return Math.ceil(measureCtx.measureText(text).width) + 24;
        }
        const labels = PART_IDS.map(id => {
            const p = partById[id];
            const el = document.createElement('button');
            el.type = 'button';
            el.className = 'wt-label wt-label-' + p.group + ' is-off';
            el.dataset.part = id;
            el.setAttribute('aria-label', p.num + '. ' + p.name + ': show details');
            const line = document.createElement('span');
            line.className = 'wt-line';
            const tag = document.createElement('span');
            tag.className = 'wt-tag';
            tag.textContent = p.name;
            const pin = document.createElement('span');
            pin.className = 'wt-pin';
            pin.textContent = String(p.num);
            el.appendChild(line);
            el.appendChild(tag);
            el.appendChild(pin);
            el.addEventListener('click', (e) => { e.stopPropagation(); stopTour(); select(id, { focus: true }); });
            el.addEventListener('mouseenter', () => setHover(id));
            el.addEventListener('mouseleave', () => setHover(null));
            if (labelsRoot) labelsRoot.appendChild(el);
            return { id: id, part: p, el: el, tag: tag, line: line, tw: measureTag(p.name), cand: -1, off: true, tagOn: true, ax: 0, ay: 0, dist: 0 };
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

        // Candidate tag positions relative to the pin: [dx, dy of tag centre]
        const CANDS = [[18, -30], [18, 30], [-18, -30], [-18, 30], [28, -58], [-28, -58], [28, 58], [-28, 58], [34, 0], [-34, 0]];
        const TAG_H = 24;
        const uiRects = [];                                 // toolbars and hint, in stage pixels
        function overlaps(x, y, w, h, r) {
            return x < r[0] + r[2] + 3 && x + w + 3 > r[0] && y < r[1] + r[3] + 3 && y + h + 3 > r[1];
        }
        const tmpV = V(0, 0, 0);

        function layoutLabels(w, h, infoTop) {
            if (!ui.labels) return;
            const narrow = w < 440;
            const compactExterior = state.xray > 0.5;
            const vis = [];
            labels.forEach(L => {
                const p = L.part;
                if (p.group === 'interior' && state.xray < 0.3) { setOff(L, true); return; }
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
                const len = Math.hypot(ex, ey);
                L.line.style.width = Math.max(0, len - 11).toFixed(1) + 'px';
                L.line.style.transform = 'rotate(' + Math.atan2(ey, ex).toFixed(4) + 'rad) translateX(11px)';
            });
        }

        // ========================================================
        //  Selection highlight
        // ========================================================
        const highlightCache = [];
        function clearHighlight() {
            highlightCache.forEach(e => { e.mesh.material.dispose(); e.mesh.material = e.mat; });
            highlightCache.length = 0;
        }
        function highlight(part) {
            clearHighlight();
            const color = part.group === 'interior' ? 0xffb300 : 0x4caf50;
            part.object.traverse(o => {
                if (!o.isMesh) return;
                const m = o.material.clone();
                m.emissive = new THREE.Color(color);
                m.emissiveIntensity = 0.22;
                highlightCache.push({ mesh: o, mat: o.material });
                o.material = m;
            });
        }

        // ========================================================
        //  Interaction
        // ========================================================
        const pointer = { x: 0, y: 0, tx: 0, ty: 0, cx: 0, cy: 0, pending: false };
        const raycaster = new THREE.Raycaster();
        const ndc = new THREE.Vector2();
        const SHELLS = { nacelle: true, tower: true };
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
                if (!obj.isMesh) continue;                  // ignore particles and edge lines
                let o = obj;
                let visible = true;
                while (o) { if (!o.visible) { visible = false; break; } o = o.parent; }
                if (!visible) continue;
                o = obj;
                while (o && !o.userData.partId) o = o.parent;
                if (!o) continue;
                const id = o.userData.partId;
                // In x-ray, clicks pass through the see-through shells to what is inside
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
                goal.phi = cam.phi = clamp(drag.phi - dy * 0.004, 0.25, 1.56);
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
        // Wheel zooms only after the model was clicked, so page scrolling is never hijacked
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
            else if (k === 'ArrowDown') goal.phi = Math.min(1.56, goal.phi + 0.1);
            else if (k === 'Escape') select(null);
            else return;
            e.preventDefault();
            stopTour();
        });

        function zoomBy(factor) {
            goal.radius = clamp(goal.radius * factor, RADIUS_MIN, RADIUS_MAX);
        }

        // ========================================================
        //  Sizing
        // ========================================================
        const size = { w: 1, h: 1 };
        let radiusScale = 1;
        function measureUi() {
            uiRects.length = 0;
            const s = stage.getBoundingClientRect();
            ['.wt-modes', '.wt-tools', '.wt-hint'].forEach(sel => {
                const el = stage.querySelector(sel);
                if (!el) return;
                const r = el.getBoundingClientRect();
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

        // ========================================================
        //  Frame update
        // ========================================================
        const clock = new THREE.Clock();
        let running = false;
        let visible = true;
        let rafId = 0;
        const focusTmp = V(0, 0, 0);

        function render(dt) {
            const t = clock.elapsedTime;
            const k = 1 - Math.exp(-dt * 4.5);
            const w = size.w;
            const h = size.h;

            // Read layout first (info card), before this frame writes any styles
            const infoOverlay = !!(ui.selected && info.root && !info.root.hidden && !mqStaticInfo.matches);
            const infoH = infoOverlay ? info.root.offsetHeight : 0;
            const infoTop = infoOverlay ? h - infoH - 12 : h;

            // Hover picking, at most once per frame
            if (pointer.pending && !drag) {
                pointer.pending = false;
                const id = pickAt(pointer.cx, pointer.cy);
                setHover(id);
                canvas.style.cursor = id ? 'pointer' : 'grab';
            }

            // Wind and physics
            if (t > state.nextGust) {
                state.gustGoal = (Math.random() - 0.5) * 0.18 * Math.max(ui.windBase, 2);
                state.nextGust = t + 3 + Math.random() * 5;
            }
            state.gust += (state.gustGoal - state.gust) * Math.min(1, dt * 0.5);
            const wind = Math.max(0, ui.windBase + state.gust * motionScale);
            state.op = operatingPoint(wind);
            hudClock += dt;
            if (hudClock > 0.15) { hudClock = 0; renderHud(state.op); }

            // Rotor follows the physical angular speed, scaled 1.5x for legibility
            state.rotorOmegaVis += (state.op.omega * 1.5 * motionScale - state.rotorOmegaVis) * Math.min(1, dt * 0.8);
            rotor.rotation.z -= state.rotorOmegaVis * dt;

            // Blade pitch
            state.pitch += (THREE.MathUtils.degToRad(state.op.pitchDeg) - state.pitch) * Math.min(1, dt * 1.2);
            pitchPivots.forEach(b => { b.rotation.y = state.pitch; });

            // Drive train kinematics (planet spin is relative to the carrier)
            const a = rotor.rotation.z;
            carrier.rotation.z = a;
            planets.forEach(p => { p.rotation.z = -a * R_RING / R_PLANET; });
            sun.rotation.z = a * SUN_RATIO;
            mainShaft.rotation.y = a;
            hsShaft.rotation.y = a * SUN_RATIO;
            brakeDisc.rotation.y = a * SUN_RATIO;
            genRotor.rotation.z = a * SUN_RATIO;
            cups.rotation.y += wind * 0.9 * dt * motionScale;

            // Generator glow and current flow scale with output
            const load = state.op.powerW / SPEC.ratedPowerW;
            statorMat.emissiveIntensity = load * (0.8 + Math.sin(t * 6) * 0.25 * motionScale);
            cableMat.emissiveIntensity = 0.25 + load * 0.9;
            const flowAdvance = load * dt * 0.9 * motionScale;
            updateFlow(nacelleFlow, flowAdvance);
            updateFlow(towerFlow, flowAdvance * 0.5);
            nacelleFlow.visible = towerFlow.visible = load > 0.01 && state.xray > 0.3;

            nacelle.rotation.y = YAW_MEAN + Math.sin(t * 0.18) * 0.06 * motionScale;
            accentMat.emissiveIntensity = 0.5 + Math.sin(t * 2.2) * 0.4 * motionScale;

            // View modes
            state.xray += (state.xrayGoal - state.xray) * k;
            state.explode += (state.explodeGoal - state.explode) * k;
            const x = state.xray;
            housingMat.transparent = towerMat.transparent = bladeMat.transparent = x > 0.01;
            bladeMat.opacity = lerp(1, 0.4, x);
            bladeMat.depthWrite = x < 0.5;
            housingMat.opacity = lerp(1, 0.1, x);
            towerMat.opacity = lerp(1, 0.22, x);
            housingMat.depthWrite = towerMat.depthWrite = x < 0.5;
            housing.castShadow = tail.castShadow = tower.castShadow = x < 0.5;
            edgeMat.opacity = x * 0.6;
            interior.visible = x > 0.02;
            cableGroup.visible = x > 0.02;
            nacelleCable.visible = state.explode < 0.3;
            nacelleFlow.visible = nacelleFlow.visible && state.explode < 0.3;
            parts.forEach(p => { if (p.explode) p.object.position.copy(p.base).addScaledVector(p.explode, state.explode); });
            rotor.position.copy(ROTOR_BASE).addScaledVector(ROTOR_EXPLODE, state.explode);

            // Highlight follows the x-ray fade of the original materials
            const glow = 0.22 + Math.sin(t * 4) * 0.08 * motionScale;
            highlightCache.forEach(e => {
                const m = e.mesh.material;
                m.opacity = e.mat.opacity;
                m.transparent = e.mat.transparent;
                m.depthWrite = e.mat.depthWrite;
                m.emissiveIntensity = glow;
            });

            // Wind particles flow front to back through the rotor
            const arr = pGeo.attributes.position.array;
            const ws = (0.4 + wind * 0.12) * motionScale;
            for (let i = 0; i < PARTICLES; i++) {
                arr[i * 3] += windDir.x * pSpeed[i] * ws * dt;
                arr[i * 3 + 2] += windDir.z * pSpeed[i] * ws * dt;
                arr[i * 3 + 1] += Math.sin(t * 0.8 + i) * dt * 0.08 * motionScale;
                if (arr[i * 3] * windDir.x + arr[i * 3 + 2] * windDir.z > 9) {
                    arr[i * 3] -= windDir.x * 18;
                    arr[i * 3 + 2] -= windDir.z * 18;
                }
            }
            pGeo.attributes.position.needsUpdate = true;
            particles.material.opacity = 0.2 + Math.min(0.5, wind * 0.03);

            // Camera: smooth orbit around the (possibly moving) focus
            scene.updateMatrixWorld();
            if (focusPart) goal.target.copy(focusPart.center(focusTmp));
            if (!drag) {
                cam.theta += (goal.theta - cam.theta) * k;
                cam.phi += (goal.phi - cam.phi) * k;
            }
            cam.radius += (goal.radius - cam.radius) * k;
            cam.target.lerp(goal.target, k);
            pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 4);
            pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 4);
            const theta = cam.theta + pointer.x * 0.05;
            const phi = clamp(cam.phi - pointer.y * 0.025, 0.2, 1.57);
            const r = cam.radius * radiusScale;
            camera.position.set(r * Math.sin(phi) * Math.sin(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.cos(theta)).add(cam.target);
            camera.lookAt(cam.target);

            // Lift the scene above the info card so the selected part stays visible
            const shiftGoal = infoOverlay ? clamp((infoH + 12) / h * 0.5, 0, 0.24) : 0;
            state.shift += (shiftGoal - state.shift) * k;
            if (state.shift > 0.002) camera.setViewOffset(w, h, 0, state.shift * h, w, h);
            else if (camera.view && camera.view.enabled) camera.clearViewOffset();

            renderer.render(scene, camera);
            layoutLabels(w, h, infoTop);
        }
        let hudClock = 0;

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

        // ========================================================
        //  Public hooks for the UI layer
        // ========================================================
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
                    goal.theta = cam.theta + wrapAngle((p.view[1] !== undefined ? YAW_MEAN + p.view[0] : cam.theta) - cam.theta);
                    goal.phi = p.view[1];
                }
            },
            zoomBy: zoomBy
        };

        // --- Go ---
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
        if (reduceMotion) rotor.rotation.z = -0.4;
        clock.start();
        render(0.016);
        stage.classList.add('is-ready');
        updateRunState();
    }
})();
