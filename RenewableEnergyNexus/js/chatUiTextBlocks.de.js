/* Reusable text blocks for the GreenPlan chat UI (German + English). */

window.chatUiTextBlocks = {
  de: {
    locale: "de-DE",
    ui: {
      sectionTitle: "GreenPlan Copilot",
      subtitle: "In wenigen Minuten zu drei passenden Energie-Optionen fuer dein Projekt.",
      calculateButton: "Empfehlung berechnen",
      downloadButton: "Bericht als PDF herunterladen"
    },
    labels: {
      language: "Sprache",
      location: "Standort (PLZ oder Ort)",
      projectType: "Projekttyp",
      annualConsumption: "Jaehrlicher Stromverbrauch (kWh)",
      availableArea: "Nutzbare Dachflaeche (m2)",
      shading: "Verschattung",
      budget: "Budget (EUR)",
      primaryGoal: "Primaeres Ziel",
      batteryPreference: "Batteriespeicher",
      heatPump: "Waermepumpe",
      evCharging: "E-Mobilitaet",
      amortizationImportance: "Amortisation wichtig (1-10)",
      co2Importance: "CO2-Einsparung wichtig (1-10)"
    },
    placeholders: {
      location: "z. B. 50667 Koeln"
    },
    selectOptions: {
      projectType: [
        { value: "residential_single_family", label: "Einfamilienhaus" },
        { value: "multi_family", label: "Mehrfamilienhaus" },
        { value: "commercial", label: "Gewerbe" },
        { value: "municipal", label: "Kommune" },
        { value: "industrial", label: "Industrie" }
      ],
      shading: [
        { value: "none", label: "Keine" },
        { value: "low", label: "Leicht" },
        { value: "medium", label: "Mittel" },
        { value: "high", label: "Stark" }
      ],
      primaryGoal: [
        { value: "cost_reduction", label: "Kosten senken" },
        { value: "co2_reduction", label: "CO2 reduzieren" },
        { value: "autarky", label: "Autarkie erhoehen" },
        { value: "security", label: "Versorgungssicherheit" }
      ],
      batteryPreference: [
        { value: "yes", label: "Ja" },
        { value: "no", label: "Nein" },
        { value: "unsure", label: "Unsicher" }
      ],
      heatPump: [
        { value: "existing", label: "Vorhanden" },
        { value: "planned", label: "Geplant" },
        { value: "no", label: "Nein" }
      ],
      evCharging: [
        { value: "yes", label: "Ja" },
        { value: "planned", label: "Geplant" },
        { value: "no", label: "Nein" }
      ]
    },
    progress: {
      collecting: "Ich sammle gerade deine Projektdaten...",
      calculating: "Ich berechne gerade deine Optionen mit Deutschland-Annahmen...",
      done: "Fertig! Deine Empfehlungen sind bereit."
    },
    validation: {
      conflictBudgetAutarky: "Du willst maximale Autarkie, das Budget ist aber knapp. Soll ich eine stufenweise Umsetzung planen?",
      paused: "Berechnung pausiert. Passe die Eingaben an und starte erneut."
    },
    recommendation: {
      title: "Dein Ergebnis: 3 machbare Energie-Optionen",
      selected: "Empfohlene Option: {{planLabel}}",
      metrics: {
        capex: "Investition",
        payback: "Amortisation",
        co2: "CO2-Einsparung pro Jahr",
        autarky: "Autarkiegrad",
        savings: "Jaehrliche Ersparnis"
      },
      nextStepLabel: "Naechster Schritt"
    },
    nextSteps: {
      title: "Naechste Schritte"
    },
    errors: {
      generic: "Es ist ein unerwarteter Fehler aufgetreten. Bitte versuche es erneut.",
      functionUnavailable: "Die lokale Function ist nicht erreichbar (HTTP 404/501). Bitte mit Netlify Dev starten: netlify dev --port 8888.",
      serverError: "Der Server hat einen Fehler gemeldet. Bitte pruefe die Function-Logs."
    }
  },
  en: {
    locale: "en-US",
    ui: {
      sectionTitle: "GreenPlan Copilot",
      subtitle: "Get three tailored energy plan options for your project in just a few minutes.",
      calculateButton: "Calculate Recommendation",
      downloadButton: "Download Report as PDF"
    },
    labels: {
      language: "Language",
      location: "Location (ZIP or city)",
      projectType: "Project type",
      annualConsumption: "Annual electricity consumption (kWh)",
      availableArea: "Usable roof area (m2)",
      shading: "Shading",
      budget: "Budget (EUR)",
      primaryGoal: "Primary goal",
      batteryPreference: "Battery storage",
      heatPump: "Heat pump",
      evCharging: "E-mobility",
      amortizationImportance: "Payback importance (1-10)",
      co2Importance: "CO2 reduction importance (1-10)"
    },
    placeholders: {
      location: "e.g. 50667 Cologne"
    },
    selectOptions: {
      projectType: [
        { value: "residential_single_family", label: "Single-family home" },
        { value: "multi_family", label: "Multi-family building" },
        { value: "commercial", label: "Commercial" },
        { value: "municipal", label: "Municipal" },
        { value: "industrial", label: "Industrial" }
      ],
      shading: [
        { value: "none", label: "None" },
        { value: "low", label: "Low" },
        { value: "medium", label: "Medium" },
        { value: "high", label: "High" }
      ],
      primaryGoal: [
        { value: "cost_reduction", label: "Reduce costs" },
        { value: "co2_reduction", label: "Reduce CO2" },
        { value: "autarky", label: "Increase self-sufficiency" },
        { value: "security", label: "Improve energy security" }
      ],
      batteryPreference: [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
        { value: "unsure", label: "Not sure" }
      ],
      heatPump: [
        { value: "existing", label: "Existing" },
        { value: "planned", label: "Planned" },
        { value: "no", label: "No" }
      ],
      evCharging: [
        { value: "yes", label: "Yes" },
        { value: "planned", label: "Planned" },
        { value: "no", label: "No" }
      ]
    },
    progress: {
      collecting: "Collecting your project data...",
      calculating: "Calculating your options with Germany-specific assumptions...",
      done: "Done. Your recommendations are ready."
    },
    validation: {
      conflictBudgetAutarky: "You want high self-sufficiency, but the budget looks tight. Should I continue with a phased plan?",
      paused: "Calculation paused. Adjust your inputs and run again."
    },
    recommendation: {
      title: "Your result: 3 feasible energy options",
      selected: "Recommended option: {{planLabel}}",
      metrics: {
        capex: "Investment",
        payback: "Payback",
        co2: "Annual CO2 savings",
        autarky: "Self-sufficiency rate",
        savings: "Annual savings"
      },
      nextStepLabel: "Next step"
    },
    nextSteps: {
      title: "Next steps"
    },
    errors: {
      generic: "An unexpected error occurred. Please try again.",
      functionUnavailable: "Local function is unavailable (HTTP 404/501). Start Netlify Dev: netlify dev --port 8888.",
      serverError: "The server returned an error. Please check function logs."
    }
  }
};

window.chatUiTextBlocksDe = window.chatUiTextBlocks.de;
