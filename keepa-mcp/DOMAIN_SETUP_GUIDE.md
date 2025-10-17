# 🌐 Custom Domain Setup Guide for Keepa API

## Overview

This guide will help you set up a custom domain for your Keepa API, enabling:
- **Professional URLs** like `https://api.yourdomain.com`
- **SSL/HTTPS encryption** with automatic certificate management
- **Automatic HTTP to HTTPS redirects**
- **Easy-to-remember endpoints**

## 🚀 Quick Start

### Option 1: Register a New Domain (Recommended)

1. **Register your domain** through AWS Route 53 or any domain registrar
2. **Deploy with new domain**:
   ```bash
   cd infrastructure
   ./deploy-scripts.sh new-domain api.yourdomain.com
   ```

### Option 2: Use Existing Domain

1. **Get your hosted zone ID** from Route 53
2. **Deploy with existing domain**:
   ```bash
   cd infrastructure
   ./deploy-scripts.sh existing-domain api.yourdomain.com Z1234567890ABC
   ```

## 📋 Step-by-Step Setup

### Step 1: Choose Your Domain Name

**Recommended naming patterns:**
- `api.yourdomain.com` - Clean and professional
- `keepa.yourdomain.com` - Service-specific
- `data.yourdomain.com` - Generic API domain

### Step 2: Domain Registration Options

#### Option A: Register with AWS Route 53 (Easiest)
```bash
# Check domain availability
aws route53domains check-domain-availability \
  --domain-name api.yourdomain.com \
  --profile app-dev-administrator

# Register domain (if available)
aws route53domains register-domain \
  --domain-name api.yourdomain.com \
  --duration-in-years 1 \
  --admin-contact file://contact.json \
  --registrant-contact file://contact.json \
  --tech-contact file://contact.json \
  --profile app-dev-administrator
```

#### Option B: Register with External Registrar
1. Register domain with your preferred registrar (Namecheap, GoDaddy, etc.)
2. Create hosted zone in Route 53
3. Update nameservers at your registrar

### Step 3: Deploy Your API with Custom Domain

#### For New Domain (Creates hosted zone automatically):
```bash
cd infrastructure
./deploy-scripts.sh new-domain api.yourdomain.com
```

#### For Existing Domain:
```bash
# First, get your hosted zone ID
aws route53 list-hosted-zones --profile app-dev-administrator

# Then deploy
./deploy-scripts.sh existing-domain api.yourdomain.com Z1234567890ABC
```

### Step 4: Update Nameservers (If Using External Registrar)

After deployment, the CDK will output nameservers:
```
NameServers: ns-123.awsdns-12.com, ns-456.awsdns-45.net, ...
```

Update these at your domain registrar.

## 🌟 After Deployment

### Your New URLs

Once deployed successfully, you'll have:

- **🌐 Main API**: `https://api.yourdomain.com`
- **🔍 Health Check**: `https://api.yourdomain.com/health`
- **⚡ API Base**: `https://api.yourdomain.com/api/keepa/`
- **📡 Webhook**: `https://api.yourdomain.com/api/keepa/webhook`

### SSL Certificate

- ✅ **Automatic SSL certificate** provisioned by AWS Certificate Manager
- ✅ **HTTP to HTTPS redirect** configured automatically
- ✅ **Certificate auto-renewal** handled by AWS

### API Endpoints

All your Keepa API endpoints will be available at:

```
https://api.yourdomain.com/api/keepa/product
https://api.yourdomain.com/api/keepa/query  
https://api.yourdomain.com/api/keepa/deals
https://api.yourdomain.com/api/keepa/bestsellers
https://api.yourdomain.com/api/keepa/search
https://api.yourdomain.com/api/keepa/seller
https://api.yourdomain.com/api/keepa/tracking
https://api.yourdomain.com/api/keepa/webhook
https://api.yourdomain.com/api/keepa/stats
https://api.yourdomain.com/api/keepa/token-status
https://api.yourdomain.com/api/keepa/category
```

## 🔧 Advanced Configuration

### Subdomain Options

You can use different subdomains for different purposes:

- `api.yourdomain.com` - Main API
- `webhook.yourdomain.com` - Webhook endpoint
- `docs.yourdomain.com` - API documentation

### Multiple Domains

The infrastructure supports multiple domains with Subject Alternative Names (SAN):
- Primary: `api.yourdomain.com`
- Alternative: `www.api.yourdomain.com`
- Alternative: `keepa.yourdomain.com`

## 🛠 Troubleshooting

### Common Issues

#### 1. SSL Certificate Pending Validation
```bash
# Check certificate status
aws acm list-certificates --profile app-dev-administrator
aws acm describe-certificate --certificate-arn arn:aws:acm:... --profile app-dev-administrator
```

#### 2. DNS Not Propagating
```bash
# Check DNS propagation
dig api.yourdomain.com
nslookup api.yourdomain.com
```

#### 3. Domain Not Resolving
- Verify nameservers are correctly set at registrar
- Check hosted zone configuration in Route 53
- DNS propagation can take up to 48 hours

### Verification Commands

```bash
# Test your new domain
curl -I https://api.yourdomain.com/health

# Check SSL certificate
openssl s_client -connect api.yourdomain.com:443 -servername api.yourdomain.com

# Test API endpoint
curl -X POST https://api.yourdomain.com/api/keepa/token-status \
  -H "Content-Type: application/json" \
  -d '{"apiKey": "your_api_key"}'
```

## 💰 Cost Considerations

### AWS Costs:
- **Route 53 Hosted Zone**: $0.50/month
- **Domain Registration**: $12-50/year (depending on TLD)
- **SSL Certificate**: FREE (AWS Certificate Manager)
- **Load Balancer**: ~$16/month (existing cost)

### Total Additional Cost: ~$6-10/month

## 🎯 Next Steps

1. **Register your domain**
2. **Deploy using the provided scripts**
3. **Update your API documentation** with new URLs
4. **Configure webhooks** in Keepa dashboard
5. **Set up monitoring** for your custom domain

## 📞 Support

If you encounter issues:
1. Check CloudFormation stack events in AWS Console
2. Review CDK deployment logs
3. Verify DNS configuration
4. Test SSL certificate validation

---

**🎉 Your Keepa API will be professional and production-ready with a custom domain!**
