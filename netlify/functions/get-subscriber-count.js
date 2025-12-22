/**
 * Netlify Function: Get Subscriber Count from Brevo
 * 
 * This function securely fetches the subscriber count from Brevo API
 * without exposing the API key to the frontend.
 * 
 * Environment Variable Required:
 * - BREVO_API_KEY: Your Brevo API key
 */

exports.handler = async (event, context) => {
    // CORS headers for frontend access
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
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

    // Only allow GET requests
    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    const apiKey = process.env.BREVO_API_KEY;

    // Check if API key is configured
    if (!apiKey || apiKey === 'YOUR_BREVO_API_KEY') {
        // Return fallback count if API key not configured
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ 
                count: 2, 
                source: 'fallback',
                message: 'API key not configured, using fallback count'
            })
        };
    }

    try {
        // Fetch contacts from Brevo list (listId: 2)
        const listId = 2;
        const response = await fetch(`https://api.brevo.com/v3/contacts/lists/${listId}`, {
            method: 'GET',
            headers: {
                'accept': 'application/json',
                'api-key': apiKey
            }
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error('Brevo API Error:', errorData);
            
            // Return fallback on error
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ 
                    count: 2, 
                    source: 'fallback',
                    message: 'API error, using fallback count'
                })
            };
        }

        const data = await response.json();
        const subscriberCount = data.uniqueSubscribers || data.totalSubscribers || 0;

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ 
                count: subscriberCount,
                source: 'brevo',
                listName: data.name || 'Newsletter'
            })
        };

    } catch (error) {
        console.error('Error fetching subscriber count:', error);
        
        // Return fallback on network error
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ 
                count: 2, 
                source: 'fallback',
                message: 'Network error, using fallback count'
            })
        };
    }
};
