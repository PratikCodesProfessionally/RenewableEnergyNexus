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

    document.getElementById('consult-form').addEventListener('submit', (e) => {
        e.preventDefault();
        alert('Consultation request submitted! We will contact you soon.');
        modal.style.display = 'none';
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
function updateSubscriberCount() {
    const countEl = document.getElementById('subscriber-count');
    if (countEl && typeof subscriptionManager !== 'undefined') {
        const count = subscriptionManager.getSubscriberCount();
        if (count > 0) {
            countEl.textContent = `Join ${count} other subscriber${count !== 1 ? 's' : ''}`;
        } else {
            countEl.textContent = 'Be the first to subscribe!';
        }
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

// Initialize Everything
document.addEventListener('DOMContentLoaded', () => {
    setupEnergyCards();
    setupConsultation();
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
            navigator.serviceWorker.register('sw.js')
                .catch(err => console.error('Service Worker registration failed:', err));
        });
    }
});
