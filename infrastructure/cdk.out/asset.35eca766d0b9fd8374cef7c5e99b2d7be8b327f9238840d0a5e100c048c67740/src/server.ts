import express, { Request, Response } from 'express';
import cors from 'cors';
import { getFreshCapabilities, getApiMetadata, clearSchemaCache, getCacheStatus } from './dynamic-capabilities';
import oauthEndpoints, { buildResourceMetadataUrl } from './oauth-endpoints.js';
import { registerExecRoute } from './routes/exec-route.js';

const app = express();
app.set('trust proxy', true);
app.use(cors());
app.use(express.json());
app.use('/', oauthEndpoints);

const NEONPANEL_BASE_URL = process.env.NEONPANEL_BASE_URL || 'https://my.neonpanel.com';

function attachAuthChallenge(res: Response, req: Request) {
  const metadataUrl = buildResourceMetadataUrl(req);
  if (!res.getHeader('WWW-Authenticate')) {
    res.setHeader('WWW-Authenticate', `Bearer realm="mcp", resource_metadata="${metadataUrl}"`);
  }
}

// Health
app.get('/health', async (_req, res) => {
  try {
    const metadata = await getApiMetadata();
    const cacheStatus = getCacheStatus();
    
    res.json({ 
      status: 'ok', 
      service: 'neonpanel-mcp', 
      baseUrl: NEONPANEL_BASE_URL,
      api: metadata,
      cache: cacheStatus,
      ts: new Date().toISOString() 
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      status: 'error',
      service: 'neonpanel-mcp',
      baseUrl: NEONPANEL_BASE_URL,
      error: errorMessage,
      ts: new Date().toISOString()
    });
  }
});

// MCP Protocol Endpoints
app.get('/mcp/info', async (_req, res) => {
  try {
    const metadata = await getApiMetadata();
    
    res.json({
      name: 'neonpanel-mcp',
      version: '1.0.0',
      description: 'NeonPanel MCP Server for inventory, finance, and integrated services',
      capabilities: {
        tools: true,
        resources: false,
        prompts: false
      },
      server: {
        protocol: 'http',
        endpoints: {
          health: '/health',
          info: '/mcp/info',
          capabilities: '/mcp/capabilities',
          exec: '/exec',
          refresh: '/mcp/refresh'
        }
      },
      api: metadata,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      error: 'MCP_INFO_ERROR',
      message: errorMessage,
      timestamp: new Date().toISOString()
    });
  }
});

app.get('/mcp/capabilities', async (_req, res) => {
  try {
    console.log('📡 MCP Capabilities endpoint called - fetching fresh data');
    const capabilities = await getFreshCapabilities();
    
    res.json({
      capabilities: capabilities,
      metadata: {
        source: 'https://my.neonpanel.com/api/v1/scheme',
        generated: new Date().toISOString(),
        total_capabilities: capabilities.length,
        total_actions: capabilities.reduce((sum, cap) => sum + cap.actions.length, 0)
      }
    });
  } catch (error) {
    console.error('❌ Error fetching capabilities:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      error: 'MCP_CAPABILITIES_ERROR',
      message: errorMessage,
      timestamp: new Date().toISOString()
    });
  }
});

// MCP Refresh endpoint - force refresh of capabilities
app.post('/mcp/refresh', async (_req, res) => {
  try {
    console.log('🔄 MCP Refresh endpoint called - clearing cache and fetching fresh data');
    clearSchemaCache();
    const capabilities = await getFreshCapabilities();
    const metadata = await getApiMetadata();
    
    res.json({
      success: true,
      message: 'Capabilities refreshed successfully',
      capabilities: capabilities,
      metadata: metadata,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error refreshing capabilities:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      success: false,
      error: 'MCP_REFRESH_ERROR',
      message: errorMessage,
      timestamp: new Date().toISOString()
    });
  }
});

// MCP OAuth configuration endpoint
app.get('/mcp/oauth/config', (_req, res) => {
  res.json({
    authorization_url: `${NEONPANEL_BASE_URL}/oauth/authorize`,
    token_url: `${NEONPANEL_BASE_URL}/oauth/token`,
    scopes: ['read:inventory', 'read:analytics', 'read:companies', 'read:reports', 'read:warehouses', 'read:revenue', 'read:cogs', 'read:landed-cost', 'write:import'],
    client_id: 'mcp-client'
  });
});

registerExecRoute(app, {
  neonpanelBaseUrl: NEONPANEL_BASE_URL,
  attachAuthChallenge
});

const PORT = process.env.PORT || 3030;
if (require.main === module) {
  app.listen(PORT, async () => {
    console.log(`🚀 NeonPanel MCP HTTP server running on :${PORT}`);
    console.log(`📊 Health: http://localhost:${PORT}/health`);
    console.log(`ℹ️  Info: http://localhost:${PORT}/mcp/info`);
    console.log(`🔧 Capabilities: http://localhost:${PORT}/mcp/capabilities`);
    console.log(`🔄 Refresh: POST http://localhost:${PORT}/mcp/refresh`);
    console.log(`⚡ Exec: POST http://localhost:${PORT}/exec { action, args } (Authorization: Bearer <token>)`);
    
    // Pre-load capabilities on startup
    try {
      console.log('🔄 Pre-loading capabilities from NeonPanel API...');
      const capabilities = await getFreshCapabilities();
      console.log(`✅ Loaded ${capabilities.length} capabilities with ${capabilities.reduce((sum, cap) => sum + cap.actions.length, 0)} total actions`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.warn('⚠️ Failed to pre-load capabilities:', errorMessage);
    }
  });
}

export default app;
