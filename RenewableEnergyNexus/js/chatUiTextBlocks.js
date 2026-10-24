/* Text blocks for the GreenPlan Copilot UI and its generated report.
   English is the source language; German, French and Spanish are full
   translations. Every string the user can see in the interface or in the
   exported report lives here, so a report never mixes languages. */

window.chatUiTextBlocks = {
  en: {
    locale: "en-US",
    languageName: "English",
    colon: ": ",
    ui: {
      sectionTitle: "GreenPlan Copilot",
      subtitle: "Get three tailored energy plan options for your project in just a few minutes.",
      calculateButton: "Calculate recommendation",
      downloadButton: "Download report as PDF"
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
      location: "e.g. 50667 Cologne",
      consumption: "4500",
      area: "55",
      budget: "18000"
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
    units: {
      years: "years",
      kg: "kg",
      currency: "EUR"
    },
    progress: {
      collecting: "Collecting your project data...",
      calculating: "Calculating your options with Germany-specific assumptions...",
      done: "Done. Your recommendations are ready."
    },
    validation: {
      conflictBudgetAutarky: "You want high self-sufficiency, but the budget looks tight. Should I continue with a phased plan?",
      conflictRoofTooSmall: "The roof area is very small compared with your electricity demand, so the options will probably be limited.",
      conflictCompetingPriorities: "Giving top priority to both a fast payback and maximum CO2 savings can pull the plan in two directions.",
      confirmProceed: "Do you want to run the calculation anyway?",
      paused: "Calculation paused. Adjust your inputs and run again."
    },
    recommendation: {
      title: "Your result: 3 feasible energy options",
      selected: "Recommended option: {{planLabel}}",
      cards: {
        budget_plan: "Entry-level budget",
        roi_plan: "Best return",
        green_plan: "Maximum sustainability"
      },
      reasons: {
        base: "Selected based on your priorities for economics, CO2, feasibility and resilience.",
        goalPrefix: "Primary goal",
        byPlan: {
          budget_plan: "Lowest capital requirement with a clear entry path.",
          roi_plan: "Best balance between upfront cost and savings potential.",
          green_plan: "Highest impact on CO2 reduction and self-sufficiency."
        }
      },
      nextStepByPlan: {
        budget_plan: "Check the roof and request two comparison quotes.",
        roi_plan: "Validate the load profile with the installer and fine-tune the components.",
        green_plan: "Verify the grid connection capacity and the storage location."
      },
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
    report: {
      generatedOn: "Generated on {{date}}",
      disclaimerTitle: "Note"
    },
    errors: {
      generic: "An unexpected error occurred. Please try again.",
      functionUnavailable: "The local function is unavailable (HTTP 404/501). Start Netlify Dev: netlify dev --port 8888.",
      serverError: "The server returned an error. Please check the function logs."
    }
  },

  de: {
    locale: "de-DE",
    languageName: "Deutsch",
    colon: ": ",
    ui: {
      sectionTitle: "GreenPlan Copilot",
      subtitle: "In wenigen Minuten zu drei passenden Energie-Optionen für dein Projekt.",
      calculateButton: "Empfehlung berechnen",
      downloadButton: "Bericht als PDF herunterladen"
    },
    labels: {
      language: "Sprache",
      location: "Standort (PLZ oder Ort)",
      projectType: "Projekttyp",
      annualConsumption: "Jährlicher Stromverbrauch (kWh)",
      availableArea: "Nutzbare Dachfläche (m2)",
      shading: "Verschattung",
      budget: "Budget (EUR)",
      primaryGoal: "Primäres Ziel",
      batteryPreference: "Batteriespeicher",
      heatPump: "Wärmepumpe",
      evCharging: "E-Mobilität",
      amortizationImportance: "Amortisation wichtig (1-10)",
      co2Importance: "CO2-Einsparung wichtig (1-10)"
    },
    placeholders: {
      location: "z. B. 50667 Köln",
      consumption: "4500",
      area: "55",
      budget: "18000"
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
        { value: "autarky", label: "Autarkie erhöhen" },
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
    units: {
      years: "Jahre",
      kg: "kg",
      currency: "EUR"
    },
    progress: {
      collecting: "Ich sammle gerade deine Projektdaten...",
      calculating: "Ich berechne gerade deine Optionen mit Deutschland-Annahmen...",
      done: "Fertig! Deine Empfehlungen sind bereit."
    },
    validation: {
      conflictBudgetAutarky: "Du willst maximale Autarkie, das Budget ist aber knapp. Soll ich eine stufenweise Umsetzung planen?",
      conflictRoofTooSmall: "Die Dachfläche ist sehr klein im Verhältnis zum Strombedarf. Die Optionen werden wahrscheinlich begrenzt sein.",
      conflictCompetingPriorities: "Sehr hohe Priorität für schnelle Amortisation und maximale CO2-Einsparung gleichzeitig kann Zielkonflikte erzeugen.",
      confirmProceed: "Möchtest du die Berechnung trotzdem starten?",
      paused: "Berechnung pausiert. Passe die Eingaben an und starte erneut."
    },
    recommendation: {
      title: "Dein Ergebnis: 3 machbare Energie-Optionen",
      selected: "Empfohlene Option: {{planLabel}}",
      cards: {
        budget_plan: "Minimal-Budget",
        roi_plan: "Beste Rendite",
        green_plan: "Maximal nachhaltig"
      },
      reasons: {
        base: "Auswahl nach Prioritäten für Wirtschaftlichkeit, CO2, Umsetzbarkeit und Resilienz.",
        goalPrefix: "Primäres Ziel",
        byPlan: {
          budget_plan: "Niedrigster Kapitaleinsatz mit sauberem Einstiegspfad.",
          roi_plan: "Beste Balance zwischen Investitionshöhe und Einsparpotenzial.",
          green_plan: "Höchste Wirkung bei CO2-Reduktion und Autarkiegrad."
        }
      },
      nextStepByPlan: {
        budget_plan: "Dachprüfung durchführen und zwei Vergleichsangebote einholen.",
        roi_plan: "Lastprofil mit dem Installateur validieren und Komponenten fein auslegen.",
        green_plan: "Netzanschlussleistung und Speicherstandort verbindlich prüfen."
      },
      metrics: {
        capex: "Investition",
        payback: "Amortisation",
        co2: "CO2-Einsparung pro Jahr",
        autarky: "Autarkiegrad",
        savings: "Jährliche Ersparnis"
      },
      nextStepLabel: "Nächster Schritt"
    },
    nextSteps: {
      title: "Nächste Schritte"
    },
    report: {
      generatedOn: "Erstellt am {{date}}",
      disclaimerTitle: "Hinweis"
    },
    errors: {
      generic: "Es ist ein unerwarteter Fehler aufgetreten. Bitte versuche es erneut.",
      functionUnavailable: "Die lokale Function ist nicht erreichbar (HTTP 404/501). Bitte mit Netlify Dev starten: netlify dev --port 8888.",
      serverError: "Der Server hat einen Fehler gemeldet. Bitte prüfe die Function-Logs."
    }
  },

  fr: {
    locale: "fr-FR",
    languageName: "Français",
    colon: " : ",
    ui: {
      sectionTitle: "GreenPlan Copilot",
      subtitle: "Obtenez en quelques minutes trois options énergétiques adaptées à votre projet.",
      calculateButton: "Calculer la recommandation",
      downloadButton: "Télécharger le rapport en PDF"
    },
    labels: {
      language: "Langue",
      location: "Localisation (code postal ou ville)",
      projectType: "Type de projet",
      annualConsumption: "Consommation annuelle d'électricité (kWh)",
      availableArea: "Surface de toiture utilisable (m2)",
      shading: "Ombrage",
      budget: "Budget (EUR)",
      primaryGoal: "Objectif principal",
      batteryPreference: "Batterie de stockage",
      heatPump: "Pompe à chaleur",
      evCharging: "Mobilité électrique",
      amortizationImportance: "Importance du retour sur investissement (1-10)",
      co2Importance: "Importance de la réduction de CO2 (1-10)"
    },
    placeholders: {
      location: "p. ex. 50667 Cologne",
      consumption: "4500",
      area: "55",
      budget: "18000"
    },
    selectOptions: {
      projectType: [
        { value: "residential_single_family", label: "Maison individuelle" },
        { value: "multi_family", label: "Immeuble collectif" },
        { value: "commercial", label: "Commercial" },
        { value: "municipal", label: "Collectivité" },
        { value: "industrial", label: "Industriel" }
      ],
      shading: [
        { value: "none", label: "Aucun" },
        { value: "low", label: "Faible" },
        { value: "medium", label: "Moyen" },
        { value: "high", label: "Fort" }
      ],
      primaryGoal: [
        { value: "cost_reduction", label: "Réduire les coûts" },
        { value: "co2_reduction", label: "Réduire le CO2" },
        { value: "autarky", label: "Augmenter l'autoconsommation" },
        { value: "security", label: "Renforcer la sécurité d'approvisionnement" }
      ],
      batteryPreference: [
        { value: "yes", label: "Oui" },
        { value: "no", label: "Non" },
        { value: "unsure", label: "Je ne sais pas" }
      ],
      heatPump: [
        { value: "existing", label: "Existante" },
        { value: "planned", label: "Prévue" },
        { value: "no", label: "Non" }
      ],
      evCharging: [
        { value: "yes", label: "Oui" },
        { value: "planned", label: "Prévue" },
        { value: "no", label: "Non" }
      ]
    },
    units: {
      years: "ans",
      kg: "kg",
      currency: "EUR"
    },
    progress: {
      collecting: "Je rassemble les données de votre projet...",
      calculating: "Je calcule vos options avec les hypothèses propres à l'Allemagne...",
      done: "Terminé. Vos recommandations sont prêtes."
    },
    validation: {
      conflictBudgetAutarky: "Vous visez une autoconsommation maximale, mais le budget semble juste. Dois-je prévoir une mise en œuvre par étapes ?",
      conflictRoofTooSmall: "La surface de toiture est très petite par rapport à vos besoins en électricité. Les options seront probablement limitées.",
      conflictCompetingPriorities: "Donner la priorité maximale à la fois à un retour rapide et à une réduction maximale du CO2 peut créer des objectifs contradictoires.",
      confirmProceed: "Voulez-vous lancer le calcul malgré tout ?",
      paused: "Calcul interrompu. Ajustez vos données et relancez."
    },
    recommendation: {
      title: "Votre résultat : 3 options énergétiques réalisables",
      selected: "Option recommandée : {{planLabel}}",
      cards: {
        budget_plan: "Budget d'entrée",
        roi_plan: "Meilleur rendement",
        green_plan: "Durabilité maximale"
      },
      reasons: {
        base: "Sélection fondée sur vos priorités de rentabilité, de CO2, de faisabilité et de résilience.",
        goalPrefix: "Objectif principal",
        byPlan: {
          budget_plan: "Investissement initial le plus faible, avec un parcours d'entrée clair.",
          roi_plan: "Meilleur équilibre entre coût initial et potentiel d'économies.",
          green_plan: "Impact le plus fort sur la réduction du CO2 et l'autoconsommation."
        }
      },
      nextStepByPlan: {
        budget_plan: "Faire vérifier la toiture et demander deux devis comparatifs.",
        roi_plan: "Valider le profil de charge avec l'installateur et affiner le dimensionnement.",
        green_plan: "Vérifier la puissance de raccordement au réseau et l'emplacement du stockage."
      },
      metrics: {
        capex: "Investissement",
        payback: "Retour sur investissement",
        co2: "Économies de CO2 par an",
        autarky: "Taux d'autoconsommation",
        savings: "Économies annuelles"
      },
      nextStepLabel: "Prochaine étape"
    },
    nextSteps: {
      title: "Prochaines étapes"
    },
    report: {
      generatedOn: "Établi le {{date}}",
      disclaimerTitle: "Remarque"
    },
    errors: {
      generic: "Une erreur inattendue s'est produite. Veuillez réessayer.",
      functionUnavailable: "La fonction locale est inaccessible (HTTP 404/501). Démarrez Netlify Dev : netlify dev --port 8888.",
      serverError: "Le serveur a renvoyé une erreur. Veuillez consulter les journaux de la fonction."
    }
  },

  es: {
    locale: "es-ES",
    languageName: "Español",
    colon: ": ",
    ui: {
      sectionTitle: "GreenPlan Copilot",
      subtitle: "Obtén en pocos minutos tres opciones energéticas adaptadas a tu proyecto.",
      calculateButton: "Calcular recomendación",
      downloadButton: "Descargar informe en PDF"
    },
    labels: {
      language: "Idioma",
      location: "Ubicación (código postal o ciudad)",
      projectType: "Tipo de proyecto",
      annualConsumption: "Consumo anual de electricidad (kWh)",
      availableArea: "Superficie de tejado utilizable (m2)",
      shading: "Sombreado",
      budget: "Presupuesto (EUR)",
      primaryGoal: "Objetivo principal",
      batteryPreference: "Batería de almacenamiento",
      heatPump: "Bomba de calor",
      evCharging: "Movilidad eléctrica",
      amortizationImportance: "Importancia de la amortización (1-10)",
      co2Importance: "Importancia de la reducción de CO2 (1-10)"
    },
    placeholders: {
      location: "p. ej. 50667 Colonia",
      consumption: "4500",
      area: "55",
      budget: "18000"
    },
    selectOptions: {
      projectType: [
        { value: "residential_single_family", label: "Vivienda unifamiliar" },
        { value: "multi_family", label: "Edificio plurifamiliar" },
        { value: "commercial", label: "Comercial" },
        { value: "municipal", label: "Municipal" },
        { value: "industrial", label: "Industrial" }
      ],
      shading: [
        { value: "none", label: "Ninguno" },
        { value: "low", label: "Bajo" },
        { value: "medium", label: "Medio" },
        { value: "high", label: "Alto" }
      ],
      primaryGoal: [
        { value: "cost_reduction", label: "Reducir costes" },
        { value: "co2_reduction", label: "Reducir CO2" },
        { value: "autarky", label: "Aumentar el autoconsumo" },
        { value: "security", label: "Mejorar la seguridad de suministro" }
      ],
      batteryPreference: [
        { value: "yes", label: "Sí" },
        { value: "no", label: "No" },
        { value: "unsure", label: "No estoy seguro" }
      ],
      heatPump: [
        { value: "existing", label: "Existente" },
        { value: "planned", label: "Prevista" },
        { value: "no", label: "No" }
      ],
      evCharging: [
        { value: "yes", label: "Sí" },
        { value: "planned", label: "Prevista" },
        { value: "no", label: "No" }
      ]
    },
    units: {
      years: "años",
      kg: "kg",
      currency: "EUR"
    },
    progress: {
      collecting: "Estoy recopilando los datos de tu proyecto...",
      calculating: "Estoy calculando tus opciones con supuestos específicos de Alemania...",
      done: "Listo. Tus recomendaciones están preparadas."
    },
    validation: {
      conflictBudgetAutarky: "Buscas el máximo autoconsumo, pero el presupuesto parece ajustado. ¿Planifico una implantación por fases?",
      conflictRoofTooSmall: "La superficie de tejado es muy pequeña en relación con tu demanda eléctrica, así que las opciones serán limitadas.",
      conflictCompetingPriorities: "Dar la máxima prioridad a la vez a una amortización rápida y al mayor ahorro de CO2 puede generar objetivos contrapuestos.",
      confirmProceed: "¿Quieres ejecutar el cálculo de todos modos?",
      paused: "Cálculo en pausa. Ajusta los datos y vuelve a ejecutarlo."
    },
    recommendation: {
      title: "Tu resultado: 3 opciones energéticas viables",
      selected: "Opción recomendada: {{planLabel}}",
      cards: {
        budget_plan: "Presupuesto de entrada",
        roi_plan: "Mejor rentabilidad",
        green_plan: "Máxima sostenibilidad"
      },
      reasons: {
        base: "Selección basada en tus prioridades de rentabilidad, CO2, viabilidad y resiliencia.",
        goalPrefix: "Objetivo principal",
        byPlan: {
          budget_plan: "Menor inversión inicial, con una vía de entrada clara.",
          roi_plan: "Mejor equilibrio entre coste inicial y potencial de ahorro.",
          green_plan: "Mayor impacto en la reducción de CO2 y en el autoconsumo."
        }
      },
      nextStepByPlan: {
        budget_plan: "Revisar el tejado y pedir dos presupuestos comparables.",
        roi_plan: "Validar el perfil de carga con el instalador y ajustar los componentes.",
        green_plan: "Comprobar la potencia de conexión a la red y la ubicación del almacenamiento."
      },
      metrics: {
        capex: "Inversión",
        payback: "Amortización",
        co2: "Ahorro anual de CO2",
        autarky: "Grado de autoconsumo",
        savings: "Ahorro anual"
      },
      nextStepLabel: "Siguiente paso"
    },
    nextSteps: {
      title: "Siguientes pasos"
    },
    report: {
      generatedOn: "Generado el {{date}}",
      disclaimerTitle: "Aviso"
    },
    errors: {
      generic: "Se ha producido un error inesperado. Vuelve a intentarlo.",
      functionUnavailable: "La función local no está disponible (HTTP 404/501). Inicia Netlify Dev: netlify dev --port 8888.",
      serverError: "El servidor ha devuelto un error. Revisa los registros de la función."
    }
  }
};

window.chatUiTextBlocksDe = window.chatUiTextBlocks.de;
