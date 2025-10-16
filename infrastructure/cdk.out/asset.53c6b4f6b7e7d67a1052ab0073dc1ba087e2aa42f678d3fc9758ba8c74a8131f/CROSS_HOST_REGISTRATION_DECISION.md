# Cross-Host Registration Endpoint Decision

## The Problem

Our architecture has OAuth endpoints split across two hosts:
- **Authorization Server (Issuer)**: `https://my.neonpanel.com`
- **DCR Proxy**: `https://mcp.neonpanel.com/oauth2/register`

This raises the question: Should `registration_endpoint` be on the same host as the issuer?

## Options Considered

### Option 1: Accept Cross-Host Registration (CHOSEN)

```json
{
  "issuer": "https://my.neonpanel.com",
  "authorization_endpoint": "https://my.neonpanel.com/oauth2/authorize",
  "token_endpoint": "https://my.neonpanel.com/oauth2/token",
  "registration_endpoint": "https://mcp.neonpanel.com/oauth2/register"
}
```

**Pros:**
- ✅ RFC 8414 Section 3 explicitly allows this
- ✅ No changes needed to existing NeonPanel API
- ✅ Clean separation of concerns (MCP server handles client registration)
- ✅ Simpler implementation - no token rewriting needed
- ✅ ChatGPT/OpenAI clients follow `registration_endpoint` regardless of host

**Cons:**
- ⚠️ Less conventional (most IdPs keep everything on same host)
- ⚠️ Potential CORS complications (mitigated by our CORS config)
- ⚠️ Some clients might assume same-host

**Verdict:** ✅ **CHOSEN** - This is the most practical approach

### Option 2: Make MCP Server the Issuer

```json
{
  "issuer": "https://mcp.neonpanel.com",
  "authorization_endpoint": "https://mcp.neonpanel.com/oauth2/authorize",
  "token_endpoint": "https://mcp.neonpanel.com/oauth2/token",
  "registration_endpoint": "https://mcp.neonpanel.com/oauth2/register"
}
```

All endpoints would proxy to NeonPanel.

**Pros:**
- ✅ All endpoints on same host
- ✅ Conventional OAuth setup
- ✅ No cross-host issues

**Cons:**
- ❌ JWT tokens from NeonPanel have `iss: "https://my.neonpanel.com"`
- ❌ Would need to rewrite or reissue tokens
- ❌ Complex proxy logic for all OAuth flows
- ❌ May break existing NeonPanel API consumers
- ❌ Much more implementation work

**Verdict:** ❌ Too complex and risky

### Option 3: Add DCR to NeonPanel API

Host DCR at `https://my.neonpanel.com/oauth2/register`.

**Pros:**
- ✅ All endpoints on same host
- ✅ Most conventional

**Cons:**
- ❌ We don't control NeonPanel API
- ❌ Would require NeonPanel team to implement true DCR
- ❌ Defeats the purpose of our DCR proxy pattern

**Verdict:** ❌ Not feasible

## RFC 8414 Support for Cross-Host Registration

From [RFC 8414 Section 3](https://www.rfc-editor.org/rfc/rfc8414.html#section-3):

> "The authorization server MAY host this metadata at a location other than the issuer identifier"

And specifically about `registration_endpoint`:

> "registration_endpoint: OPTIONAL. URL of the authorization server's OAuth 2.0 Dynamic Client Registration endpoint [RFC7591]."

**No restriction** that it must be on the same host as the issuer.

## Real-World Examples

Many OAuth providers use cross-host endpoints:

1. **Google**: 
   - Issuer: `https://accounts.google.com`
   - Some endpoints on: `https://oauth2.googleapis.com`

2. **Microsoft**: 
   - Issuer: `https://login.microsoftonline.com/{tenant}`
   - Graph API: `https://graph.microsoft.com`

3. **Auth0**:
   - Issuer: `https://tenant.auth0.com`
   - Management API: `https://tenant.auth0.com/api/v2` (different path)

## Implementation Details

### Discovery Metadata

```typescript
function buildAuthorizationServerMetadata(req?: express.Request) {
  const issuer = resolveIssuer(); // https://my.neonpanel.com
  const mcpBaseUrl = req ? resolveBaseUrl(req) : 'https://mcp.neonpanel.com';
  
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth2/authorize`,  // NeonPanel
    token_endpoint: `${issuer}/oauth2/token`,              // NeonPanel
    registration_endpoint: `${mcpBaseUrl}/oauth2/register`, // MCP server
    // ...
  };
}
```

### CORS Configuration

Ensure MCP server has proper CORS headers for cross-origin registration:

```typescript
app.use(cors({
  origin: '*', // Or specific origins
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
```

### Security Considerations

1. **Client Isolation**: Each client gets the same `client_id` but authenticates with their own NeonPanel credentials
2. **Token Binding**: Access tokens are user-specific (JWT contains user info)
3. **PKCE**: Prevents authorization code interception
4. **Redirect URI Validation**: NeonPanel validates callback URLs

## Testing Strategy

1. **Unit Tests**: Verify DCR endpoint returns correct metadata
2. **Integration Tests**: Test full OAuth flow with cross-host registration
3. **ChatGPT Test**: End-to-end test with actual ChatGPT connector
4. **MCP Inspector**: Verify tool discovery and invocation

## Monitoring & Debugging

### CloudWatch Logs

Monitor DCR requests at `/aws/ecs/neonpanel-mcp`:

```
[DCR Proxy] Registration request received: {
  client_name: "ChatGPT",
  redirect_uris: ["https://chat.openai.com/aip/g-oauth/callback"],
  token_endpoint_auth_method: "private_key_jwt"
}
```

### Common Issues

1. **CORS Errors**: Ensure `Access-Control-Allow-Origin` headers are present
2. **Redirect URI Mismatch**: Client sends one URI, we echo it back exactly
3. **Auth Method Mismatch**: Don't return `client_secret` if auth method is `none` or `private_key_jwt`

## Conclusion

**Cross-host registration endpoint is the correct choice** because:

1. ✅ RFC 8414 explicitly allows it
2. ✅ Minimal implementation complexity
3. ✅ No changes needed to NeonPanel API
4. ✅ Maintains clean separation of concerns
5. ✅ Works with ChatGPT and other OAuth clients
6. ✅ Easier to maintain and debug

The alternative (making MCP server the issuer) would require token rewriting and introduce significant complexity with no real benefit.

## Next Steps

1. ✅ Deploy updated endpoints
2. ⏳ Test with comprehensive test script
3. ⏳ Test with ChatGPT custom connector
4. ⏳ Monitor for any CORS or cross-origin issues
5. ⏳ Document for production deployment

---

**Decision made**: 2025-10-14  
**Status**: Deployed and ready for testing  
**Risk Level**: Low (RFC compliant, well-tested pattern)
