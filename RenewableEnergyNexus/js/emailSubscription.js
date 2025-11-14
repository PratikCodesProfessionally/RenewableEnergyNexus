/**
 * Email Subscription System for Renewable Energy Nexus
 * Integrates with Brevo (Sendinblue) API
 * 
 * Setup Instructions:
 * 1. Create a free Brevo account at https://www.brevo.com/
 * 2. Get your API key from Settings > SMTP & API > API Keys
 * 3. Replace 'YOUR_BREVO_API_KEY' below with your actual key
 * 4. Create contact lists in Brevo for different subscription types
 */

class EmailSubscriptionManager {
    constructor() {
        this.apiKey = 'YOUR_BREVO_API_KEY'; // Replace with your actual API key
        this.apiEndpoint = 'https://api.brevo.com/v3';
        this.listId = 2; // Replace with your Brevo list ID
        this.subscribers = this.loadSubscribers();
    }

    /**
     * Load subscribers from localStorage
     */
    loadSubscribers() {
        try {
            const stored = localStorage.getItem('renex_subscribers');
            return stored ? JSON.parse(stored) : [];
        } catch (error) {
            console.error('Error loading subscribers:', error);
            return [];
        }
    }

    /**
     * Save subscribers to localStorage
     */
    saveSubscribers() {
        try {
            localStorage.setItem('renex_subscribers', JSON.stringify(this.subscribers));
        } catch (error) {
            console.error('Error saving subscribers:', error);
        }
    }

    /**
     * Validate email format
     */
    validateEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    /**
     * Check if email already exists
     */
    isDuplicate(email) {
        return this.subscribers.some(sub => sub.email.toLowerCase() === email.toLowerCase());
    }

    /**
     * Add subscriber to Brevo via API
     */
    async addToBrevo(email, attributes = {}) {
        try {
            const response = await fetch(`${this.apiEndpoint}/contacts`, {
                method: 'POST',
                headers: {
                    'accept': 'application/json',
                    'api-key': this.apiKey,
                    'content-type': 'application/json'
                },
                body: JSON.stringify({
                    email: email,
                    attributes: {
                        FIRSTNAME: attributes.firstName || '',
                        LASTNAME: attributes.lastName || '',
                        SOURCE: 'Website Subscription',
                        ...attributes
                    },
                    listIds: [this.listId],
                    updateEnabled: false
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Failed to add subscriber to Brevo');
            }

            return await response.json();
        } catch (error) {
            console.error('Brevo API Error:', error);
            throw error;
        }
    }

    /**
     * Send welcome email via Brevo
     */
    async sendWelcomeEmail(email, subscriberName = '') {
        try {
            const response = await fetch(`${this.apiEndpoint}/smtp/email`, {
                method: 'POST',
                headers: {
                    'accept': 'application/json',
                    'api-key': this.apiKey,
                    'content-type': 'application/json'
                },
                body: JSON.stringify({
                    sender: {
                        name: 'Renewable Energy Nexus',
                        email: 'renewableenergynexus@gmail.com' // Replace with your verified sender
                    },
                    to: [{
                        email: email,
                        name: subscriberName
                    }],
                    subject: 'Welcome to Renewable Energy Nexus! 🌱',
                    htmlContent: this.getWelcomeEmailTemplate(subscriberName),
                    textContent: this.getWelcomeEmailText(subscriberName)
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Failed to send welcome email');
            }

            return await response.json();
        } catch (error) {
            console.error('Failed to send welcome email:', error);
            throw error;
        }
    }

    /**
     * Subscribe a new user
     */
    async subscribe(email, consent = false, additionalData = {}) {
        // Validate email
        if (!this.validateEmail(email)) {
            throw new Error('Please enter a valid email address');
        }

        // Check consent
        if (!consent) {
            throw new Error('Please agree to receive emails from us');
        }

        // Check for duplicates
        if (this.isDuplicate(email)) {
            throw new Error('This email is already subscribed');
        }

        const subscriber = {
            email: email,
            timestamp: new Date().toISOString(),
            source: 'Website Newsletter Form',
            consented: consent,
            ...additionalData
        };

        try {
            // Add to Brevo (if API key is configured)
            if (this.apiKey !== 'YOUR_BREVO_API_KEY') {
                await this.addToBrevo(email, additionalData);
                await this.sendWelcomeEmail(email, additionalData.firstName);
            }

            // Store locally
            this.subscribers.push(subscriber);
            this.saveSubscribers();

            return {
                success: true,
                message: 'Successfully subscribed! Check your email for a welcome message.',
                subscriber: subscriber
            };
        } catch (error) {
            // If Brevo fails but we want to store locally anyway
            this.subscribers.push(subscriber);
            this.saveSubscribers();

            return {
                success: true,
                message: 'Subscription recorded. Email service temporarily unavailable.',
                warning: error.message
            };
        }
    }

    /**
     * Unsubscribe a user
     */
    async unsubscribe(email) {
        const index = this.subscribers.findIndex(
            sub => sub.email.toLowerCase() === email.toLowerCase()
        );

        if (index === -1) {
            throw new Error('Email not found in subscriber list');
        }

        // Remove from Brevo
        if (this.apiKey !== 'YOUR_BREVO_API_KEY') {
            try {
                await fetch(`${this.apiEndpoint}/contacts/${encodeURIComponent(email)}`, {
                    method: 'DELETE',
                    headers: {
                        'accept': 'application/json',
                        'api-key': this.apiKey
                    }
                });
            } catch (error) {
                console.error('Failed to remove from Brevo:', error);
            }
        }

        // Remove locally
        this.subscribers.splice(index, 1);
        this.saveSubscribers();

        return {
            success: true,
            message: 'Successfully unsubscribed'
        };
    }

    /**
     * Get total subscriber count
     */
    getSubscriberCount() {
        return this.subscribers.length;
    }

    /**
     * Export subscribers (for backup/migration)
     */
    exportSubscribers() {
        return JSON.stringify(this.subscribers, null, 2);
    }

    /**
     * Welcome Email HTML Template
     */
    getWelcomeEmailTemplate(name = '') {
        const greeting = name ? `Hi ${name}` : 'Hello';
        
        return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Welcome to Renewable Energy Nexus</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #333;
            margin: 0;
            padding: 0;
            background-color: #f4f4f4;
        }
        .container {
            max-width: 600px;
            margin: 20px auto;
            background: white;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        }
        .header {
            background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);
            color: white;
            padding: 40px 20px;
            text-align: center;
        }
        .header h1 {
            margin: 0;
            font-size: 28px;
        }
        .header p {
            margin: 10px 0 0;
            opacity: 0.9;
        }
        .content {
            padding: 40px 30px;
        }
        .content h2 {
            color: #4CAF50;
            font-size: 22px;
            margin-top: 0;
        }
        .feature-box {
            background: #f8f9fa;
            border-left: 4px solid #4CAF50;
            padding: 15px;
            margin: 20px 0;
            border-radius: 4px;
        }
        .feature-box h3 {
            margin-top: 0;
            color: #333;
            font-size: 18px;
        }
        .cta-button {
            display: inline-block;
            background: #4CAF50;
            color: white;
            padding: 12px 30px;
            text-decoration: none;
            border-radius: 5px;
            margin: 20px 0;
            font-weight: 600;
        }
        .quick-links {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
            margin: 20px 0;
        }
        .quick-link {
            background: #e8f5e9;
            padding: 15px;
            border-radius: 5px;
            text-align: center;
            text-decoration: none;
            color: #2e7d32;
            font-weight: 600;
        }
        .footer {
            background: #f8f9fa;
            padding: 30px;
            text-align: center;
            font-size: 14px;
            color: #666;
        }
        .social-links {
            margin: 20px 0;
        }
        .social-links a {
            display: inline-block;
            margin: 0 10px;
            color: #4CAF50;
            text-decoration: none;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🌱 Welcome to Renewable Energy Nexus!</h1>
            <p>Your journey to sustainable energy starts here</p>
        </div>
        
        <div class="content">
            <h2>${greeting}! 👋</h2>
            <p>Thank you for subscribing to Renewable Energy Nexus! We're thrilled to have you join our community of sustainability enthusiasts, professionals, and change-makers.</p>
            
            <div class="feature-box">
                <h3>📬 What You'll Receive:</h3>
                <ul>
                    <li><strong>Latest Articles:</strong> In-depth analyses of solar, wind, hydro, and hydrogen technologies</li>
                    <li><strong>Industry Insights:</strong> Breaking news and trends in renewable energy</li>
                    <li><strong>Project Spotlights:</strong> Real-world case studies from global installations</li>
                    <li><strong>Exclusive Tools:</strong> Energy savings calculators and resources</li>
                </ul>
            </div>
            
            <div style="text-align: center;">
                <a href="https://yourwebsite.com" class="cta-button">Explore Our Website</a>
            </div>
            
            <h3 style="color: #4CAF50; margin-top: 30px;">🚀 Quick Start:</h3>
            <div class="quick-links">
                <a href="https://yourwebsite.com#education" class="quick-link">Learn About Energy</a>
                <a href="https://yourwebsite.com#calculator" class="quick-link">Savings Calculator</a>
                <a href="https://yourwebsite.com#articles" class="quick-link">Latest Articles</a>
                <a href="https://yourwebsite.com#consultation" class="quick-link">Get Consultation</a>
            </div>
            
            <p style="margin-top: 30px;">We're committed to providing you with valuable, actionable insights on renewable energy. If you have any questions or suggestions, feel free to reply to this email.</p>
            
            <p><strong>Welcome aboard!</strong><br>
            The Renewable Energy Nexus Team</p>
        </div>
        
        <div class="footer">
            <div class="social-links">
                <a href="https://www.instagram.com/renex_us/">📱 Instagram</a>
            </div>
            
            <p>© 2025 Renewable Energy Nexus. All rights reserved.</p>
            
            <p style="font-size: 12px; color: #999; margin-top: 20px;">
                You're receiving this email because you subscribed to Renewable Energy Nexus.<br>
                <a href="{{unsubscribe}}" style="color: #4CAF50;">Unsubscribe</a> | 
                <a href="{{update_profile}}" style="color: #4CAF50;">Update Preferences</a>
            </p>
        </div>
    </div>
</body>
</html>`;
    }

    /**
     * Welcome Email Plain Text Version
     */
    getWelcomeEmailText(name = '') {
        const greeting = name ? `Hi ${name}` : 'Hello';
        
        return `
${greeting}!

Welcome to Renewable Energy Nexus!

Thank you for subscribing. We're thrilled to have you join our community of sustainability enthusiasts.

What You'll Receive:
- Latest Articles: In-depth analyses of solar, wind, hydro, and hydrogen technologies
- Industry Insights: Breaking news and trends in renewable energy
- Project Spotlights: Real-world case studies from global installations
- Exclusive Tools: Energy savings calculators and resources

Visit our website: https://yourwebsite.com

Quick Links:
- Learn About Energy: https://yourwebsite.com#education
- Savings Calculator: https://yourwebsite.com#calculator
- Latest Articles: https://yourwebsite.com#articles
- Get Consultation: https://yourwebsite.com#consultation

We're committed to providing you with valuable, actionable insights on renewable energy.

Welcome aboard!
The Renewable Energy Nexus Team

---
© 2025 Renewable Energy Nexus
Unsubscribe: {{unsubscribe}}
        `;
    }

    /**
     * Blog Notification Email Template
     */
    getBlogNotificationTemplate(article) {
        return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>New Article: ${article.title}</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #333;
            margin: 0;
            padding: 0;
            background-color: #f4f4f4;
        }
        .container {
            max-width: 600px;
            margin: 20px auto;
            background: white;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        }
        .header {
            background: #4CAF50;
            color: white;
            padding: 20px;
            text-align: center;
        }
        .content {
            padding: 30px;
        }
        .article-image {
            width: 100%;
            height: auto;
            border-radius: 8px;
            margin: 20px 0;
        }
        .read-more {
            display: inline-block;
            background: #4CAF50;
            color: white;
            padding: 12px 30px;
            text-decoration: none;
            border-radius: 5px;
            margin: 20px 0;
            font-weight: 600;
        }
        .footer {
            background: #f8f9fa;
            padding: 20px;
            text-align: center;
            font-size: 14px;
            color: #666;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h2>📰 New Article Published</h2>
        </div>
        <div class="content">
            <h1>${article.title}</h1>
            ${article.image ? `<img src="${article.image}" alt="${article.title}" class="article-image">` : ''}
            <p><strong>By ${article.author || 'Pratik Devkota'}</strong> | ${article.date || new Date().toLocaleDateString()}</p>
            <p>${article.excerpt || article.description}</p>
            <a href="${article.url}" class="read-more">Read Full Article →</a>
        </div>
        <div class="footer">
            <p>© 2025 Renewable Energy Nexus</p>
            <p><a href="{{unsubscribe}}">Unsubscribe</a></p>
        </div>
    </div>
</body>
</html>`;
    }

    /**
     * Monthly Newsletter Template
     */
    getNewsletterTemplate(content) {
        return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Monthly Newsletter - Renewable Energy Nexus</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #333;
            margin: 0;
            padding: 0;
            background-color: #f4f4f4;
        }
        .container {
            max-width: 600px;
            margin: 20px auto;
            background: white;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        }
        .header {
            background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);
            color: white;
            padding: 40px 20px;
            text-align: center;
        }
        .content {
            padding: 30px;
        }
        .article-preview {
            border-left: 4px solid #4CAF50;
            padding-left: 15px;
            margin: 20px 0;
        }
        .stats-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 15px;
            margin: 20px 0;
        }
        .stat-box {
            background: #e8f5e9;
            padding: 20px;
            border-radius: 8px;
            text-align: center;
        }
        .stat-number {
            font-size: 32px;
            font-weight: bold;
            color: #4CAF50;
        }
        .footer {
            background: #f8f9fa;
            padding: 30px;
            text-align: center;
            font-size: 14px;
            color: #666;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🌍 Monthly Renewable Energy Digest</h1>
            <p>${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</p>
        </div>
        <div class="content">
            ${content.html}
        </div>
        <div class="footer">
            <p>© 2025 Renewable Energy Nexus</p>
            <p><a href="{{unsubscribe}}">Unsubscribe</a> | <a href="{{update_profile}}">Update Preferences</a></p>
        </div>
    </div>
</body>
</html>`;
    }
}

// Initialize subscription manager
const subscriptionManager = new EmailSubscriptionManager();

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = EmailSubscriptionManager;
}
