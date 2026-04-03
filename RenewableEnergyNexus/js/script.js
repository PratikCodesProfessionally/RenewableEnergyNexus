// Map Configuration
let map = null;

function initMap() {
    const mapContainer = document.getElementById('projects-map');
    if (!mapContainer) return;

    if (map) {
        map.remove();
        map = null;
    }

    map = L.map('projects-map').setView([20, 0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    const projects = [
        { lat: 34.05, lng: -118.24, name: "Los Angeles Solar Farm", type: "solar", capacity: "500MW" },
        { lat: 56.13, lng: -3.94, name: "Scottish Wind Farm", type: "wind", capacity: "350MW" },
        { lat: -33.86, lng: 151.21, name: "Sydney Hydrogen Plant", type: "hydrogen", capacity: "100MW" }
    ];

    projects.forEach(project => {
        const iconColor = project.type === 'solar' ? 'orange' :
                        project.type === 'wind' ? 'blue' : 'green';

        const icon = L.divIcon({
            className: 'custom-icon',
            html: `<div style="background-color:${iconColor}" class="map-marker">
                     <i class="fas fa-${project.type === 'solar' ? 'solar-panel' : 
                                      project.type === 'wind' ? 'wind' : 'atom'}"></i>
                   </div>`
        });

        L.marker([project.lat, project.lng], { icon })
            .addTo(map)
            .bindPopup(`<b>${project.name}</b><br>Capacity: ${project.capacity}`);
    });
}

// Toggle Card Function - called from HTML onclick
function toggleCard(card) {
    // Close other cards
    document.querySelectorAll('.energy-card').forEach(c => {
        if (c !== card) c.classList.remove('active');
    });
    
    // Toggle this card
    card.classList.toggle('active');
    
    // Update calculator energy type
    const energyType = card.dataset.energyType;
    if (energyType) {
        const energyTypeSelect = document.getElementById('energy-type');
        if (energyTypeSelect) {
            energyTypeSelect.value = energyType;
        }
    }
    
    // Handle map initialization
    if (card.classList.contains('active')) {
        setTimeout(() => {
            if (card.querySelector('#projects-map')) {
                if (!map) {
                    initMap();
                } else {
                    map.invalidateSize();
                }
            }
        }, 300);
    }
    
    // Recalculate if needed
    const energyUseInput = document.getElementById('energy-use');
    if (energyUseInput && energyUseInput.value) {
        calculateSavingsDE();
    }
}

// Energy Card Interactions (backup for programmatic setup)
function setupEnergyCards() {
    // This function is kept for backward compatibility
    // Cards now use onclick="toggleCard(this)" in HTML
    console.log('Energy cards ready with toggleCard function');
}

// Consultation System
function setupConsultation() {
    const buttons = document.querySelectorAll('.consult-btn');
    const modal = document.createElement('div');
    modal.className = 'consult-modal';
    modal.innerHTML = `
        <div class="modal-content">
            <span class="close-modal">&times;</span>
            <h3>Request Consultation</h3>
            <form id="consult-form">
                <input type="hidden" id="consult-type">
                <div class="form-group">
                    <label for="name">Full Name</label>
                    <input type="text" id="name" required>
                </div>
                <div class="form-group">
                    <label for="email">Email</label>
                    <input type="email" id="email" required>
                </div>
                <div class="form-group">
                    <label for="project-details">Project Details</label>
                    <textarea id="project-details" rows="4" required></textarea>
                </div>
                <button type="submit">Submit Request</button>
            </form>
        </div>
    `;
    document.body.appendChild(modal);

    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            document.getElementById('consult-type').value = btn.dataset.type;
            modal.style.display = 'block';
        });
    });

    modal.querySelector('.close-modal').addEventListener('click', () => {
        modal.style.display = 'none';
    });

    document.getElementById('consult-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const submitBtn = e.target.querySelector('button[type="submit"]');
        const originalText = submitBtn.textContent;
        submitBtn.textContent = 'Sending...';
        submitBtn.disabled = true;
        
        const formData = {
            type: document.getElementById('consult-type').value,
            name: document.getElementById('name').value,
            email: document.getElementById('email').value,
            projectDetails: document.getElementById('project-details').value
        };
        
        try {
            // Send consultation request email
            if (typeof subscriptionManager !== 'undefined') {
                await subscriptionManager.sendConsultationRequest(formData);
                alert('✅ Consultation request submitted successfully! We will contact you soon at ' + formData.email);
            } else {
                alert('⚠️ Consultation request received! We will contact you soon.');
            }
            modal.style.display = 'none';
            e.target.reset();
        } catch (error) {
            console.error('Error submitting consultation:', error);
            alert('✅ Consultation request received! We will contact you soon via email.');
            modal.style.display = 'none';
            e.target.reset();
        } finally {
            submitBtn.textContent = originalText;
            submitBtn.disabled = false;
        }
    });
}

// Calculator Functionality
function calculateSavingsDE() {
    const energyInput = document.getElementById('energy-use');
    const typeInput = document.getElementById('energy-type');
    const resultsDiv = document.getElementById('results');

    const kWh = parseFloat(energyInput.value);
    const type = typeInput.value;

    if (isNaN(kWh) || kWh <= 0) {
        alert("Please enter a valid energy usage number");
        return;
    }

    const rates = {
        solar: { savings: 0.15, co2: 0.8 },
        wind: { savings: 0.12, co2: 0.7 },
        hybrid: { savings: 0.18, co2: 0.9 },
        default: { savings: 0.10, co2: 0.5 }
    };

    const { savings, co2 } = rates[type] || rates.default;
    const monthlySavings = kWh * savings;
    const annualCO2 = kWh * co2 * 12;

    resultsDiv.innerHTML = `
        <h4>Estimated Savings <span class="co2-badge">CO2 Reduction Calculator</span></h4>
        <div class="results-grid">
            <div class="result-item">
                <p class="result-label">Monthly Savings</p>
                <p class="result-value">${monthlySavings.toFixed(2)} Euros</p>
            </div>
            <div class="result-item">
                <p class="result-label">Annual Savings</p>
                <p class="result-value">${(monthlySavings * 12).toFixed(2)} Euros</p>
            </div>
            <div class="result-item">
                <p class="result-label">CO2 Reduction</p>
                <p class="result-value">${annualCO2.toFixed(0)} kg/year</p>
            </div>
        </div>
    `;
    resultsDiv.classList.add('visible');
}

// Newsletter System
function setupNewsletter() {
    const form = document.getElementById('newsletter-form');
    if (!form) return;

    // Update subscriber count on page load
    updateSubscriberCount();

    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const emailInput = document.getElementById('subscriber-email');
        const firstNameInput = document.getElementById('subscriber-firstname');
        const lastNameInput = document.getElementById('subscriber-lastname');
        const consentCheckbox = document.getElementById('email-consent');
        const messageEl = document.querySelector('.subscription-message');
        const submitBtn = form.querySelector('button[type="submit"]');

        // Clear previous messages
        messageEl.textContent = '';
        messageEl.className = 'subscription-message';

        // Validate email
        if (!subscriptionManager.validateEmail(emailInput.value)) {
            showMessage(messageEl, 'Please enter a valid email address', 'error');
            return;
        }

        // Check consent
        if (!consentCheckbox.checked) {
            showMessage(messageEl, 'Please agree to receive emails from us', 'error');
            return;
        }

        // Disable submit button during processing
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Subscribing...';

        try {
            const result = await subscriptionManager.subscribe(
                emailInput.value,
                consentCheckbox.checked,
                {
                    firstName: firstNameInput.value,
                    lastName: lastNameInput.value
                }
            );

            if (result.success) {
                showMessage(messageEl, result.message, 'success');
                form.reset();
                updateSubscriberCount();
                
                // Show success animation
                confetti();
            }
        } catch (error) {
            showMessage(messageEl, error.message, 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-envelope"></i> Subscribe Now';
        }
    });
}

// Show message with styling
function showMessage(element, message, type) {
    element.textContent = message;
    element.className = `subscription-message ${type}`;
    element.style.display = 'block';
    
    // Auto-hide success messages after 5 seconds
    if (type === 'success') {
        setTimeout(() => {
            element.style.display = 'none';
        }, 5000);
    }
}

// Update subscriber count display
// Fetches count from Netlify function (real-time from Brevo API)
async function updateSubscriberCount() {
    const countEl = document.getElementById('subscriber-count');
    if (!countEl) return;

    try {
        // Fetch from Netlify function (real-time from Brevo API)
        const response = await fetch('/.netlify/functions/get-subscriber-count');
        
        if (response.ok) {
            const data = await response.json();
            console.log('Full API response:', data);
            const count = data.count || 0;
            
            if (count > 0) {
                countEl.textContent = `Join ${count} other subscriber${count !== 1 ? 's' : ''}`;
            }
            console.log('Subscriber count:', count, '(source:', data.source, ')');
            if (data.message) {
                console.warn('API Message:', data.message);
            }
            if (data.error) {
                console.error('API Error Details:', JSON.stringify(data.error, null, 2));
            }
        } else {
            console.log('Unable to fetch subscriber count from API - Status:', response.status);
        }
    } catch (error) {
        // On error, keep the HTML default
        console.log('Using default subscriber count:', error.message);
    }
}

// Simple confetti effect for successful subscription
function confetti() {
    if (typeof confetti === 'undefined') {
        console.log('🎉 Subscription successful!');
    }
}

// Reaction tracking
function trackReaction(type) {
    console.log('User reaction:', type);
    if (type === 'like') {
        alert('Thanks for your feedback!');
    } else if (type === 'share') {
        alert('Thanks for sharing!');
    }
}

// User Feedback System
function setupReactions() {
    // Reactions are now handled via onclick="trackReaction(type)" in HTML
    console.log('Reaction tracking ready');
}

// Article Loading
function loadArticles() {
    setTimeout(() => {
        const articles = [
            {
                id: 1,
                title: "The Future of Solar Panel Efficiency",
                excerpt: "New perovskite technologies promise to revolutionize solar energy capture.",
                category: "solar"
            },
            {
                id: 2,
                title: "Offshore Wind Farms: Challenges and Opportunities",
                excerpt: "Exploring the potential of deep-water wind energy installations.",
                category: "wind"
            },
             {
                 id: 3,
                 title: "Germany’s Energy Ballet: Where Electrons Waltz and Batteries Pirouette",
                 excerpt: "The future grid?",
                 category: "battery"
             }
        ];

        const container = document.getElementById('articles-container');
        const loading = document.getElementById('articles-loading');

        if (articles.length > 0) {
            loading.style.display = 'none';
            articles.forEach(article => {
                const articleEl = document.createElement('article');
                articleEl.className = 'blog-post';
                articleEl.innerHTML = `
                    <h3>${article.title}</h3>
                    <p>${article.excerpt}</p>
                    <a href="/article/${article.id}" class="read-more">Read full article ?</a>
                `;
                container.appendChild(articleEl);
            });
        }
    }, 1500);
}

// Smooth Scroll
function setupSmoothScroll() {
    document.querySelectorAll('nav a').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            if (this.hash.startsWith('#')) {
                e.preventDefault();
                const target = document.querySelector(this.hash);
                if (target) {
                    window.scrollTo({
                        top: target.offsetTop - 20,
                        behavior: 'smooth'
                    });
                }
            }
        });
    });
}

// Show sources function
function showSources() {
    alert('Data sources:\n- German Federal Network Agency (Bundesnetzagentur)\n- Fraunhofer ISE Solar Reports\n- German Wind Energy Association (BWE)\n- International Renewable Energy Agency (IRENA)');
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

let lastGreenPlanResult = null;
let greenPlanLang = 'de';

function getGreenPlanTexts(lang = greenPlanLang) {
    if (window.chatUiTextBlocks && window.chatUiTextBlocks[lang]) {
        return window.chatUiTextBlocks[lang];
    }

    if (window.chatUiTextBlocksDe) {
        return window.chatUiTextBlocksDe;
    }

    return {
        progress: {
            collecting: 'Ich sammle gerade deine Projektdaten...',
            calculating: 'Ich berechne gerade deine Optionen mit Deutschland-Annahmen...',
            done: 'Fertig! Deine Empfehlungen sind bereit.'
        },
        recommendation: {
            title: 'Dein Ergebnis: 3 machbare Energie-Optionen',
            selected: 'Empfohlene Option: {{planLabel}}',
            metrics: {
                capex: 'Investition',
                payback: 'Amortisation',
                co2: 'CO2-Einsparung pro Jahr',
                autarky: 'Autarkiegrad',
                savings: 'Jaehrliche Ersparnis'
            }
        },
        nextSteps: {
            title: 'Naechste Schritte',
            cta: 'Bericht als PDF herunterladen'
        },
        errors: {
            generic: 'Es ist ein unerwarteter Fehler aufgetreten. Bitte versuche es erneut.',
            functionUnavailable: 'Die lokale Function ist nicht erreichbar (HTTP 404/501). Bitte mit Netlify Dev starten: netlify dev --port 8888.',
            serverError: 'Der Server hat einen Fehler gemeldet. Bitte pruefe die Function-Logs.'
        }
    };
}

function setSelectOptions(selectId, options) {
    const selectEl = document.getElementById(selectId);
    if (!selectEl || !Array.isArray(options)) return;

    const previousValue = selectEl.value;
    selectEl.innerHTML = options
        .map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`)
        .join('');

    const valueExists = options.some((option) => option.value === previousValue);
    if (valueExists) {
        selectEl.value = previousValue;
    }
}

function applyGreenPlanLocale(lang) {
    const texts = getGreenPlanTexts(lang);

    const sectionTitle = document.querySelector('#greenplan-chat .section-header h2');
    if (sectionTitle) {
        sectionTitle.innerHTML = '<i class="fas fa-robot"></i> ' + escapeHtml(texts.ui.sectionTitle);
    }

    const subtitle = document.getElementById('greenplan-subtitle');
    if (subtitle) subtitle.textContent = texts.ui.subtitle;

    const labelMap = {
        'gp-language': texts.labels.language,
        'gp-location': texts.labels.location,
        'gp-project-type': texts.labels.projectType,
        'gp-consumption': texts.labels.annualConsumption,
        'gp-area': texts.labels.availableArea,
        'gp-shading': texts.labels.shading,
        'gp-budget': texts.labels.budget,
        'gp-goal': texts.labels.primaryGoal,
        'gp-battery': texts.labels.batteryPreference,
        'gp-heatpump': texts.labels.heatPump,
        'gp-ev': texts.labels.evCharging,
        'gp-amortization': texts.labels.amortizationImportance,
        'gp-co2': texts.labels.co2Importance
    };

    Object.keys(labelMap).forEach((id) => {
        const labelEl = document.querySelector(`label[for="${id}"]`);
        if (labelEl) labelEl.textContent = labelMap[id];
    });

    const locationInput = document.getElementById('gp-location');
    if (locationInput && texts.placeholders && texts.placeholders.location) {
        locationInput.placeholder = texts.placeholders.location;
    }

    setSelectOptions('gp-project-type', texts.selectOptions.projectType);
    setSelectOptions('gp-shading', texts.selectOptions.shading);
    setSelectOptions('gp-goal', texts.selectOptions.primaryGoal);
    setSelectOptions('gp-battery', texts.selectOptions.batteryPreference);
    setSelectOptions('gp-heatpump', texts.selectOptions.heatPump);
    setSelectOptions('gp-ev', texts.selectOptions.evCharging);

    const submitBtn = document.querySelector('#greenplan-form .greenplan-submit');
    if (submitBtn) {
        submitBtn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> ' + escapeHtml(texts.ui.calculateButton);
    }

    const downloadBtn = document.getElementById('greenplan-download');
    if (downloadBtn) {
        downloadBtn.innerHTML = '<i class="fas fa-file-pdf"></i> ' + escapeHtml(texts.ui.downloadButton);
    }
}

function getLocalizedPlanLabel(planId, texts) {
    return (texts.recommendation.cards && texts.recommendation.cards[planId]) || planId;
}

function getLocalizedPlanReasons(planId, goal, texts) {
    const isEnglish = texts.locale && String(texts.locale).startsWith('en');
    const reasons = [];

    if (isEnglish) {
        reasons.push('Selected based on your priorities for economics, CO2, feasibility, and resilience.');
        reasons.push(`Primary goal: ${goal.replace('_', ' ')}`);

        if (planId === 'roi_plan') reasons.push('Best balance between upfront cost and savings potential.');
        if (planId === 'green_plan') reasons.push('Highest impact on CO2 reduction and self-sufficiency.');
        if (planId === 'budget_plan') reasons.push('Lowest capital requirement with a clear entry path.');
        return reasons;
    }

    reasons.push('Auswahl nach Prioritaeten fuer Wirtschaftlichkeit, CO2, Umsetzbarkeit und Resilienz');
    reasons.push(`Primaeres Ziel: ${goal.replace('_', ' ')}`);

    if (planId === 'roi_plan') reasons.push('Beste Balance zwischen Investitionshoehe und Einsparpotenzial');
    if (planId === 'green_plan') reasons.push('Hoechste Wirkung bei CO2-Reduktion und Autarkiegrad');
    if (planId === 'budget_plan') reasons.push('Niedrigster Kapitaleinsatz mit sauberem Einstiegspfad');
    return reasons;
}

function getLocalizedNextStep(planId, texts) {
    const isEnglish = texts.locale && String(texts.locale).startsWith('en');
    const nextStepMap = {
        budget_plan: {
            de: 'Dachpruefung und zwei Vergleichsangebote einholen',
            en: 'Check the roof and request two comparison quotes'
        },
        roi_plan: {
            de: 'Lastprofil mit Installateur validieren und Komponenten fein auslegen',
            en: 'Validate the load profile with the installer and fine-tune components'
        },
        green_plan: {
            de: 'Netzanschlussleistung und Speicherstandort verbindlich pruefen',
            en: 'Verify grid connection capacity and storage location'
        }
    };

    return (nextStepMap[planId] && nextStepMap[planId][isEnglish ? 'en' : 'de']) || '';
}

function renderGreenPlanResults(data, texts) {
    const resultsEl = document.getElementById('greenplan-results');
    if (!resultsEl || !data || !Array.isArray(data.plans)) return;

    const selectedId = data.selectedRecommendation && data.selectedRecommendation.planId;
    const selectedPlan = data.plans.find((plan) => plan.id === selectedId) || data.plans[0];

    const primaryGoal = data.userInput && data.userInput.primaryGoal ? data.userInput.primaryGoal : 'cost_reduction';
    const whyPoints = getLocalizedPlanReasons(selectedId, primaryGoal, texts)
        .map((why) => `<li>${escapeHtml(why)}</li>`)
        .join('');
    const selectedPlanLabel = getLocalizedPlanLabel(selectedId, texts);

    const summary = `
        <div class="greenplan-summary">
            <h3>${escapeHtml(texts.recommendation.title)}</h3>
            <p>${escapeHtml(texts.recommendation.selected.replace('{{planLabel}}', selectedPlanLabel))}</p>
            ${whyPoints ? `<ul>${whyPoints}</ul>` : ''}
        </div>
    `;

    const numberFormatter = new Intl.NumberFormat(texts.locale || 'de-DE');
    const decimalFormatter = new Intl.NumberFormat(texts.locale || 'de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

    const cards = data.plans.map((plan) => {
        const capexMin = numberFormatter.format(plan.financials.capexEUR.min);
        const capexMax = numberFormatter.format(plan.financials.capexEUR.max);
        const paybackMin = decimalFormatter.format(plan.financials.paybackYears.min);
        const paybackMax = decimalFormatter.format(plan.financials.paybackYears.max);
        const savingsMin = numberFormatter.format(plan.financials.annualSavingsEUR.min);
        const savingsMax = numberFormatter.format(plan.financials.annualSavingsEUR.max);
        const co2 = numberFormatter.format(Number(plan.impact.annualCo2SavingsKg));
        const autarky = numberFormatter.format(Number(plan.impact.autarkyPct));
        const nextStep = escapeHtml(getLocalizedNextStep(plan.id, texts) || plan.next7DayAction || '');
        const isRecommended = plan.id === selectedId;

        return `
            <article class="greenplan-card ${isRecommended ? 'recommended' : ''}">
            <h4>${escapeHtml(getLocalizedPlanLabel(plan.id, texts))}</h4>
                <p><strong>${escapeHtml(texts.recommendation.metrics.capex)}:</strong> ${capexMin} - ${capexMax} EUR</p>
                <p><strong>${escapeHtml(texts.recommendation.metrics.payback)}:</strong> ${paybackMin} - ${paybackMax} Jahre</p>
                <p><strong>${escapeHtml(texts.recommendation.metrics.savings)}:</strong> ${savingsMin} - ${savingsMax} EUR</p>
                <p><strong>${escapeHtml(texts.recommendation.metrics.co2)}:</strong> ${co2} kg</p>
                <p><strong>${escapeHtml(texts.recommendation.metrics.autarky)}:</strong> ${autarky}%</p>
                <p><strong>${escapeHtml(texts.recommendation.nextStepLabel)}:</strong> ${nextStep}</p>
            </article>
        `;
    }).join('');

    const nextSteps = Array.isArray(data.nextSteps)
        ? `<div class="greenplan-summary"><h4>${escapeHtml(texts.nextSteps.title)}</h4><ul>${data.nextSteps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ul></div>`
        : '';

    resultsEl.innerHTML = `${summary}<div class="greenplan-cards">${cards}</div>${nextSteps}`;
}

function buildGreenPlanPayload() {
    const languageSelect = document.getElementById('gp-language');
    const locationRaw = document.getElementById('gp-location').value.trim();
    const locationParts = locationRaw.split(' ');
    const postalCode = locationParts[0] || '';
    const city = locationParts.slice(1).join(' ') || locationRaw;

    return {
        location: {
            postalCode,
            city,
            state: 'DE'
        },
        projectType: document.getElementById('gp-project-type').value,
        annualConsumptionKWh: Number(document.getElementById('gp-consumption').value),
        availableRoofAreaM2: Number(document.getElementById('gp-area').value),
        shading: document.getElementById('gp-shading').value,
        budgetEUR: Number(document.getElementById('gp-budget').value),
        primaryGoal: document.getElementById('gp-goal').value,
        batteryPreference: document.getElementById('gp-battery').value,
        heatPump: document.getElementById('gp-heatpump').value,
        evCharging: document.getElementById('gp-ev').value,
        amortizationImportance: Number(document.getElementById('gp-amortization').value),
        co2Importance: Number(document.getElementById('gp-co2').value),
        feedInPreference: 'mixed',
        language: languageSelect ? languageSelect.value : greenPlanLang
    };
}

function exportGreenPlanPdf(data, texts) {
    if (!data || !window.jspdf || !window.jspdf.jsPDF) {
        return false;
    }

    const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4' });
    const marginX = 40;
    let y = 48;

    const title = texts.recommendation.title;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(title, marginX, y);
    y += 24;

    const selectedPlan = (data.plans || []).find((p) => p.id === data.selectedRecommendation.planId) || data.plans[0];
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.text(texts.recommendation.selected.replace('{{planLabel}}', getLocalizedPlanLabel(selectedPlan.id, texts)), marginX, y);
    y += 20;

    const primaryGoal = data.userInput && data.userInput.primaryGoal ? data.userInput.primaryGoal : 'cost_reduction';
    getLocalizedPlanReasons(selectedPlan.id, primaryGoal, texts).forEach((reason) => {
        const lines = doc.splitTextToSize(`- ${reason}`, 510);
        doc.text(lines, marginX, y);
        y += (lines.length * 14);
    });
    y += 8;

    (data.plans || []).forEach((plan) => {
        if (y > 720) {
            doc.addPage();
            y = 48;
        }

        doc.setFont('helvetica', 'bold');
        doc.text(getLocalizedPlanLabel(plan.id, texts), marginX, y);
        y += 16;
        doc.setFont('helvetica', 'normal');

        const lines = [
            `${texts.recommendation.metrics.capex}: ${plan.financials.capexEUR.min} - ${plan.financials.capexEUR.max} EUR`,
            `${texts.recommendation.metrics.payback}: ${plan.financials.paybackYears.min} - ${plan.financials.paybackYears.max} Jahre`,
            `${texts.recommendation.metrics.savings}: ${plan.financials.annualSavingsEUR.min} - ${plan.financials.annualSavingsEUR.max} EUR`,
            `${texts.recommendation.metrics.co2}: ${plan.impact.annualCo2SavingsKg} kg`,
            `${texts.recommendation.metrics.autarky}: ${plan.impact.autarkyPct}%`,
            `${texts.recommendation.nextStepLabel}: ${getLocalizedNextStep(plan.id, texts) || plan.next7DayAction}`
        ];

        lines.forEach((line) => {
            const wrapped = doc.splitTextToSize(line, 510);
            doc.text(wrapped, marginX + 8, y);
            y += (wrapped.length * 14);
        });
        y += 6;
    });

    if (Array.isArray(data.nextSteps) && data.nextSteps.length) {
        if (y > 730) {
            doc.addPage();
            y = 48;
        }
        doc.setFont('helvetica', 'bold');
        doc.text(texts.nextSteps.title, marginX, y);
        y += 16;
        doc.setFont('helvetica', 'normal');
        data.nextSteps.forEach((step) => {
            const wrapped = doc.splitTextToSize(`- ${step}`, 510);
            doc.text(wrapped, marginX + 8, y);
            y += (wrapped.length * 14);
        });
    }

    doc.save(`greenplan-report-${Date.now()}.pdf`);
    return true;
}

function setGreenPlanStatus(statusEl, message, type) {
    statusEl.textContent = message;
    statusEl.className = `greenplan-status ${type || ''}`.trim();
}

function checkGreenPlanPlausibility(payload, texts) {
    const conflicts = [];

    if ((payload.primaryGoal === 'autarky' || payload.primaryGoal === 'co2_reduction') && payload.budgetEUR < 12000) {
        conflicts.push(texts.validation && texts.validation.conflictBudgetAutarky
            ? texts.validation.conflictBudgetAutarky
            : 'Dein Ziel ist ambitioniert, aber das Budget wirkt dafuer knapp.');
    }

    if (payload.availableRoofAreaM2 < 15 && payload.annualConsumptionKWh > 7000) {
        conflicts.push('Die Dachflaeche ist sehr klein im Verhaeltnis zum Strombedarf. Die Optionen werden wahrscheinlich begrenzt sein.');
    }

    if (payload.amortizationImportance >= 9 && payload.co2Importance >= 9) {
        conflicts.push('Sehr hohe Prioritaet fuer schnelle Amortisation und maximale CO2-Einsparung gleichzeitig kann Zielkonflikte erzeugen.');
    }

    if (conflicts.length === 0) {
        return { hasConflict: false, message: '' };
    }

    return {
        hasConflict: true,
        message: conflicts.join(' ')
    };
}

function setupGreenPlanChat() {
    const form = document.getElementById('greenplan-form');
    const statusEl = document.getElementById('greenplan-status');
    const resultsEl = document.getElementById('greenplan-results');
    const downloadBtn = document.getElementById('greenplan-download');

    if (!form || !statusEl || !resultsEl || !downloadBtn) return;

    const langSelect = document.getElementById('gp-language');

    if (langSelect && (window.chatUiTextBlocks && window.chatUiTextBlocks[langSelect.value])) {
        greenPlanLang = langSelect.value;
    }
    applyGreenPlanLocale(greenPlanLang);

    if (langSelect) {
        langSelect.addEventListener('change', () => {
            greenPlanLang = langSelect.value;
            applyGreenPlanLocale(greenPlanLang);
            setGreenPlanStatus(statusEl, '', 'info');
        });
    }

    downloadBtn.addEventListener('click', () => {
        const texts = getGreenPlanTexts();
        const exported = exportGreenPlanPdf(lastGreenPlanResult, texts);
        if (!exported) {
            setGreenPlanStatus(statusEl, texts.errors.generic, 'error');
        }
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submitBtn = form.querySelector('button[type="submit"]');
        const texts = getGreenPlanTexts();

        setGreenPlanStatus(statusEl, texts.progress.collecting, 'info');
        resultsEl.innerHTML = '';
        submitBtn.disabled = true;
        downloadBtn.disabled = true;
        lastGreenPlanResult = null;

        try {
            const payload = buildGreenPlanPayload();
            greenPlanLang = payload.language || greenPlanLang;
            const plausibility = checkGreenPlanPlausibility(payload, texts);
            if (plausibility.hasConflict) {
                setGreenPlanStatus(statusEl, plausibility.message, 'warning');
                const proceed = window.confirm(`${plausibility.message}\n\nMoechtest du die Berechnung trotzdem starten?`);
                if (!proceed) {
                    setGreenPlanStatus(statusEl, 'Berechnung pausiert. Passe die Eingaben an und starte erneut.', 'warning');
                    return;
                }
            }

            setGreenPlanStatus(statusEl, texts.progress.calculating, 'info');

            const response = await fetch('/.netlify/functions/greenplan-recommendation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                let details = '';
                try {
                    const errorJson = await response.json();
                    details = errorJson.error || errorJson.message || JSON.stringify(errorJson);
                } catch (parseError) {
                    try {
                        details = await response.text();
                    } catch (textError) {
                        details = '';
                    }
                }

                const err = new Error(`HTTP ${response.status}${details ? `: ${details}` : ''}`);
                err.status = response.status;
                throw err;
            }

            const data = await response.json();
            renderGreenPlanResults(data, texts);
            lastGreenPlanResult = data;
            downloadBtn.disabled = false;
            setGreenPlanStatus(statusEl, texts.progress.done, 'success');
        } catch (error) {
            console.error('GreenPlan API error:', error);
            const status = error && error.status
                ? error.status
                : (() => {
                    const match = String(error && error.message ? error.message : '').match(/HTTP\s+(\d+)/);
                    return match ? Number(match[1]) : 0;
                })();

            if (status === 404 || status === 501) {
                setGreenPlanStatus(statusEl, texts.errors.functionUnavailable, 'error');
            } else if (status >= 500) {
                setGreenPlanStatus(statusEl, texts.errors.serverError, 'error');
            } else {
                setGreenPlanStatus(statusEl, texts.errors.generic, 'error');
            }
        } finally {
            submitBtn.disabled = false;
        }
    });
}

// Initialize Everything
document.addEventListener('DOMContentLoaded', () => {
    setupEnergyCards();
    setupConsultation();
    setupGreenPlanChat();
    setupNewsletter();
    setupReactions();
    setupSmoothScroll();
    
    // View More Articles button
    const viewMoreBtn = document.getElementById('view-more-articles');
    if (viewMoreBtn) {
        viewMoreBtn.addEventListener('click', () => {
            alert('More articles coming soon! Stay tuned.');
        });
    }

    // GSAP Animations
    if (typeof gsap !== 'undefined') {
        gsap.from(".feature-card", {
            duration: 1,
            y: 50,
            opacity: 0,
            stagger: 0.2,
            ease: "power2.out"
        });
    }

    // Service Worker
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js')
                .catch(err => console.error('Service Worker registration failed:', err));
        });
    }
});
