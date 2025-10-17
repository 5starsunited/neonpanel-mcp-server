#!/usr/bin/env bash

#######################################
# NeonPanel MCP Server Comprehensive Test Suite
# 
# Tests all aspects of the MCP server including:
# - Health checks
# - OpenAPI endpoints
# - SSE transport
# - JSON-RPC protocol
# - MCP tool discovery
# - Authentication
# - Service provider API connectivity
#######################################

set -o pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
MCP_SERVER_URL="${MCP_SERVER_URL:-https://mcp.neonpanel.com}"
NEONPANEL_API_URL="${NEONPANEL_API_URL:-https://api.neonpanel.com}"
BEARER_TOKEN="${BEARER_TOKEN:-}"
TEST_COMPANY_UUID="${TEST_COMPANY_UUID:-}"

# Test results
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

#######################################
# Helper Functions
#######################################

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[✓]${NC} $1"
    ((TESTS_PASSED++))
}

log_error() {
    echo -e "${RED}[✗]${NC} $1"
    ((TESTS_FAILED++))
}

log_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

log_section() {
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

test_start() {
    ((TESTS_RUN++))
    log_info "Test $TESTS_RUN: $1"
}

test_http_status() {
    local url="$1"
    local expected_status="${2:-200}"
    local description="$3"
    
    test_start "$description"
    
    local status=$(curl -s -o /dev/null -w "%{http_code}" "$url")
    
    if [ "$status" = "$expected_status" ]; then
        log_success "HTTP $status (expected $expected_status)"
        return 0
    else
        log_error "HTTP $status (expected $expected_status)"
        return 1
    fi
}

test_http_status_with_auth() {
    local url="$1"
    local expected_status="${2:-200}"
    local description="$3"
    
    test_start "$description"
    
    if [ -z "$BEARER_TOKEN" ]; then
        log_warning "Skipped - BEARER_TOKEN not set"
        return 0
    fi
    
    local status=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $BEARER_TOKEN" "$url")
    
    if [ "$status" = "$expected_status" ]; then
        log_success "HTTP $status (expected $expected_status)"
        return 0
    else
        log_error "HTTP $status (expected $expected_status)"
        return 1
    fi
}

test_json_response() {
    local url="$1"
    local json_path="$2"
    local expected_value="$3"
    local description="$4"
    
    test_start "$description"
    
    local response=$(curl -s "$url")
    local actual_value=$(echo "$response" | jq -r "$json_path")
    
    if [ "$actual_value" = "$expected_value" ]; then
        log_success "Value: $actual_value"
        return 0
    else
        log_error "Expected: $expected_value, Got: $actual_value"
        echo "Full response: $response"
        return 1
    fi
}

test_json_property_exists() {
    local url="$1"
    local json_path="$2"
    local description="$3"
    
    test_start "$description"
    
    local response=$(curl -s "$url")
    local value=$(echo "$response" | jq -r "$json_path")
    
    if [ "$value" != "null" ] && [ -n "$value" ]; then
        log_success "Property exists: $value"
        return 0
    else
        log_error "Property missing or null"
        echo "Full response: $response"
        return 1
    fi
}

#######################################
# Test Suite
#######################################

print_banner() {
    echo ""
    echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║                                                                           ║${NC}"
    echo -e "${BLUE}║           ${GREEN}NeonPanel MCP Server Comprehensive Test Suite${BLUE}                 ║${NC}"
    echo -e "${BLUE}║                                                                           ║${NC}"
    echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    log_info "MCP Server URL: $MCP_SERVER_URL"
    log_info "NeonPanel API URL: $NEONPANEL_API_URL"
    log_info "Bearer Token: ${BEARER_TOKEN:+[SET]}${BEARER_TOKEN:-[NOT SET]}"
    log_info "Test Company UUID: ${TEST_COMPANY_UUID:-[NOT SET]}"
    echo ""
}

test_health_endpoint() {
    log_section "1. Health Check Tests"
    
    test_http_status "$MCP_SERVER_URL/healthz" 200 "Health endpoint responds"
    test_json_response "$MCP_SERVER_URL/healthz" ".status" "ok" "Health status is 'ok'"
    test_json_response "$MCP_SERVER_URL/healthz" ".service" "neonpanel-mcp" "Service name is correct"
    test_json_property_exists "$MCP_SERVER_URL/healthz" ".version" "Version is present"
    test_json_property_exists "$MCP_SERVER_URL/healthz" ".timestamp" "Timestamp is present"
    test_json_property_exists "$MCP_SERVER_URL/healthz" ".uptimeSeconds" "Uptime is present"
    test_json_property_exists "$MCP_SERVER_URL/healthz" ".openapi.source" "OpenAPI source is present"
    test_json_property_exists "$MCP_SERVER_URL/healthz" ".sse.activeConnections" "SSE connections count is present"
}

test_openapi_endpoints() {
    log_section "2. OpenAPI Specification Tests"
    
    test_http_status "$MCP_SERVER_URL/openapi.json" 200 "OpenAPI JSON endpoint responds"
    test_http_status "$MCP_SERVER_URL/openapi.yaml" 200 "OpenAPI YAML endpoint responds"
    
    test_start "OpenAPI JSON is valid JSON"
    if curl -s "$MCP_SERVER_URL/openapi.json" | jq . > /dev/null 2>&1; then
        log_success "Valid JSON"
    else
        log_error "Invalid JSON"
    fi
    
    test_json_property_exists "$MCP_SERVER_URL/openapi.json" ".openapi" "OpenAPI version is present"
    test_json_property_exists "$MCP_SERVER_URL/openapi.json" ".info.title" "API title is present"
    test_json_property_exists "$MCP_SERVER_URL/openapi.json" ".paths" "API paths are present"
    test_json_property_exists "$MCP_SERVER_URL/openapi.json" ".components" "Components are present"
}

test_sse_endpoint() {
    log_section "3. SSE Transport Tests"
    
    test_start "SSE endpoint accepts connections"
    local sse_response=$(timeout 2 curl -s -N -H "Accept: text/event-stream" "$MCP_SERVER_URL/sse" || true)
    
    if [ -n "$sse_response" ]; then
        log_success "SSE connection established"
    else
        log_warning "SSE connection timeout (expected for unauthenticated)"
    fi
    
    test_start "SSE endpoint requires authentication"
    local status=$(curl -s -o /dev/null -w "%{http_code}" -H "Accept: text/event-stream" "$MCP_SERVER_URL/sse")
    
    if [ "$status" = "401" ] || [ "$status" = "403" ]; then
        log_success "Authentication required (HTTP $status)"
    else
        log_warning "Unexpected status: HTTP $status"
    fi
}

test_jsonrpc_endpoint() {
    log_section "4. JSON-RPC 2.0 Protocol Tests"
    
    test_http_status "$MCP_SERVER_URL/messages" 405 "Messages endpoint rejects GET requests"
    
    test_start "JSON-RPC endpoint requires authentication"
    local status=$(curl -s -o /dev/null -w "%{http_code}" \
        -X POST \
        -H "Content-Type: application/json" \
        -d '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":1}' \
        "$MCP_SERVER_URL/messages")
    
    if [ "$status" = "401" ] || [ "$status" = "403" ]; then
        log_success "Authentication required (HTTP $status)"
    else
        log_warning "Unexpected status: HTTP $status"
    fi
    
    if [ -n "$BEARER_TOKEN" ]; then
        test_start "JSON-RPC: Initialize protocol"
        local response=$(curl -s \
            -X POST \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer $BEARER_TOKEN" \
            -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{}},"id":1}' \
            "$MCP_SERVER_URL/messages")
        
        local result=$(echo "$response" | jq -r '.result')
        if [ "$result" != "null" ] && [ -n "$result" ]; then
            log_success "Initialize successful"
            echo "Response: $response" | head -c 200
        else
            log_error "Initialize failed"
            echo "Response: $response"
        fi
    else
        log_warning "Skipping authenticated JSON-RPC tests - BEARER_TOKEN not set"
    fi
}

test_mcp_tools() {
    log_section "5. MCP Tool Discovery Tests"
    
    if [ -z "$BEARER_TOKEN" ]; then
        log_warning "Skipping MCP tool tests - BEARER_TOKEN not set"
        return 0
    fi
    
    test_start "List available tools"
    local response=$(curl -s \
        -X POST \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $BEARER_TOKEN" \
        -d '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":1}' \
        "$MCP_SERVER_URL/messages")
    
    local tools=$(echo "$response" | jq -r '.result.tools[]?.name' 2>/dev/null)
    local tool_count=$(echo "$tools" | grep -c "neonpanel\." || true)
    
    if [ "$tool_count" -gt 0 ]; then
        log_success "Found $tool_count NeonPanel tools"
        echo "$tools" | head -5
    else
        log_error "No tools found"
        echo "Response: $response"
    fi
    
    # Expected tools
    local expected_tools=(
        "neonpanel.listCompanies"
        "neonpanel.listReports"
        "neonpanel.listInventoryItems"
        "neonpanel.listWarehouses"
        "neonpanel.getWarehouseBalances"
        "neonpanel.getInventoryDetails"
        "neonpanel.getInventoryLandedCost"
        "neonpanel.getInventoryCogs"
        "neonpanel.getImportInstructions"
        "neonpanel.createDocuments"
        "neonpanel.createDocumentsByPdf"
        "neonpanel.checkImportStatus"
        "neonpanel.getRevenueAndCogs"
    )
    
    for tool in "${expected_tools[@]}"; do
        test_start "Tool registered: $tool"
        if echo "$tools" | grep -q "^$tool$"; then
            log_success "Tool found"
        else
            log_error "Tool missing"
        fi
    done
}

test_neonpanel_api() {
    log_section "6. NeonPanel API Service Provider Tests"
    
    if [ -z "$BEARER_TOKEN" ]; then
        log_warning "Skipping API tests - BEARER_TOKEN not set"
        return 0
    fi
    
    test_http_status_with_auth "$NEONPANEL_API_URL/api/v1/companies" 200 "List companies endpoint"
    test_http_status_with_auth "$NEONPANEL_API_URL/api/v1/reports" 200 "List reports endpoint"
    
    test_start "Companies API returns data"
    local response=$(curl -s -H "Authorization: Bearer $BEARER_TOKEN" "$NEONPANEL_API_URL/api/v1/companies")
    local data=$(echo "$response" | jq -r '.data')
    
    if [ "$data" != "null" ] && [ -n "$data" ]; then
        local count=$(echo "$response" | jq -r '.data | length')
        log_success "Returned $count companies"
    else
        log_error "No data returned"
        echo "Response: $response"
    fi
    
    if [ -n "$TEST_COMPANY_UUID" ]; then
        test_http_status_with_auth "$NEONPANEL_API_URL/api/v1/companies/$TEST_COMPANY_UUID/inventory-items" 200 "List inventory items"
        test_http_status_with_auth "$NEONPANEL_API_URL/api/v1/companies/$TEST_COMPANY_UUID/warehouses" 200 "List warehouses"
    else
        log_warning "Skipping company-specific tests - TEST_COMPANY_UUID not set"
    fi
}

test_mcp_tool_execution() {
    log_section "7. MCP Tool Execution Tests"
    
    if [ -z "$BEARER_TOKEN" ]; then
        log_warning "Skipping tool execution tests - BEARER_TOKEN not set"
        return 0
    fi
    
    test_start "Execute: neonpanel.listCompanies"
    local response=$(curl -s \
        -X POST \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $BEARER_TOKEN" \
        -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"neonpanel.listCompanies","arguments":{}},"id":2}' \
        "$MCP_SERVER_URL/messages")
    
    local result=$(echo "$response" | jq -r '.result')
    if [ "$result" != "null" ] && [ -n "$result" ]; then
        log_success "Tool executed successfully"
        echo "$response" | jq -C '.' | head -20
    else
        local error=$(echo "$response" | jq -r '.error.message')
        if [ -n "$error" ] && [ "$error" != "null" ]; then
            log_error "Tool execution failed: $error"
        else
            log_error "Tool execution failed"
        fi
        echo "Response: $response"
    fi
    
    test_start "Execute: neonpanel.listReports"
    local response=$(curl -s \
        -X POST \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $BEARER_TOKEN" \
        -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"neonpanel.listReports","arguments":{}},"id":3}' \
        "$MCP_SERVER_URL/messages")
    
    local result=$(echo "$response" | jq -r '.result')
    if [ "$result" != "null" ] && [ -n "$result" ]; then
        log_success "Tool executed successfully"
    else
        log_error "Tool execution failed"
        echo "Response: $response"
    fi
}

test_error_handling() {
    log_section "8. Error Handling Tests"
    
    test_start "Invalid JSON-RPC method"
    local response=$(curl -s \
        -X POST \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer ${BEARER_TOKEN:-invalid}" \
        -d '{"jsonrpc":"2.0","method":"invalid/method","params":{},"id":4}' \
        "$MCP_SERVER_URL/messages")
    
    local error=$(echo "$response" | jq -r '.error.code')
    if [ "$error" = "-32601" ]; then
        log_success "Method not found error returned correctly"
    else
        log_warning "Expected error code -32601, got: $error"
    fi
    
    test_start "Invalid tool name"
    if [ -n "$BEARER_TOKEN" ]; then
        local response=$(curl -s \
            -X POST \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer $BEARER_TOKEN" \
            -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"invalid.tool","arguments":{}},"id":5}' \
            "$MCP_SERVER_URL/messages")
        
        local error=$(echo "$response" | jq -r '.error')
        if [ "$error" != "null" ]; then
            log_success "Error returned for invalid tool"
        else
            log_error "No error returned for invalid tool"
        fi
    else
        log_warning "Skipped - BEARER_TOKEN not set"
    fi
}

test_cors_headers() {
    log_section "9. CORS and Security Headers Tests"
    
    test_start "CORS headers present"
    local headers=$(curl -s -I "$MCP_SERVER_URL/healthz")
    
    if echo "$headers" | grep -qi "access-control-allow-origin"; then
        log_success "CORS headers present"
    else
        log_warning "CORS headers not found"
    fi
    
    test_start "Content-Type headers"
    local content_type=$(curl -s -I "$MCP_SERVER_URL/healthz" | grep -i "content-type" | cut -d: -f2 | tr -d ' \r\n')
    
    if echo "$content_type" | grep -qi "application/json"; then
        log_success "Correct Content-Type: $content_type"
    else
        log_warning "Unexpected Content-Type: $content_type"
    fi
}

test_rate_limiting() {
    log_section "10. Rate Limiting Tests"
    
    test_start "Rate limiting (burst requests)"
    local success_count=0
    local total_requests=20
    
    for i in $(seq 1 $total_requests); do
        local status=$(curl -s -o /dev/null -w "%{http_code}" "$MCP_SERVER_URL/healthz")
        if [ "$status" = "200" ]; then
            ((success_count++))
        fi
    done
    
    if [ "$success_count" -eq "$total_requests" ]; then
        log_success "All $total_requests requests succeeded"
    elif [ "$success_count" -gt 0 ]; then
        log_warning "$success_count/$total_requests requests succeeded (rate limiting may be active)"
    else
        log_error "All requests failed"
    fi
}

print_summary() {
    log_section "Test Summary"
    
    echo ""
    echo -e "${BLUE}Total Tests Run:${NC} $TESTS_RUN"
    echo -e "${GREEN}Tests Passed:${NC}    $TESTS_PASSED"
    echo -e "${RED}Tests Failed:${NC}    $TESTS_FAILED"
    echo ""
    
    local pass_rate=0
    if [ "$TESTS_RUN" -gt 0 ]; then
        pass_rate=$((TESTS_PASSED * 100 / TESTS_RUN))
    fi
    
    echo -e "${BLUE}Pass Rate:${NC}       ${pass_rate}%"
    echo ""
    
    if [ "$TESTS_FAILED" -eq 0 ]; then
        echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════════════════╗${NC}"
        echo -e "${GREEN}║                                                                           ║${NC}"
        echo -e "${GREEN}║                          ✓ ALL TESTS PASSED ✓                            ║${NC}"
        echo -e "${GREEN}║                                                                           ║${NC}"
        echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════════════════╝${NC}"
        return 0
    else
        echo -e "${RED}╔═══════════════════════════════════════════════════════════════════════════╗${NC}"
        echo -e "${RED}║                                                                           ║${NC}"
        echo -e "${RED}║                        ✗ SOME TESTS FAILED ✗                             ║${NC}"
        echo -e "${RED}║                                                                           ║${NC}"
        echo -e "${RED}╚═══════════════════════════════════════════════════════════════════════════╝${NC}"
        return 1
    fi
}

print_usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Comprehensive test suite for NeonPanel MCP Server

OPTIONS:
    -u, --url URL           MCP Server URL (default: https://mcp.neonpanel.com)
    -a, --api-url URL       NeonPanel API URL (default: https://api.neonpanel.com)
    -t, --token TOKEN       Bearer token for authentication
    -c, --company UUID      Company UUID for testing
    -h, --help              Show this help message

ENVIRONMENT VARIABLES:
    MCP_SERVER_URL          MCP Server URL
    NEONPANEL_API_URL       NeonPanel API URL
    BEARER_TOKEN            Bearer token for authentication
    TEST_COMPANY_UUID       Company UUID for testing

EXAMPLES:
    # Basic health check (no auth required)
    $0

    # Full test with authentication
    $0 --token "your-token-here"

    # Test specific company endpoints
    $0 --token "your-token" --company "company-uuid"

    # Test against local development server
    $0 --url "http://localhost:3030"

EOF
}

#######################################
# Main
#######################################

main() {
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            -u|--url)
                MCP_SERVER_URL="$2"
                shift 2
                ;;
            -a|--api-url)
                NEONPANEL_API_URL="$2"
                shift 2
                ;;
            -t|--token)
                BEARER_TOKEN="$2"
                shift 2
                ;;
            -c|--company)
                TEST_COMPANY_UUID="$2"
                shift 2
                ;;
            -h|--help)
                print_usage
                exit 0
                ;;
            *)
                echo "Unknown option: $1"
                print_usage
                exit 1
                ;;
        esac
    done
    
    # Check dependencies
    if ! command -v curl &> /dev/null; then
        log_error "curl is required but not installed"
        exit 1
    fi
    
    if ! command -v jq &> /dev/null; then
        log_error "jq is required but not installed"
        exit 1
    fi
    
    # Run tests
    print_banner
    test_health_endpoint
    test_openapi_endpoints
    test_sse_endpoint
    test_jsonrpc_endpoint
    test_mcp_tools
    test_neonpanel_api
    test_mcp_tool_execution
    test_error_handling
    test_cors_headers
    test_rate_limiting
    print_summary
}

# Run main function
main "$@"
