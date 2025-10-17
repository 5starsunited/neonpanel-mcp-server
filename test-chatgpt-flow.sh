#!/bin/bash

#==============================================================================
# ChatGPT MCP Flow Simulator
# Simulates the complete ChatGPT MCP Connector flow end-to-end
#==============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
MCP_SERVER="https://mcp.neonpanel.com"
OAUTH_SERVER="https://my.neonpanel.com"
CLIENT_ID="${CLIENT_ID:-}" # Set from environment or prompt
CLIENT_SECRET="${CLIENT_SECRET:-}" # Set from environment or prompt
REDIRECT_URI="https://chat.openai.com/aip/g/callback"

# Test state
STEP=0
TOTAL_STEPS=10
ACCESS_TOKEN=""
SERVER_VERSION=""
TOOL_COUNT=0

#==============================================================================
# Utility Functions
#==============================================================================

print_header() {
    echo ""
    echo -e "${CYAN}=============================================================================${NC}"
    echo -e "${CYAN}  $1${NC}"
    echo -e "${CYAN}=============================================================================${NC}"
    echo ""
}

print_step() {
    STEP=$((STEP + 1))
    echo ""
    echo -e "${BLUE}[Step $STEP/$TOTAL_STEPS] $1${NC}"
    echo -e "${BLUE}─────────────────────────────────────────────────────────────────────────${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_info() {
    echo -e "  $1"
}

check_dependencies() {
    print_step "Checking dependencies"
    
    local missing=0
    
    if ! command -v curl &> /dev/null; then
        print_error "curl not found"
        missing=1
    else
        print_success "curl found"
    fi
    
    if ! command -v jq &> /dev/null; then
        print_error "jq not found (required for JSON parsing)"
        missing=1
    else
        print_success "jq found"
    fi
    
    if ! command -v base64 &> /dev/null; then
        print_error "base64 not found"
        missing=1
    else
        print_success "base64 found"
    fi
    
    if ! command -v openssl &> /dev/null; then
        print_error "openssl not found"
        missing=1
    else
        print_success "openssl found"
    fi
    
    if [ $missing -eq 1 ]; then
        print_error "Missing required dependencies"
        exit 1
    fi
}

#==============================================================================
# Phase 1: Discovery (No Authentication)
#==============================================================================

test_mcp_health() {
    print_step "Testing MCP server health"
    
    local response=$(curl -s "${MCP_SERVER}/healthz")
    
    # Check if response is valid JSON
    if ! echo "$response" | jq empty 2>/dev/null; then
        print_error "Invalid JSON response from health endpoint"
        print_info "Response: $response"
        return 1
    fi
    
    local status=$(echo "$response" | jq -r '.status // "unknown"')
    local version=$(echo "$response" | jq -r '.version // "unknown"')
    local service=$(echo "$response" | jq -r '.service // "unknown"')
    
    if [ "$status" = "ok" ]; then
        print_success "MCP server is healthy"
        print_info "Service: $service"
        print_info "Version: $version"
        return 0
    else
        print_error "MCP server health check failed"
        print_info "Response: $response"
        return 1
    fi
}

test_initialize() {
    print_step "Testing MCP initialize (public, no auth)"
    
    local payload='{
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {
                "name": "chatgpt-mcp-connector",
                "version": "1.0.0"
            }
        }
    }'
    
    local response=$(curl -s -X POST "${MCP_SERVER}/messages" \
        -H "Content-Type: application/json" \
        -d "$payload")
    
    # Check if response is valid JSON
    if ! echo "$response" | jq empty 2>/dev/null; then
        print_error "Invalid JSON response"
        print_info "Response: $response"
        return 1
    fi
    
    # Extract server info
    SERVER_VERSION=$(echo "$response" | jq -r '.result.serverInfo.version // "unknown"')
    local server_name=$(echo "$response" | jq -r '.result.serverInfo.name // "unknown"')
    local protocol_version=$(echo "$response" | jq -r '.result.protocolVersion // "unknown"')
    
    if [ "$SERVER_VERSION" != "unknown" ]; then
        print_success "Initialize successful"
        print_info "Server: $server_name"
        print_info "Version: $SERVER_VERSION"
        print_info "Protocol: $protocol_version"
        return 0
    else
        print_error "Initialize failed - invalid response"
        print_info "Response: $response"
        return 1
    fi
}

test_tools_list_public() {
    print_step "Testing tools/list (public, no auth)"
    
    local payload='{
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/list"
    }'
    
    local response=$(curl -s -X POST "${MCP_SERVER}/messages" \
        -H "Content-Type: application/json" \
        -d "$payload")
    
    # Check if response is valid JSON
    if ! echo "$response" | jq empty 2>/dev/null; then
        print_error "Invalid JSON response"
        print_info "Response: $response"
        return 1
    fi
    
    # Count tools
    TOOL_COUNT=$(echo "$response" | jq -r '.result.tools | length // 0')
    
    if [ "$TOOL_COUNT" -gt 0 ]; then
        print_success "Tools list retrieved successfully"
        print_info "Tool count: $TOOL_COUNT"
        
        # Show first 3 tools
        echo ""
        print_info "Sample tools:"
        echo "$response" | jq -r '.result.tools[0:3] | .[] | "  - \(.name): \(.description)"'
        
        return 0
    else
        print_error "No tools found"
        print_info "Response: $response"
        return 1
    fi
}

#==============================================================================
# Phase 2: OAuth Discovery
#==============================================================================

test_oauth_discovery() {
    print_step "Testing OAuth discovery endpoint"
    
    local response=$(curl -s "${OAUTH_SERVER}/.well-known/oauth-authorization-server")
    
    # Check if response is valid JSON
    if ! echo "$response" | jq empty 2>/dev/null; then
        print_error "Invalid JSON response from discovery endpoint"
        print_info "Response: $response"
        return 1
    fi
    
    local issuer=$(echo "$response" | jq -r '.issuer // "unknown"')
    local auth_endpoint=$(echo "$response" | jq -r '.authorization_endpoint // "unknown"')
    local token_endpoint=$(echo "$response" | jq -r '.token_endpoint // "unknown"')
    
    if [ "$issuer" != "unknown" ]; then
        print_success "OAuth discovery successful"
        print_info "Issuer: $issuer"
        print_info "Authorization: $auth_endpoint"
        print_info "Token: $token_endpoint"
        return 0
    else
        print_error "OAuth discovery failed"
        print_info "Response: $response"
        return 1
    fi
}

#==============================================================================
# Phase 3: Client Registration (DCR)
#==============================================================================

get_client_credentials() {
    print_step "Getting client credentials"
    
    # Check if credentials are in environment
    if [ -n "$CLIENT_ID" ] && [ -n "$CLIENT_SECRET" ]; then
        print_success "Using credentials from environment"
        print_info "Client ID: $CLIENT_ID"
        print_info "Client Secret: ${CLIENT_SECRET:0:10}..."
        return 0
    fi
    
    # Check if credentials file exists
    if [ -f "chatgpt-client-credentials.json" ]; then
        print_info "Found credentials file: chatgpt-client-credentials.json"
        CLIENT_ID=$(jq -r '.client_id' chatgpt-client-credentials.json)
        CLIENT_SECRET=$(jq -r '.client_secret' chatgpt-client-credentials.json)
        
        if [ -n "$CLIENT_ID" ] && [ -n "$CLIENT_SECRET" ]; then
            print_success "Loaded credentials from file"
            print_info "Client ID: $CLIENT_ID"
            print_info "Client Secret: ${CLIENT_SECRET:0:10}..."
            return 0
        fi
    fi
    
    # Prompt for manual input
    print_warning "No client credentials found"
    print_info "You can either:"
    print_info "  1. Run './register-chatgpt-client.sh' to register a new client"
    print_info "  2. Set CLIENT_ID and CLIENT_SECRET environment variables"
    print_info "  3. Enter credentials manually now"
    echo ""
    read -p "Do you want to enter credentials manually? (y/n): " answer
    
    if [ "$answer" = "y" ] || [ "$answer" = "Y" ]; then
        read -p "Client ID: " CLIENT_ID
        read -s -p "Client Secret: " CLIENT_SECRET
        echo ""
        print_success "Credentials entered"
        return 0
    else
        print_error "Cannot proceed without client credentials"
        return 1
    fi
}

#==============================================================================
# Phase 4: PKCE Preparation
#==============================================================================

generate_pkce() {
    print_step "Generating PKCE challenge"
    
    # Generate code_verifier (43-128 characters, base64url encoded)
    CODE_VERIFIER=$(openssl rand -base64 32 | tr -d '=' | tr '+/' '-_')
    
    # Generate code_challenge (SHA256 hash of verifier, base64url encoded)
    CODE_CHALLENGE=$(echo -n "$CODE_VERIFIER" | openssl dgst -sha256 -binary | base64 | tr -d '=' | tr '+/' '-_')
    
    print_success "PKCE challenge generated"
    print_info "Code Verifier: ${CODE_VERIFIER:0:20}..."
    print_info "Code Challenge: ${CODE_CHALLENGE:0:20}..."
    
    export CODE_VERIFIER
    export CODE_CHALLENGE
}

#==============================================================================
# Phase 5: Authorization Request (Manual Step)
#==============================================================================

build_authorization_url() {
    print_step "Building authorization URL"
    
    local state=$(openssl rand -hex 16)
    
    # Build authorization URL
    local auth_url="${OAUTH_SERVER}/oauth2/authorize"
    auth_url="${auth_url}?client_id=${CLIENT_ID}"
    auth_url="${auth_url}&redirect_uri=${REDIRECT_URI}"
    auth_url="${auth_url}&response_type=code"
    auth_url="${auth_url}&scope=dcr.create"
    auth_url="${auth_url}&state=${state}"
    auth_url="${auth_url}&code_challenge=${CODE_CHALLENGE}"
    auth_url="${auth_url}&code_challenge_method=S256"
    
    print_success "Authorization URL built"
    echo ""
    print_warning "MANUAL STEP REQUIRED"
    print_info "Copy this URL and open it in a browser:"
    echo ""
    echo -e "${CYAN}${auth_url}${NC}"
    echo ""
    print_info "After authorization, you will be redirected to:"
    print_info "${REDIRECT_URI}?code=AUTHORIZATION_CODE&state=${state}"
    echo ""
    print_info "The authorization code will be in the 'code' parameter"
    echo ""
    
    export AUTH_STATE="$state"
}

#==============================================================================
# Phase 6: Token Exchange
#==============================================================================

exchange_token() {
    print_step "Exchanging authorization code for access token"
    
    if [ -z "$1" ]; then
        print_warning "No authorization code provided"
        read -p "Enter authorization code: " auth_code
    else
        auth_code="$1"
    fi
    
    print_info "Exchanging code: ${auth_code:0:20}..."
    
    local response=$(curl -s -X POST "${OAUTH_SERVER}/oauth2/token" \
        -H "Content-Type: application/x-www-form-urlencoded" \
        -u "${CLIENT_ID}:${CLIENT_SECRET}" \
        -d "grant_type=authorization_code" \
        -d "code=${auth_code}" \
        -d "redirect_uri=${REDIRECT_URI}" \
        -d "code_verifier=${CODE_VERIFIER}")
    
    # Check if response is valid JSON
    if ! echo "$response" | jq empty 2>/dev/null; then
        print_error "Invalid JSON response from token endpoint"
        print_info "Response: $response"
        return 1
    fi
    
    # Check for error
    local error=$(echo "$response" | jq -r '.error // empty')
    if [ -n "$error" ]; then
        local error_desc=$(echo "$response" | jq -r '.error_description // "No description"')
        print_error "Token exchange failed: $error"
        print_info "Description: $error_desc"
        return 1
    fi
    
    # Extract access token
    ACCESS_TOKEN=$(echo "$response" | jq -r '.access_token // empty')
    local token_type=$(echo "$response" | jq -r '.token_type // "unknown"')
    local expires_in=$(echo "$response" | jq -r '.expires_in // "unknown"')
    
    if [ -n "$ACCESS_TOKEN" ]; then
        print_success "Token exchange successful"
        print_info "Token Type: $token_type"
        print_info "Expires In: $expires_in seconds"
        print_info "Access Token: ${ACCESS_TOKEN:0:30}..."
        
        # Decode and display token claims
        decode_jwt "$ACCESS_TOKEN"
        
        return 0
    else
        print_error "No access token in response"
        print_info "Response: $response"
        return 1
    fi
}

decode_jwt() {
    local token="$1"
    
    # Split token into parts
    local header=$(echo "$token" | cut -d. -f1)
    local payload=$(echo "$token" | cut -d. -f2)
    
    # Decode header and payload (add padding if needed)
    local header_decoded=$(echo "$header=" | base64 -d 2>/dev/null | jq -c)
    local payload_decoded=$(echo "$payload=" | base64 -d 2>/dev/null | jq)
    
    echo ""
    print_info "JWT Header:"
    echo "$header_decoded" | jq .
    
    echo ""
    print_info "JWT Payload:"
    echo "$payload_decoded" | jq .
}

#==============================================================================
# Phase 7: Authenticated MCP Calls
#==============================================================================

test_tools_call_authenticated() {
    print_step "Testing tools/call with authentication"
    
    if [ -z "$ACCESS_TOKEN" ]; then
        print_error "No access token available"
        return 1
    fi
    
    # Try to call a simple tool: neonpanel.listCompanies
    local payload='{
        "jsonrpc": "2.0",
        "id": 3,
        "method": "tools/call",
        "params": {
            "name": "neonpanel.listCompanies",
            "arguments": {
                "page": 1,
                "perPage": 10
            }
        }
    }'
    
    local response=$(curl -s -X POST "${MCP_SERVER}/messages" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer ${ACCESS_TOKEN}" \
        -d "$payload")
    
    # Check if response is valid JSON
    if ! echo "$response" | jq empty 2>/dev/null; then
        print_error "Invalid JSON response"
        print_info "Response: $response"
        return 1
    fi
    
    # Check for error
    local error=$(echo "$response" | jq -r '.error // empty')
    if [ -n "$error" ]; then
        local error_msg=$(echo "$response" | jq -r '.error.message // "Unknown error"')
        print_error "Tool call failed: $error_msg"
        print_info "Full response:"
        echo "$response" | jq .
        return 1
    fi
    
    # Check for result
    local result=$(echo "$response" | jq -r '.result // empty')
    if [ -n "$result" ]; then
        print_success "Tool call successful!"
        
        # Try to extract data
        local company_count=$(echo "$response" | jq -r '.result.content[0].text | fromjson | .data | length // 0' 2>/dev/null || echo "0")
        
        if [ "$company_count" -gt 0 ]; then
            print_info "Retrieved $company_count companies"
            echo ""
            print_info "Sample response:"
            echo "$response" | jq '.result.content[0].text | fromjson | .data[0]' 2>/dev/null || echo "$response" | jq '.result' | head -20
        else
            print_info "Response:"
            echo "$response" | jq '.result'
        fi
        
        return 0
    else
        print_error "No result in response"
        print_info "Response: $response"
        return 1
    fi
}

#==============================================================================
# Summary and Report
#==============================================================================

generate_report() {
    print_header "TEST SUMMARY"
    
    echo -e "${CYAN}Server Information:${NC}"
    echo "  MCP Server: $MCP_SERVER"
    echo "  OAuth Server: $OAUTH_SERVER"
    echo "  Server Version: $SERVER_VERSION"
    echo "  Tools Available: $TOOL_COUNT"
    echo ""
    
    echo -e "${CYAN}Test Results:${NC}"
    echo "  ✓ MCP Health Check"
    echo "  ✓ Initialize (Public)"
    echo "  ✓ Tools List (Public)"
    echo "  ✓ OAuth Discovery"
    
    if [ -n "$ACCESS_TOKEN" ]; then
        echo "  ✓ Client Registration"
        echo "  ✓ PKCE Generation"
        echo "  ✓ Token Exchange"
        echo "  ✓ Authenticated Tool Call"
        echo ""
        echo -e "${GREEN}✓ FULL FLOW COMPLETED SUCCESSFULLY${NC}"
    else
        echo "  ⚠ Authorization (Manual Step Required)"
        echo ""
        echo -e "${YELLOW}⚠ PARTIAL FLOW COMPLETED${NC}"
        echo -e "${YELLOW}  Manual authorization step pending${NC}"
    fi
    
    echo ""
    echo -e "${CYAN}Next Steps:${NC}"
    if [ -z "$ACCESS_TOKEN" ]; then
        echo "  1. Complete the authorization in browser"
        echo "  2. Run script again with authorization code:"
        echo "     ./test-chatgpt-flow.sh --auth-code YOUR_CODE"
    else
        echo "  ✓ Integration is fully functional"
        echo "  You can now use ChatGPT MCP Connector"
    fi
    echo ""
}

#==============================================================================
# Main Flow
#==============================================================================

main() {
    print_header "ChatGPT MCP Flow Simulator"
    
    echo "This script simulates the complete ChatGPT MCP Connector flow:"
    echo "  1. Discovery (public, no auth)"
    echo "  2. OAuth discovery"
    echo "  3. Client registration"
    echo "  4. PKCE generation"
    echo "  5. Authorization (manual)"
    echo "  6. Token exchange"
    echo "  7. Authenticated tool execution"
    echo ""
    
    # Parse command line arguments
    AUTH_CODE=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --auth-code)
                AUTH_CODE="$2"
                shift 2
                ;;
            --client-id)
                CLIENT_ID="$2"
                shift 2
                ;;
            --client-secret)
                CLIENT_SECRET="$2"
                shift 2
                ;;
            --help)
                echo "Usage: $0 [OPTIONS]"
                echo ""
                echo "Options:"
                echo "  --auth-code CODE       Authorization code from OAuth flow"
                echo "  --client-id ID         OAuth client ID"
                echo "  --client-secret SECRET OAuth client secret"
                echo "  --help                 Show this help"
                echo ""
                echo "Environment variables:"
                echo "  CLIENT_ID              OAuth client ID"
                echo "  CLIENT_SECRET          OAuth client secret"
                exit 0
                ;;
            *)
                print_error "Unknown option: $1"
                echo "Use --help for usage information"
                exit 1
                ;;
        esac
    done
    
    # Run tests
    check_dependencies || exit 1
    
    # Phase 1: Public Discovery
    test_mcp_health || exit 1
    test_initialize || exit 1
    test_tools_list_public || exit 1
    
    # Phase 2: OAuth Discovery
    test_oauth_discovery || exit 1
    
    # Phase 3: Get credentials
    get_client_credentials || exit 1
    
    # Phase 4: PKCE
    generate_pkce
    
    # Phase 5: Authorization URL
    build_authorization_url
    
    # Phase 6: Token Exchange (if auth code provided)
    if [ -n "$AUTH_CODE" ]; then
        exchange_token "$AUTH_CODE" || exit 1
        
        # Phase 7: Authenticated calls
        test_tools_call_authenticated || exit 1
    else
        print_warning "Skipping token exchange (no authorization code)"
        print_info "Run script with --auth-code after completing authorization"
    fi
    
    # Summary
    generate_report
}

# Run main
main "$@"
