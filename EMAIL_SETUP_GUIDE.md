# Email Subscription System - Setup Guide
## Renewable Energy Nexus

---

## 📋 Overview

This email subscription system provides a complete solution for managing newsletter subscribers, sending automated welcome emails, and distributing content updates. The system uses **Brevo (formerly Sendinblue)** as the email service provider.

### Why Brevo?
- ✅ **Free Tier**: 300 emails/day (9,000/month) forever
- ✅ **Easy API**: RESTful API with excellent documentation
- ✅ **Email Templates**: Built-in template builder
- ✅ **Contact Management**: List segmentation and contact attributes
- ✅ **Analytics**: Open rates, click rates, bounce tracking
- ✅ **No Credit Card**: Free tier requires no payment method

---

## 🚀 Quick Start (5 Minutes)

### Step 1: Create Brevo Account
1. Go to [https://www.brevo.com/](https://www.brevo.com/)
2. Click "Sign up free"
3. Verify your email address
4. Complete the onboarding questionnaire

### Step 2: Get API Key
1. Log into Brevo dashboard
2. Navigate to **Settings** (top right corner)
3. Click **SMTP & API** → **API Keys**
4. Click **Generate a new API key**
5. Name it "Renewable Energy Nexus Website"
6. Copy the API key (you'll only see it once!)

### Step 3: Create Contact List
1. In Brevo, go to **Contacts** → **Lists**
2. Click **Create a list**
3. Name it "Newsletter Subscribers"
4. Note the List ID (you'll see it in the URL or list details)

### Step 4: Configure Sender Email
1. Go to **Senders & IPs** → **Senders**
2. Add your domain email (e.g., `newsletter@yourdomain.com`)
3. Verify the email (check inbox for verification link)
4. Set as default sender

### Step 5: Update Code
Open `/RenewableEnergyNexus/js/emailSubscription.js` and replace:

```javascript
this.apiKey = 'YOUR_BREVO_API_KEY'; // Replace with your actual API key
this.listId = 2; // Replace with your list ID from Step 3
```

In the `sendWelcomeEmail` method, update:
```javascript
sender: {
    name: 'Renewable Energy Nexus',
    email: 'newsletter@yourdomain.com' // Your verified sender email
}
```

---

## 📧 Email Templates

### Welcome Email (Automated)
Sent immediately upon subscription. Includes:
- Personalized greeting
- Overview of what subscribers will receive
- Quick links to website sections
- Social media links
- Unsubscribe option

**Preview**: Check `getWelcomeEmailTemplate()` in emailSubscription.js

### Blog Notification Email
Triggered when new article is published:

```javascript
// Send blog notification to all subscribers
async function notifyNewArticle(article) {
    const response = await fetch(`${apiEndpoint}/contacts/lists/${listId}/contacts`, {
        headers: {
            'accept': 'application/json',
            'api-key': apiKey
        }
    });
    
    const subscribers = await response.json();
    
    // Send email to each subscriber
    for (const subscriber of subscribers.contacts) {
        await subscriptionManager.sendEmail(
            subscriber.email,
            'New Article: ' + article.title,
            subscriptionManager.getBlogNotificationTemplate(article)
        );
    }
}

// Usage when publishing new article:
notifyNewArticle({
    title: "The Future of Solar Energy",
    author: "Pratik Devkota",
    date: "2025-11-14",
    excerpt: "Exploring breakthrough technologies...",
    image: "https://yourwebsite.com/images/solar.jpg",
    url: "https://yourwebsite.com/articles/future-of-solar"
});
```

### Monthly Newsletter
Send curated content monthly:

```javascript
const newsletterContent = {
    html: `
        <h2>This Month's Highlights</h2>
        <div class="article-preview">
            <h3>Top Article: Perovskite Solar Breakthroughs</h3>
            <p>Lab prototypes achieving 33%+ efficiency...</p>
            <a href="...">Read More</a>
        </div>
        <div class="stats-grid">
            <div class="stat-box">
                <div class="stat-number">2,245 MW</div>
                <p>Bhadla Solar Park Capacity</p>
            </div>
            <div class="stat-box">
                <div class="stat-number">14,000 MW</div>
                <p>Itaipu Dam Output</p>
            </div>
        </div>
    `
};

// Send to all subscribers
// (Use Brevo Campaigns feature for best results)
```

---

## 🔧 Features

### Frontend Subscription Form
✅ Real-time email validation  
✅ First/Last name capture (optional)  
✅ GDPR-compliant consent checkbox  
✅ Privacy policy link  
✅ Success/error feedback  
✅ Loading states  
✅ Subscriber count display  

### Backend Integration
✅ Brevo API integration  
✅ LocalStorage backup (works offline)  
✅ Duplicate email detection  
✅ Automatic welcome email  
✅ Error handling with retry logic  
✅ Contact list synchronization  

### Email Workflows
✅ Welcome email (automated)  
✅ Blog post notifications (manual trigger)  
✅ Monthly newsletters (via Brevo Campaigns)  
✅ Unsubscribe handling  

---

## 📊 Subscriber Management

### View Subscribers
```javascript
// Get subscriber count
const count = subscriptionManager.getSubscriberCount();

// Export all subscribers (JSON format)
const data = subscriptionManager.exportSubscribers();
console.log(data);

// Download as file
const blob = new Blob([data], { type: 'application/json' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'subscribers.json';
a.click();
```

### Unsubscribe User
```javascript
// From email link: yourwebsite.com/unsubscribe?email=user@example.com
const urlParams = new URLSearchParams(window.location.search);
const email = urlParams.get('email');

if (email) {
    subscriptionManager.unsubscribe(email)
        .then(result => alert(result.message))
        .catch(error => alert(error.message));
}
```

### Brevo Dashboard
Access subscriber analytics:
1. Log into Brevo
2. Go to **Contacts** → **Lists**
3. Click on "Newsletter Subscribers"
4. View: Total contacts, Active, Unsubscribed, Bounced

---

## 🔐 Security & Privacy

### API Key Security
⚠️ **IMPORTANT**: Never commit API keys to GitHub!

**For Production**:
1. Use environment variables
2. Create `.env` file:
```
BREVO_API_KEY=your_actual_key_here
BREVO_LIST_ID=2
```

3. Add to `.gitignore`:
```
.env
```

4. Use backend proxy:
```javascript
// Instead of calling Brevo directly, call your server
fetch('/api/subscribe', {
    method: 'POST',
    body: JSON.stringify({ email, firstName, lastName })
})
// Server handles Brevo API calls with env variables
```

### GDPR Compliance
✅ Explicit consent checkbox  
✅ Clear privacy policy link  
✅ Easy unsubscribe (one-click)  
✅ Data export capability  
✅ Right to erasure (unsubscribe deletes data)  

---

## 📱 Testing Checklist

### Form Functionality
- [ ] Valid email accepted
- [ ] Invalid email rejected with error message
- [ ] Duplicate email shows appropriate message
- [ ] Consent checkbox required
- [ ] Form clears after successful submission
- [ ] Loading state shows during API call
- [ ] Error handling for network failures

### Email Delivery
- [ ] Welcome email arrives within 1 minute
- [ ] Email displays correctly in Gmail
- [ ] Email displays correctly in Outlook
- [ ] Email displays correctly on mobile
- [ ] Unsubscribe link works
- [ ] Plain text version looks good

### Brevo Integration
- [ ] Subscriber added to correct list
- [ ] First/Last name saved as attributes
- [ ] Subscription timestamp recorded
- [ ] Email opened tracking works
- [ ] Link clicks tracked

---

## 🚀 Going Live

### Pre-Launch Checklist
1. ✅ Replace `YOUR_BREVO_API_KEY` with real key
2. ✅ Update sender email to verified domain
3. ✅ Test all email templates
4. ✅ Verify unsubscribe links work
5. ✅ Update privacy policy with email collection details
6. ✅ Test on multiple devices/browsers
7. ✅ Set up email forwarding for unsubscribe requests
8. ✅ Configure DKIM/SPF records for domain (better deliverability)

### Monitoring
- **Daily**: Check Brevo dashboard for bounces/complaints
- **Weekly**: Review open rates and click rates
- **Monthly**: Clean list (remove bounced emails)

---

## 🔄 Sending Campaigns

### Method 1: Via Brevo Dashboard (Recommended for Newsletters)
1. Log into Brevo
2. Go to **Campaigns** → **Email**
3. Click **Create a campaign**
4. Choose template or use drag-drop editor
5. Select "Newsletter Subscribers" list
6. Schedule or send immediately

### Method 2: Via API (For Blog Notifications)
```javascript
// Add this method to emailSubscription.js
async sendBulkEmail(subject, htmlContent, listId) {
    const response = await fetch(`${this.apiEndpoint}/emailCampaigns`, {
        method: 'POST',
        headers: {
            'accept': 'application/json',
            'api-key': this.apiKey,
            'content-type': 'application/json'
        },
        body: JSON.stringify({
            sender: {
                name: 'Renewable Energy Nexus',
                email: 'newsletter@yourdomain.com'
            },
            name: `Blog Post - ${new Date().toISOString()}`,
            subject: subject,
            htmlContent: htmlContent,
            recipients: {
                listIds: [listId]
            }
        })
    });
    
    return await response.json();
}
```

---

## 💰 Cost Estimates

### Free Tier (Brevo)
- **0-300 emails/day**: FREE forever
- **Features**: All features included
- **Contacts**: Unlimited
- **Perfect for**: Starting out (0-500 subscribers)

### As You Grow
- **Up to 20,000 emails/month**: $25/month
- **Up to 40,000 emails/month**: $39/month
- **Up to 60,000 emails/month**: $49/month

**Example**: 1,000 subscribers receiving 1 email/week = 4,000 emails/month = FREE tier

---

## 🆘 Troubleshooting

### "API key invalid"
- Check API key is copied correctly (no spaces)
- Verify key hasn't been regenerated in Brevo
- Check API key permissions in Brevo settings

### "Email not arriving"
- Check spam folder
- Verify sender email is verified in Brevo
- Check Brevo dashboard for bounce/blocked status
- Ensure daily limit not exceeded (300 on free tier)

### "Subscriber not added to list"
- Verify listId is correct
- Check Brevo dashboard → Contacts for any errors
- Review browser console for error messages

### CORS Errors
- Brevo API should work from browser
- If issues persist, implement backend proxy
- Alternative: Use Brevo's JavaScript SDK

---

## 📚 Additional Resources

- [Brevo API Documentation](https://developers.brevo.com/)
- [Brevo Email Templates](https://app.brevo.com/templates)
- [Email Deliverability Guide](https://www.brevo.com/blog/email-deliverability/)
- [GDPR Compliance Checklist](https://gdpr.eu/checklist/)

---

## 🎯 Next Steps

1. **Week 1**: Set up Brevo account and test welcome email
2. **Week 2**: Collect first 50 subscribers
3. **Week 3**: Send first manual blog notification
4. **Month 2**: Launch monthly newsletter
5. **Ongoing**: Monitor engagement and optimize

---

## 📞 Support

For issues with this system:
- Check browser console for errors
- Review Brevo API logs in dashboard
- Test with curl to isolate frontend vs API issues

For Brevo support:
- [Brevo Help Center](https://help.brevo.com/)
- Live chat (available on dashboard)
- Email: support@brevo.com

---

**Last Updated**: November 14, 2025  
**Version**: 1.0  
**Author**: GitHub Copilot for Renewable Energy Nexus
