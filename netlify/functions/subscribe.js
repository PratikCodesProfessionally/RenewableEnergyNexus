/**
 * Netlify Function: Subscribe user and send welcome email via Brevo
 * 
 * This function securely handles email subscriptions using the Brevo API
 * The API key is kept on the server and not exposed to the frontend.
 * 
 * Environment Variable Required:
 * - BREVO_API_KEY: Your Brevo API key
 */

exports.handler = async (event, context) => {
    // CORS headers for frontend access
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    // Handle preflight requests
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers,
            body: ''
        };
    }

    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    const apiKey = process.env.BREVO_API_KEY;
    const listId = 2; // Your Brevo list ID

    // Check if API key is configured
    if (!apiKey || apiKey === 'YOUR_BREVO_API_KEY') {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
                error: 'API key not configured',
                success: false
            })
        };
    }

    try {
        let body;
        try {
            body = JSON.parse(event.body);
        } catch (e) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    error: 'Invalid JSON in request body',
                    success: false
                })
            };
        }

        const { email, firstName = '', lastName = '' } = body;

        // Validate email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!email || !emailRegex.test(email)) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    error: 'Invalid email address',
                    success: false
                })
            };
        }

        // Step 1: Add contact to Brevo
        const addContactResponse = await fetch(`https://api.brevo.com/v3/contacts`, {
            method: 'POST',
            headers: {
                'accept': 'application/json',
                'api-key': apiKey,
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                email: email,
                attributes: {
                    FIRSTNAME: firstName,
                    LASTNAME: lastName,
                    SOURCE: 'Website Subscription'
                },
                listIds: [listId],
                updateEnabled: true // Allow updating if email already exists
            })
        });

        if (!addContactResponse.ok) {
            let errorData = {};
            try {
                errorData = await addContactResponse.json();
            } catch (e) {
                errorData = { message: 'Failed to add contact' };
            }
            
            console.error('Brevo Add Contact Error:', addContactResponse.status, errorData);

            // If contact already exists (409 Conflict), continue to send welcome email
            if (addContactResponse.status !== 409) {
                return {
                    statusCode: addContactResponse.status,
                    headers,
                    body: JSON.stringify({ 
                        error: errorData.message || 'Failed to add subscriber',
                        success: false,
                        status: addContactResponse.status
                    })
                };
            }
        }

        // Step 2: Send welcome email
        const emailResponse = await fetch(`https://api.brevo.com/v3/smtp/email`, {
            method: 'POST',
            headers: {
                'accept': 'application/json',
                'api-key': apiKey,
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                sender: {
                    name: 'Renewable Energy Nexus',
                    email: 'renewableenergynexus@gmail.com'
                },
                to: [{
                    email: email,
                    name: firstName || 'Subscriber'
                }],
                subject: 'Welcome to Renewable Energy Nexus! 🌱',
                htmlContent: getWelcomeEmailTemplate(firstName),
                textContent: getWelcomeEmailText(firstName)
            })
        });

        if (!emailResponse.ok) {
            let errorData = {};
            try {
                errorData = await emailResponse.json();
            } catch (e) {
                errorData = { message: 'Failed to send email' };
            }
            
            console.error('Brevo Email Send Error:', emailResponse.status, errorData);
            
            // Email sending failed, but contact was added
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ 
                    success: true,
                    message: 'Subscription successful, but welcome email could not be sent',
                    warning: 'Email service error',
                    email: email
                })
            };
        }

        // Success!
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ 
                success: true,
                message: 'Successfully subscribed! Check your email for a welcome message.',
                email: email
            })
        };

    } catch (error) {
        console.error('Subscription Error:', error);
        
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: 'An error occurred during subscription',
                success: false,
                details: error.message
            })
        };
    }
};

/**
 * Get welcome email HTML template
 */
function getWelcomeEmailTemplate(firstName) {
    const name = firstName ? ` ${firstName}` : '';
    return `
        <!DOCTYPE html>
        <html>
            <head>
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background: linear-gradient(135deg, #4CAF50, #2196F3); color: white; padding: 20px; border-radius: 5px; text-align: center; }
                    .content { padding: 20px 0; }
                    .button { display: inline-block; background: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
                    .footer { color: #666; font-size: 12px; border-top: 1px solid #ddd; padding-top: 20px; margin-top: 20px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>🌍 Welcome to Renewable Energy Nexus${name}!</h1>
                    </div>
                    
                    <div class="content">
                        <p>Thank you for subscribing to our newsletter!</p>
                        
                        <p>You'll now receive the latest updates on:</p>
                        <ul>
                            <li>🔋 Renewable energy technologies and innovations</li>
                            <li>💡 Sustainable energy solutions</li>
                            <li>📊 Energy industry insights and trends</li>
                            <li>🌱 Global renewable energy projects</li>
                        </ul>
                        
                        <p>Stay tuned for exciting content!</p>
                        
                        <a href="https://renewableenergynexus.netlify.app" class="button">Visit Our Website</a>
                    </div>
                    
                    <div class="footer">
                        <p>© 2026 Renewable Energy Nexus. All rights reserved.</p>
                        <p>You're receiving this email because you subscribed to our newsletter.</p>
                    </div>
                </div>
            </body>
        </html>
    `;
}

/**
 * Get welcome email text version
 */
function getWelcomeEmailText(firstName) {
    const name = firstName ? ` ${firstName}` : '';
    return `
Welcome to Renewable Energy Nexus${name}!

Thank you for subscribing to our newsletter!

You'll now receive the latest updates on:
- Renewable energy technologies and innovations
- Sustainable energy solutions
- Energy industry insights and trends
- Global renewable energy projects

Stay tuned for exciting content!

Visit: https://renewableenergynexus.netlify.app

---
© 2026 Renewable Energy Nexus. All rights reserved.
You're receiving this email because you subscribed to our newsletter.
    `;
}
