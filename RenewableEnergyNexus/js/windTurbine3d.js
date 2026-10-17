/* ============================================================
   Interactive 3D Windrad (wind turbine) explorer
   Built procedurally with Three.js, no model files needed.

   - Five turbine models: geared 4.2 MW, direct-drive 5.5 MW,
     15 MW offshore giant, vertical-axis Darrieus, small 10 kW
   - Onshore or offshore site; offshore foundations: monopile,
     jacket or floating, with transition piece, J-tube, mooring
     and the inter-array cable on the seabed
   - "Grid link" view: how a whole farm reaches the grid
     (offshore: array cables, offshore substation, HVAC or HVDC
     export cable, landfall, onshore station; onshore: collector
     cables, farm substation, overhead line)
   - Numbered labels with leader lines, legend and guided tours
   - Orbit, zoom, Exterior / Inside / Exploded / Grid link views
   - Live physics per model: P = 1/2 rho A v^3 Cp eta, rotor and
     generator speed, pitch, and the annual yield and capacity
     factor from a Rayleigh wind distribution for the site
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
    //  Turbine models and site statistics
    // ============================================================
    const RHO = 1.225;
    const MODELS = {
        geared: {
            label: 'Geared 3-blade', short: '4.2 MW geared', kind: 'hawt', drive: 'geared', nacelle: 'box',
            ratedKw: 4200, rotorD: 150, hubH: 120, cutIn: 3, cutOut: 25, cp: 0.46, tsr: 8.5, gear: 110, eff: 0.94,
            sites: ['onshore', 'offshore'], note: 'The classic design: a gearbox lets a compact high-speed generator be used.'
        },
        direct: {
            label: 'Direct-drive', short: '5.5 MW gearless', kind: 'hawt', drive: 'direct', nacelle: 'egg',
            ratedKw: 5500, rotorD: 160, hubH: 135, cutIn: 2.5, cutOut: 25, cp: 0.47, tsr: 8.5, gear: 1, eff: 0.95,
            sites: ['onshore', 'offshore'], note: 'No gearbox: the rotor turns a large ring generator directly.'
        },
        offshore: {
            label: 'Offshore giant', short: '15 MW offshore', kind: 'hawt', drive: 'direct', nacelle: 'giant',
            ratedKw: 15000, rotorD: 236, hubH: 150, cutIn: 3, cutOut: 30, cp: 0.48, tsr: 9, gear: 1, eff: 0.95,
            sites: ['offshore'], note: 'Blades longer than a football pitch; too large to move by road, so it is built only at sea.'
        },
        vawt: {
            label: 'Vertical-axis Darrieus', short: '0.5 MW VAWT', kind: 'vawt', drive: 'geared', nacelle: 'none',
            ratedKw: 500, rotorD: 34, rotorH: 50, hubH: 40, cutIn: 4, cutOut: 22, cp: 0.38, tsr: 4.5, gear: 38, eff: 0.92,
            sites: ['onshore'], note: 'Spins about a vertical axis and takes wind from any direction.'
        },
        small: {
            label: 'Small home turbine', short: '10 kW small', kind: 'small', drive: 'direct', nacelle: 'small',
            ratedKw: 10, rotorD: 8, hubH: 18, cutIn: 2.5, cutOut: 25, cp: 0.38, tsr: 7, gear: 1, eff: 0.88,
            sites: ['onshore'], note: 'For a farm or a remote home, often with a battery.'
        }
    };
    Object.keys(MODELS).forEach(k => {
        const m = MODELS[k];
        m.id = k;
        m.R = m.rotorD / 2;
        m.area = m.kind === 'vawt' ? (2 / 3) * m.rotorD * m.rotorH : Math.PI * m.R * m.R;
        m.ratedWind = Math.cbrt(m.ratedKw * 1000 / (0.5 * RHO * m.area * m.cp * m.eff));
    });
    const SITES = {
        onshore: { label: 'Onshore', ref: 6.8, alpha: 0.2, losses: 0.88 },
        offshore: { label: 'Offshore', ref: 9.5, alpha: 0.11, losses: 0.9 }
    };
    const FOUNDATIONS = {
        monopile: { label: 'Monopile', depthM: 30 },
        jacket: { label: 'Jacket', depthM: 55 },
        floating: { label: 'Floating', depthM: 120 }
    };
    const FARM = { onshore: 6, offshore: 12 };

    /** Steady-state operating point of model m at hub wind speed v (m/s). */
    function operatingPoint(m, v) {
        const pAvail = 0.5 * RHO * m.area * v * v * v;
        const out = { v: v, pAvail: pAvail, powerW: 0, cp: 0, omega: 0, rpm: 0, genRpm: 0, pitchDeg: 0, furlDeg: 0, state: 'idle' };
        if (v >= m.cutOut) {
            out.state = 'parked';
            if (m.kind === 'hawt') out.pitchDeg = 90;
            if (m.kind === 'small') out.furlDeg = 75;
            return out;
        }
        if (v < m.cutIn) {
            out.omega = 0.08 * v * (m.kind === 'small' ? 4 : 1);
            out.rpm = out.omega * 60 / (2 * Math.PI);
            return out;
        }
        const vTrack = Math.min(v, m.ratedWind);
        out.omega = m.tsr * vTrack / m.R;
        out.rpm = out.omega * 60 / (2 * Math.PI);
        out.genRpm = out.rpm * m.gear;
        out.powerW = Math.min(pAvail * m.cp * m.eff, m.ratedKw * 1000);
        out.cp = out.powerW / (pAvail * m.eff);
        if (v > m.ratedWind) {
            out.state = 'rated';
            const t = (v - m.ratedWind) / (m.cutOut - m.ratedWind);
            if (m.kind === 'hawt') out.pitchDeg = lerp(0, 25, t);
            if (m.kind === 'small') out.furlDeg = lerp(0, 55, t);
        } else {
            out.state = 'generating';
        }
        return out;
    }

    function meanWindOf(m, site) { return SITES[site].ref * Math.pow(m.hubH / 100, SITES[site].alpha); }
    const yieldCache = {};
    /** Annual yield from a Rayleigh (Weibull k = 2) wind distribution at hub height. */
    function yieldOf(m, site) {
        const key = m.id + site;
        if (yieldCache[key]) return yieldCache[key];
        const vm = meanWindOf(m, site);
        let meanP = 0;
        for (let v = 0.125; v < 35; v += 0.25) {
            const f = (Math.PI * v / (2 * vm * vm)) * Math.exp(-Math.PI * v * v / (4 * vm * vm));
            meanP += operatingPoint(m, v).powerW * f * 0.25;
        }
        meanP *= SITES[site].losses;
        const y = { meanWind: vm, cf: meanP / (m.ratedKw * 1000), aepMWh: meanP * 8760 / 1e6 };
        yieldCache[key] = y;
        return y;
    }

    // ============================================================
    //  Parts. family: turbine (Exterior/Inside/Exploded) or grid (Grid link)
    //  avail(c) decides whether a part exists for the current config c
    // ============================================================
    const fmtN = (n, d) => n.toLocaleString('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
    const isHawt = (c) => c.m.kind === 'hawt';
    const off = (c) => c.site === 'offshore';
    const PARTS = {
        blade: {
            family: 'turbine', group: 'exterior', rel: 1.25, view: [0.18, 1.5], avail: () => true,
            name: (c) => c.m.kind === 'vawt' ? 'Curved Darrieus blades' : 'Rotor blades',
            desc: (c) => c.m.kind === 'vawt'
                ? 'A Darrieus rotor spins about a vertical axis, so it takes wind from any direction without yawing. Its curved blades follow the shape a skipping rope makes when spun, which keeps them in tension. Lift on each blade reverses twice per turn, so the torque pulses and the efficiency is lower than a horizontal-axis rotor (Cp about 0.35–0.40). Swept area ≈ ⅔ · D · H = ' + fmtN(c.m.area) + ' m².'
                : 'Airfoil-shaped composite blades. Air flowing faster over the curved suction side lowers its pressure and creates lift, which turns the rotor. The swept area A = πR² sets how much power the rotor can catch: P = ½·ρ·A·v³·Cp, with Cp never above 0.593 (the Betz limit). This rotor is ' + c.m.rotorD + ' m across and sweeps ' + fmtN(c.m.area) + ' m².' + (c.m.kind === 'small' ? ' Small turbines use fixed-pitch blades and spin much faster.' : '')
        },
        hub: {
            family: 'turbine', group: 'exterior', rel: 0.45, view: [0.6, 1.45], avail: (c) => c.m.kind !== 'vawt',
            name: (c) => c.m.kind === 'small' ? 'Hub' : 'Hub & pitch system',
            desc: (c) => c.m.kind === 'small'
                ? 'A simple hub with fixed blades. Instead of pitching, the whole rotor swings out of the wind when it gets too strong (furling); see the tail vane.'
                : 'The cast hub joins the blades to the shaft. Pitch bearings and motors inside turn each blade about its long axis to limit power above rated wind and to feather the blades to 90° in a storm, which is the turbine’s main brake.'
        },
        nacelle: {
            family: 'turbine', group: 'exterior', rel: 0.65, view: [1.1, 1.32], avail: (c) => c.m.kind !== 'vawt',
            name: (c) => c.m.kind === 'small' ? 'Generator housing' : 'Nacelle',
            desc: (c) => ({
                box: 'The housing on top of the tower holds the drive train: main shaft, gearbox, brake, generator and converter. Switch to Inside or Exploded to see them.',
                egg: 'A direct-drive nacelle is short, because there is no gearbox. The rotor turns the large ring generator directly, the wide drum just behind the hub.',
                giant: 'A 15 MW nacelle weighs around 500 t and is the size of a house. The platform on its roof lets technicians be lowered from a helicopter when waves make boat access unsafe.',
                small: 'A compact housing for the permanent-magnet generator, which sits directly on the rotor shaft.'
            })[c.m.nacelle]
        },
        anemometer: {
            family: 'turbine', group: 'exterior', rel: 0.32, view: [1.3, 1.05], avail: isHawt,
            name: () => 'Anemometer & wind vane',
            desc: () => 'Measure wind speed and direction behind the rotor. The controller uses them to turn the nacelle into the wind, start generating at cut-in and shut down above cut-out.'
        },
        tail: {
            family: 'turbine', group: 'exterior', rel: 0.5, view: [1.2, 1.3], avail: (c) => c.m.kind === 'small',
            name: () => 'Tail vane',
            desc: () => 'The tail keeps the rotor facing the wind without motors. In strong wind the hinged tail lets the rotor swing sideways out of the wind (furling), which limits power and protects the turbine.'
        },
        tower: {
            family: 'turbine', group: 'exterior', rel: 1.2, view: [0.2, 1.5], avail: () => true,
            name: (c) => c.m.kind === 'vawt' ? 'Rotating column & guy wires' : c.m.kind === 'small' ? 'Guyed mast' : 'Tower',
            desc: (c) => {
                const y = yieldOf(c.m, c.site);
                if (c.m.kind === 'vawt') return 'The whole central column turns with the blades. Guy wires from the top bearing to ground anchors hold it upright, and because the rotor works in any wind direction it needs no yaw system.';
                if (c.m.kind === 'small') return 'A slim guyed mast, often hinged at the base so it can be lowered for maintenance without a crane. Height matters: at ' + c.m.hubH + ' m the mean wind here is only about ' + fmtN(y.meanWind, 1) + ' m/s.';
                if (off(c)) return 'Offshore the sea surface is smooth, so wind speed hardly drops near the water (shear exponent α ≈ 0.1). The hub sits ' + c.m.hubH + ' m above sea level, where the mean wind here is about ' + fmtN(y.meanWind, 1) + ' m/s.';
                return 'A tubular steel or hybrid concrete-steel tower lifts the hub to ' + c.m.hubH + ' m. Over land the wind grows with height roughly as v₂ = v₁·(h₂/h₁)^α with α ≈ 0.2, so the mean wind here is about ' + fmtN(y.meanWind, 1) + ' m/s.';
            }
        },
        foundation: {
            family: 'turbine', group: 'exterior', rel: 0.9, view: [0.35, 1.2], avail: () => true,
            name: (c) => !off(c) ? 'Foundation' : ({ monopile: 'Monopile foundation', jacket: 'Jacket foundation', floating: 'Floating platform' })[c.foundation],
            desc: (c) => {
                if (!off(c)) return c.m.kind === 'hawt' ? 'A reinforced-concrete gravity foundation of about 600–1,000 m³ anchors the turbine against the overturning moment from rotor thrust.' : 'A small concrete footing, plus ground anchors for the guy wires.';
                return ({
                    monopile: 'A single steel tube up to 10 m wide and over 1,500 t, driven 30–40 m into the seabed. Monopiles are the cheapest choice in water up to about 40–50 m deep. Rock dumped around the base (scour protection) stops currents washing the sand away.',
                    jacket: 'A four-legged steel lattice pinned to the seabed by piles. It is lighter and stiffer than a monopile in deeper water, typically 40–70 m.',
                    floating: 'Beyond about 60 m of water, fixed foundations become too costly, so the turbine floats. The semi-submersible’s three buoyant columns keep it stable as it rocks gently in the waves. Floating wind opens deep waters such as those off Norway, Portugal, Japan and the US west coast. The water depth here is drawn shorter than in reality.'
                })[c.foundation];
            }
        },
        transition: {
            family: 'turbine', group: 'exterior', rel: 0.45, view: [0.7, 1.35], avail: (c) => off(c) && c.foundation !== 'floating',
            name: () => 'Transition piece & boat landing',
            desc: () => 'The yellow transition piece joins tower and foundation and corrects any tilt left from pile driving. It carries the access platform, the boat landing where crew vessels dock, and the J-tube that guides the power cable down to the seabed.'
        },
        mooring: {
            family: 'turbine', group: 'exterior', rel: 1.0, view: [0.7, 1.25], avail: (c) => off(c) && c.foundation === 'floating',
            name: () => 'Mooring lines & anchors',
            desc: () => 'Three catenary lines of chain and fibre rope hold the platform in place, anchored to the seabed hundreds of metres away. Their sagging weight acts like a spring, letting the platform drift and pitch a little without breaking free.'
        },
        arraycable: {
            family: 'turbine', group: 'exterior', rel: 0.8, view: [0.75, 1.3], avail: off,
            name: () => 'Inter-array cable',
            desc: (c) => (c.foundation === 'floating' ? 'A dynamic cable hangs from the platform in a “lazy wave”, with buoyancy modules that let it flex as the platform moves, before it reaches the seabed. ' : 'The cable leaves the J-tube at the seabed. ') + 'This 66 kV three-core cable is buried 1–2 m into the seabed to protect it from anchors and fishing gear, and links several turbines in a string to the offshore substation. Switch to Grid link to follow it to land.'
        },
        transformer: {
            family: 'turbine', group: 'exterior', rel: 0.4, view: [0.9, 1.2], avail: (c) => !off(c) && c.m.kind !== 'small',
            name: () => 'Transformer',
            desc: () => 'The generator delivers about 690 V. A transformer steps it up to the 20–36 kV collector network to cut I²R losses. On land it often stands beside the tower; offshore it is built into the nacelle or tower base.'
        },
        shaft: {
            family: 'turbine', group: 'interior', rel: 0.35, view: [1.3, 1.32], avail: (c) => c.m.drive === 'geared' && c.m.kind === 'hawt',
            name: () => 'Main (low-speed) shaft',
            desc: () => 'Carries the rotor torque, several meganewton-metres, into the gearbox at only 10–15 rpm. The main bearing supports it and takes the rotor thrust.'
        },
        gearbox: {
            family: 'turbine', group: 'interior', rel: 0.32, view: [1.3, 1.32], avail: (c) => c.m.drive === 'geared',
            name: () => 'Gearbox',
            desc: (c) => c.m.kind === 'vawt'
                ? 'At ground level a gearbox raises the slow rotor speed of about ' + fmtN(operatingPoint(c.m, c.m.ratedWind).rpm) + ' rpm to the 1,500 rpm a standard generator needs. Because it sits at ground level it is easy to service, one of the main advantages of a vertical-axis design.'
                : 'Raises the speed about 1:' + c.m.gear + ', from around ' + fmtN(operatingPoint(c.m, c.m.ratedWind).rpm) + ' rpm to about 1,500 rpm. In the planetary stage the carrier turns with the main shaft, the planets roll inside a fixed ring gear and spin the central sun gear faster. Gearboxes are a leading cause of costly repairs, which is why direct-drive designs exist.'
        },
        brake: {
            family: 'turbine', group: 'interior', rel: 0.26, view: [1.3, 1.32], avail: (c) => c.m.drive === 'geared',
            name: () => 'Mechanical disc brake',
            desc: () => 'Sits on the high-speed shaft, where torque is far lower than at the rotor, so a small caliper can hold it. It parks the rotor for maintenance and backs up the aerodynamic brake.'
        },
        generator: {
            family: 'turbine', group: 'interior', rel: 0.35, view: [1.3, 1.32], avail: () => true,
            name: (c) => c.m.drive === 'direct' && c.m.kind === 'hawt' ? 'Ring generator (PMSG)' : c.m.kind === 'small' ? 'Permanent-magnet alternator' : 'Generator',
            desc: (c) => {
                if (c.m.kind === 'small') return 'A permanent-magnet alternator on the rotor shaft makes variable-frequency AC, which is rectified to charge batteries or feed an inverter.';
                if (c.m.kind === 'vawt') return 'A standard 1,500 rpm induction generator at ground level. Faraday’s law, ε = −N·dΦ/dt, induces the stator voltage as the rotor field sweeps past the windings.';
                if (c.m.drive === 'direct') return 'A ring generator with permanent magnets, several metres across, turning at rotor speed (about ' + fmtN(operatingPoint(c.m, c.m.ratedWind).rpm, 1) + ' rpm at rated wind). Many pole pairs make the induced frequency high enough for the converter even at this slow speed. No gearbox means fewer moving parts, at the cost of more weight and rare-earth magnets.' + (c.m.id === 'offshore' ? ' At 15 MW the generator alone weighs well over 200 t.' : '');
                return 'A doubly-fed induction generator (DFIG). Its rotor windings are fed through a small converter, so it can run at variable speed while only about 30% of the power passes through power electronics. Faraday’s law, ε = −N·dΦ/dt, induces the stator voltage.';
            }
        },
        converter: {
            family: 'turbine', group: 'interior', rel: 0.3, view: [1.3, 1.32], avail: () => true,
            name: (c) => c.m.kind === 'small' ? 'Inverter & battery' : 'Power converter',
            desc: (c) => {
                if (c.m.kind === 'small') return 'A charge controller and inverter turn the generator output into 230 V household AC, and a battery bank stores surplus wind for calm spells.';
                if (c.m.drive === 'geared' && c.m.kind === 'hawt') return 'Handles the DFIG’s rotor power, about 30% of the total, to keep a fixed 50 Hz output while the rotor speed varies, and runs the control loops for pitch and yaw.';
                return 'A full-power converter turns all of the generator’s variable-frequency AC into DC and back into 50 Hz AC. This gives full control of speed and lets the turbine support grid voltage and frequency.';
            }
        },
        yaw: {
            family: 'turbine', group: 'interior', rel: 0.35, view: [1.3, 1.5], avail: isHawt,
            name: () => 'Yaw system',
            desc: () => 'A toothed slewing ring, turned by electric motors, points the rotor into the wind reported by the vane. Captured power falls roughly with cos³ of the yaw error.'
        },
        cable: {
            family: 'turbine', group: 'interior', rel: 1.0, view: [1.0, 1.5], avail: () => true,
            name: () => 'Power cables',
            desc: (c) => off(c) ? 'Cables run down the tower, through the transition piece and the J-tube, to the inter-array cable on the seabed. A hanging loop at the top lets the nacelle yaw.' : 'Flexible cables carry the power down the tower to the transformer. A hanging loop at the top lets the nacelle yaw; after a few full turns the controller untwists it.'
        },

        // ---- Grid link: offshore ----
        farm: {
            family: 'grid', group: 'exterior', abs: 30, view: [0.5, 1.05], avail: () => true,
            name: (c) => off(c) ? 'Offshore wind farm' : 'Onshore wind farm',
            desc: (c) => (off(c)
                ? 'Turbines stand 5–10 rotor diameters apart, often 1–2 km, so each recovers from the slower, turbulent wake of its upwind neighbours. '
                : 'Onshore turbines stand 3–5 rotor diameters apart across the wind and 5–9 along it, often on ridges where the wind is strongest. ')
                + 'This farm has ' + FARM[c.site] + ' × ' + c.m.short + ' = ' + fmtN(FARM[c.site] * c.m.ratedKw / 1000, 1) + ' MW and would produce about ' + fmtN(FARM[c.site] * yieldOf(c.m, c.site).aepMWh / 1000) + ' GWh a year (capacity factor ' + Math.round(yieldOf(c.m, c.site).cf * 100) + '%).'
        },
        array: {
            family: 'grid', group: 'exterior', abs: 26, view: [0.55, 0.95], avail: off,
            name: () => 'Inter-array cables (66 kV)',
            desc: () => 'Turbines are linked in strings by 66 kV subsea cables buried in the seabed. Each string carries the output of several turbines to the offshore substation; ring layouts add a back-up path if one cable fails.'
        },
        oss: {
            family: 'grid', group: 'exterior', abs: 18, view: [0.6, 1.05], avail: off,
            name: () => 'Offshore substation',
            desc: () => 'A platform on a jacket foundation with large transformers that raise the 66 kV array voltage to 155–275 kV. Higher voltage means lower current, so less energy is lost as heat in the long export cable (P_loss = I²·R).'
        },
        hvdcplat: {
            family: 'grid', group: 'exterior', abs: 18, view: [0.4, 1.05], avail: (c) => off(c) && c.link === 'hvdc',
            name: () => 'HVDC converter platform',
            desc: () => 'Far from shore, beyond roughly 80–100 km, an AC cable wastes much of its capacity charging its own capacitance. Here power electronics convert the AC to high-voltage direct current at ±320 to ±525 kV, on a platform the size of an office block.'
        },
        export: {
            family: 'grid', group: 'exterior', abs: 34, view: [0.4, 0.95], avail: off,
            name: (c) => c.link === 'hvdc' ? 'Export cable (HVDC ±525 kV)' : 'Export cable (HVAC 220 kV)',
            desc: (c) => c.link === 'hvdc'
                ? 'A pair of DC cables can carry 2 GW over hundreds of kilometres with losses of only a few percent, because direct current has no charging current. The cables are buried 1–3 m into the seabed and covered with rock where they cross other cables or pipelines. Shown here much shorter than in reality.'
                : 'One or more three-core AC cables, buried in the seabed, carry the power to shore over a few tens of kilometres. A long AC cable behaves like a capacitor and draws charging current, so reactors at both ends compensate the reactive power. Shown here shorter than in reality.'
        },
        landfall: {
            family: 'grid', group: 'exterior', abs: 16, view: [0.9, 1.1], avail: off,
            name: () => 'Landfall',
            desc: () => 'At the coast the cable is pulled through ducts drilled under the beach and dunes by horizontal directional drilling, so the shoreline is not dug up. In a buried transition joint bay behind the dunes, the subsea cable is spliced to the land cable.'
        },
        onstation: {
            family: 'grid', group: 'exterior', abs: 16, view: [0.7, 1.05], avail: off,
            name: (c) => c.link === 'hvdc' ? 'Onshore converter station' : 'Onshore substation',
            desc: (c) => c.link === 'hvdc'
                ? 'A second converter turns the DC back into three-phase 50 Hz AC for the grid and can support grid voltage and frequency within milliseconds.'
                : 'Transformers match the voltage to the transmission grid, for example 380 kV, while shunt reactors and STATCOMs compensate the reactive power of the long AC export cable.'
        },
        // ---- Grid link: onshore ----
        collector: {
            family: 'grid', group: 'exterior', abs: 26, view: [0.5, 1.0], avail: (c) => !off(c),
            name: () => 'Underground collector cables',
            desc: () => 'Medium-voltage cables at 20–36 kV run in trenches about a metre deep from each turbine’s transformer to the farm substation, so the landscape is not crossed by extra overhead lines.'
        },
        onsub: {
            family: 'grid', group: 'exterior', abs: 16, view: [0.7, 1.05], avail: (c) => !off(c),
            name: () => 'Wind farm substation',
            desc: () => 'Raises the collector voltage to 110 kV or more and connects to the regional grid through switchgear and protection relays.'
        },
        grid: {
            family: 'grid', group: 'exterior', abs: 26, view: [0.7, 1.0], avail: () => true,
            name: () => 'Transmission grid',
            desc: (c) => off(c)
                ? 'High-voltage lines carry the power inland to cities and industry. Because wind at sea blows more strongly and steadily, this farm reaches a capacity factor of about ' + Math.round(yieldOf(c.m, c.site).cf * 100) + '%, against roughly 25–35% for typical onshore farms.'
                : 'An overhead line links the farm to the transmission network. Onshore farms are usually close to existing lines, which keeps the connection far cheaper than offshore.'
        }
    };
    const PART_ORDER = Object.keys(PARTS);

    const TOURS = {
        onshore: [
            { part: 'blade', mode: 'exterior', title: 'Wind creates lift on the blades', text: 'Moving air flows over the airfoil blades; the pressure difference creates lift and turns the rotor.' },
            { part: 'shaft', mode: 'inside', title: 'The rotor turns the main shaft', text: 'The hub drives the slow main shaft, carrying huge torque into the nacelle.' },
            { part: 'gearbox', mode: 'inside', title: 'The gearbox raises the speed', text: 'Gear stages speed the rotation up to about 1,500 rpm for the generator.' },
            { part: 'generator', mode: 'inside', title: 'The generator induces current', text: 'Magnets sweeping past copper windings change the magnetic flux, and by Faraday’s law this induces an AC voltage.' },
            { part: 'converter', mode: 'inside', title: 'Power electronics tame it', text: 'The converter fixes the frequency at 50 Hz while the rotor speed follows the wind.' },
            { part: 'transformer', mode: 'exterior', title: 'A transformer raises the voltage', text: 'From about 690 V up to the 20–36 kV collector network, to reduce losses.' },
            { part: 'collector', mode: 'grid', title: 'Cables collect the farm’s power', text: 'Underground cables carry every turbine’s output to the farm substation.' },
            { part: 'onsub', mode: 'grid', title: 'Into the grid', text: 'The substation raises the voltage again and feeds the transmission grid.' }
        ],
        offshore: [
            { part: 'blade', mode: 'exterior', title: 'Strong sea winds turn the rotor', text: 'Smooth water means strong, steady wind even low above the waves.' },
            { part: 'generator', mode: 'inside', title: 'The generator makes AC power', text: 'Rotating magnets induce a voltage in the copper windings.' },
            { part: 'foundation', mode: 'exterior', title: 'The foundation holds it at sea', text: 'Monopile, jacket or floating platform, depending on water depth.' },
            { part: 'arraycable', mode: 'exterior', title: 'An array cable runs to the seabed', text: 'From the transition piece or platform down to a cable buried in the seabed.' },
            { part: 'array', mode: 'grid', title: 'Strings of turbines are linked', text: '66 kV inter-array cables join turbines in strings to the offshore substation.' },
            { part: 'oss', mode: 'grid', title: 'The offshore substation steps up', text: 'Transformers raise the voltage to cut losses in the long export cable.' },
            { part: 'export', mode: 'grid', title: 'The export cable crosses the sea', text: 'HVAC for nearby farms, HVDC for farms far from shore.' },
            { part: 'landfall', mode: 'grid', title: 'Landfall under the beach', text: 'Drilled ducts carry the cable under the dunes to a joint bay on land.' },
            { part: 'onstation', mode: 'grid', title: 'Into the transmission grid', text: 'The onshore station adapts the power for the grid.' }
        ]
    };

    const STATUS_TEXT = {
        idle: 'Idling: wind is below the cut-in speed',
        generating: 'Generating: the rotor tracks its optimum tip-speed ratio',
        rated: 'Rated power reached',
        parked: 'Storm shutdown: wind above the cut-out speed'
    };

    // ============================================================
    //  UI layer (works with or without WebGL)
    // ============================================================
    const ui = {
        selected: null, mode: 'exterior', tour: -1, windBase: 8, labels: true, hover: null,
        model: 'geared', site: 'onshore', foundation: 'monopile', link: 'hvac'
    };
    const cfg = () => ({ m: MODELS[ui.model], site: ui.site, foundation: ui.foundation, link: ui.link });
    let viewer = null;
    let tourTimer = 0;
    const famOf = (mode) => mode === 'grid' ? 'grid' : 'turbine';

    const el = (id) => document.getElementById(id);
    const hud = {
        windMean: el('wt-wind-mean'), wind: el('wt-wind'), rpm: el('wt-rpm'), rpmSub: el('wt-rpm-sub'),
        gen: el('wt-gen'), genSub: el('wt-gen-sub'), power: el('wt-power'), rated: el('wt-rated'),
        avail: el('wt-avail'), pitch: el('wt-pitch'), pitchSub: el('wt-pitch-sub'), cp: el('wt-cp'),
        cf: el('wt-cf'), cfSub: el('wt-cf-sub'), aep: el('wt-aep'), aepSub: el('wt-aep-sub'),
        status: el('wt-status'), bar: el('wt-power-bar'), spec: el('wt-spec'), formula: el('wt-formula-area'),
        scaleIn: el('wt-scale-cutin'), scaleRated: el('wt-scale-rated'), scaleOut: el('wt-scale-cutout')
    };
    const info = {
        root: el('wt-info'), num: el('wt-info-num'), title: el('wt-info-title'),
        text: el('wt-info-text'), step: el('wt-info-step'), close: el('wt-info-close')
    };
    const slider = el('wt-wind-slider');
    const stepsRoot = $('.wt-steps');
    const legendRoot = $('.wt-legend');
    const tourBtn = $('[data-action="tour"]');
    const labelsBtn = $('[data-action="labels"]');
    const expandBtn = $('[data-action="expand"]');

    function setText(node, text) { if (node) node.textContent = text; }
    const fmt = fmtN;
    function formatPower(w) {
        if (w >= 1e6) return fmt(w / 1e6, 2) + ' MW';
        if (w >= 1e3) return fmt(w / 1e3, w >= 1e5 ? 0 : 1) + ' kW';
        return fmt(w, 0) + ' W';
    }

    // ---- availability and numbering ----
    let numbers = {};
    function available(id, c, fam) {
        const p = PARTS[id];
        if (fam && p.family !== fam) return false;
        return p.avail(c || cfg()) && (!viewer || viewer.hasPart(id));
    }
    function renumber() {
        numbers = {};
        const c = cfg();
        const fam = famOf(ui.mode);
        let n = 0;
        PART_ORDER.forEach(id => { if (available(id, c, fam)) numbers[id] = ++n; });
        if (viewer) viewer.renumber(numbers);
    }
    function partName(id) { return PARTS[id].name(cfg()); }
    function partDesc(id) { return PARTS[id].desc(cfg()); }

    function renderHud() {
        const m = MODELS[ui.model];
        const op = operatingPoint(m, ui.windBase);
        const y = yieldOf(m, ui.site);
        setText(hud.windMean, fmt(ui.windBase, 1));
        setText(hud.wind, fmt(op.v, 1) + ' m/s');
        setText(hud.rpm, fmt(op.rpm, op.rpm < 100 ? 1 : 0) + ' rpm');
        setText(hud.rpmSub, 'blade tip ' + fmt(op.omega * m.R, 0) + ' m/s');
        setText(hud.gen, fmt(Math.round(op.genRpm), 0) + ' rpm');
        setText(hud.genSub, m.gear > 1 ? 'via gearbox 1:' + m.gear : 'direct drive, no gearbox');
        setText(hud.power, formatPower(op.powerW));
        setText(hud.rated, 'of ' + formatPower(m.ratedKw * 1000) + ' rated');
        setText(hud.avail, formatPower(op.pAvail));
        setText(hud.cp, fmt(op.cp, 2));
        if (m.kind === 'hawt') { setText(hud.pitch, fmt(op.pitchDeg, 0) + '°'); setText(hud.pitchSub, 'blade pitch'); }
        else if (m.kind === 'small') { setText(hud.pitch, fmt(op.furlDeg, 0) + '°'); setText(hud.pitchSub, 'furled out of the wind'); }
        else { setText(hud.pitch, 'stall'); setText(hud.pitchSub, 'fixed blades, stall control'); }
        setText(hud.cf, Math.round(y.cf * 100) + '%');
        setText(hud.cfSub, 'mean wind ' + fmt(y.meanWind, 1) + ' m/s at hub');
        setText(hud.aep, y.aepMWh >= 1000 ? fmt(y.aepMWh / 1000, 1) + ' GWh' : fmt(y.aepMWh, y.aepMWh < 100 ? 1 : 0) + ' MWh');
        setText(hud.aepSub, '≈ ' + fmt(Math.max(1, Math.round(y.aepMWh / 3.5))) + ' homes (3,500 kWh each)');
        if (hud.bar) hud.bar.style.width = (op.powerW / (m.ratedKw * 1000) * 100).toFixed(1) + '%';
        if (hud.status) {
            let text = STATUS_TEXT[op.state];
            if (op.state === 'rated') text += m.kind === 'hawt' ? ': blades pitch to shed the excess' : m.kind === 'small' ? ': the tail furls the rotor out of the wind' : ': blades stall to limit power';
            if (op.state === 'parked' && m.kind === 'hawt') text += ', blades feathered to 90°';
            hud.status.textContent = text;
            hud.status.dataset.state = op.state;
        }
        setText(hud.spec, m.short + ' · Ø ' + m.rotorD + ' m rotor · ' + m.hubH + ' m hub · ' + SITES[ui.site].label.toLowerCase());
        setText(hud.formula, 'A = ' + (m.kind === 'vawt' ? '⅔·D·H' : 'πR²') + ' = ' + fmt(m.area) + ' m²');
        const pos = (v) => (v / 30 * 100).toFixed(1) + '%';
        if (hud.scaleIn) { hud.scaleIn.style.left = pos(m.cutIn); hud.scaleIn.textContent = 'cut-in ' + fmt(m.cutIn, m.cutIn % 1 ? 1 : 0); }
        if (hud.scaleRated) { hud.scaleRated.style.left = pos(m.ratedWind); hud.scaleRated.textContent = 'rated ' + fmt(m.ratedWind, 1); }
        if (hud.scaleOut) { hud.scaleOut.style.left = pos(m.cutOut); hud.scaleOut.textContent = 'cut-out ' + m.cutOut; }
        return op;
    }

    // ---- configuration controls ----
    function syncConfigButtons() {
        $$('button[data-site]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.site === ui.site)));
        $$('button[data-model]').forEach(b => {
            const ok = MODELS[b.dataset.model].sites.indexOf(ui.site) >= 0;
            b.disabled = !ok;
            b.setAttribute('aria-pressed', String(b.dataset.model === ui.model));
            b.title = ok ? MODELS[b.dataset.model].note : (b.dataset.model === 'offshore' ? 'Too large to transport by road: built only offshore' : 'Not used offshore');
        });
        $$('button[data-foundation]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.foundation === ui.foundation)));
        $$('button[data-link]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.link === ui.link)));
        $$('[data-offshore-only]').forEach(n => { n.hidden = ui.site !== 'offshore'; });
        stage.dataset.site = ui.site;
    }
    function configChanged(rebuildTurbine) {
        syncConfigButtons();
        if (viewer) viewer.configure(rebuildTurbine);
        renumber();
        buildLegend();
        buildSteps();
        if (ui.selected && !available(ui.selected, null, famOf(ui.mode))) select(null);
        else if (ui.selected) select(ui.selected, { focus: false });
        renderHud();
    }

    // ---- Mode, selection, tour ----
    function setMode(mode, moveCamera) {
        const famChanged = famOf(mode) !== famOf(ui.mode);
        ui.mode = mode;
        $$('button[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
        stage.dataset.viewMode = mode;
        if (ui.selected) {
            const p = PARTS[ui.selected];
            if (p.family !== famOf(mode) || (mode === 'exterior' && p.group === 'interior')) select(null);
        }
        if (famChanged) { renumber(); buildLegend(); }
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
        const p = PARTS[ui.selected];
        if (p.family === 'grid' && ui.mode !== 'grid') setMode('grid', false);
        else if (p.family === 'turbine' && ui.mode === 'grid') setMode(p.group === 'interior' ? 'inside' : 'exterior', false);
        else if (p.group === 'interior' && ui.mode === 'exterior') setMode('inside', false);
        setText(info.num, String(numbers[ui.selected] || ''));
        setText(info.title, partName(ui.selected));
        setText(info.text, partDesc(ui.selected));
        if (info.root) info.root.classList.toggle('is-interior', p.group === 'interior');
        if (info.step) {
            if (typeof opts.step === 'number') {
                const s = currentTour()[opts.step];
                info.step.hidden = false;
                info.step.innerHTML = '';
                const strong = document.createElement('strong');
                strong.textContent = 'Step ' + (opts.step + 1) + ' of ' + currentTour().length + ': ' + s.title + '. ';
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
    function currentTour() {
        const c = cfg();
        return TOURS[ui.site].filter(s => PARTS[s.part].avail(c));
    }
    function showStep(i) {
        const s = currentTour()[i];
        if (!s) return;
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
            ui.tour = (ui.tour + 1) % currentTour().length;
            showStep(ui.tour);
        }, 7000);
    }
    function stopTour() {
        if (ui.tour < 0) return;
        window.clearInterval(tourTimer);
        ui.tour = -1;
        setTourButton(false);
    }

    function buildSteps() {
        if (!stepsRoot) return;
        stepsRoot.innerHTML = '';
        currentTour().forEach((s, i) => {
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
        const head = $('.wt-howto h3 span');
        setText(head, ui.site === 'offshore' ? 'From sea wind to the grid' : 'How a Windrad makes electricity');
    }
    function buildLegend() {
        if (!legendRoot) return;
        legendRoot.innerHTML = '';
        const c = cfg();
        const fam = famOf(ui.mode);
        PART_ORDER.forEach(id => {
            if (!available(id, c, fam)) return;
            const p = PARTS[id];
            const li = document.createElement('li');
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'wt-legend-btn wt-legend-' + p.group + (id === ui.selected ? ' is-active' : '');
            b.dataset.part = id;
            const num = document.createElement('span');
            num.className = 'wt-legend-num';
            num.textContent = String(numbers[id] || '');
            const name = document.createElement('span');
            name.textContent = p.name(c);
            b.appendChild(num);
            b.appendChild(name);
            b.addEventListener('click', () => { stopTour(); select(id, { focus: true }); });
            li.appendChild(b);
            legendRoot.appendChild(li);
        });
        const head = $('.wt-legend-card h3 span');
        setText(head, fam === 'grid' ? 'Grid connection' : 'Components');
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
        const root = el('wt-labels');
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
        slider.addEventListener('input', () => { ui.windBase = parseFloat(slider.value); renderHud(); });
    }
    $$('button[data-site]').forEach(b => b.addEventListener('click', () => {
        if (ui.site === b.dataset.site) return;
        stopTour();
        ui.site = b.dataset.site;
        if (MODELS[ui.model].sites.indexOf(ui.site) < 0) ui.model = ui.site === 'offshore' ? 'offshore' : 'geared';
        configChanged(true);
        if (viewer) viewer.reframe();
    }));
    $$('button[data-model]').forEach(b => b.addEventListener('click', () => {
        if (b.disabled || ui.model === b.dataset.model) return;
        stopTour();
        ui.model = b.dataset.model;
        configChanged(true);
        if (viewer) viewer.reframe();
    }));
    $$('button[data-foundation]').forEach(b => b.addEventListener('click', () => {
        if (ui.foundation === b.dataset.foundation) return;
        stopTour();
        ui.foundation = b.dataset.foundation;
        configChanged(true);
        if (viewer) viewer.reframe();
    }));
    $$('button[data-link]').forEach(b => b.addEventListener('click', () => {
        if (ui.link === b.dataset.link) return;
        ui.link = b.dataset.link;
        configChanged(false);
    }));

    syncConfigButtons();
    renumber();
    buildLegend();
    buildSteps();
    renderHud();

    // ============================================================
    //  3D bootstrap
    // ============================================================
    function showFallback() {
        stage.classList.add('is-fallback');
        stage.classList.remove('is-ready');
        hero.classList.add('wt-no3d');
        viewer = null;
        renderHud();
    }

    // Three.js is loaded on demand; the promise is shared with the other explorers
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
        const mqStaticInfo = window.matchMedia('(max-width: 600px)');

        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setClearColor(0x000000, 0);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.outputEncoding = THREE.sRGBEncoding;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 600);
        const V = (x, y, z) => new THREE.Vector3(x, y, z);
        const E = (x, y, z) => new THREE.Euler(x, y, z);
        const U = 15;                                    // metres per scene unit for turbines

        // --- Lighting -------------------------------------------------
        scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x1d3a2a, 0.6));
        const key = new THREE.DirectionalLight(0xfff4e0, 1.15);
        key.castShadow = true;
        key.shadow.mapSize.set(2048, 2048);
        key.shadow.bias = -0.0006;
        scene.add(key);
        scene.add(key.target);
        const fill = new THREE.DirectionalLight(0x8fd3ff, 0.35);
        fill.position.set(-8, 4, -2);
        scene.add(fill);
        const rim = new THREE.DirectionalLight(0xffc107, 0.5);
        rim.position.set(-4, 6, -9);
        scene.add(rim);
        function aimLight(cx, cy, cz, size) {
            key.position.set(cx + size * 0.6, cy + size * 1.1, cz + size * 0.8);
            key.target.position.set(cx, cy, cz);
            const sc = key.shadow.camera;
            sc.left = -size; sc.right = size; sc.top = size; sc.bottom = -size;
            sc.near = 0.5; sc.far = size * 5;
            sc.updateProjectionMatrix();
        }

        // --- Materials -------------------------------------------------
        const std = (o) => new THREE.MeshStandardMaterial(o);
        const whiteMat = std({ color: 0xf3f5f8, metalness: 0.15, roughness: 0.42 });
        const housingMat = std({ color: 0xf3f5f8, metalness: 0.15, roughness: 0.42 });
        const towerMat = std({ color: 0xf3f5f8, metalness: 0.15, roughness: 0.42 });
        const bladeMat = std({ color: 0xf7f8fb, metalness: 0.1, roughness: 0.35, side: THREE.DoubleSide });
        const darkMat = std({ color: 0x2a3340, metalness: 0.6, roughness: 0.35 });
        const steelMat = std({ color: 0x9aa5b1, metalness: 0.85, roughness: 0.3 });
        const copperMat = std({ color: 0xb87333, metalness: 0.9, roughness: 0.32 });
        const genMat = std({ color: 0x35506e, metalness: 0.6, roughness: 0.4, emissive: 0x2a6fb0, emissiveIntensity: 0, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide });
        const brakeMat = std({ color: 0x8a3b2e, metalness: 0.7, roughness: 0.4 });
        const caseMat = std({ color: 0x3a7ca5, metalness: 0.4, roughness: 0.5, transparent: true, opacity: 0.28, depthWrite: false });
        const cableMat = std({ color: 0xffc107, emissive: 0x7a5a00, emissiveIntensity: 0.6, roughness: 0.6 });
        const accentMat = std({ color: 0xffc107, metalness: 0.3, roughness: 0.4, emissive: 0x3a2a00, emissiveIntensity: 0.6 });
        const ledMat = std({ color: 0x4caf50, emissive: 0x2e7d32, emissiveIntensity: 1.2 });
        const magnetN = std({ color: 0xd84343, metalness: 0.4, roughness: 0.45 });
        const magnetS = std({ color: 0x3f6fd8, metalness: 0.4, roughness: 0.45 });
        const yellowMat = std({ color: 0xf2c200, metalness: 0.3, roughness: 0.5 });
        const pileMat = std({ color: 0x3d4a57, metalness: 0.6, roughness: 0.5 });
        const rockMat = std({ color: 0x6f6a64, roughness: 1 });
        const subCableMat = std({ color: 0x1b1f24, roughness: 0.6 });
        const concreteMat = std({ color: 0xbfbab2, roughness: 0.9 });
        const xrayMats = [housingMat, towerMat, bladeMat];

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
            g.addColorStop(0.55, '#fff');
            g.addColorStop(1, '#000');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, 256, 256);
            return new THREE.CanvasTexture(c);
        }
        const fadeTex = makeFadeTexture();
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
        function disposeTree(obj) {
            obj.traverse(o => {
                if (o.geometry) o.geometry.dispose();
                if (o.isSprite && o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
            });
        }

        // ===============================================================
        //  Environments: onshore ground, offshore sea
        // ===============================================================
        const onshoreEnv = new THREE.Group();
        scene.add(onshoreEnv);
        const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 80), std({ color: 0x1b3b2a, roughness: 1, transparent: true, opacity: 0.92, alphaMap: fadeTex }));
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        onshoreEnv.add(ground);
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.2, 64), new THREE.MeshBasicMaterial({ color: 0x4caf50, transparent: true, opacity: 0.3, side: THREE.DoubleSide }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.01;
        onshoreEnv.add(ring);

        const offshoreEnv = new THREE.Group();
        scene.add(offshoreEnv);
        const SEA_SEG = 72;
        const seaGeo = new THREE.PlaneGeometry(90, 90, SEA_SEG, SEA_SEG);
        seaGeo.rotateX(-Math.PI / 2);
        const seaBase = Float32Array.from(seaGeo.attributes.position.array);
        const seaMat = std({ color: 0x1f6f9e, roughness: 0.15, metalness: 0.25, transparent: true, opacity: 0.62, alphaMap: fadeTex, depthWrite: false, side: THREE.DoubleSide });
        const sea = new THREE.Mesh(seaGeo, seaMat);
        sea.renderOrder = 2;
        offshoreEnv.add(sea);
        const seabed = new THREE.Mesh(new THREE.CircleGeometry(45, 64), std({ color: 0x8c7a5b, roughness: 1, transparent: true, opacity: 0.95, alphaMap: fadeTex }));
        seabed.rotation.x = -Math.PI / 2;
        seabed.receiveShadow = true;
        offshoreEnv.add(seabed);
        const waterCol = new THREE.Mesh(new THREE.CylinderGeometry(30, 30, 1, 48, 1, true), new THREE.MeshBasicMaterial({ color: 0x0d3d5c, transparent: true, opacity: 0.12, side: THREE.BackSide, depthWrite: false }));
        offshoreEnv.add(waterCol);

        // ===============================================================
        //  Parts registry (rebuilt with the turbine)
        // ===============================================================
        let reg = {};
        const tmpBox = new THREE.Box3();
        function addPart(id, object, anchor, center) {
            object.userData.partId = id;
            reg[id] = { id: id, object: object, anchor: anchor, center: center || ((t) => tmpBox.setFromObject(object).getCenter(t)) };
        }

        // ===============================================================
        //  Blade geometry
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
            const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.055, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.02, bevelSegments: 3, curveSegments: 24 });
            geo.translate(0, 0, -0.0275);
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
        function makeGearGeometry(teeth, radius, depth) {
            const shape = new THREE.Shape();
            const inner = radius * 0.8;
            const step = (Math.PI * 2) / teeth;
            for (let i = 0; i < teeth; i++) {
                const a0 = i * step;
                [[radius, a0], [radius, a0 + step * 0.3], [inner, a0 + step * 0.5], [inner, a0 + step * 0.8]].forEach((p, j) => {
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

        // ===============================================================
        //  Turbine builders. Each returns:
        //  { group, height, bottom, radius, nacelleY, exploders: [{obj, base, delta}],
        //    spin(angle), setPitch(rad), setYaw(rad), animate(op, t, dt, x, ex), cableCurve, gen }
        // ===============================================================
        const YAW_MEAN = 0.35;

        function buildHawt(m, baseY) {
            const root = new THREE.Group();
            const hubUnits = m.hubH / U;
            const S = (hubUnits - baseY) / 6.5;
            const t = new THREE.Group();
            t.position.y = baseY;
            t.scale.setScalar(S);
            root.add(t);
            const bladeLen = (m.R / U) / S - 0.22;
            const ex = [];
            const direct = m.drive === 'direct';
            const giant = m.nacelle === 'giant';

            const TOWER_H = 6.2 - 0.3 - 0.18;
            const tower = mesh(new THREE.CylinderGeometry(0.17, 0.36, TOWER_H, 40), towerMat, { position: V(0, TOWER_H / 2 + 0.18, 0) });
            t.add(tower);
            addPart('tower', tower, (v) => t.localToWorld(v.set(0.27, 3.3, 0.05)));

            const nacelle = new THREE.Group();
            nacelle.position.y = 6.5;
            t.add(nacelle);
            const cover = new THREE.Group();
            nacelle.add(cover);
            let housing;
            if (m.nacelle === 'egg') {
                housing = mesh(new THREE.SphereGeometry(1, 32, 20), housingMat, { position: V(0, 0, -0.3) });
                housing.scale.set(0.42, 0.42, 0.78);
            } else {
                const L = giant ? 1.7 : 1.55;
                housing = mesh(new THREE.BoxGeometry(giant ? 0.8 : 0.68, giant ? 0.66 : 0.6, L), housingMat, { position: V(0, 0, -0.25) });
                const tail = mesh(new THREE.SphereGeometry(0.31, 28, 14, 0, Math.PI * 2, 0, Math.PI), housingMat, { position: V(0, 0, -0.25 - L / 2 + 0.03), rotation: E(-Math.PI / 2, 0, 0) });
                tail.scale.set(giant ? 1.29 : 1.08, giant ? 1.07 : 0.97, 1.1);
                cover.add(tail);
            }
            cover.add(housing);
            cover.add(mesh(new THREE.SphereGeometry(0.05, 12, 10), accentMat, { position: V(0, 0.35, -0.45) }));
            if (giant) {
                const pad = new THREE.Group();
                pad.position.set(0, 0.36, -0.75);
                pad.add(mesh(new THREE.BoxGeometry(0.7, 0.03, 0.6), darkMat));
                pad.add(mesh(new THREE.TorusGeometry(0.22, 0.015, 6, 28), yellowMat, { position: V(0, 0.02, 0), rotation: E(-Math.PI / 2, 0, 0) }));
                [[-0.34, 0], [0.34, 0]].forEach(p => pad.add(mesh(new THREE.BoxGeometry(0.02, 0.12, 0.6), steelMat, { position: V(p[0], 0.06, 0) })));
                cover.add(pad);
            }
            ex.push({ obj: cover, base: cover.position.clone(), delta: V(0, 1.5, 0) });
            addPart('nacelle', cover, (v) => cover.localToWorld(v.set(0, 0.32, -0.2)), (v) => housing.getWorldPosition(v));

            // Anemometer
            const anemo = new THREE.Group();
            anemo.position.set(0, 0.3, -0.82);
            anemo.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.34, 8), steelMat, { position: V(0, 0.17, 0) }));
            const cups = new THREE.Group();
            cups.position.y = 0.34;
            for (let i = 0; i < 3; i++) {
                const a = (i * Math.PI * 2) / 3;
                cups.add(mesh(new THREE.SphereGeometry(0.022, 10, 8, 0, Math.PI), darkMat, { position: V(Math.cos(a) * 0.07, 0, Math.sin(a) * 0.07), rotation: E(0, -a + Math.PI / 2, 0) }));
            }
            anemo.add(cups);
            anemo.add(mesh(new THREE.BoxGeometry(0.01, 0.06, 0.16), darkMat, { position: V(0.06, 0.2, -0.08) }));
            cover.add(anemo);
            addPart('anemometer', anemo, (v) => cups.localToWorld(v.set(0, 0.03, 0)), (v) => cups.getWorldPosition(v));

            // Interior
            const interior = new THREE.Group();
            nacelle.add(interior);
            interior.add(mesh(new THREE.BoxGeometry(0.56, 0.04, 1.4), darkMat, { position: V(0, -0.26, -0.25) }));
            const spinners = [];        // [object, axis, ratio]
            let genGroup;
            if (!direct) {
                nacelle.add(mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.3, 28), darkMat, { position: V(0, 0, 0.65), rotation: E(Math.PI / 2, 0, 0) }));
                const shaftGroup = new THREE.Group();
                const mainShaft = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.72, 20), steelMat, { position: V(0, 0, 0.29), rotation: E(Math.PI / 2, 0, 0) });
                shaftGroup.add(mainShaft);
                shaftGroup.add(mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.1, 28), darkMat, { position: V(0, 0, 0.46), rotation: E(Math.PI / 2, 0, 0) }));
                interior.add(shaftGroup);
                spinners.push([mainShaft, 'y', 1]);
                ex.push({ obj: shaftGroup, base: shaftGroup.position.clone(), delta: V(0, 0, 0.9) });
                addPart('shaft', shaftGroup, (v) => shaftGroup.localToWorld(v.set(0, 0.07, 0.2)), (v) => shaftGroup.localToWorld(v.set(0, 0, 0.29)));

                const gearbox = new THREE.Group();
                gearbox.position.z = -0.1;
                const R_RING = 0.19;
                const R_SUN = 0.05;
                const R_PLANET = (R_RING - R_SUN) / 2;
                const ratio = 1 + R_RING / R_SUN;
                const caseGeo = new THREE.BoxGeometry(0.5, 0.5, 0.3);
                gearbox.add(mesh(caseGeo, caseMat, { castShadow: false }));
                gearbox.add(new THREE.LineSegments(new THREE.EdgesGeometry(caseGeo), new THREE.LineBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.5 })));
                gearbox.add(mesh(new THREE.TorusGeometry(R_RING + 0.02, 0.02, 8, 48), steelMat));
                const carrier = new THREE.Group();
                for (let i = 0; i < 3; i++) {
                    const a = (i * Math.PI * 2) / 3;
                    const p = mesh(makeGearGeometry(11, R_PLANET, 0.09), steelMat, { position: V(Math.cos(a) * (R_SUN + R_PLANET), Math.sin(a) * (R_SUN + R_PLANET), 0) });
                    carrier.add(p);
                    spinners.push([p, 'z', -R_RING / R_PLANET]);
                }
                gearbox.add(carrier);
                spinners.push([carrier, 'z', 1]);
                const sun = mesh(makeGearGeometry(8, R_SUN, 0.1), copperMat);
                gearbox.add(sun);
                spinners.push([sun, 'z', ratio]);
                interior.add(gearbox);
                ex.push({ obj: gearbox, base: gearbox.position.clone(), delta: V(0, 0, 0.42) });
                addPart('gearbox', gearbox, (v) => gearbox.localToWorld(v.set(0, 0.25, 0)));

                const hs = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.5, 16), steelMat, { position: V(0, 0, -0.45), rotation: E(Math.PI / 2, 0, 0) });
                interior.add(hs);
                spinners.push([hs, 'y', ratio]);
                const brake = new THREE.Group();
                brake.position.z = -0.3;
                const disc = mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.025, 36), brakeMat, { rotation: E(Math.PI / 2, 0, 0) });
                for (let i = 0; i < 8; i++) {
                    const a = (i / 8) * Math.PI * 2;
                    disc.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 8), darkMat, { position: V(Math.cos(a) * 0.09, 0, Math.sin(a) * 0.09) }));
                }
                brake.add(disc);
                brake.add(mesh(new THREE.BoxGeometry(0.06, 0.08, 0.07), darkMat, { position: V(0, 0.13, 0) }));
                interior.add(brake);
                spinners.push([disc, 'y', ratio]);
                ex.push({ obj: brake, base: brake.position.clone(), delta: V(0, 0, 0.12) });
                addPart('brake', brake, (v) => brake.localToWorld(v.set(0, 0.17, 0)));

                genGroup = new THREE.Group();
                genGroup.position.z = -0.7;
                genGroup.add(mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.38, 36, 1, true), genMat, { rotation: E(Math.PI / 2, 0, 0), castShadow: false }));
                [-0.12, 0, 0.12].forEach(z => genGroup.add(mesh(new THREE.TorusGeometry(0.172, 0.016, 8, 48), copperMat, { position: V(0, 0, z) })));
                const gr = new THREE.Group();
                gr.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.34, 20), steelMat, { rotation: E(Math.PI / 2, 0, 0) }));
                for (let i = 0; i < 6; i++) {
                    const a = (i / 6) * Math.PI * 2;
                    gr.add(mesh(new THREE.BoxGeometry(0.05, 0.04, 0.3), i % 2 ? magnetS : magnetN, { position: V(Math.cos(a) * 0.09, Math.sin(a) * 0.09, 0), rotation: E(0, 0, a + Math.PI / 2) }));
                }
                genGroup.add(gr);
                genGroup.add(mesh(new THREE.BoxGeometry(0.3, 0.05, 0.38), darkMat, { position: V(0, -0.2, 0) }));
                spinners.push([gr, 'z', ratio]);
                interior.add(genGroup);
                ex.push({ obj: genGroup, base: genGroup.position.clone(), delta: V(0, 0, -0.55) });
                addPart('generator', genGroup, (v) => genGroup.localToWorld(v.set(0, 0.19, 0)));
            } else {
                // Ring generator between hub and nacelle (visible from outside)
                genGroup = new THREE.Group();
                genGroup.position.z = 0.42;
                const ringR = giant ? 0.6 : 0.56;
                genGroup.add(mesh(new THREE.CylinderGeometry(ringR, ringR, 0.3, 48, 1, true), genMat, { rotation: E(Math.PI / 2, 0, 0), castShadow: false }));
                genGroup.add(mesh(new THREE.CylinderGeometry(ringR + 0.02, ringR + 0.02, 0.06, 48), housingMat, { position: V(0, 0, -0.15), rotation: E(Math.PI / 2, 0, 0) }));
                [-0.09, 0.0, 0.09].forEach(z => genGroup.add(mesh(new THREE.TorusGeometry(ringR - 0.01, 0.02, 8, 64), copperMat, { position: V(0, 0, z) })));
                const gr = new THREE.Group();
                for (let i = 0; i < 24; i++) {
                    const a = (i / 24) * Math.PI * 2;
                    gr.add(mesh(new THREE.BoxGeometry(0.1, 0.05, 0.22), i % 2 ? magnetS : magnetN, { position: V(Math.cos(a) * (ringR - 0.09), Math.sin(a) * (ringR - 0.09), 0), rotation: E(0, 0, a + Math.PI / 2) }));
                }
                gr.add(mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.3, 20), steelMat, { rotation: E(Math.PI / 2, 0, 0) }));
                genGroup.add(gr);
                spinners.push([gr, 'z', 1]);
                nacelle.add(genGroup);
                ex.push({ obj: genGroup, base: genGroup.position.clone(), delta: V(0, 0, 0.8) });
                addPart('generator', genGroup, (v) => genGroup.localToWorld(v.set(0, ringR + 0.05, 0)));
                interior.add(mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.4, 24), darkMat, { position: V(0, 0, 0.12), rotation: E(Math.PI / 2, 0, 0) }));
            }

            // Converter
            const converter = new THREE.Group();
            converter.position.set(direct ? 0 : 0.25, -0.1, direct ? -0.55 : -0.78);
            converter.add(mesh(new THREE.BoxGeometry(direct ? 0.4 : 0.12, 0.22, 0.3), darkMat));
            converter.add(mesh(new THREE.SphereGeometry(0.014, 8, 6), ledMat, { position: V(direct ? 0.21 : 0.062, 0.06, 0.08) }));
            interior.add(converter);
            ex.push({ obj: converter, base: converter.position.clone(), delta: V(0.45, 0, -0.2) });
            addPart('converter', converter, (v) => converter.localToWorld(v.set(0, 0.11, 0)));

            // Yaw ring
            const yaw = new THREE.Group();
            yaw.position.y = -0.31;
            yaw.add(mesh(new THREE.TorusGeometry(0.21, 0.03, 8, 48), steelMat, { rotation: E(Math.PI / 2, 0, 0) }));
            [[0.17, 0.08], [-0.17, 0.08]].forEach(p => yaw.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 12), darkMat, { position: V(p[0], 0.07, p[1]) })));
            interior.add(yaw);
            ex.push({ obj: yaw, base: yaw.position.clone(), delta: V(0, -0.9, 0) });
            addPart('yaw', yaw, (v) => yaw.localToWorld(v.set(0.21, 0, 0)));

            // Rotor
            const rotor = new THREE.Group();
            const ROTOR_Z = direct ? 0.72 : 0.8;
            rotor.position.z = ROTOR_Z;
            nacelle.add(rotor);
            const hubGroup = new THREE.Group();
            const hub = mesh(new THREE.SphereGeometry(direct ? 0.36 : 0.3, 28, 20), whiteMat);
            hub.scale.set(1, 1, 1.25);
            hubGroup.add(hub);
            hubGroup.add(mesh(new THREE.ConeGeometry(direct ? 0.27 : 0.22, 0.42, 28), whiteMat, { position: V(0, 0, 0.42), rotation: E(Math.PI / 2, 0, 0) }));
            rotor.add(hubGroup);
            addPart('hub', hubGroup, (v) => nacelle.localToWorld(v.copy(rotor.position).add(V(0, 0, 0.5))), (v) => rotor.getWorldPosition(v));
            const bladeGeo = makeBladeGeometry(bladeLen);
            const bladesGroup = new THREE.Group();
            const pitchPivots = [];
            for (let i = 0; i < 3; i++) {
                const pivot = new THREE.Group();
                pivot.rotation.z = (i * Math.PI * 2) / 3;
                const pp = new THREE.Group();
                pp.position.y = 0.22;
                pp.add(mesh(bladeGeo, bladeMat));
                pivot.add(pp);
                pivot.add(mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.16, 20), darkMat, { position: V(0, 0.26, 0) }));
                pitchPivots.push(pp);
                bladesGroup.add(pivot);
            }
            rotor.add(bladesGroup);
            ex.push({ obj: rotor, base: rotor.position.clone(), delta: V(0, 0, 1.6) });
            addPart('blade', bladesGroup, (v) => nacelle.localToWorld(v.copy(rotor.position).add(V(-0.35 * bladeLen, 0.6 * bladeLen, 0))), (v) => rotor.getWorldPosition(v));

            // Power cable down the tower
            const cableGroup = new THREE.Group();
            const cTop = V(0, 6.1, 0);
            const cBot = V(0.05, 0.4, 0.0);
            const cableCurve = new THREE.CatmullRomCurve3([cTop, V(0, 3.5, 0), cBot]);
            cableGroup.add(mesh(new THREE.TubeGeometry(cableCurve, 30, 0.02, 6, false), cableMat, { castShadow: false }));
            t.add(cableGroup);
            addPart('cable', cableGroup, (v) => t.localToWorld(v.set(0, 2.2, 0)), (v) => t.localToWorld(v.set(0, 3, 0)));

            const gen = genGroup;
            return {
                group: root, scale: S, worldTop: hubUnits + m.R / U, hubY: hubUnits, nacelleNode: nacelle, rotorNode: rotor,
                interior: interior, cableGroup: cableGroup, exploders: ex, gen: gen,
                cableBottomWorld: () => t.localToWorld(cBot.clone()),
                spin(angle) {
                    rotor.rotation.z = angle;
                    spinners.forEach(s => { s[0].rotation[s[1]] = angle * s[2]; });
                },
                setPitch(r) { pitchPivots.forEach(p => { p.rotation.y = r; }); },
                setYaw(r) { nacelle.rotation.y = r; },
                animate(op, time, dt) { cups.rotation.y += op.v * 0.9 * dt * motionScale; }
            };
        }

        function buildVawt(m) {
            const root = new THREE.Group();
            const H = m.rotorH / U;
            const R = m.R / U;
            const baseH = 0.45;
            const y0 = baseH + 0.15;
            const y1 = y0 + H;
            const ex = [];
            const base = new THREE.Group();
            base.add(mesh(new THREE.BoxGeometry(1.1, baseH, 1.1), housingMat, { position: V(0, baseH / 2, 0) }));
            root.add(base);
            const foundation = mesh(new THREE.CylinderGeometry(0.9, 1.0, 0.1, 32), concreteMat, { position: V(0, 0.05, 0) });
            root.add(foundation);
            addPart('foundation', foundation, (v) => v.set(0.9, 0.12, 0.3));
            const rotorG = new THREE.Group();
            root.add(rotorG);
            const column = mesh(new THREE.CylinderGeometry(0.08, 0.09, H + 0.4, 20), towerMat, { position: V(0, y0 + H / 2, 0) });
            rotorG.add(column);
            for (let b = 0; b < 2; b++) {
                const pts = [];
                for (let k = 0; k <= 30; k++) {
                    const s = k / 30;
                    const r = 0.06 + R * Math.pow(Math.sin(Math.PI * s), 0.85);
                    pts.push(V(r, y0 + s * H, 0));
                }
                const blade = mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.05, 8, false), bladeMat);
                blade.scale.set(1, 1, 0.55);
                const pivot = new THREE.Group();
                pivot.rotation.y = b * Math.PI;
                pivot.add(blade);
                rotorG.add(pivot);
            }
            ex.push({ obj: rotorG, base: rotorG.position.clone(), delta: V(0, 1.4, 0) });
            addPart('blade', rotorG, (v) => v.set(R * 0.95, y0 + H * 0.62, 0), (v) => v.set(0, y0 + H / 2, 0));
            // Guy wires
            const guys = new THREE.Group();
            for (let k = 0; k < 3; k++) {
                const a = k * Math.PI * 2 / 3 + 0.4;
                const anchor = V(Math.cos(a) * R * 2.6, 0, Math.sin(a) * R * 2.6);
                guys.add(mesh(new THREE.TubeGeometry(new THREE.LineCurve3(V(0, y1 + 0.2, 0), anchor), 2, 0.012, 4, false), steelMat, { castShadow: false }));
                guys.add(mesh(new THREE.BoxGeometry(0.2, 0.08, 0.2), concreteMat, { position: anchor }));
            }
            root.add(guys);
            addPart('tower', column, (v) => v.set(0.1, y0 + H * 0.25, 0.05), (v) => v.set(0, y0 + H / 2, 0));
            // Ground-level drive train (x-ray through the base housing)
            const interior = new THREE.Group();
            root.add(interior);
            const gearbox = new THREE.Group();
            gearbox.position.set(0, 0.22, 0);
            gearbox.add(mesh(new THREE.BoxGeometry(0.34, 0.26, 0.34), caseMat, { castShadow: false }));
            const gear = mesh(makeGearGeometry(14, 0.13, 0.05), steelMat, { rotation: E(Math.PI / 2, 0, 0) });
            gearbox.add(gear);
            interior.add(gearbox);
            ex.push({ obj: gearbox, base: gearbox.position.clone(), delta: V(0, 0, 0.8) });
            addPart('gearbox', gearbox, (v) => v.set(0, 0.4, 0));
            const genG = new THREE.Group();
            genG.position.set(0.36, 0.2, 0);
            genG.add(mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.26, 24, 1, true), genMat, { rotation: E(0, 0, Math.PI / 2), castShadow: false }));
            const gr = new THREE.Group();
            for (let i = 0; i < 6; i++) {
                const a = i / 6 * Math.PI * 2;
                gr.add(mesh(new THREE.BoxGeometry(0.22, 0.03, 0.04), i % 2 ? magnetS : magnetN, { position: V(0, Math.cos(a) * 0.06, Math.sin(a) * 0.06), rotation: E(a, 0, 0) }));
            }
            genG.add(gr);
            interior.add(genG);
            ex.push({ obj: genG, base: genG.position.clone(), delta: V(0.8, 0, 0) });
            addPart('generator', genG, (v) => genG.localToWorld(v.set(0, 0.14, 0)));
            const brake = new THREE.Group();
            brake.position.set(-0.3, 0.2, 0);
            const disc = mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 28), brakeMat, { rotation: E(0, 0, Math.PI / 2) });
            brake.add(disc);
            interior.add(brake);
            ex.push({ obj: brake, base: brake.position.clone(), delta: V(-0.7, 0, 0) });
            addPart('brake', brake, (v) => brake.localToWorld(v.set(0, 0.13, 0)));
            const converter = new THREE.Group();
            converter.position.set(0, 0.16, 0.36);
            converter.add(mesh(new THREE.BoxGeometry(0.3, 0.2, 0.1), darkMat));
            converter.add(mesh(new THREE.SphereGeometry(0.012, 8, 6), ledMat, { position: V(0.1, 0.05, 0.055) }));
            interior.add(converter);
            ex.push({ obj: converter, base: converter.position.clone(), delta: V(0, 0, 0.8) });
            addPart('converter', converter, (v) => v.set(0, 0.3, 0.36));
            const cableGroup = new THREE.Group();
            const cableCurve = new THREE.CatmullRomCurve3([V(0, 0.1, 0.4), V(0.6, 0.05, 0.9), V(1.6, 0.05, 1.2)]);
            cableGroup.add(mesh(new THREE.TubeGeometry(cableCurve, 20, 0.02, 6, false), cableMat, { castShadow: false }));
            interior.add(cableGroup);
            addPart('cable', cableGroup, (v) => cableCurve.getPointAt(0.5, v).add(V(0, 0.1, 0)));
            // Transformer kiosk
            const kiosk = new THREE.Group();
            kiosk.position.set(1.8, 0, 1.3);
            kiosk.add(mesh(new THREE.BoxGeometry(0.5, 0.42, 0.4), std({ color: 0x5f6f66, metalness: 0.5, roughness: 0.5 }), { position: V(0, 0.21, 0) }));
            root.add(kiosk);
            addPart('transformer', kiosk, (v) => kiosk.localToWorld(v.set(0, 0.55, 0)));
            const rootTop = y1 + 0.3;
            return {
                group: root, scale: 1, worldTop: rootTop, hubY: y0 + H / 2, interior: interior, cableGroup: cableGroup, exploders: ex, gen: genG,
                spin(angle) { rotorG.rotation.y = angle; gear.rotation.z = angle * 2; gr.rotation.x = angle * 6; disc.rotation.x = angle * 6; },
                setPitch() { }, setYaw() { },
                animate() { }
            };
        }

        function buildSmall(m) {
            const root = new THREE.Group();
            const hubY = m.hubH / U;
            const R = m.R / U;
            const ex = [];
            const mast = mesh(new THREE.CylinderGeometry(0.012, 0.02, hubY - 0.02, 12), towerMat, { position: V(0, (hubY - 0.02) / 2, 0) });
            root.add(mast);
            addPart('tower', mast, (v) => v.set(0.03, hubY * 0.45, 0));
            const footing = mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.03, 20), concreteMat, { position: V(0, 0.015, 0) });
            root.add(footing);
            for (let k = 0; k < 4; k++) {
                const a = k * Math.PI / 2 + 0.6;
                const anchor = V(Math.cos(a) * 0.55, 0, Math.sin(a) * 0.55);
                root.add(mesh(new THREE.TubeGeometry(new THREE.LineCurve3(V(0, hubY * 0.7, 0), anchor), 2, 0.0025, 4, false), steelMat, { castShadow: false }));
                root.add(mesh(new THREE.BoxGeometry(0.04, 0.02, 0.04), concreteMat, { position: anchor }));
            }
            addPart('foundation', footing, (v) => v.set(0.06, 0.04, 0.03));
            const head = new THREE.Group();
            head.position.y = hubY;
            root.add(head);
            const body = new THREE.Group();
            const housing = mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.16, 16), housingMat, { position: V(0, 0, -0.02), rotation: E(Math.PI / 2, 0, 0) });
            body.add(housing);
            head.add(body);
            addPart('nacelle', body, (v) => head.localToWorld(v.set(0, 0.04, -0.03)));
            const genG = new THREE.Group();
            genG.position.z = -0.01;
            genG.add(mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.08, 16, 1, true), genMat, { rotation: E(Math.PI / 2, 0, 0), castShadow: false }));
            const gr = new THREE.Group();
            for (let i = 0; i < 6; i++) {
                const a = i / 6 * Math.PI * 2;
                gr.add(mesh(new THREE.BoxGeometry(0.01, 0.006, 0.07), i % 2 ? magnetS : magnetN, { position: V(Math.cos(a) * 0.018, Math.sin(a) * 0.018, 0), rotation: E(0, 0, a) }));
            }
            genG.add(gr);
            head.add(genG);
            ex.push({ obj: genG, base: genG.position.clone(), delta: V(0, 0.12, 0) });
            addPart('generator', genG, (v) => head.localToWorld(v.set(0, 0.035, -0.01)));
            const rotor = new THREE.Group();
            rotor.position.z = 0.07;
            head.add(rotor);
            const hubG = new THREE.Group();
            hubG.add(mesh(new THREE.ConeGeometry(0.025, 0.05, 16), whiteMat, { position: V(0, 0, 0.02), rotation: E(Math.PI / 2, 0, 0) }));
            rotor.add(hubG);
            addPart('hub', hubG, (v) => head.localToWorld(v.set(0, 0, 0.11)), (v) => rotor.getWorldPosition(v));
            const bladeGeo = makeBladeGeometry(3.1);
            const bladeS = (R - 0.02) / 3.3;
            const blades = new THREE.Group();
            for (let i = 0; i < 3; i++) {
                const pivot = new THREE.Group();
                pivot.rotation.z = i * Math.PI * 2 / 3;
                const b = mesh(bladeGeo, bladeMat, { position: V(0, 0.02, 0) });
                b.scale.setScalar(bladeS);
                pivot.add(b);
                blades.add(pivot);
            }
            rotor.add(blades);
            ex.push({ obj: rotor, base: rotor.position.clone(), delta: V(0, 0, 0.2) });
            addPart('blade', blades, (v) => head.localToWorld(v.set(-R * 0.4, R * 0.65, 0.07)), (v) => rotor.getWorldPosition(v));
            const tail = new THREE.Group();
            tail.position.z = -0.08;
            tail.add(mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.32, 8), steelMat, { position: V(0, 0, -0.16), rotation: E(Math.PI / 2, 0, 0) }));
            tail.add(mesh(new THREE.BoxGeometry(0.004, 0.12, 0.16), whiteMat, { position: V(0, 0.03, -0.33) }));
            head.add(tail);
            ex.push({ obj: tail, base: tail.position.clone(), delta: V(0, 0, -0.18) });
            addPart('tail', tail, (v) => tail.localToWorld(v.set(0, 0.1, -0.33)));
            // Inverter & battery cabinet at the base, and a person for scale
            const converter = new THREE.Group();
            converter.position.set(0.3, 0, 0.2);
            converter.add(mesh(new THREE.BoxGeometry(0.1, 0.1, 0.06), std({ color: 0xdfe5ea, roughness: 0.6 }), { position: V(0, 0.05, 0) }));
            converter.add(mesh(new THREE.SphereGeometry(0.006, 8, 6), ledMat, { position: V(0.03, 0.08, 0.032) }));
            root.add(converter);
            addPart('converter', converter, (v) => converter.localToWorld(v.set(0, 0.13, 0)));
            const person = new THREE.Group();
            person.position.set(0.45, 0, 0.05);
            person.add(mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.085, 10), std({ color: 0x2f5f8f }), { position: V(0, 0.043, 0) }));
            person.add(mesh(new THREE.SphereGeometry(0.013, 12, 10), std({ color: 0xe0b896 }), { position: V(0, 0.1, 0) }));
            root.add(person);
            const scaleTag = textSprite('person, 1.8 m', '#cfeed2', 0.035);
            scaleTag.position.set(0.45, 0.15, 0.05);
            root.add(scaleTag);
            const cableGroup = new THREE.Group();
            const cableCurve = new THREE.CatmullRomCurve3([V(0, hubY - 0.05, 0), V(0.005, hubY * 0.5, 0), V(0.02, 0.02, 0.02), V(0.3, 0.02, 0.2)]);
            cableGroup.add(mesh(new THREE.TubeGeometry(cableCurve, 30, 0.004, 6, false), cableMat, { castShadow: false }));
            root.add(cableGroup);
            addPart('cable', cableGroup, (v) => cableCurve.getPointAt(0.5, v));
            return {
                group: root, scale: R / 3.3, worldTop: hubY + R, hubY: hubY, interior: new THREE.Group(), cableGroup: cableGroup, exploders: ex, gen: genG,
                spin(angle) { rotor.rotation.z = angle; gr.rotation.z = angle; },
                setPitch() { },
                setYaw(r) { head.rotation.y = r; },
                setFurl(r) { head.rotation.y = YAW_MEAN + r; tail.rotation.y = -r * 1.1; },
                animate() { }
            };
        }

        // ---- Offshore foundations (world units below the tower base) ----
        function buildOffshore(type, towerBaseR, baseY) {
            const g = new THREE.Group();
            const depth = FOUNDATIONS[type].depthM / U;
            const bed = -depth;
            const parts = {};
            let cableStart;
            if (type === 'monopile') {
                const pileR = towerBaseR * 1.15;
                const pile = new THREE.Group();
                pile.add(mesh(new THREE.CylinderGeometry(pileR, pileR, depth + 0.5, 32), pileMat, { position: V(0, bed + (depth + 0.5) / 2, 0) }));
                for (let i = 0; i < 26; i++) {
                    const a = Math.random() * Math.PI * 2;
                    const r = pileR + 0.2 + Math.random() * 1.0;
                    pile.add(mesh(new THREE.DodecahedronGeometry(0.1 + Math.random() * 0.12, 0), rockMat, { position: V(Math.cos(a) * r, bed + 0.05, Math.sin(a) * r) }));
                }
                g.add(pile);
                parts.foundation = { obj: pile, anchor: (v) => v.set(pileR + 0.05, bed * 0.55, 0) };
                cableStart = V(pileR + 0.06, bed + 0.25, 0);
            } else if (type === 'jacket') {
                const jacket = new THREE.Group();
                const topY = 0.4;
                const w0 = 1.6;
                const w1 = 0.7;
                const corners = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
                const legs = corners.map(cn => [V(cn[0] * w0, bed, cn[1] * w0), V(cn[0] * w1, topY, cn[1] * w1)]);
                legs.forEach(l => jacket.add(mesh(new THREE.TubeGeometry(new THREE.LineCurve3(l[0], l[1]), 2, 0.06, 8, false), yellowMat)));
                const levels = 4;
                for (let lv = 0; lv < levels; lv++) {
                    const ta = lv / levels;
                    const tb = (lv + 1) / levels;
                    const at = (l, tt) => l[0].clone().lerp(l[1], tt);
                    [[0, 1], [0, 2], [3, 1], [3, 2]].forEach(pr => {
                        jacket.add(mesh(new THREE.TubeGeometry(new THREE.LineCurve3(at(legs[pr[0]], ta), at(legs[pr[1]], tb)), 2, 0.025, 6, false), yellowMat));
                        jacket.add(mesh(new THREE.TubeGeometry(new THREE.LineCurve3(at(legs[pr[1]], ta), at(legs[pr[0]], tb)), 2, 0.025, 6, false), yellowMat));
                    });
                }
                legs.forEach(l => jacket.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.4, 10), pileMat, { position: l[0].clone().add(V(0, 0.1, 0)) })));
                jacket.add(mesh(new THREE.BoxGeometry(w1 * 2.4, 0.12, w1 * 2.4), yellowMat, { position: V(0, topY, 0) }));
                g.add(jacket);
                parts.foundation = { obj: jacket, anchor: (v) => v.set(w0 * 0.8, bed * 0.5, w0 * 0.8) };
                cableStart = V(w0 + 0.05, bed + 0.2, -w0);
            } else {
                // Semi-submersible: centre column + three outer columns, pontoons and braces
                const plat = new THREE.Group();
                const colR = 0.42;
                const draft = 1.3;
                const top = baseY;
                plat.add(mesh(new THREE.CylinderGeometry(colR * 0.8, colR * 0.8, top + draft, 24), yellowMat, { position: V(0, (top - draft) / 2, 0) }));
                const outer = [];
                for (let k = 0; k < 3; k++) {
                    const a = k * Math.PI * 2 / 3 + Math.PI / 6;
                    const p = V(Math.cos(a) * 2.4, 0, Math.sin(a) * 2.4);
                    outer.push(p);
                    plat.add(mesh(new THREE.CylinderGeometry(colR, colR, top + draft, 24), yellowMat, { position: V(p.x, (top - draft) / 2, p.z) }));
                    plat.add(mesh(new THREE.TubeGeometry(new THREE.LineCurve3(V(0, -draft + 0.15, 0), V(p.x, -draft + 0.15, p.z)), 2, 0.18, 8, false), pileMat));
                    plat.add(mesh(new THREE.TubeGeometry(new THREE.LineCurve3(V(0, top - 0.15, 0), V(p.x, top - 0.15, p.z)), 2, 0.05, 6, false), steelMat));
                }
                g.add(plat);
                parts.foundation = { obj: plat, anchor: (v) => v.set(outer[0].x, top + 0.1, outer[0].z) };
                const moor = new THREE.Group();
                outer.forEach(p => {
                    const dir = V(p.x, 0, p.z).normalize();
                    const fair = V(p.x, -draft + 0.3, p.z);
                    const anchor = V(p.x + dir.x * 9, bed, p.z + dir.z * 9);
                    const mid = fair.clone().lerp(anchor, 0.55);
                    mid.y = bed + 0.35;
                    const curve = new THREE.CatmullRomCurve3([fair, fair.clone().lerp(mid, 0.5).add(V(0, -0.3, 0)), mid, anchor]);
                    moor.add(mesh(new THREE.TubeGeometry(curve, 30, 0.025, 6, false), subCableMat, { castShadow: false }));
                    moor.add(mesh(new THREE.BoxGeometry(0.35, 0.18, 0.35), pileMat, { position: anchor }));
                });
                g.add(moor);
                parts.mooring = { obj: moor, anchor: (v) => v.set(outer[1].x * 2.3, bed * 0.55, outer[1].z * 2.3) };
                cableStart = V(-0.2, -draft, 0.2);
            }
            // Transition piece (fixed foundations)
            if (type !== 'floating') {
                const tp = new THREE.Group();
                const tpR = towerBaseR * 1.2;
                const tpBottom = type === 'jacket' ? 0.46 : -0.6;
                tp.add(mesh(new THREE.CylinderGeometry(tpR, tpR, baseY - tpBottom, 28), yellowMat, { position: V(0, (baseY + tpBottom) / 2, 0) }));
                tp.add(mesh(new THREE.CylinderGeometry(tpR + 0.45, tpR + 0.45, 0.06, 32), steelMat, { position: V(0, baseY - 0.05, 0) }));
                for (let k = 0; k < 12; k++) {
                    const a = k / 12 * Math.PI * 2;
                    tp.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 4), steelMat, { position: V(Math.cos(a) * (tpR + 0.43), baseY + 0.06, Math.sin(a) * (tpR + 0.43)) }));
                }
                const landing = mesh(new THREE.BoxGeometry(0.06, baseY + 0.4, 0.3), steelMat, { position: V(tpR + 0.05, (baseY - 0.4) / 2, 0.3) });
                tp.add(landing);
                g.add(tp);
                parts.transition = { obj: tp, anchor: (v) => v.set(tpR + 0.5, baseY + 0.1, 0) };
                // J-tube along the foundation
                const jx = (type === 'jacket') ? 0.75 : towerBaseR * 1.15 + 0.06;
                const jtube = new THREE.CatmullRomCurve3([V(tpR, baseY - 0.1, -0.1), V(jx, 0, -0.15), V(cableStart.x, cableStart.y + 0.4, cableStart.z * 0.5), cableStart]);
                g.add(mesh(new THREE.TubeGeometry(jtube, 24, 0.035, 6, false), steelMat, { castShadow: false }));
            }
            // Inter-array cable along the seabed
            const arr = new THREE.Group();
            let pts;
            if (type === 'floating') {
                pts = [cableStart, V(1.0, -draftOf(type) - 1.0, 1.0), V(2.4, bed + 2.2, 2.0), V(3.6, bed + 1.4, 2.6), V(5.2, bed + 0.1, 3.2), V(12, bed + 0.05, 5)];
                const buoys = new THREE.CatmullRomCurve3(pts);
                for (let k = 0; k < 7; k++) arr.add(mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.14, 12), yellowMat, { position: buoys.getPointAt(0.24 + k * 0.025), rotation: E(0, 0, Math.PI / 2) }));
            } else {
                pts = [cableStart, cableStart.clone().add(V(0.6, -0.2, 0.2)), V(cableStart.x + 2.5, bed + 0.05, 1.0), V(12, bed + 0.05, 4)];
            }
            const arrCurve = new THREE.CatmullRomCurve3(pts);
            arr.add(mesh(new THREE.TubeGeometry(arrCurve, 60, 0.05, 8, false), subCableMat, { castShadow: false }));
            arr.add(mesh(new THREE.TubeGeometry(arrCurve, 60, 0.07, 8, false), new THREE.MeshBasicMaterial({ color: 0xffc107, transparent: true, opacity: 0.18, depthWrite: false })));
            g.add(arr);
            parts.arraycable = { obj: arr, anchor: (v) => arrCurve.getPointAt(0.55, v).add(V(0, 0.15, 0)) };
            return { group: g, depth: depth, parts: parts, arrCurve: arrCurve };
        }
        function draftOf(type) { return type === 'floating' ? 1.3 : 0; }

        // ===============================================================
        //  Grid-link dioramas (miniature, not to scale)
        // ===============================================================
        function miniTurbine(h, r) {
            const g = new THREE.Group();
            g.add(mesh(new THREE.CylinderGeometry(h * 0.02, h * 0.035, h, 10), whiteMat, { position: V(0, h / 2, 0) }));
            const head = new THREE.Group();
            head.position.y = h;
            head.rotation.y = YAW_MEAN;
            head.add(mesh(new THREE.BoxGeometry(h * 0.08, h * 0.07, h * 0.18), whiteMat, { position: V(0, 0, -h * 0.03) }));
            const rot = new THREE.Group();
            rot.position.z = h * 0.08;
            for (let i = 0; i < 3; i++) {
                const p = new THREE.Group();
                p.rotation.z = i * Math.PI * 2 / 3;
                p.add(mesh(new THREE.BoxGeometry(r * 0.06, r, r * 0.02), bladeMat, { position: V(0, r / 2, 0) }));
                rot.add(p);
            }
            head.add(rot);
            g.add(head);
            g.userData.rotor = rot;
            return g;
        }
        const gridRoot = new THREE.Group();
        scene.add(gridRoot);
        const miniRotors = [];
        const gridFlows = [];
        function gridFlow(parent, curve, color, count, size, key) {
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
            const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: color, size: size, transparent: true, opacity: 0.95, depthWrite: false }));
            pts.frustumCulled = false;
            parent.add(pts);
            const f = { pts: pts, curve: curve, count: count, phase: Math.random(), len: curve.getLength(), key: key, tmp: V(0, 0, 0) };
            gridFlows.push(f);
            return f;
        }
        const gridParts = {};
        function gridPart(id, obj, anchor) { obj.userData.partId = id; gridParts[id] = { id: id, object: obj, anchor: anchor, center: (t) => tmpBox.setFromObject(obj).getCenter(t) }; }

        // ---- Offshore diorama ----
        const offGrid = new THREE.Group();
        gridRoot.add(offGrid);
        const gSea = mesh(new THREE.PlaneGeometry(46, 34), std({ color: 0x1f6f9e, roughness: 0.15, metalness: 0.25, transparent: true, opacity: 0.58, depthWrite: false }), { position: V(8, 0, 0), rotation: E(-Math.PI / 2, 0, 0), castShadow: false });
        gSea.renderOrder = 2;
        offGrid.add(gSea);
        offGrid.add(mesh(new THREE.BoxGeometry(46, 0.4, 34), std({ color: 0x8c7a5b, roughness: 1 }), { position: V(8, -1.0, 0), castShadow: false }));
        const landMat = std({ color: 0x3f6b3a, roughness: 1 });
        offGrid.add(mesh(new THREE.BoxGeometry(26, 1.4, 34), landMat, { position: V(-28, -0.3, 0) }));
        const beach = mesh(new THREE.BoxGeometry(4, 0.3, 34), std({ color: 0xd8c38f, roughness: 1 }), { position: V(-14.6, 0.2, 0) });
        beach.rotation.z = 0.12;
        offGrid.add(beach);
        for (let k = 0; k < 8; k++) offGrid.add(mesh(new THREE.SphereGeometry(0.9, 12, 8), std({ color: 0xc9b47c, roughness: 1 }), { position: V(-16.6, 0.25, -14 + k * 4), castShadow: false }));
        const offFarm = new THREE.Group();
        [8, 13, 18].forEach(x => [-9, -3, 3, 9].forEach(z => {
            const tb = miniTurbine(2.4, 1.4);
            tb.position.set(x, 0.25, z);
            tb.add(mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.3, 10), yellowMat, { position: V(0, -0.45, 0) }));
            offFarm.add(tb);
            miniRotors.push(tb.userData.rotor);
        }));
        offGrid.add(offFarm);
        gridPart('farm', offFarm, (v) => v.set(18, 3.9, -9));
        const offArray = new THREE.Group();
        const bedY = -0.75;
        const OSS = V(2, 0, 0);
        [-9, -3, 3, 9].forEach(z => {
            const curve = new THREE.CatmullRomCurve3([V(18, bedY, z), V(13, bedY, z), V(8, bedY, z), V(5, bedY, z * 0.6), V(OSS.x + 0.4, bedY, z * 0.08)]);
            offArray.add(mesh(new THREE.TubeGeometry(curve, 40, 0.06, 6, false), cableMat, { castShadow: false }));
            gridFlow(offGrid, curve, 0xffe082, 22, 0.32, 'array');
        });
        offGrid.add(offArray);
        gridPart('array', offArray, (v) => v.set(10.5, bedY + 0.3, 3));
        const oss = new THREE.Group();
        oss.position.copy(OSS);
        [[0.7, 0.5], [0.7, -0.5], [-0.7, 0.5], [-0.7, -0.5]].forEach(p => oss.add(mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.2, 8), yellowMat, { position: V(p[0], 0.25, p[1]) })));
        oss.add(mesh(new THREE.BoxGeometry(2.0, 0.9, 1.6), std({ color: 0xe8edf1, roughness: 0.5 }), { position: V(0, 1.75, 0) }));
        oss.add(mesh(new THREE.BoxGeometry(1.2, 0.05, 1.0), darkMat, { position: V(0.2, 2.23, 0) }));
        oss.add(mesh(new THREE.TorusGeometry(0.3, 0.03, 6, 24), yellowMat, { position: V(0.2, 2.27, 0), rotation: E(-Math.PI / 2, 0, 0) }));
        offGrid.add(oss);
        gridPart('oss', oss, (v) => v.set(OSS.x, 2.7, OSS.z));
        const hvdc = new THREE.Group();
        hvdc.position.set(-2.5, 0, 2.6);
        [[1.1, 0.8], [1.1, -0.8], [-1.1, 0.8], [-1.1, -0.8]].forEach(p => hvdc.add(mesh(new THREE.CylinderGeometry(0.1, 0.12, 2.6, 8), yellowMat, { position: V(p[0], 0.4, p[1]) })));
        hvdc.add(mesh(new THREE.BoxGeometry(3.0, 1.5, 2.2), std({ color: 0xdfe6ec, roughness: 0.5 }), { position: V(0, 2.3, 0) }));
        const hvdcTag = textSprite('HVDC', '#8fe3ff', 0.55);
        hvdcTag.position.set(0, 3.5, 0);
        hvdc.add(hvdcTag);
        offGrid.add(hvdc);
        gridPart('hvdcplat', hvdc, (v) => v.set(-2.5, 3.9, 2.6));
        const exportGroup = new THREE.Group();
        const landfallX = -14.2;
        const exportAc = new THREE.CatmullRomCurve3([V(OSS.x - 0.3, bedY, 0), V(-3, bedY, -1.5), V(-8, bedY, -0.5), V(-12, bedY + 0.05, 0.4), V(landfallX, bedY + 0.1, 0.5)]);
        const exportDc = new THREE.CatmullRomCurve3([V(-2.5, bedY, 2.6), V(-5, bedY, 2.0), V(-9, bedY, 0.8), V(-12, bedY + 0.05, 0.5), V(landfallX, bedY + 0.1, 0.5)]);
        const exportAcMesh = mesh(new THREE.TubeGeometry(exportAc, 60, 0.09, 8, false), copperMat, { castShadow: false });
        const exportDcMesh = mesh(new THREE.TubeGeometry(exportDc, 60, 0.09, 8, false), std({ color: 0x8fe3ff, emissive: 0x1a5f80, emissiveIntensity: 0.5 }), { castShadow: false });
        exportGroup.add(exportAcMesh);
        exportGroup.add(exportDcMesh);
        const ossToHvdc = mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(OSS.x - 0.3, bedY, 0), V(-0.4, bedY, 1.4), V(-2.5, bedY, 2.6)]), 20, 0.07, 6, false), cableMat, { castShadow: false });
        exportGroup.add(ossToHvdc);
        offGrid.add(exportGroup);
        gridPart('export', exportGroup, (v) => v.set(-7, bedY + 0.4, -0.6));
        const fAc = gridFlow(offGrid, exportAc, 0xffc107, 40, 0.38, 'exportAc');
        const fDc = gridFlow(offGrid, exportDc, 0x8fe3ff, 40, 0.38, 'exportDc');
        const fBridge = gridFlow(offGrid, new THREE.CatmullRomCurve3([V(OSS.x - 0.3, bedY, 0), V(-0.4, bedY, 1.4), V(-2.5, bedY, 2.6)]), 0xffe082, 8, 0.32, 'bridge');
        const distTag = textSprite('≈ 30 km, not to scale', '#ffe082', 0.5);
        distTag.position.set(-7, 1.2, -2.2);
        offGrid.add(distTag);
        const landfall = new THREE.Group();
        const hdd = new THREE.CatmullRomCurve3([V(landfallX, bedY + 0.1, 0.5), V(-15.5, -0.6, 0.5), V(-17, -0.35, 0.5), V(-18.5, 0.15, 0.5)]);
        landfall.add(mesh(new THREE.TubeGeometry(hdd, 30, 0.08, 6, false), copperMat, { castShadow: false }));
        landfall.add(mesh(new THREE.BoxGeometry(1.2, 0.5, 0.9), concreteMat, { position: V(-18.9, 0.2, 0.5) }));
        offGrid.add(landfall);
        gridPart('landfall', landfall, (v) => v.set(-17, 0.9, 0.5));
        gridFlow(offGrid, hdd, 0xffc107, 10, 0.32, 'land');
        const landCable = new THREE.CatmullRomCurve3([V(-18.9, 0.42, 0.5), V(-22, 0.42, 1.5), V(-25.5, 0.42, 1.2)]);
        offGrid.add(mesh(new THREE.TubeGeometry(landCable, 20, 0.06, 6, false), darkMat, { castShadow: false }));
        gridFlow(offGrid, landCable, 0xffc107, 10, 0.3, 'land');
        const onStation = new THREE.Group();
        onStation.position.set(-27.5, 0.4, 1.0);
        onStation.add(mesh(new THREE.BoxGeometry(4.2, 0.04, 3.4), std({ color: 0x9a9e9f, roughness: 1 }), { position: V(0, 0.02, 0) }));
        const acYard = new THREE.Group();
        [-1.1, 0.3].forEach(x => acYard.add(mesh(new THREE.BoxGeometry(0.9, 0.8, 0.7), std({ color: 0x7c8a7a, roughness: 0.6, metalness: 0.3 }), { position: V(x, 0.42, -0.6) })));
        [-1.2, -0.4, 0.4, 1.2].forEach(x => acYard.add(mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.7, 14), std({ color: 0x8c6d4f, roughness: 0.6 }), { position: V(x, 0.37, 0.9) })));
        onStation.add(acYard);
        const dcHall = new THREE.Group();
        dcHall.add(mesh(new THREE.BoxGeometry(3.4, 1.4, 2.0), std({ color: 0xdfe6ec, roughness: 0.6 }), { position: V(0, 0.72, -0.3) }));
        [-1.2, 0, 1.2].forEach(x => dcHall.add(mesh(new THREE.BoxGeometry(0.7, 0.6, 0.5), std({ color: 0x7c8a7a, roughness: 0.6, metalness: 0.3 }), { position: V(x, 0.32, 1.2) })));
        onStation.add(dcHall);
        offGrid.add(onStation);
        gridPart('onstation', onStation, (v) => v.set(-27.5, 2.3, 1.0));
        function pylon(p, h) {
            const py = new THREE.Group();
            py.position.copy(p);
            [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]].forEach(l => {
                const leg = mesh(new THREE.CylinderGeometry(0.03, 0.05, h, 5), steelMat, { position: V(l[0] * 0.6, h / 2, l[1] * 0.6) });
                leg.rotation.set(-l[1] * 0.12, 0, l[0] * 0.12);
                py.add(leg);
            });
            py.add(mesh(new THREE.BoxGeometry(1.8, 0.06, 0.06), steelMat, { position: V(0, h - 0.2, 0) }));
            return py;
        }
        const offLine = new THREE.Group();
        const pylonsOff = [V(-30.5, 0.4, -2), V(-34.5, 0.4, -5.5), V(-38.5, 0.4, -9)];
        pylonsOff.forEach(p => offLine.add(pylon(p, 3.6)));
        const lineCurveOff = new THREE.CatmullRomCurve3([V(-28.5, 1.4, 0.4)].concat(pylonsOff.map(p => V(p.x, p.y + 3.4, p.z))).concat([V(-41, 3.6, -11.5)]));
        offLine.add(mesh(new THREE.TubeGeometry(lineCurveOff, 40, 0.03, 5, false), darkMat, { castShadow: false }));
        offGrid.add(offLine);
        gridFlow(offGrid, lineCurveOff, 0xffc107, 22, 0.3, 'line');
        gridPart('grid', offLine, (v) => v.set(-34.5, 4.6, -5.5));
        const offParts = ['farm', 'array', 'oss', 'hvdcplat', 'export', 'landfall', 'onstation', 'grid'];
        const offGridParts = {};
        offParts.forEach(id => { offGridParts[id] = gridParts[id]; });

        // ---- Onshore diorama ----
        const onGrid = new THREE.Group();
        gridRoot.add(onGrid);
        const hillGeo = new THREE.PlaneGeometry(60, 34, 60, 34);
        hillGeo.rotateX(-Math.PI / 2);
        const hillH = (x, z) => 1.4 * Math.max(0, Math.sin(x * 0.18 + 0.6) * Math.cos(z * 0.16)) + 0.5 * Math.sin(x * 0.4) * Math.cos(z * 0.33) + 0.6;
        const hp = hillGeo.attributes.position;
        for (let i = 0; i < hp.count; i++) hp.setY(i, hillH(hp.getX(i), hp.getZ(i)));
        hillGeo.computeVertexNormals();
        onGrid.add(mesh(hillGeo, std({ color: 0x3f6b3a, roughness: 1 }), { castShadow: false }));
        const onFarm = new THREE.Group();
        const onSpots = [[4, -7], [9, -3.5], [14, -7], [5, 4], [10, 7], [15, 3.5]];
        const SUB = V(-8, hillH(-8, 2), 2);
        const onCollector = new THREE.Group();
        onSpots.forEach(sp => {
            const y = hillH(sp[0], sp[1]);
            const tb = miniTurbine(3.0, 1.7);
            tb.position.set(sp[0], y, sp[1]);
            onFarm.add(tb);
            miniRotors.push(tb.userData.rotor);
            onFarm.add(mesh(new THREE.BoxGeometry(0.4, 0.3, 0.3), std({ color: 0x5f6f66 }), { position: V(sp[0] + 0.7, y + 0.15, sp[1] + 0.4) }));
            const pts = [];
            for (let k = 0; k <= 16; k++) {
                const tt = k / 16;
                const x = lerp(sp[0] + 0.7, SUB.x + 0.8, tt);
                const z = lerp(sp[1] + 0.4, SUB.z, tt) + Math.sin(tt * Math.PI) * 1.2;
                pts.push(V(x, hillH(x, z) + 0.06, z));
            }
            const curve = new THREE.CatmullRomCurve3(pts);
            onCollector.add(mesh(new THREE.TubeGeometry(curve, 40, 0.06, 5, false), std({ color: 0x5a4632, roughness: 1 }), { castShadow: false }));
            gridFlow(onGrid, curve, 0xffe082, 14, 0.32, 'collector');
        });
        onGrid.add(onFarm);
        onGrid.add(onCollector);
        const onSub = new THREE.Group();
        onSub.position.copy(SUB);
        onSub.add(mesh(new THREE.BoxGeometry(3.4, 0.05, 2.8), std({ color: 0x9a9e9f, roughness: 1 }), { position: V(0, 0.03, 0) }));
        [-0.8, 0.6].forEach(x => onSub.add(mesh(new THREE.BoxGeometry(0.8, 0.7, 0.6), std({ color: 0x7c8a7a, roughness: 0.6, metalness: 0.3 }), { position: V(x, 0.38, -0.4) })));
        onSub.add(mesh(new THREE.BoxGeometry(2.6, 0.06, 0.06), steelMat, { position: V(0, 1.2, 0.6) }));
        [-1.2, 1.2].forEach(x => onSub.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 6), steelMat, { position: V(x, 0.6, 0.6) })));
        onGrid.add(onSub);
        const onLine = new THREE.Group();
        const pylonsOn = [V(-12, 0, -1), V(-17, 0, -4), V(-22, 0, -7)].map(p => V(p.x, hillH(p.x, p.z), p.z));
        pylonsOn.forEach(p => onLine.add(pylon(p, 3.6)));
        const lineCurveOn = new THREE.CatmullRomCurve3([V(SUB.x - 1, SUB.y + 1.2, SUB.z)].concat(pylonsOn.map(p => V(p.x, p.y + 3.4, p.z))).concat([V(-27, hillH(-27, -9) + 3.4, -9.5)]));
        onLine.add(mesh(new THREE.TubeGeometry(lineCurveOn, 40, 0.03, 5, false), darkMat, { castShadow: false }));
        onGrid.add(onLine);
        gridFlow(onGrid, lineCurveOn, 0xffc107, 22, 0.3, 'line');
        const onGridParts = {};
        [['farm', onFarm, (v) => v.set(15, hillH(15, -7) + 4.6, -7)], ['collector', onCollector, (v) => v.set(-1, hillH(-1, -1) + 0.4, -1)], ['onsub', onSub, (v) => v.set(SUB.x, SUB.y + 1.8, SUB.z)], ['grid', onLine, (v) => v.set(-17, pylonsOn[1].y + 4.2, -4)]].forEach(e => {
            e[1].userData.partId = e[0];
            onGridParts[e[0]] = { id: e[0], object: e[1], anchor: e[2], center: (t) => tmpBox.setFromObject(e[1]).getCenter(t) };
        });

        // ===============================================================
        //  Current turbine and its environment
        // ===============================================================
        let T = null;            // current turbine build
        let O = null;            // offshore foundation build
        const turbineRoot = new THREE.Group();
        scene.add(turbineRoot);
        let frame = { cx: 0, cy: 4, cz: 0, size: 10, hubY: 6.5, bottom: 0, top: 10 };

        // Wind particles
        const WIND_N = 180;
        const windGeo = new THREE.BufferGeometry();
        const windPos = new Float32Array(WIND_N * 3);
        const windSpd = new Float32Array(WIND_N);
        windGeo.setAttribute('position', new THREE.BufferAttribute(windPos, 3));
        const windPts = new THREE.Points(windGeo, new THREE.PointsMaterial({ color: 0xbfe8c6, size: 0.06, transparent: true, opacity: 0.5, depthWrite: false }));
        windPts.frustumCulled = false;
        scene.add(windPts);
        function seedWind() {
            const s = frame.size;
            for (let i = 0; i < WIND_N; i++) {
                windPos[i * 3] = (Math.random() - 0.5) * s * 2.4;
                windPos[i * 3 + 1] = Math.max(0.1, frame.bottom > -0.01 ? 0 : 0.2) + Math.random() * (frame.top + 0.2);
                windPos[i * 3 + 2] = (Math.random() - 0.5) * s * 2.4;
                windSpd[i] = 0.6 + Math.random() * 0.8;
            }
            windPts.material.size = Math.max(0.012, s * 0.006);
            windGeo.attributes.position.needsUpdate = true;
        }

        // Flow along the cable down the tower / array cable
        const FLOW_N = 40;
        const flowGeo = new THREE.BufferGeometry();
        flowGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(FLOW_N * 3), 3));
        const flowPts = new THREE.Points(flowGeo, new THREE.PointsMaterial({ color: 0xffd54f, size: 0.08, transparent: true, opacity: 0.95, depthWrite: false }));
        flowPts.frustumCulled = false;
        scene.add(flowPts);
        let flowCurve = null;
        let flowPhase = 0;

        function buildTurbine() {
            // Clear previous build
            if (T) { turbineRoot.remove(T.group); disposeTree(T.group); }
            if (O) { turbineRoot.remove(O.group); disposeTree(O.group); }
            reg = {};
            T = null;
            O = null;
            const m = MODELS[ui.model];
            const offshore = ui.site === 'offshore';
            let baseY = 0;
            if (offshore) baseY = ui.foundation === 'floating' ? 0.85 : 20 / U;
            if (m.kind === 'hawt') T = buildHawt(m, baseY);
            else if (m.kind === 'vawt') T = buildVawt(m);
            else T = buildSmall(m);
            turbineRoot.add(T.group);
            if (m.kind === 'hawt' && !offshore) {
                // gravity foundation + transformer kiosk on land (in the scaled turbine frame)
                const S = T.scale;
                const fnd = mesh(new THREE.CylinderGeometry(0.55 * S, 0.7 * S, 0.18 * S, 40), darkMat, { position: V(0, 0.09 * S, 0) });
                T.group.add(fnd);
                addPart('foundation', fnd, (v) => v.set(0.75 * S, 0.12 * S, 0.2 * S));
                const kiosk = new THREE.Group();
                kiosk.position.set(1.75 * S, 0, -1.05 * S);
                kiosk.scale.setScalar(S);
                kiosk.add(mesh(new THREE.BoxGeometry(0.62, 0.5, 0.46), std({ color: 0x5f6f66, metalness: 0.5, roughness: 0.5 }), { position: V(0, 0.25, 0) }));
                for (let i = 0; i < 5; i++) kiosk.add(mesh(new THREE.BoxGeometry(0.02, 0.4, 0.42), steelMat, { position: V(-0.33 - i * 0.045, 0.25, 0) }));
                T.group.add(kiosk);
                addPart('transformer', kiosk, (v) => kiosk.localToWorld(v.set(0, 0.62, 0)));
            }
            if (offshore) {
                const towerBaseR = 0.36 * T.scale;
                O = buildOffshore(ui.foundation, towerBaseR, baseY);
                turbineRoot.add(O.group);
                Object.keys(O.parts).forEach(id => addPart(id, O.parts[id].obj, O.parts[id].anchor));
                seabed.position.y = -O.depth;
                waterCol.scale.y = O.depth;
                waterCol.position.y = -O.depth / 2;
            }
            onshoreEnv.visible = !offshore;
            offshoreEnv.visible = offshore;
            // Framing
            const top = T.worldTop;
            const bottom = offshore ? -O.depth : 0;
            const halfW = (m.kind === 'hawt' ? m.R / U : m.kind === 'vawt' ? m.R / U * 2.6 : m.R / U * 2);
            frame = { cx: 0, cy: (top + bottom) / 2, cz: 0, size: Math.max(top - bottom, halfW * 2), hubY: T.hubY, bottom: bottom, top: top };
            aimLight(0, frame.cy, 0, frame.size * 0.9 + 2);
            ring.scale.setScalar(Math.max(0.15, frame.size / 10));
            ground.scale.setScalar(Math.max(0.2, frame.size / 10));
            seedWind();
            // Cable flow path: down the tower, then (offshore) along the array cable
            const pts = [];
            if (m.kind === 'hawt') {
                const nac = T.nacelleNode;
                turbineRoot.updateMatrixWorld(true);
                pts.push(nac.localToWorld(V(0, -0.3, 0)));
                pts.push(V(0, (T.hubY + (offshore ? O.depth * 0 : 0)) * 0.5, 0));
                pts.push(T.cableBottomWorld());
                if (offshore) O.arrCurve.getSpacedPoints(12).forEach(p => pts.push(p));
            }
            flowCurve = pts.length > 2 ? new THREE.CatmullRomCurve3(pts) : null;
            flowPts.material.size = Math.max(0.02, frame.size * 0.008);
            pickables = Object.keys(reg).map(id => reg[id].object);
            labels.forEach(L => { L.cand = -1; });
        }

        // ===============================================================
        //  View state and camera
        // ===============================================================
        const state = { xray: 0, xrayGoal: 0, explode: 0, explodeGoal: 0, gridGoal: 0, grid: 0, shift: 0, active: false, rotorAngle: 0, rotorOmegaVis: 0, pitch: 0, furl: 0 };
        const cam = { theta: 0.5, phi: 1.4, radius: 20, target: V(0, 4, 0) };
        const goal = { theta: cam.theta, phi: cam.phi, radius: cam.radius, target: cam.target.clone() };
        let focusPart = null;
        const RADIUS_MIN = 0.2;
        const RADIUS_MAX = 260;
        function wrapAngle(a) {
            while (a > Math.PI) a -= Math.PI * 2;
            while (a < -Math.PI) a += Math.PI * 2;
            return a;
        }
        const FOV_FIT = 1 / (2 * Math.tan(16 * Math.PI / 180));
        function viewFor(mode) {
            const m = MODELS[ui.model];
            if (mode === 'grid') return ui.site === 'offshore' ? { theta: 0.42, phi: 0.98, radius: 78, target: V(-8, 0, 0) } : { theta: 0.45, phi: 1.02, radius: 66, target: V(1, 1, 0) };
            const fit = frame.size * FOV_FIT * 1.18;
            if (mode === 'inside' || mode === 'exploded') {
                if (m.kind === 'hawt') {
                    const nacY = T ? T.hubY : frame.hubY;
                    return { theta: YAW_MEAN + (mode === 'inside' ? 1.25 : 1.05), phi: mode === 'inside' ? 1.36 : 1.28, radius: T.scale * (mode === 'inside' ? 6.2 : 9.2), target: V(0, nacY + (mode === 'exploded' ? 0.25 * T.scale : 0), 0) };
                }
                if (m.kind === 'vawt') return { theta: 0.7, phi: 1.25, radius: mode === 'inside' ? 4.5 : 7, target: V(0, 0.35, 0) };
                return { theta: 1.2, phi: 1.3, radius: mode === 'inside' ? 0.9 : 1.3, target: V(0, T.hubY, 0) };
            }
            return { theta: ui.site === 'offshore' ? 0.62 : 0.526, phi: ui.site === 'offshore' ? 1.38 : 1.5, radius: fit, target: V(0, frame.cy, 0) };
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
        const labelsRoot = el('wt-labels');
        const measureCtx = document.createElement('canvas').getContext('2d');
        function measureTag(text) {
            measureCtx.font = '600 11.52px Inter, "Segoe UI", sans-serif';
            return Math.ceil(measureCtx.measureText(text).width) + 24;
        }
        const labels = PART_ORDER.map(id => {
            const p = PARTS[id];
            const node = document.createElement('button');
            node.type = 'button';
            node.className = 'wt-label wt-label-' + p.group + ' is-off';
            node.dataset.part = id;
            const line = document.createElement('span');
            line.className = 'wt-line';
            const tag = document.createElement('span');
            tag.className = 'wt-tag';
            const pin = document.createElement('span');
            pin.className = 'wt-pin';
            node.appendChild(line);
            node.appendChild(tag);
            node.appendChild(pin);
            node.addEventListener('click', (e) => { e.stopPropagation(); stopTour(); select(id, { focus: true }); });
            node.addEventListener('mouseenter', () => setHover(id));
            node.addEventListener('mouseleave', () => setHover(null));
            if (labelsRoot) labelsRoot.appendChild(node);
            return { id: id, part: p, el: node, tag: tag, pin: pin, line: line, tw: 0, cand: -1, off: true, tagOn: true, ax: 0, ay: 0, dist: 0 };
        });
        function refreshLabelText() {
            const c = cfg();
            labels.forEach(L => {
                const name = L.part.name(c);
                L.tag.textContent = name;
                L.tw = measureTag(name);
                L.pin.textContent = String(numbers[L.id] || '');
                L.el.setAttribute('aria-label', (numbers[L.id] || '') + '. ' + name + ': show details');
            });
        }
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(refreshLabelText);
        function setHover(id) {
            if (ui.hover === id) return;
            ui.hover = id;
            labels.forEach(L => L.el.classList.toggle('is-hover', L.id === id));
        }
        function setOff(L, o) {
            if (L.off === o) return;
            L.off = o;
            L.el.classList.toggle('is-off', o);
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
        function regFor(id) { return PARTS[id].family === 'grid' ? (ui.site === 'offshore' ? offGridParts[id] : onGridParts[id]) : reg[id]; }
        function labelVisible(id) {
            const p = PARTS[id];
            if (!numbers[id] || !regFor(id)) return false;
            if (p.family === 'grid') return state.grid > 0.5;
            if (state.grid > 0.3) return false;
            if (p.group === 'interior') return state.xray > 0.3 || state.explode > 0.5;
            return true;
        }
        function layoutLabels(w, h, infoTop) {
            if (!ui.labels) return;
            const narrow = w < 440;
            const compactExterior = state.xray > 0.5 || state.explode > 0.5;
            const vis = [];
            labels.forEach(L => {
                if (!labelVisible(L.id)) { setOff(L, true); return; }
                regFor(L.id).anchor(tmpV);
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
            const rank = (L) => (L.id === ui.selected ? 0 : L.id === ui.hover ? 1 : 2) * 100 + (compactExterior && L.part.group === 'exterior' ? 50 : 0) + (numbers[L.id] || 0);
            vis.sort((a, b) => rank(a) - rank(b));
            const placed = [];
            vis.forEach(L => {
                L.el.style.transform = 'translate(' + L.ax.toFixed(1) + 'px,' + L.ay.toFixed(1) + 'px)';
                L.el.style.zIndex = String(Math.max(1, Math.round(1000 - L.dist * 4)));
                const pinned = L.id === ui.selected || L.id === ui.hover;
                const wantTag = pinned || (!narrow && !(compactExterior && L.part.group === 'exterior'));
                if (!wantTag) { setTag(L, false); return; }
                const tw = L.tw || measureTag(L.tag.textContent);
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
        function highlight(id) {
            clearHighlight();
            const r = regFor(id);
            if (!r) return;
            const color = PARTS[id].group === 'interior' ? 0xffb300 : 0x4caf50;
            r.object.traverse(o => {
                if (!o.isMesh || Array.isArray(o.material)) return;
                let owner = o;
                while (owner && !owner.userData.partId) owner = owner.parent;
                if (!owner || owner.userData.partId !== id) return;
                const mm = o.material.clone();
                if (!mm.emissive) { mm.dispose(); return; }
                mm.emissive = new THREE.Color(color);
                mm.emissiveIntensity = 0.22;
                highlightCache.push({ mesh: o, mat: o.material });
                o.material = mm;
            });
        }

        // ===============================================================
        //  Interaction
        // ===============================================================
        const pointer = { x: 0, y: 0, tx: 0, ty: 0, cx: 0, cy: 0, pending: false };
        const raycaster = new THREE.Raycaster();
        const ndc = new THREE.Vector2();
        let pickables = [];
        const SHELLS = { nacelle: true, tower: true, foundation: true };
        let drag = null;
        function pickAt(clientX, clientY) {
            const rect = canvas.getBoundingClientRect();
            ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
            raycaster.setFromCamera(ndc, camera);
            const gridMode = state.grid > 0.5;
            const list = gridMode ? Object.keys(ui.site === 'offshore' ? offGridParts : onGridParts).map(id => regFor(id).object) : pickables;
            const hits = raycaster.intersectObjects(list, true);
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
                const id = o.userData.partId;
                if (!numbers[id]) continue;
                if (PARTS[id].group === 'interior' && state.xray < 0.3 && state.explode < 0.5) continue;
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
                goal.phi = cam.phi = clamp(drag.phi - dy * 0.004, 0.25, 1.6);
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
            else if (k === 'ArrowDown') goal.phi = Math.min(1.6, goal.phi + 0.1);
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
        let hudClock = 0;
        let gust = 0;
        let gustGoal = 0;
        let nextGust = 3;
        const focusTmp = V(0, 0, 0);

        function render(dt) {
            const t = clock.elapsedTime;
            const k = 1 - Math.exp(-dt * 4.5);
            const w = size.w;
            const h = size.h;
            const infoOverlay = !!(ui.selected && info.root && !info.root.hidden && !mqStaticInfo.matches);
            const infoH = infoOverlay ? info.root.offsetHeight : 0;
            const infoTop = infoOverlay ? h - infoH - 12 : h;
            const m = MODELS[ui.model];

            if (pointer.pending && !drag) {
                pointer.pending = false;
                const id = pickAt(pointer.cx, pointer.cy);
                setHover(id);
                canvas.style.cursor = id ? 'pointer' : 'grab';
            }

            // Wind with gentle gusts
            if (t > nextGust) {
                gustGoal = (Math.random() - 0.5) * 0.18 * Math.max(ui.windBase, 2);
                nextGust = t + 3 + Math.random() * 5;
            }
            gust += (gustGoal - gust) * Math.min(1, dt * 0.5);
            const wind = Math.max(0, ui.windBase + gust * motionScale);
            const op = operatingPoint(m, wind);
            hudClock += dt;
            if (hudClock > 0.15) {
                hudClock = 0;
                const shown = renderHud();
                setText(hud.wind, fmt(wind, 1) + ' m/s');
                void shown;
            }

            // Rotor: visual speed follows the physical angular speed (scaled for big, slow rotors)
            const visScale = m.kind === 'small' ? 0.25 : m.kind === 'vawt' ? 0.8 : 1.5;
            state.rotorOmegaVis += (op.omega * visScale * motionScale - state.rotorOmegaVis) * Math.min(1, dt * 0.8);
            state.rotorAngle -= state.rotorOmegaVis * dt;
            if (T) {
                T.spin(state.rotorAngle);
                state.pitch += (THREE.MathUtils.degToRad(op.pitchDeg) - state.pitch) * Math.min(1, dt * 1.2);
                T.setPitch(state.pitch);
                state.furl += (THREE.MathUtils.degToRad(op.furlDeg) - state.furl) * Math.min(1, dt * 1.0);
                if (T.setFurl) T.setFurl(state.furl + Math.sin(t * 0.3) * 0.04 * motionScale);
                else T.setYaw(YAW_MEAN + Math.sin(t * 0.18) * 0.06 * motionScale);
                T.animate(op, t, dt);
                genMat.emissiveIntensity = op.powerW / (m.ratedKw * 1000) * (0.8 + Math.sin(t * 6) * 0.2 * motionScale);
            }

            // Floating platform motion
            if (O && ui.foundation === 'floating') {
                const roll = Math.sin(t * 0.7) * 0.015 * motionScale * (0.5 + wind / 20);
                const heave = Math.sin(t * 0.9) * 0.05 * motionScale;
                turbineRoot.rotation.set(roll, 0, Math.cos(t * 0.55) * 0.012 * motionScale);
                turbineRoot.position.y = heave;
            } else {
                turbineRoot.rotation.set(0, 0, 0);
                turbineRoot.position.y = 0;
            }

            // Sea waves
            if (offshoreEnv.visible && state.grid < 0.98) {
                const pa = seaGeo.attributes.position.array;
                const amp = (0.03 + wind * 0.006) * Math.max(0.3, frame.size / 20);
                for (let i = 0; i < pa.length; i += 3) {
                    const x = seaBase[i];
                    const z = seaBase[i + 2];
                    pa[i + 1] = (Math.sin(x * 0.6 + t * 1.3 * motionScale) + Math.cos(z * 0.5 + t * 1.1 * motionScale) * 0.7) * amp;
                }
                seaGeo.attributes.position.needsUpdate = true;
                seaGeo.computeVertexNormals();
            }

            // Wind particles
            const wa = windGeo.attributes.position.array;
            const ws = (0.15 + wind * 0.05) * frame.size * 0.12 * motionScale;
            for (let i = 0; i < WIND_N; i++) {
                wa[i * 3] -= Math.sin(YAW_MEAN) * windSpd[i] * ws * dt;
                wa[i * 3 + 2] -= Math.cos(YAW_MEAN) * windSpd[i] * ws * dt;
                if (wa[i * 3 + 2] < -frame.size * 1.2) { wa[i * 3 + 2] += frame.size * 2.4; wa[i * 3] += Math.sin(YAW_MEAN) * frame.size * 2.4; }
            }
            windGeo.attributes.position.needsUpdate = true;
            windPts.visible = state.grid < 0.5;
            windPts.material.opacity = 0.15 + Math.min(0.45, wind * 0.03);

            // Power flowing down the cable and out along the array cable
            const load = op.powerW / (m.ratedKw * 1000);
            flowPts.visible = !!flowCurve && load > 0.01 && (state.xray > 0.3 || ui.site === 'offshore') && state.grid < 0.5;
            if (flowPts.visible) {
                flowPhase = (flowPhase + load * dt * 0.25 * motionScale) % 1;
                const fa = flowGeo.attributes.position.array;
                for (let i = 0; i < FLOW_N; i++) {
                    flowCurve.getPointAt((i / FLOW_N + flowPhase) % 1, focusTmp);
                    fa[i * 3] = focusTmp.x;
                    fa[i * 3 + 1] = focusTmp.y + turbineRoot.position.y;
                    fa[i * 3 + 2] = focusTmp.z;
                }
                flowGeo.attributes.position.needsUpdate = true;
            }
            cableMat.emissiveIntensity = 0.25 + load * 0.9;
            accentMat.emissiveIntensity = 0.5 + Math.sin(t * 2.2) * 0.4 * motionScale;

            // Grid diorama animation
            if (state.grid > 0.02) {
                miniRotors.forEach(r => { r.rotation.z -= op.omega * 1.5 * dt * motionScale; });
                const hvdcOn = ui.link === 'hvdc';
                gridFlows.forEach(f => {
                    let on = load > 0.01;
                    if (f.key === 'exportAc') on = on && !hvdcOn;
                    if (f.key === 'exportDc' || f.key === 'bridge') on = on && hvdcOn;
                    f.pts.visible = on;
                    if (!on) return;
                    f.phase = (f.phase + (1.5 + load * 5) / f.len * dt * motionScale) % 1;
                    const fa = f.pts.geometry.attributes.position.array;
                    for (let i = 0; i < f.count; i++) {
                        f.curve.getPointAt((i / f.count + f.phase) % 1, f.tmp);
                        fa[i * 3] = f.tmp.x;
                        fa[i * 3 + 1] = f.tmp.y + 0.12;
                        fa[i * 3 + 2] = f.tmp.z;
                    }
                    f.pts.geometry.attributes.position.needsUpdate = true;
                });
            }

            // --- View modes ------------------------------------------------
            state.xray += (state.xrayGoal - state.xray) * k;
            state.explode += (state.explodeGoal - state.explode) * k;
            state.grid += (state.gridGoal - state.grid) * k;
            const x = state.xray;
            xrayMats.forEach(mt => { mt.transparent = x > 0.01; mt.depthWrite = x < 0.5; });
            housingMat.opacity = lerp(1, 0.1, x);
            towerMat.opacity = lerp(1, 0.22, x);
            bladeMat.opacity = lerp(1, 0.4, x);
            if (T) {
                T.interior.visible = x > 0.02 || state.explode > 0.02;
                if (T.cableGroup) T.cableGroup.visible = x > 0.02 || ui.site === 'offshore' || m.kind !== 'hawt';
                T.exploders.forEach(e => { e.obj.position.copy(e.base).addScaledVector(e.delta, state.explode); });
            }
            const showGrid = state.grid > 0.5;
            gridRoot.visible = state.grid > 0.02;
            offGrid.visible = ui.site === 'offshore';
            onGrid.visible = ui.site !== 'offshore';
            hvdc.visible = ui.link === 'hvdc';
            exportAcMesh.visible = ui.link !== 'hvdc';
            exportDcMesh.visible = ossToHvdc.visible = ui.link === 'hvdc';
            acYard.visible = ui.link !== 'hvdc';
            dcHall.visible = ui.link === 'hvdc';
            setDistTag();
            turbineRoot.visible = !showGrid;
            onshoreEnv.visible = !showGrid && ui.site !== 'offshore';
            offshoreEnv.visible = !showGrid && ui.site === 'offshore';
            if (showGrid !== lastGridLight) { lastGridLight = showGrid; if (showGrid) aimLight(-6, 0, 0, 40); else aimLight(0, frame.cy, 0, frame.size * 0.9 + 2); }

            const glow = 0.22 + Math.sin(t * 4) * 0.08 * motionScale;
            highlightCache.forEach(e => {
                const mm = e.mesh.material;
                mm.opacity = e.mat.opacity;
                mm.transparent = e.mat.transparent;
                mm.depthWrite = e.mat.depthWrite;
                mm.emissiveIntensity = glow;
            });

            // --- Camera ------------------------------------------------------
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
            const phi = clamp(cam.phi - pointer.y * 0.03, 0.2, 1.62);
            const r = cam.radius * radiusScale;
            camera.position.set(r * Math.sin(phi) * Math.sin(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.cos(theta)).add(cam.target);
            camera.near = Math.max(0.01, r * 0.01);
            camera.far = Math.max(200, r * 12);
            camera.lookAt(cam.target);
            const shiftGoal = infoOverlay ? clamp((infoH + 12) / h * 0.5, 0, 0.24) : 0;
            state.shift += (shiftGoal - state.shift) * k;
            if (state.shift > 0.002) camera.setViewOffset(w, h, 0, state.shift * h, w, h);
            else { if (camera.view && camera.view.enabled) camera.clearViewOffset(); camera.updateProjectionMatrix(); }

            renderer.render(scene, camera);
            layoutLabels(w, h, infoTop);
        }
        let lastGridLight = null;
        let distLink = null;
        function setDistTag() {
            if (distLink === ui.link) return;
            distLink = ui.link;
            const sp = textSprite(ui.link === 'hvdc' ? '≈ 150 km, not to scale' : '≈ 30 km, not to scale', ui.link === 'hvdc' ? '#8fe3ff' : '#ffe082', 0.5);
            distTag.material.map.dispose();
            distTag.material.map = sp.material.map;
            distTag.scale.copy(sp.scale);
            distTag.material.needsUpdate = true;
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

        // ===============================================================
        //  Hooks for the UI layer
        // ===============================================================
        viewer = {
            hasPart(id) { return !!regFor(id); },
            renumber() { refreshLabelText(); },
            configure(rebuild) {
                clearHighlight();
                focusPart = null;
                if (rebuild) buildTurbine();
                refreshLabelText();
            },
            reframe() { setView(viewFor(ui.mode)); },
            setMode(mode, moveCamera) {
                state.xrayGoal = mode === 'inside' ? 1 : 0;
                state.explodeGoal = mode === 'exploded' ? 1 : 0;
                state.gridGoal = mode === 'grid' ? 1 : 0;
                if (moveCamera) setView(viewFor(mode));
            },
            select(id, focusCamera) {
                if (!id) { clearHighlight(); focusPart = null; return; }
                highlight(id);
                const r = regFor(id);
                if (focusCamera && r) {
                    const p = PARTS[id];
                    focusPart = r;
                    const size0 = p.family === 'grid' ? p.abs : p.rel * Math.max(frame.size, 0.5) * 0.9;
                    goal.radius = Math.max(RADIUS_MIN * 2, size0);
                    goal.theta = cam.theta + wrapAngle((p.family === 'turbine' && MODELS[ui.model].kind === 'hawt' ? p.view[0] : p.view[0]) - cam.theta);
                    goal.phi = p.view[1];
                }
            },
            zoomBy: zoomBy
        };

        buildTurbine();
        resize();
        renumber();
        buildLegend();
        refreshLabelText();
        const startView = viewFor(ui.mode);
        cam.theta = goal.theta = startView.theta;
        cam.phi = goal.phi = startView.phi;
        cam.radius = goal.radius = startView.radius;
        cam.target.copy(startView.target);
        goal.target.copy(startView.target);
        viewer.setMode(ui.mode, false);
        state.xray = state.xrayGoal;
        state.explode = state.explodeGoal;
        state.grid = state.gridGoal;
        if (ui.selected) select(ui.selected, { focus: true });
        clock.start();
        render(0.016);
        stage.classList.add('is-ready');
        updateRunState();
    }
})();
