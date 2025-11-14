# 🔐 API Key Security Guide

## ⚠️ WICHTIG: Niemals API-Keys in Git committen!

GitHub hat Ihren Push blockiert, weil ein Brevo API-Key im Code erkannt wurde. Das ist eine wichtige Sicherheitsfunktion!

---

## 🔧 Sichere Konfiguration

### Schritt 1: Lokale Entwicklung

Ihr API-Key ist jetzt sicher in `.env` gespeichert:

```bash
# .env (wird NICHT zu Git hinzugefügt)
BREVO_API_KEY=xkeysib-c265...pDq8
```

### Schritt 2: Für die Produktion (Netlify)

Da Ihr Code im Browser läuft, **können Sie den API-Key NICHT komplett verstecken**. Hier sind Ihre Optionen:

#### ✅ Option 1: Backend-Proxy (Empfohlen für Produktion)

Erstellen Sie eine serverless Function in Netlify:

```javascript
// netlify/functions/subscribe.js
const fetch = require('node-fetch');

exports.handler = async (event) => {
    const { email, firstName, lastName, consent } = JSON.parse(event.body);
    
    // API-Key ist hier sicher als Umgebungsvariable
    const response = await fetch('https://api.brevo.com/v3/contacts', {
        method: 'POST',
        headers: {
            'api-key': process.env.BREVO_API_KEY,
            'content-type': 'application/json'
        },
        body: JSON.stringify({ email, attributes: { FIRSTNAME: firstName, LASTNAME: lastName } })
    });
    
    return {
        statusCode: 200,
        body: JSON.stringify({ success: true })
    };
};
```

Dann in Netlify Dashboard:
1. Site settings → Environment variables
2. Add: `BREVO_API_KEY` = `xkeysib-c265...pDq8`

#### ⚠️ Option 2: API-Key im Frontend (Aktuell - Akzeptables Risiko)

Brevo API-Keys haben begrenzte Rechte und können im Frontend verwendet werden, aber:

**Risiken:**
- Jeder kann den Key in DevTools sehen
- Missbrauch möglich (Spam-Subscriptions)

**Schutzmaßnahmen:**
- Verwenden Sie einen Key nur für Subscriptions (keine Admin-Rechte)
- Aktivieren Sie Double-Opt-In in Brevo
- Monitoren Sie die Nutzung im Brevo-Dashboard
- Limitieren Sie Subscriptions mit Captcha/Rate-Limiting

---

## 📝 Aktueller Status

### Was wurde geändert:

1. ✅ API-Key aus `emailSubscription.js` entfernt
2. ✅ API-Key aus `BREVO_CONFIGURATION_STATUS.md` entfernt
3. ✅ `.env` Datei erstellt (enthält Ihren echten Key)
4. ✅ `.gitignore` erstellt (verhindert .env commit)
5. ✅ `.env.example` als Vorlage erstellt

### So verwenden Sie den API-Key jetzt:

**Für lokale Tests:**
```javascript
// Lesen Sie die .env Datei oder ersetzen Sie manuell:
const apiKey = 'YOUR_BREVO_API_KEY'; // Replace with your actual key
```

**Für Production (Temporär - bis Backend-Proxy implementiert):**

Ersetzen Sie in `emailSubscription.js` Zeile 14:
```javascript
this.apiKey = 'YOUR_BREVO_API_KEY'; // Your actual Brevo API key
```

**ABER:** Committen Sie diese Datei NICHT zu GitHub!

---

## 🚀 Empfohlener Workflow

### Für JETZT (schnelle Lösung):

1. Ändern Sie `emailSubscription.js` lokal mit Ihrem echten Key
2. Deployen Sie nur zu Netlify (ohne Git-Commit)
3. Nutzen Sie Netlify CLI: `netlify deploy --prod`

### Für SPÄTER (beste Lösung):

1. Implementieren Sie Netlify Functions (Backend-Proxy)
2. Speichern Sie API-Key in Netlify Environment Variables
3. Frontend ruft nur Ihre Function auf, nicht Brevo direkt

---

## 📋 Nächste Schritte

### Sofort (um zu committen):

```bash
# Änderungen sind bereits vorbereitet
git add .
git commit -m "Secure API key configuration - remove secrets from code"
git push origin main
```

### Dann (um die Website zu deployen):

**Option A: Manuelles Deployment**
1. Öffnen Sie `emailSubscription.js`
2. Ersetzen Sie Zeile 14 mit Ihrem echten API-Key
3. Deployen Sie direkt über Netlify Dashboard (Drag & Drop)

**Option B: Netlify CLI**
```bash
# Ändern Sie emailSubscription.js lokal (NICHT committen!)
npm install -g netlify-cli
netlify login
netlify deploy --prod
```

---

## 🔑 Ihr API-Key

**Wichtig**: Ihr API-Key ist sicher in der `.env` Datei gespeichert (lokal, nicht in Git).

**So finden Sie Ihren Key:**
1. Brevo Dashboard → Settings → SMTP & API → API Keys
2. Oder schauen Sie in Ihre lokale `.env` Datei

**Speicherorte:**
- ✅ `.env` (lokal, nicht in Git)
- ✅ Passwort-Manager
- ✅ Netlify Environment Variables (für Production)
- ❌ NIEMALS in Git commits!

---

## ❓ FAQ

**Q: Warum wurde mein Push blockiert?**
A: GitHub Secret Scanning hat Ihren API-Key erkannt und den Push aus Sicherheitsgründen verhindert.

**Q: Ist mein Key jetzt kompromittiert?**
A: Nein, der Push wurde blockiert, bevor der Key öffentlich wurde.

**Q: Muss ich einen neuen Key generieren?**
A: Nein, Ihr Key ist sicher, da er nie auf GitHub veröffentlicht wurde.

**Q: Kann ich Frontend-Subscriptions ohne Backend machen?**
A: Ja, aber es ist weniger sicher. Für kleine Projekte akzeptabel, für größere Projekte Backend empfohlen.

---

**Erstellt**: November 14, 2025  
**Status**: API-Key gesichert, bereit für Commit
