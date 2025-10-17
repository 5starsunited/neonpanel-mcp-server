# Keepa MCP Server - API Documentation

## 🚀 **Live API Endpoint**
- **Custom Domain**: `http://mcp.neonasphera.com/api/keepa/`
- **Base URL**: `http://mcp.neonasphera.com`## 🔐 **Security**
- All requests require valid Keepa API key
- API runs on secure AWS infrastructure with custom domain
- Rate limiting applied per Keepa's terms
- Professional endpoint: `mcp.neonasphera.com`
- HTTPS upgrade available (load balancer configuration)

## 💻 **Usage Examples**

### cURL Example:
```bash
curl -X POST http://mcp.neonasphera.com/api/keepa/product-lookup 
  -H "Content-Type: application/json" 
  -d '{
    "apiKey": "your_keepa_api_key",
    "asin": "B08N5WRWNW",
    "domain": 1
  }'
```

### Python Example:
```python
import requests

url = "http://mcp.neonasphera.com/api/keepa/product-lookup"
data = {
    "apiKey": "your_keepa_api_key",
    "asin": "B08N5WRWNW", 
    "domain": 1
}

response = requests.post(url, json=data)
print(response.json())
```

### JavaScript Example:
```javascript
const response = await fetch('http://mcp.neonasphera.com/api/keepa/product-lookup', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    apiKey: 'your_keepa_api_key',
    asin: 'B08N5WRWNW',
    domain: 1
  })
});

const data = await response.json();
console.log(data);
``` URL**: `http://KeepaS-Keepa-oX1h97yGJJan-333729718.us-east-1.elb.amazonaws.com/api/keepa/`
- **Health Check**: `GET /health`
- **Authentication**: API key per request (in request body)

## 📋 **Available Endpoints**

### 1. **Token Status Check**
**Endpoint**: `POST /api/keepa/token-status`
```json
{
  "apiKey": "your_keepa_api_key"
}
```
**Response**: Token status and remaining requests

### 2. **Product Lookup**
**Endpoint**: `POST /api/keepa/product-lookup`
```json
{
  "apiKey": "your_keepa_api_key",
  "asin": "B08N5WRWNW",
  "domain": 1
}
```
**Response**: Detailed product information

### 3. **Batch Product Lookup** 
**Endpoint**: `POST /api/keepa/batch-product-lookup`
```json
{
  "apiKey": "your_keepa_api_key",
  "asins": ["B08N5WRWNW", "B07H8QMZPV"],
  "domain": 1
}
```
**Response**: Array of product information

### 4. **Price History**
**Endpoint**: `POST /api/keepa/price-history`
```json
{
  "apiKey": "your_keepa_api_key",
  "asin": "B08N5WRWNW",
  "domain": 1,
  "range": 365
}
```
**Response**: Historical price data

### 5. **Product Finder**
**Endpoint**: `POST /api/keepa/product-finder`
```json
{
  "apiKey": "your_keepa_api_key",
  "domain": 1,
  "selection": {
    "current_SALES": [1000, -1],
    "current_AMAZON": [1, 5000]
  }
}
```
**Response**: Products matching criteria

### 6. **Category Analysis**
**Endpoint**: `POST /api/keepa/category-analysis`
```json
{
  "apiKey": "your_keepa_api_key",
  "domain": 1,
  "category": 165793011
}
```
**Response**: Category statistics and trends

### 7. **Search Deals**
**Endpoint**: `POST /api/keepa/search-deals`
```json
{
  "apiKey": "your_keepa_api_key",
  "domain": 1,
  "dealType": "lightning"
}
```
**Response**: Current deals and promotions

### 8. **Best Sellers**
**Endpoint**: `POST /api/keepa/best-sellers`
```json
{
  "apiKey": "your_keepa_api_key",
  "domain": 1,
  "category": 165793011
}
```
**Response**: Best-selling products in category

### 9. **Sales Velocity**
**Endpoint**: `POST /api/keepa/sales-velocity`
```json
{
  "apiKey": "your_keepa_api_key",
  "asin": "B08N5WRWNW",
  "domain": 1
}
```
**Response**: Sales rank and velocity data

### 10. **Inventory Analysis**
**Endpoint**: `POST /api/keepa/inventory-analysis`
```json
{
  "apiKey": "your_keepa_api_key",
  "asin": "B08N5WRWNW",
  "domain": 1
}
```
**Response**: Stock levels and availability

### 11. **Seller Lookup**
**Endpoint**: `POST /api/keepa/seller-lookup`
```json
{
  "apiKey": "your_keepa_api_key",
  "seller": "A2L77EE7U53NWQ"
}
```
**Response**: Seller information and metrics

## 🔧 **Domain Codes**
- `1` = Amazon.com (US)
- `2` = Amazon.co.uk (UK)
- `3` = Amazon.de (Germany)
- `4` = Amazon.fr (France)
- `5` = Amazon.co.jp (Japan)
- `6` = Amazon.ca (Canada)
- `8` = Amazon.it (Italy)
- `9` = Amazon.es (Spain)

## 📊 **Response Format**
All endpoints return JSON responses with:
```json
{
  "success": true,
  "data": { /* API response data */ },
  "timestamp": "2025-08-21T16:00:00.000Z",
  "requestId": "uuid-v4-string"
}
```

## ❌ **Error Responses**
```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE",
  "timestamp": "2025-08-21T16:00:00.000Z",
  "requestId": "uuid-v4-string"
}
```

## 🔐 **Security**
- All requests require valid Keepa API key
- API runs on secure AWS infrastructure
- Rate limiting applied per Keepa's terms
- HTTPS upgrade available (load balancer configuration)

## �� **Usage Examples**

### cURL Example:
```bash
curl -X POST http://<ALB-DNS>/api/keepa/product-lookup \
curl -X POST http://KeepaS-Keepa-oX1h97yGJJan-333729718.us-east-1.elb.amazonaws.com/api/keepa/product-lookup \
  -H "Content-Type: application/json" \
  -d '{
    "apiKey": "your_keepa_api_key",
    "asin": "B08N5WRWNW",
    "domain": 1
  }'
```

### Python Example:
```python
import requests

url = "http://KeepaS-Keepa-oX1h97yGJJan-333729718.us-east-1.elb.amazonaws.com/api/keepa/product-lookup"
data = {
    "apiKey": "your_keepa_api_key",
    "asin": "B08N5WRWNW", 
    "domain": 1
}

response = requests.post(url, json=data)
print(response.json())
```

### JavaScript Example:
```javascript
const response = await fetch('http://KeepaS-Keepa-oX1h97yGJJan-333729718.us-east-1.elb.amazonaws.com/api/keepa/product-lookup', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    apiKey: 'your_keepa_api_key',
    asin: 'B08N5WRWNW',
    domain: 1
  })
});

const data = await response.json();
console.log(data);
```

## ✅ **Quick API Test**

Test if the API is responding:
```bash
# Health check
curl -I http://mcp.neonasphera.com/health

# Token status check  
curl -X POST http://mcp.neonasphera.com/api/keepa/token-status \
  -H "Content-Type: application/json" \
  -d '{"apiKey": "your_keepa_api_key"}'
```

Expected response for health check: `HTTP/1.1 200 OK`

---
*Generated on: August 22, 2025*  
*Version: 2.0.0 - Custom Domain Update*
*Custom Domain: mcp.neonasphera.com*
