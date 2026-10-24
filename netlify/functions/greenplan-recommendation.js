/**
 * Netlify Function: GreenPlan recommendation engine
 *
 * Builds three plan variants and scores them from user input
 * using transparent assumptions for Germany.
 */

const fs = require('fs/promises');
const path = require('path');

/* ------------------------------------------------------------------ *
 * Report language. Every string that reaches the user is looked up    *
 * here, so a generated report is entirely in the requested language.  *
 * English is the source language and the fallback.                    *
 * ------------------------------------------------------------------ */

const SUPPORTED_LANGUAGES = ['en', 'de', 'fr', 'es'];

const REPORT_TEXT = {
    en: {
        locale: 'en-US',
        planLabels: {
            budget: 'Entry-level budget',
            roi: 'Best return',
            green: 'Maximum sustainability'
        },
        risks: {
            budgetExceeded: 'The budget is likely to be exceeded.',
            budgetRealistic: 'The budget looks realistic.',
            shadingHigh: 'Heavy shading reduces the yield noticeably.',
            shadingModerate: 'Shading has only a moderate effect.',
            lowerAutarky: 'Lower self-sufficiency during the evening load profile.',
            loadProfileDependency: 'Depends on the load profile and on shifting demand.'
        },
        nextAction: {
            budget: 'Check the roof and request two comparison quotes.',
            roi: 'Validate the load profile with the installer and fine-tune the components.',
            green: 'Verify the grid connection capacity and the storage location.'
        },
        reasons: {
            base: 'Selected based on your priorities for economics, CO2, feasibility and resilience.',
            goalPrefix: 'Primary goal',
            budget_plan: 'Lowest capital requirement with a clear entry path.',
            roi_plan: 'Best balance between upfront cost and savings potential.',
            green_plan: 'Highest impact on CO2 reduction and self-sufficiency.'
        },
        goals: {
            cost_reduction: 'reduce costs',
            co2_reduction: 'reduce CO2',
            autarky: 'increase self-sufficiency',
            security: 'improve energy security'
        },
        nextSteps: [
            'Schedule a technical pre-check with an installer.',
            'Compare at least two quotes with identical specifications.',
            'Confirm the grid connection and any subsidies in writing.',
            'Approve the investment decision with a risk buffer.'
        ],
        disclaimer: 'Initial indication based on your input and standard assumptions. Not binding technical planning or financial advice.',
        dataSources: [
            'BNetzA published market values',
            'Destatis electricity price trends',
            'DWD typical solar irradiation values'
        ]
    },
    de: {
        locale: 'de-DE',
        planLabels: {
            budget: 'Minimal-Budget',
            roi: 'Beste Rendite',
            green: 'Maximal nachhaltig'
        },
        risks: {
            budgetExceeded: 'Der Budgetrahmen wird voraussichtlich \u00fcberschritten.',
            budgetRealistic: 'Der Budgetrahmen ist realistisch erreichbar.',
            shadingHigh: 'Starke Verschattung reduziert den Ertrag deutlich.',
            shadingModerate: 'Die Verschattung wirkt sich nur moderat aus.',
            lowerAutarky: 'Niedrigere Autarkie im Abendprofil.',
            loadProfileDependency: 'Abh\u00e4ngig von Lastprofil und Lastverschiebung.'
        },
        nextAction: {
            budget: 'Dachpr\u00fcfung durchf\u00fchren und zwei Vergleichsangebote einholen.',
            roi: 'Lastprofil mit dem Installateur validieren und Komponenten fein auslegen.',
            green: 'Netzanschlussleistung und Speicherstandort verbindlich pr\u00fcfen.'
        },
        reasons: {
            base: 'Auswahl nach Priorit\u00e4ten f\u00fcr Wirtschaftlichkeit, CO2, Umsetzbarkeit und Resilienz.',
            goalPrefix: 'Prim\u00e4res Ziel',
            budget_plan: 'Niedrigster Kapitaleinsatz mit sauberem Einstiegspfad.',
            roi_plan: 'Beste Balance zwischen Investitionsh\u00f6he und Einsparpotenzial.',
            green_plan: 'H\u00f6chste Wirkung bei CO2-Reduktion und Autarkiegrad.'
        },
        goals: {
            cost_reduction: 'Kosten senken',
            co2_reduction: 'CO2 reduzieren',
            autarky: 'Autarkie erh\u00f6hen',
            security: 'Versorgungssicherheit'
        },
        nextSteps: [
            'Technische Vorpr\u00fcfung mit einem Installateur terminieren.',
            'Mindestens zwei Angebote mit identischer Spezifikation vergleichen.',
            'Netzanschluss und F\u00f6rderung verbindlich best\u00e4tigen.',
            'Investitionsentscheidung mit Risikopuffer freigeben.'
        ],
        disclaimer: 'Erstindikation auf Basis deiner Angaben und Standardannahmen. Keine verbindliche Fachplanung oder Finanzberatung.',
        dataSources: [
            'BNetzA ver\u00f6ffentlichte Marktwerte',
            'Destatis Strompreis-Trends',
            'DWD-typische Einstrahlungswerte'
        ]
    },
    fr: {
        locale: 'fr-FR',
        planLabels: {
            budget: "Budget d'entr\u00e9e",
            roi: 'Meilleur rendement',
            green: 'Durabilit\u00e9 maximale'
        },
        risks: {
            budgetExceeded: 'Le budget sera probablement d\u00e9pass\u00e9.',
            budgetRealistic: 'Le budget semble r\u00e9aliste.',
            shadingHigh: 'Un ombrage important r\u00e9duit nettement le rendement.',
            shadingModerate: "L'ombrage n'a qu'un effet mod\u00e9r\u00e9.",
            lowerAutarky: 'Autoconsommation plus faible sur le profil de charge du soir.',
            loadProfileDependency: 'D\u00e9pend du profil de charge et du report de consommation.'
        },
        nextAction: {
            budget: 'Faire v\u00e9rifier la toiture et demander deux devis comparatifs.',
            roi: "Valider le profil de charge avec l'installateur et affiner le dimensionnement.",
            green: "V\u00e9rifier la puissance de raccordement au r\u00e9seau et l'emplacement du stockage."
        },
        reasons: {
            base: 'S\u00e9lection fond\u00e9e sur vos priorit\u00e9s de rentabilit\u00e9, de CO2, de faisabilit\u00e9 et de r\u00e9silience.',
            goalPrefix: 'Objectif principal',
            budget_plan: "Investissement initial le plus faible, avec un parcours d'entr\u00e9e clair.",
            roi_plan: "Meilleur \u00e9quilibre entre co\u00fbt initial et potentiel d'\u00e9conomies.",
            green_plan: "Impact le plus fort sur la r\u00e9duction du CO2 et l'autoconsommation."
        },
        goals: {
            cost_reduction: 'r\u00e9duire les co\u00fbts',
            co2_reduction: 'r\u00e9duire le CO2',
            autarky: "augmenter l'autoconsommation",
            security: "renforcer la s\u00e9curit\u00e9 d'approvisionnement"
        },
        nextSteps: [
            "Planifier une pr\u00e9-\u00e9tude technique avec un installateur.",
            'Comparer au moins deux devis \u00e0 sp\u00e9cifications identiques.',
            'Confirmer par \u00e9crit le raccordement au r\u00e9seau et les aides.',
            "Valider la d\u00e9cision d'investissement avec une marge de s\u00e9curit\u00e9."
        ],
        disclaimer: "Premi\u00e8re estimation fond\u00e9e sur vos donn\u00e9es et sur des hypoth\u00e8ses standard. Il ne s'agit ni d'une \u00e9tude technique contractuelle ni d'un conseil financier.",
        dataSources: [
            'Valeurs de march\u00e9 publi\u00e9es par la BNetzA',
            "Tendances des prix de l'\u00e9lectricit\u00e9 (Destatis)",
            "Valeurs d'ensoleillement typiques du DWD"
        ]
    },
    es: {
        locale: 'es-ES',
        planLabels: {
            budget: 'Presupuesto de entrada',
            roi: 'Mejor rentabilidad',
            green: 'M\u00e1xima sostenibilidad'
        },
        risks: {
            budgetExceeded: 'Es probable que se supere el presupuesto.',
            budgetRealistic: 'El presupuesto parece realista.',
            shadingHigh: 'Un sombreado fuerte reduce notablemente el rendimiento.',
            shadingModerate: 'El sombreado solo tiene un efecto moderado.',
            lowerAutarky: 'Menor autoconsumo en el perfil de carga de la tarde.',
            loadProfileDependency: 'Depende del perfil de carga y del desplazamiento del consumo.'
        },
        nextAction: {
            budget: 'Revisar el tejado y pedir dos presupuestos comparables.',
            roi: 'Validar el perfil de carga con el instalador y ajustar los componentes.',
            green: 'Comprobar la potencia de conexi\u00f3n a la red y la ubicaci\u00f3n del almacenamiento.'
        },
        reasons: {
            base: 'Selecci\u00f3n basada en tus prioridades de rentabilidad, CO2, viabilidad y resiliencia.',
            goalPrefix: 'Objetivo principal',
            budget_plan: 'Menor inversi\u00f3n inicial, con una v\u00eda de entrada clara.',
            roi_plan: 'Mejor equilibrio entre coste inicial y potencial de ahorro.',
            green_plan: 'Mayor impacto en la reducci\u00f3n de CO2 y en el autoconsumo.'
        },
        goals: {
            cost_reduction: 'reducir costes',
            co2_reduction: 'reducir CO2',
            autarky: 'aumentar el autoconsumo',
            security: 'mejorar la seguridad de suministro'
        },
        nextSteps: [
            'Concertar una revisi\u00f3n t\u00e9cnica previa con un instalador.',
            'Comparar al menos dos presupuestos con especificaciones id\u00e9nticas.',
            'Confirmar por escrito la conexi\u00f3n a la red y las ayudas.',
            'Aprobar la decisi\u00f3n de inversi\u00f3n con un margen de riesgo.'
        ],
        disclaimer: 'Indicaci\u00f3n inicial basada en tus datos y en supuestos est\u00e1ndar. No constituye un proyecto t\u00e9cnico vinculante ni asesoramiento financiero.',
        dataSources: [
            'Valores de mercado publicados por la BNetzA',
            'Tendencias de precios de la electricidad (Destatis)',
            'Valores de irradiaci\u00f3n t\u00edpicos del DWD'
        ]
    }
};

function normalizeLanguage(rawLanguage) {
    const lang = String(rawLanguage || '').slice(0, 2).toLowerCase();
    return SUPPORTED_LANGUAGES.includes(lang) ? lang : 'en';
}

function getReportText(language) {
    return REPORT_TEXT[language] || REPORT_TEXT.en;
}

function jsonResponse(statusCode, body) {
    return {
        statusCode,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    };
}

function buildRequestId() {
    const ts = Date.now();
    return `req_${ts}`;
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function round(value, digits = 0) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function getDefaultConfig() {
    return {
        assumptions: {
            electricityPriceEURPerKWh: 0.34,
            feedInTariffEURPerKWh: 0.08,
            pvSpecificYieldKWhPerKWp: 980,
            co2GridFactorKgPerKWh: 0.38,
            opexPctPerYear: 0.012
        },
        costs: {
            baseInstallCostEUR: 1200,
            pvCostPerKWpEUR: 1450,
            batteryCostPerKWhEUR: 760
        },
        factors: {
            shadingFactorMap: {
                none: 1.0,
                low: 0.95,
                medium: 0.85,
                high: 0.72
            },
            loadAddOnKWh: {
                heatPump: 2500,
                evCharging: 1800
            },
            baseSelfConsumption: 0.34,
            projectTypeSelfConsumptionBonus: 0.12,
            heatPumpSelfConsumptionBonus: 0.08,
            evSelfConsumptionBonus: 0.07,
            selfConsumptionMin: 0.25,
            selfConsumptionMax: 0.7
        },
        sizing: {
            roofAreaToKWp: 0.2,
            minPvKWp: 2.4,
            pvFactor: {
                budget: 0.62,
                roi: 0.84,
                green: 1.0
            },
            loadMultiplier: {
                default: 1.02,
                green: 1.22
            },
            batteryFactor: {
                budget: 0.32,
                roi: 0.75,
                green: 1.08
            },
            batteryCaps: {
                default: 12,
                green: 16
            },
            budgetCeilingFactor: 1.04,
            budgetScaleTargetFactor: 1.02,
            capexRange: {
                min: 0.93,
                max: 1.08
            },
            savingsRange: {
                min: 0.9,
                max: 1.12
            }
        },
        weights: {
            economics: 0.35,
            co2: 0.30,
            feasibility: 0.20,
            resilience: 0.15
        }
    };
}

function mergeConfig(base, override) {
    return {
        assumptions: { ...base.assumptions, ...(override.assumptions || {}) },
        costs: { ...base.costs, ...(override.costs || {}) },
        factors: {
            ...base.factors,
            ...(override.factors || {}),
            shadingFactorMap: {
                ...base.factors.shadingFactorMap,
                ...((override.factors && override.factors.shadingFactorMap) || {})
            },
            loadAddOnKWh: {
                ...base.factors.loadAddOnKWh,
                ...((override.factors && override.factors.loadAddOnKWh) || {})
            }
        },
        sizing: {
            ...base.sizing,
            ...(override.sizing || {}),
            pvFactor: {
                ...base.sizing.pvFactor,
                ...((override.sizing && override.sizing.pvFactor) || {})
            },
            loadMultiplier: {
                ...base.sizing.loadMultiplier,
                ...((override.sizing && override.sizing.loadMultiplier) || {})
            },
            batteryFactor: {
                ...base.sizing.batteryFactor,
                ...((override.sizing && override.sizing.batteryFactor) || {})
            },
            batteryCaps: {
                ...base.sizing.batteryCaps,
                ...((override.sizing && override.sizing.batteryCaps) || {})
            },
            capexRange: {
                ...base.sizing.capexRange,
                ...((override.sizing && override.sizing.capexRange) || {})
            },
            savingsRange: {
                ...base.sizing.savingsRange,
                ...((override.sizing && override.sizing.savingsRange) || {})
            }
        },
        weights: { ...base.weights, ...(override.weights || {}) }
    };
}

async function loadModelConfig() {
    const defaults = getDefaultConfig();
    const configPath = path.join(process.cwd(), 'data', 'greenplan-config.json');

    try {
        const raw = await fs.readFile(configPath, 'utf8');
        const parsed = JSON.parse(raw);
        return {
            config: mergeConfig(defaults, parsed),
            source: 'file'
        };
    } catch (error) {
        return {
            config: defaults,
            source: 'defaults'
        };
    }
}

function normalizeInput(rawInput = {}) {
    const annualConsumptionKWh = clamp(Number(rawInput.annualConsumptionKWh) || 4500, 1200, 200000);
    const availableRoofAreaM2 = clamp(Number(rawInput.availableRoofAreaM2) || 55, 12, 2500);
    const budgetEUR = clamp(Number(rawInput.budgetEUR) || 18000, 4000, 3000000);

    const shading = ['none', 'low', 'medium', 'high'].includes(rawInput.shading)
        ? rawInput.shading
        : 'low';

    const primaryGoal = ['cost_reduction', 'co2_reduction', 'autarky', 'security'].includes(rawInput.primaryGoal)
        ? rawInput.primaryGoal
        : 'cost_reduction';

    const batteryPreference = ['yes', 'no', 'unsure'].includes(rawInput.batteryPreference)
        ? rawInput.batteryPreference
        : 'unsure';

    const heatPump = ['existing', 'planned', 'no'].includes(rawInput.heatPump)
        ? rawInput.heatPump
        : 'no';

    const evCharging = ['yes', 'planned', 'no'].includes(rawInput.evCharging)
        ? rawInput.evCharging
        : 'no';

    const projectType = [
        'residential_single_family',
        'multi_family',
        'commercial',
        'municipal',
        'industrial'
    ].includes(rawInput.projectType)
        ? rawInput.projectType
        : 'residential_single_family';

    return {
        language: normalizeLanguage(rawInput.language),
        location: rawInput.location || {
            postalCode: '50667',
            city: 'Koeln',
            state: 'NRW'
        },
        projectType,
        annualConsumptionKWh,
        availableRoofAreaM2,
        availableGroundAreaM2: clamp(Number(rawInput.availableGroundAreaM2) || 0, 0, 10000),
        shading,
        budgetEUR,
        primaryGoal,
        batteryPreference,
        heatPump,
        evCharging,
        amortizationImportance: clamp(Number(rawInput.amortizationImportance) || 6, 1, 10),
        co2Importance: clamp(Number(rawInput.co2Importance) || 6, 1, 10),
        feedInPreference: ['self_consumption', 'mixed', 'feed_in'].includes(rawInput.feedInPreference)
            ? rawInput.feedInPreference
            : 'mixed'
    };
}

function profileFactors(input, config) {
    const shadingFactorMap = config.factors.shadingFactorMap;

    let loadAddOn = 0;
    if (input.heatPump === 'planned' || input.heatPump === 'existing') loadAddOn += config.factors.loadAddOnKWh.heatPump;
    if (input.evCharging === 'planned' || input.evCharging === 'yes') loadAddOn += config.factors.loadAddOnKWh.evCharging;

    let baseSelfConsumption = config.factors.baseSelfConsumption;
    if (input.projectType === 'commercial' || input.projectType === 'industrial') baseSelfConsumption += config.factors.projectTypeSelfConsumptionBonus;
    if (input.heatPump !== 'no') baseSelfConsumption += config.factors.heatPumpSelfConsumptionBonus;
    if (input.evCharging !== 'no') baseSelfConsumption += config.factors.evSelfConsumptionBonus;

    return {
        shadingFactor: shadingFactorMap[input.shading],
        adjustedLoadKWh: input.annualConsumptionKWh + loadAddOn,
        baseSelfConsumption: clamp(baseSelfConsumption, config.factors.selfConsumptionMin, config.factors.selfConsumptionMax)
    };
}

function getWeights(input, config) {
    const amortDelta = (input.amortizationImportance - 5.5) / 45;
    const co2Delta = (input.co2Importance - 5.5) / 45;

    let economics = config.weights.economics + amortDelta - co2Delta / 2;
    let co2 = config.weights.co2 + co2Delta - amortDelta / 2;
    let feasibility = config.weights.feasibility;
    let resilience = config.weights.resilience;

    if (input.primaryGoal === 'security') resilience += 0.06;
    if (input.primaryGoal === 'autarky') resilience += 0.04;
    if (input.primaryGoal === 'cost_reduction') economics += 0.04;
    if (input.primaryGoal === 'co2_reduction') co2 += 0.04;

    const sum = economics + co2 + feasibility + resilience;
    return {
        economics: economics / sum,
        co2: co2 / sum,
        feasibility: feasibility / sum,
        resilience: resilience / sum
    };
}

function buildPlan(mode, input, config, profile) {
    const text = getReportText(input.language);
    const roofLimitKWp = input.availableRoofAreaM2 * config.sizing.roofAreaToKWp;
    const loadBasedKWp = profile.adjustedLoadKWh / config.assumptions.pvSpecificYieldKWhPerKWp;

    let pvFactor = 0.75;
    if (mode === 'budget') pvFactor = config.sizing.pvFactor.budget;
    if (mode === 'roi') pvFactor = config.sizing.pvFactor.roi;
    if (mode === 'green') pvFactor = config.sizing.pvFactor.green;

    let pvKWp = Math.max(
        config.sizing.minPvKWp,
        Math.min(roofLimitKWp * pvFactor, loadBasedKWp * (mode === 'green' ? config.sizing.loadMultiplier.green : config.sizing.loadMultiplier.default))
    );

    let batteryKWh = 0;
    if (mode === 'green') batteryKWh = pvKWp * config.sizing.batteryFactor.green;
    if (mode === 'roi') batteryKWh = pvKWp * config.sizing.batteryFactor.roi;
    if (mode === 'budget') batteryKWh = input.batteryPreference === 'yes' ? pvKWp * config.sizing.batteryFactor.budget : 0;

    if (input.batteryPreference === 'no') {
        batteryKWh *= mode === 'green' ? 0.4 : 0;
    }

    if (input.heatPump !== 'no' || input.evCharging !== 'no') {
        batteryKWh += mode === 'budget' ? 0.8 : 1.8;
    }

    batteryKWh = clamp(batteryKWh, 0, mode === 'green' ? config.sizing.batteryCaps.green : config.sizing.batteryCaps.default);

    const projectTypeCostFactor = input.projectType === 'commercial' || input.projectType === 'industrial' ? 0.93 : 1.0;
    let capex = config.costs.baseInstallCostEUR
        + (pvKWp * config.costs.pvCostPerKWpEUR * projectTypeCostFactor)
        + (batteryKWh * config.costs.batteryCostPerKWhEUR);

    if (mode !== 'green' && capex > input.budgetEUR * config.sizing.budgetCeilingFactor) {
        const scale = (input.budgetEUR * config.sizing.budgetScaleTargetFactor) / capex;
        pvKWp *= scale;
        batteryKWh *= scale;
        capex = config.costs.baseInstallCostEUR
            + (pvKWp * config.costs.pvCostPerKWpEUR * projectTypeCostFactor)
            + (batteryKWh * config.costs.batteryCostPerKWhEUR);
    }

    let selfRate = profile.baseSelfConsumption;
    selfRate += Math.min(0.22, batteryKWh / Math.max(8, pvKWp * 1.9));
    if (mode === 'budget') selfRate -= 0.04;
    if (mode === 'green') selfRate += 0.04;
    selfRate = clamp(selfRate, 0.28, 0.86);

    const annualProductionKWh = pvKWp * config.assumptions.pvSpecificYieldKWhPerKWp * profile.shadingFactor;
    const selfUseKWh = Math.min(annualProductionKWh * selfRate, profile.adjustedLoadKWh);
    const feedInKWh = Math.max(0, annualProductionKWh - selfUseKWh);

    const grossBenefitEUR =
        (selfUseKWh * config.assumptions.electricityPriceEURPerKWh)
        + (feedInKWh * config.assumptions.feedInTariffEURPerKWh);
    const opexEUR = capex * config.assumptions.opexPctPerYear;
    const annualNetSavingsEUR = Math.max(120, grossBenefitEUR - opexEUR);

    const payback = capex / annualNetSavingsEUR;
    const annualCo2SavingsKg = selfUseKWh * config.assumptions.co2GridFactorKgPerKWh;
    const autarkyPct = clamp((selfUseKWh / profile.adjustedLoadKWh) * 100, 5, 99);

    const capexMin = capex * config.sizing.capexRange.min;
    const capexMax = capex * config.sizing.capexRange.max;
    const savingsMin = annualNetSavingsEUR * config.sizing.savingsRange.min;
    const savingsMax = annualNetSavingsEUR * config.sizing.savingsRange.max;
    const paybackMin = capexMin / savingsMax;
    const paybackMax = capexMax / savingsMin;

    const economics = clamp(100 - ((payback - 5) * 8), 35, 96);
    const co2Score = clamp((annualCo2SavingsKg / (profile.adjustedLoadKWh * config.assumptions.co2GridFactorKgPerKWh)) * 100, 25, 98);
    const feasibility = clamp(90 - Math.max(0, ((capex - input.budgetEUR) / input.budgetEUR) * 85) - (input.shading === 'high' ? 12 : 0), 35, 96);
    const resilience = clamp((autarkyPct * 0.72) + (batteryKWh * 2.2), 30, 98);

    return {
        id: mode === 'budget' ? 'budget_plan' : mode === 'roi' ? 'roi_plan' : 'green_plan',
        label: text.planLabels[mode],
        system: {
            pvKWp: round(pvKWp, 1),
            batteryKWh: round(batteryKWh, 1),
            inverterKW: Math.max(3, Math.round(pvKWp)),
            evReady: input.evCharging !== 'no',
            heatPumpReady: input.heatPump !== 'no'
        },
        financials: {
            capexEUR: {
                min: Math.round(capexMin),
                max: Math.round(capexMax)
            },
            annualSavingsEUR: {
                min: Math.round(savingsMin),
                max: Math.round(savingsMax)
            },
            paybackYears: {
                min: round(paybackMin, 1),
                max: round(paybackMax, 1)
            },
            lifetimeNetSavingsEUR: {
                min: Math.round((savingsMin * 25) - capexMax),
                max: Math.round((savingsMax * 25) - capexMin)
            }
        },
        impact: {
            annualProductionKWh: Math.round(annualProductionKWh),
            annualCo2SavingsKg: Math.round(annualCo2SavingsKg),
            selfConsumptionPct: Math.round((selfUseKWh / annualProductionKWh) * 100),
            autarkyPct: Math.round(autarkyPct)
        },
        scoreBreakdown: {
            economics: Math.round(economics),
            co2: Math.round(co2Score),
            feasibility: Math.round(feasibility),
            resilience: Math.round(resilience)
        },
        risks: [
            capex > input.budgetEUR ? text.risks.budgetExceeded : text.risks.budgetRealistic,
            input.shading === 'high' ? text.risks.shadingHigh : text.risks.shadingModerate,
            mode === 'budget' ? text.risks.lowerAutarky : text.risks.loadProfileDependency
        ],
        next7DayAction: text.nextAction[mode]
    };
}

function scoreAndRank(plans, weights) {
    const scored = plans.map((plan) => {
        const totalScore =
            (plan.scoreBreakdown.economics * weights.economics)
            + (plan.scoreBreakdown.co2 * weights.co2)
            + (plan.scoreBreakdown.feasibility * weights.feasibility)
            + (plan.scoreBreakdown.resilience * weights.resilience);
        return {
            ...plan,
            totalScore: round(totalScore, 1)
        };
    }).sort((a, b) => b.totalScore - a.totalScore);

    return scored.map((plan, index) => ({
        ...plan,
        rank: index + 1
    }));
}

function buildRecommendationReason(input, selectedPlan) {
    const text = getReportText(input.language);
    const goalLabel = text.goals[input.primaryGoal] || String(input.primaryGoal).replace(/_/g, ' ');

    const reasons = [
        text.reasons.base,
        `${text.reasons.goalPrefix}: ${goalLabel}`
    ];

    const planReason = text.reasons[selectedPlan.id];
    if (planReason) reasons.push(planReason);

    return reasons;
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return jsonResponse(200, {});
    }

    if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
        return jsonResponse(405, { error: 'Method not allowed' });
    }

    try {
        let rawInput = {};
        if (event.httpMethod === 'POST' && event.body) {
            rawInput = JSON.parse(event.body);
        }

        const { config, source } = await loadModelConfig();
        const userInput = normalizeInput(rawInput);
        const profile = profileFactors(userInput, config);
        const weights = getWeights(userInput, config);

        const plans = [
            buildPlan('budget', userInput, config, profile),
            buildPlan('roi', userInput, config, profile),
            buildPlan('green', userInput, config, profile)
        ];

        const rankedPlans = scoreAndRank(plans, weights);
        const selectedPlan = rankedPlans[0];

        const text = getReportText(userInput.language);

        const responseBody = {
            meta: {
                requestId: buildRequestId(),
                generatedAt: new Date().toISOString(),
                language: userInput.language,
                locale: text.locale,
                country: 'DE',
                currency: 'EUR',
                confidence: 'medium',
                version: '2.0'
            },
            userInput,
            assumptions: {
                configSource: source,
                electricityPriceEURPerKWh: config.assumptions.electricityPriceEURPerKWh,
                feedInTariffEURPerKWh: config.assumptions.feedInTariffEURPerKWh,
                pvSpecificYieldKWhPerKWp: config.assumptions.pvSpecificYieldKWhPerKWp,
                co2GridFactorKgPerKWh: config.assumptions.co2GridFactorKgPerKWh,
                opexPctPerYear: round(config.assumptions.opexPctPerYear * 100, 1),
                weighting: {
                    economics: round(weights.economics, 2),
                    co2: round(weights.co2, 2),
                    feasibility: round(weights.feasibility, 2),
                    resilience: round(weights.resilience, 2)
                }
            },
            plans: rankedPlans,
            selectedRecommendation: {
                planId: selectedPlan.id,
                why: buildRecommendationReason(userInput, selectedPlan)
            },
            comparison: {
                bestForBudget: 'budget_plan',
                bestForROI: 'roi_plan',
                bestForSustainability: 'green_plan'
            },
            nextSteps: text.nextSteps,
            legal: {
                disclaimer: text.disclaimer,
                dataSources: text.dataSources
            }
        };

        return jsonResponse(200, responseBody);
    } catch (error) {
        return jsonResponse(500, {
            error: 'Unable to generate recommendation',
            details: error.message
        });
    }
};
