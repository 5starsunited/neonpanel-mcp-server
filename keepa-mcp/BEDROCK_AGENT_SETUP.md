# Connecting Amazon Bedrock Agent to Keepa MCP Server

## 🤖 **Overview**
This guide shows how to connect an Amazon Bedrock Agent to your deployed Keepa MCP Server for Amazon marketplace analysis and product research.

## 📋 **Prerequisites**
- ✅ Deployed Keepa MCP Server (AWS ECS)
- ✅ Valid Keepa API key
- ✅ AWS Account with Bedrock access
- ✅ Bedrock Agent IAM permissions

## 🚀 **Step 1: Get Your API Endpoint**

After successful deployment, your CDK stack outputs will show:
```bash
# Get your endpoint URL
aws cloudformation describe-stacks \
  --stack-name KeepaServerStack \
  --query 'Stacks[0].Outputs[?OutputKey==`LoadBalancerURL`].OutputValue' \
  --output text
```

Example output: `http://keepa-alb-123456789.us-east-1.elb.amazonaws.com`

## 🔧 **Step 2: Create Bedrock Agent Action Group**

### Action Group Configuration:
- **Name**: `keepa-marketplace-analysis`
- **Description**: `Amazon marketplace product analysis and research tools`
- **Action Group Type**: `API Schema`
- **API Schema Format**: `OpenAPI 3.0`

### OpenAPI Schema Example:
```yaml
openapi: 3.0.0
info:
  title: Keepa Marketplace Analysis API
  description: Amazon marketplace product analysis and research
  version: 1.0.0
servers:
  - url: http://YOUR_ALB_URL/api/keepa
    description: Keepa MCP Server
paths:
  /product-lookup:
    post:
      summary: Get detailed product information
      operationId: lookupProduct
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                apiKey:
                  type: string
                  description: Keepa API key
                asin:
                  type: string
                  description: Amazon product ASIN
                domain:
                  type: integer
                  description: Amazon domain (1=US, 2=UK, 3=DE, etc.)
              required: [apiKey, asin, domain]
      responses:
        '200':
          description: Product information
  /price-history:
    post:
      summary: Get product price history
      operationId: getPriceHistory
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                apiKey:
                  type: string
                asin:
                  type: string
                domain:
                  type: integer
                range:
                  type: integer
                  description: Days of history to retrieve
              required: [apiKey, asin, domain]
      responses:
        '200':
          description: Price history data
  /sales-velocity:
    post:
      summary: Get sales velocity and rank data
      operationId: getSalesVelocity
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                apiKey:
                  type: string
                asin:
                  type: string
                domain:
                  type: integer
              required: [apiKey, asin, domain]
      responses:
        '200':
          description: Sales velocity data
```

## 🛠️ **Step 3: Configure Bedrock Agent**

### 3.1 Create the Agent:
```bash
aws bedrock-agent create-agent \
  --agent-name "keepa-marketplace-analyst" \
  --description "Amazon marketplace analysis agent with Keepa data" \
  --foundation-model "anthropic.claude-3-sonnet-20240229-v1:0" \
  --instruction "You are a marketplace analysis expert. Use Keepa tools to research Amazon products, analyze pricing trends, track sales velocity, and find profitable opportunities. Always include your Keepa API key in requests."
```

## 💬 **Step 4: Test Your Agent**

### Example Conversation:
```
User: "Analyze the iPhone 15 Pro pricing trends and find similar products"

Agent: I'll help you analyze iPhone 15 Pro pricing trends using Keepa data.
[Agent uses lookupProduct, getPriceHistory, and findProducts]

Response: Based on Keepa analysis:
- Current price: $999.99
- 30-day trend: Stable with minor fluctuations  
- Sales rank: #3 in Cell Phones
- Similar products: [List of alternatives]
```

## 🎯 **Use Cases**

1. **Product Research**: "Research gaming laptops under $1500"
2. **Competitive Analysis**: "Compare AirPods vs competing earbuds"
3. **Market Opportunities**: "Find kitchen appliances with declining prices"
4. **Price Monitoring**: "Track ASIN B08N5WRWNW price history"

## 🚨 **Important Notes**

1. **API Key Security**: Store Keepa API key in AWS Secrets Manager
2. **Rate Limiting**: Respect Keepa's API rate limits
3. **Cost Management**: Monitor Keepa token usage and AWS costs
4. **HTTPS**: Upgrade to HTTPS for production use

## 🎉 **You're Ready!**

Your Bedrock Agent can now:
- ✅ Analyze Amazon product data
- ✅ Track pricing trends  
- ✅ Research market opportunities
- ✅ Monitor competitive landscapes
- ✅ Provide data-driven insights

---
*Generated on: August 21, 2025*  
*Version: 1.0.0*
