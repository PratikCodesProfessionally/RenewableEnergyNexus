/**
 * Netlify Function: GreenPlan recommendation engine
 *
 * Builds three plan variants and scores them from user input
 * using transparent assumptions for Germany.
 */

const fs = require('fs/promises');
const path = require('path');

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
        label: mode === 'budget' ? 'Minimal-Budget' : mode === 'roi' ? 'Beste Rendite' : 'Maximal nachhaltig',
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
            capex > input.budgetEUR ? 'Budgetrahmen wird voraussichtlich ueberschritten' : 'Budgetrahmen realistisch erreichbar',
            input.shading === 'high' ? 'Starke Verschattung reduziert den Ertrag deutlich' : 'Verschattung nur mit moderater Auswirkung',
            mode === 'budget' ? 'Niedrigere Autarkie im Abendprofil' : 'Abhaengigkeit von Lastprofil und Lastverschiebung'
        ],
        next7DayAction: mode === 'green'
            ? 'Netzanschlussleistung und Speicherstandort verbindlich pruefen'
            : mode === 'roi'
                ? 'Lastprofil mit Installateur validieren und Komponenten fein auslegen'
                : 'Dachpruefung und zwei Vergleichsangebote einholen'
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
    const reasons = [
        'Auswahl nach Prioritaeten fuer Wirtschaftlichkeit, CO2, Umsetzbarkeit und Resilienz',
        `Primaeres Ziel: ${input.primaryGoal.replace('_', ' ')}`
    ];

    if (selectedPlan.id === 'roi_plan') {
        reasons.push('Beste Balance zwischen Investitionshoehe und Einsparpotenzial');
    }
    if (selectedPlan.id === 'green_plan') {
        reasons.push('Hoechste Wirkung bei CO2-Reduktion und Autarkiegrad');
    }
    if (selectedPlan.id === 'budget_plan') {
        reasons.push('Niedrigster Kapitaleinsatz mit sauberem Einstiegspfad');
    }

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

        const responseBody = {
            meta: {
                requestId: buildRequestId(),
                generatedAt: new Date().toISOString(),
                locale: 'de-DE',
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
            nextSteps: [
                'Technische Vorpruefung mit Installateur terminieren',
                'Mindestens zwei Angebote mit identischer Spezifikation vergleichen',
                'Netzanschluss und Foerderung verbindlich bestaetigen',
                'Investitionsentscheidung mit Risikopuffer freigeben'
            ],
            legal: {
                disclaimer: 'Erstindikation auf Basis von Nutzerangaben und Standardannahmen. Keine verbindliche Fachplanung oder Finanzberatung.',
                dataSources: [
                    'BNetzA veroeffentlichte Marktwerte',
                    'Destatis Strompreis-Trends',
                    'DWD-typische Einstrahlungswerte'
                ]
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
