import express from 'express';
import cors from 'cors';
import { KeepaClient } from './keepa-client';
import { 
  KeepaTools,
  ProductLookupSchema,
  BatchProductLookupSchema,
  DealSearchSchema,
  SellerLookupSchema,
  BestSellersSchema,
  PriceHistorySchema,
  ProductFinderSchema,
  CategoryAnalysisSchema,
  SalesVelocitySchema,
  InventoryAnalysisSchema,
  TokenStatusSchema,
} from './tools';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Error handling middleware
const asyncHandler = (fn: Function) => (req: express.Request, res: express.Response, next: express.NextFunction) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Health check endpoint
app.get('/health', (req: express.Request, res: express.Response) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Keepa API endpoints - user provides API key in request body
app.post('/api/keepa/product-lookup', asyncHandler(async (req: express.Request, res: express.Response) => {
  const { apiKey, ...params } = req.body;
  if (!apiKey) {
    return res.status(400).json({ error: 'apiKey is required in request body' });
  }
  
  const keepaClient = new KeepaClient({ apiKey });
  const keepaTools = new KeepaTools(keepaClient);
  
  const result = await keepaTools.lookupProduct(ProductLookupSchema.parse(params));
  res.json({ result });
}));

app.post('/api/keepa/batch-product-lookup', asyncHandler(async (req: express.Request, res: express.Response) => {
  const { apiKey, ...params } = req.body;
  if (!apiKey) {
    return res.status(400).json({ error: 'apiKey is required in request body' });
  }
  
  const keepaClient = new KeepaClient({ apiKey });
  const keepaTools = new KeepaTools(keepaClient);
  
  const result = await keepaTools.batchLookupProducts(BatchProductLookupSchema.parse(params));
  res.json({ result });
}));

app.post('/api/keepa/search-deals', asyncHandler(async (req: express.Request, res: express.Response) => {
  const { apiKey, ...params } = req.body;
  if (!apiKey) {
    return res.status(400).json({ error: 'apiKey is required in request body' });
  }
  
  const keepaClient = new KeepaClient({ apiKey });
  const keepaTools = new KeepaTools(keepaClient);
  
  const result = await keepaTools.searchDeals(DealSearchSchema.parse(params));
  res.json({ result });
}));

app.post('/api/keepa/seller-lookup', asyncHandler(async (req: express.Request, res: express.Response) => {
  const { apiKey, ...params } = req.body;
  if (!apiKey) {
    return res.status(400).json({ error: 'apiKey is required in request body' });
  }
  
  const keepaClient = new KeepaClient({ apiKey });
  const keepaTools = new KeepaTools(keepaClient);
  
  const result = await keepaTools.lookupSeller(SellerLookupSchema.parse(params));
  res.json({ result });
}));

app.post('/api/keepa/best-sellers', asyncHandler(async (req: express.Request, res: express.Response) => {
  const { apiKey, ...params } = req.body;
  if (!apiKey) {
    return res.status(400).json({ error: 'apiKey is required in request body' });
  }
  
  const keepaClient = new KeepaClient({ apiKey });
  const keepaTools = new KeepaTools(keepaClient);
  
  const result = await keepaTools.getBestSellers(BestSellersSchema.parse(params));
  res.json({ result });
}));

app.post('/api/keepa/price-history', asyncHandler(async (req: express.Request, res: express.Response) => {
  const { apiKey, ...params } = req.body;
  if (!apiKey) {
    return res.status(400).json({ error: 'apiKey is required in request body' });
  }
  
  const keepaClient = new KeepaClient({ apiKey });
  const keepaTools = new KeepaTools(keepaClient);
  
  const result = await keepaTools.getPriceHistory(PriceHistorySchema.parse(params));
  res.json({ result });
}));

app.post('/api/keepa/product-finder', asyncHandler(async (req: express.Request, res: express.Response) => {
  const { apiKey, ...params } = req.body;
  if (!apiKey) {
    return res.status(400).json({ error: 'apiKey is required in request body' });
  }
  
  const keepaClient = new KeepaClient({ apiKey });
  const keepaTools = new KeepaTools(keepaClient);
  
  const result = await keepaTools.findProducts(ProductFinderSchema.parse(params));
  res.json({ result });
}));

app.post('/api/keepa/category-analysis', asyncHandler(async (req: express.Request, res: express.Response) => {
  const { apiKey, ...params } = req.body;
  if (!apiKey) {
    return res.status(400).json({ error: 'apiKey is required in request body' });
  }
  
  const keepaClient = new KeepaClient({ apiKey });
  const keepaTools = new KeepaTools(keepaClient);
  
  const result = await keepaTools.analyzeCategory(CategoryAnalysisSchema.parse(params));
  res.json({ result });
}));

app.post('/api/keepa/sales-velocity', asyncHandler(async (req: express.Request, res: express.Response) => {
  const { apiKey, ...params } = req.body;
  if (!apiKey) {
    return res.status(400).json({ error: 'apiKey is required in request body' });
  }
  
  const keepaClient = new KeepaClient({ apiKey });
  const keepaTools = new KeepaTools(keepaClient);
  
  const result = await keepaTools.analyzeSalesVelocity(SalesVelocitySchema.parse(params));
  res.json({ result });
}));

app.post('/api/keepa/inventory-analysis', asyncHandler(async (req: express.Request, res: express.Response) => {
  const { apiKey, ...params } = req.body;
  if (!apiKey) {
    return res.status(400).json({ error: 'apiKey is required in request body' });
  }
  
  const keepaClient = new KeepaClient({ apiKey });
  const keepaTools = new KeepaTools(keepaClient);
  
  const result = await keepaTools.analyzeInventory(InventoryAnalysisSchema.parse(params));
  res.json({ result });
}));

app.post('/api/keepa/token-status', asyncHandler(async (req: express.Request, res: express.Response) => {
  const { apiKey, ...params } = req.body;
  if (!apiKey) {
    return res.status(400).json({ error: 'apiKey is required in request body' });
  }
  
  const keepaClient = new KeepaClient({ apiKey });
  const keepaTools = new KeepaTools(keepaClient);
  
  const result = await keepaTools.getTokenStatus(TokenStatusSchema.parse(params));
  res.json({ result });
}));

// Keepa webhook endpoint for notifications
app.post('/api/keepa/webhook', asyncHandler(async (req: express.Request, res: express.Response) => {
  const notification = req.body;
  
  console.log('📩 Received Keepa webhook notification:', {
    timestamp: new Date().toISOString(),
    type: notification.notificationType || 'unknown',
    payload: notification
  });
  
  // Process different types of notifications
  switch (notification.notificationType) {
    case 'PRODUCT_PRICE_CHANGE':
      console.log('�� Price change notification for ASIN:', notification.asin);
      break;
    case 'PRODUCT_AVAILABILITY_CHANGE':
      console.log('📦 Availability change notification for ASIN:', notification.asin);
      break;
    case 'DEAL_NOTIFICATION':
      console.log('🎯 Deal notification:', notification);
      break;
    default:
      console.log('📨 Generic notification:', notification);
  }
  
  // Respond with 200 OK to acknowledge receipt
  res.status(200).json({
    status: 'received',
    timestamp: new Date().toISOString(),
    message: 'Webhook notification processed successfully'
  });
}));

// Webhook verification endpoint (for Keepa to verify the endpoint)
app.get('/api/keepa/webhook', (req: express.Request, res: express.Response) => {
  res.json({
    status: 'active',
    endpoint: 'Keepa webhook endpoint',
    timestamp: new Date().toISOString(),
    message: 'This endpoint is ready to receive Keepa notifications'
  });
});

// Error handling middleware
app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', error);
  
  const statusCode = error.statusCode || 500;
  const message = error.message || 'Internal server error';
  
  res.status(statusCode).json({
    error: message,
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use((req: express.Request, res: express.Response) => {
  res.status(404).json({
    error: 'Not found',
    path: req.path,
    timestamp: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Keepa Express server running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
    console.log('Available endpoints:');
    console.log('  POST /api/keepa/product-lookup');
    console.log('  POST /api/keepa/batch-product-lookup');
    console.log('  POST /api/keepa/search-deals');
    console.log('  POST /api/keepa/seller-lookup');
    console.log('  POST /api/keepa/best-sellers');
    console.log('  POST /api/keepa/price-history');
    console.log('  POST /api/keepa/product-finder');
    console.log('  POST /api/keepa/category-analysis');
    console.log('  POST /api/keepa/sales-velocity');
    console.log('  POST /api/keepa/inventory-analysis');
    console.log('  POST /api/keepa/token-status');
    console.log('  POST /api/keepa/webhook (for Keepa notifications)');
    console.log('  GET  /api/keepa/webhook (webhook verification)');
    console.log('');
    console.log('Note: All endpoints require "apiKey" in the request body');
  });
}

export default app;
