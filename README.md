# renewable-energy-nexus

Renewable Energy Nexus ist eine statische Webanwendung mit Netlify Functions.
Die GreenPlan-Komponente erstellt drei Energie-Planoptionen (Budget, Rendite, Nachhaltigkeit) auf Basis von Nutzereingaben.

## GreenPlan Ergebnis-API

- Endpoint: `/.netlify/functions/greenplan-recommendation`
- Methoden: `POST` (empfohlen), `GET` (nutzt Defaults)
- Content-Type: `application/json`

### Beispiel Request

```json
{
	"location": { "postalCode": "50667", "city": "Koeln", "state": "NRW" },
	"projectType": "residential_single_family",
	"annualConsumptionKWh": 5200,
	"availableRoofAreaM2": 64,
	"shading": "medium",
	"budgetEUR": 24000,
	"primaryGoal": "co2_reduction",
	"batteryPreference": "yes",
	"heatPump": "planned",
	"evCharging": "planned",
	"amortizationImportance": 6,
	"co2Importance": 9,
	"feedInPreference": "mixed"
}
```

### Wichtige Response-Felder

- `meta.requestId`: eindeutige Berechnungs-ID
- `assumptions.configSource`: `file` oder `defaults`
- `plans[]`: berechnete Optionen mit `financials`, `impact`, `scoreBreakdown`
- `selectedRecommendation`: empfohlene Option + Begründungen
- `nextSteps`: konkrete Folgeaktionen

## Konfigurierbare Berechnungsparameter

Die Berechnungsparameter liegen in:

- `data/greenplan-config.json`

Dort können ohne Codeänderung gepflegt werden:

- Preisannahmen (`assumptions`) wie Strompreis und Einspeisetarif
- Kostenmodell (`costs`) für PV, Speicher und Basisinstallation
- Faktoren (`factors`) wie Verschattung und Last-Add-ons
- Sizing-Parameter (`sizing`) für Auslegung, Budgetgrenzen und Bandbreiten
- Basisgewichte (`weights`) für die Scoring-Dimensionen

Wenn die Datei fehlt oder ungültig ist, verwendet die Function sichere Default-Werte.

## GreenPlan Frontend-Hinweise

- Formular mit Plausibilitätsprüfung: `RenewableEnergyNexus/js/script.js`
- UI-Texte: `RenewableEnergyNexus/js/chatUiTextBlocks.de.js`
- Ergebnisdarstellung und PDF-Export: `RenewableEnergyNexus/js/script.js`