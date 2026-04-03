# Beispiel-Rechnungen fuer Deutschland (realistische Annahmen)

Diese Beispiele liefern nachvollziehbare Erstwerte fuer den Chatbot-Output.

## Gemeinsame Annahmen (2026, vereinfachtes Modell)

- Strompreis Bezug: 0.34 EUR/kWh
- Einspeiseverguetung: 0.08 EUR/kWh
- PV-Ertrag: 980 kWh pro kWp und Jahr
- Netzstrom-CO2-Faktor: 0.38 kg CO2 pro kWh
- Opex: 1.2 % des CapEx pro Jahr
- Degradation: 0.35 % pro Jahr (in der Kurzrechnung ignoriert)
- USt auf typische PV-Komponenten: 0 % (bei gueltigen Bedingungen)

## Formelblock (Kurzmodell)

1. Jahreserzeugung:

   production_kWh = pv_kWp * 980

2. Eigenverbrauch und Einspeisung:

   self_use_kWh = production_kWh * self_consumption_rate
   feed_in_kWh = production_kWh - self_use_kWh

3. Jahresnutzen in EUR:

   gross_benefit = (self_use_kWh * 0.34) + (feed_in_kWh * 0.08)
   opex = capex * 0.012
   net_savings = gross_benefit - opex

4. Einfache Amortisation:

   payback_years = capex / net_savings

5. Jaehrliche CO2-Einsparung (vereinfacht):

   co2_savings_kg = self_use_kWh * 0.38

---

## Fall A: Einfamilienhaus, 4,500 kWh/Jahr

- System: 6.8 kWp PV + 5.1 kWh Speicher
- CapEx: 16,400 EUR
- Angenommene Eigenverbrauchsquote: 63 %

Berechnung:

- production_kWh = 6.8 * 980 = 6,664 kWh
- self_use_kWh = 6,664 * 0.63 = 4,198 kWh
- feed_in_kWh = 6,664 - 4,198 = 2,466 kWh
- gross_benefit = (4,198 * 0.34) + (2,466 * 0.08)
- gross_benefit = 1,427.32 + 197.28 = 1,624.60 EUR
- opex = 16,400 * 0.012 = 196.80 EUR
- net_savings = 1,624.60 - 196.80 = 1,427.80 EUR/Jahr
- payback_years = 16,400 / 1,427.80 = 11.49 Jahre
- co2_savings_kg = 4,198 * 0.38 = 1,595 kg/Jahr

Interpretation:

- Gute Balance aus Rendite und Nachhaltigkeit
- Amortisation wird besser, wenn Strompreis steigt oder Lastverschiebung gelingt

---

## Fall B: Kleine Gewerbeeinheit, 18,000 kWh/Jahr

- System: 19.5 kWp PV, ohne Speicher
- CapEx: 24,800 EUR
- Angenommene Eigenverbrauchsquote: 72 %

Berechnung:

- production_kWh = 19.5 * 980 = 19,110 kWh
- self_use_kWh = 19,110 * 0.72 = 13,759 kWh
- feed_in_kWh = 5,351 kWh
- gross_benefit = (13,759 * 0.34) + (5,351 * 0.08)
- gross_benefit = 4,678.06 + 428.08 = 5,106.14 EUR
- opex = 24,800 * 0.012 = 297.60 EUR
- net_savings = 4,808.54 EUR/Jahr
- payback_years = 24,800 / 4,808.54 = 5.16 Jahre
- co2_savings_kg = 13,759 * 0.38 = 5,228 kg/Jahr

Interpretation:

- Sehr starke Wirtschaftlichkeit bei hoher Tageslast
- Speicher oft optional, falls Lastprofil tagsueber hoch ist

---

## Fall C: Nachhaltigkeitsfokus (Privat), 8.4 kWp + 9.6 kWh Speicher

- Verbrauch: 5,500 kWh/Jahr
- CapEx: 23,900 EUR
- Eigenverbrauchsquote: 71 %

Berechnung:

- production_kWh = 8.4 * 980 = 8,232 kWh
- self_use_kWh = 8,232 * 0.71 = 5,845 kWh
- feed_in_kWh = 2,387 kWh
- gross_benefit = (5,845 * 0.34) + (2,387 * 0.08)
- gross_benefit = 1,987.30 + 190.96 = 2,178.26 EUR
- opex = 23,900 * 0.012 = 286.80 EUR
- net_savings = 1,891.46 EUR/Jahr
- payback_years = 23,900 / 1,891.46 = 12.64 Jahre
- co2_savings_kg = 5,845 * 0.38 = 2,221 kg/Jahr

Interpretation:

- Starkes CO2-Profil und hoher Autarkiegrad
- Rendite geringer als ROI-optimierte Variante

---

## Hinweise fuer die Integration im Projekt

- Nutze die Rechnungen als transparente Erklaerung im Ergebnisbereich der Chat-UI.
- Nutze Bandbreiten statt Einzelwerte (z. B. Strompreis 0.30 bis 0.40 EUR/kWh).
- Markiere alle Resultate als Erstindikation bis zur technischen Vor-Ort-Pruefung.
