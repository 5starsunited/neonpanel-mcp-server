#!/bin/bash

echo "🌐 Keepa API Custom Domain Deployment Scripts"
echo "=============================================="
echo

# Function to deploy without custom domain (current setup)
deploy_without_domain() {
    echo "📦 Deploying Keepa API without custom domain..."
    npx cdk deploy --profile app-dev-administrator --require-approval never
}

# Function to deploy with a new domain (creates hosted zone)
deploy_with_new_domain() {
    local domain_name=$1
    if [ -z "$domain_name" ]; then
        echo "❌ Error: Please provide a domain name"
        echo "Usage: ./deploy-scripts.sh new-domain your-domain.com"
        exit 1
    fi
    
    echo "🆕 Deploying Keepa API with NEW domain: $domain_name"
    echo "   This will create a new hosted zone and SSL certificate"
    
    DOMAIN_NAME=$domain_name CREATE_HOSTED_ZONE=true \
    npx cdk deploy --app "npx ts-node deploy-with-domain.ts" \
    --profile app-dev-administrator --require-approval never
}

# Function to deploy with existing domain (uses existing hosted zone)
deploy_with_existing_domain() {
    local domain_name=$1
    local hosted_zone_id=$2
    
    if [ -z "$domain_name" ] || [ -z "$hosted_zone_id" ]; then
        echo "❌ Error: Please provide domain name and hosted zone ID"
        echo "Usage: ./deploy-scripts.sh existing-domain your-domain.com Z1234567890ABC"
        exit 1
    fi
    
    echo "🔄 Deploying Keepa API with EXISTING domain: $domain_name"
    echo "   Using hosted zone ID: $hosted_zone_id"
    
    DOMAIN_NAME=$domain_name HOSTED_ZONE_ID=$hosted_zone_id \
    npx cdk deploy --app "npx ts-node deploy-with-domain.ts" \
    --profile app-dev-administrator --require-approval never
}

# Main script logic
case "$1" in
    "no-domain"|"current")
        deploy_without_domain
        ;;
    "new-domain")
        deploy_with_new_domain "$2"
        ;;
    "existing-domain")
        deploy_with_existing_domain "$2" "$3"
        ;;
    "help"|"--help"|"-h")
        echo "Available commands:"
        echo "  no-domain                           - Deploy without custom domain (current setup)"
        echo "  new-domain <domain.com>             - Deploy with new domain (creates hosted zone)"
        echo "  existing-domain <domain.com> <id>   - Deploy with existing domain and hosted zone"
        echo
        echo "Examples:"
        echo "  ./deploy-scripts.sh no-domain"
        echo "  ./deploy-scripts.sh new-domain api.keepa-tools.com"
        echo "  ./deploy-scripts.sh existing-domain api.keepa-tools.com Z1234567890ABC"
        ;;
    *)
        echo "❌ Unknown command: $1"
        echo "Use './deploy-scripts.sh help' for available options"
        exit 1
        ;;
esac
