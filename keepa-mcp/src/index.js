#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const keepa_client_js_1 = require("./keepa-client.js");
const tools_js_1 = require("./tools.js");
class KeepaServer {
    server;
    keepaClient;
    keepaTools;
    constructor() {
        this.server = new index_js_1.Server({
            name: 'keepa-mcp-server',
            version: '1.0.0',
        }, {
            capabilities: {
                tools: {},
            },
        });
        this.setupToolHandlers();
        this.setupErrorHandling();
    }
    initializeKeepaClient() {
        const apiKey = process.env.KEEPA_API_KEY;
        if (!apiKey) {
            throw new Error('KEEPA_API_KEY environment variable is required. ' +
                'Get your API key at https://keepa.com/#!api');
        }
        this.keepaClient = new keepa_client_js_1.KeepaClient({
            apiKey,
            rateLimitDelay: parseInt(process.env.KEEPA_RATE_LIMIT_DELAY || '1000'),
            timeout: parseInt(process.env.KEEPA_TIMEOUT || '30000'),
        });
        this.keepaTools = new tools_js_1.KeepaTools(this.keepaClient);
    }
    setupToolHandlers() {
        this.server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => {
            const tools = [
                {
                    name: 'keepa_product_lookup',
                    description: 'Look up detailed information for a single Amazon product by ASIN',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            asin: { type: 'string', description: 'Amazon ASIN (product identifier)' },
                            domain: { type: 'number', minimum: 1, maximum: 11, default: 1, description: 'Amazon domain (1=US, 2=UK, 3=DE, etc.)' },
                            days: { type: 'number', minimum: 1, maximum: 365, description: 'Number of days of price history to include' },
                            history: { type: 'boolean', default: false, description: 'Include full price history' },
                            offers: { type: 'number', minimum: 0, maximum: 100, description: 'Number of marketplace offers to include' },
                            variations: { type: 'boolean', default: false, description: 'Include product variations' },
                            rating: { type: 'boolean', default: false, description: 'Include product rating data' }
                        },
                        required: ['asin']
                    }
                },
                {
                    name: 'keepa_batch_product_lookup',
                    description: 'Look up information for multiple Amazon products by ASIN (up to 100)',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            asins: { type: 'array', items: { type: 'string' }, maxItems: 100, description: 'Array of Amazon ASINs (max 100)' },
                            domain: { type: 'number', minimum: 1, maximum: 11, default: 1, description: 'Amazon domain (1=US, 2=UK, 3=DE, etc.)' },
                            days: { type: 'number', minimum: 1, maximum: 365, description: 'Number of days of price history to include' },
                            history: { type: 'boolean', default: false, description: 'Include full price history' }
                        },
                        required: ['asins']
                    }
                },
                {
                    name: 'keepa_search_deals',
                    description: 'Search for current Amazon deals with filtering options',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            domain: { type: 'number', minimum: 1, maximum: 11, default: 1, description: 'Amazon domain (1=US, 2=UK, 3=DE, etc.)' },
                            categoryId: { type: 'number', description: 'Amazon category ID to filter by' },
                            minPrice: { type: 'number', minimum: 0, description: 'Minimum price in cents' },
                            maxPrice: { type: 'number', minimum: 0, description: 'Maximum price in cents' },
                            minDiscount: { type: 'number', minimum: 0, maximum: 100, description: 'Minimum discount percentage' },
                            minRating: { type: 'number', minimum: 1, maximum: 5, description: 'Minimum product rating (1-5 stars)' },
                            isPrime: { type: 'boolean', description: 'Filter for Prime eligible deals only' },
                            sortType: { type: 'number', minimum: 0, maximum: 4, default: 0, description: 'Sort type (0=deal score, 1=price, 2=discount, 3=rating, 4=reviews)' },
                            page: { type: 'number', minimum: 0, default: 0, description: 'Page number for pagination' },
                            perPage: { type: 'number', minimum: 1, maximum: 50, default: 25, description: 'Results per page (max 50)' }
                        },
                        required: ['domain']
                    }
                },
                {
                    name: 'keepa_seller_lookup',
                    description: 'Get detailed information about an Amazon seller',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            seller: { type: 'string', description: 'Seller ID or name' },
                            domain: { type: 'number', minimum: 1, maximum: 11, default: 1, description: 'Amazon domain (1=US, 2=UK, 3=DE, etc.)' },
                            storefront: { type: 'number', minimum: 0, maximum: 100000, description: 'Number of storefront ASINs to retrieve' }
                        },
                        required: ['seller']
                    }
                },
                {
                    name: 'keepa_best_sellers',
                    description: 'Get best sellers list for a specific Amazon category',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            domain: { type: 'number', minimum: 1, maximum: 11, default: 1, description: 'Amazon domain (1=US, 2=UK, 3=DE, etc.)' },
                            category: { type: 'number', description: 'Amazon category ID' },
                            page: { type: 'number', minimum: 0, default: 0, description: 'Page number for pagination' }
                        },
                        required: ['category']
                    }
                },
                {
                    name: 'keepa_price_history',
                    description: 'Get historical price data for an Amazon product',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            asin: { type: 'string', description: 'Amazon ASIN (product identifier)' },
                            domain: { type: 'number', minimum: 1, maximum: 11, default: 1, description: 'Amazon domain (1=US, 2=UK, 3=DE, etc.)' },
                            dataType: { type: 'number', minimum: 0, maximum: 30, description: 'Data type (0=Amazon, 1=New, 2=Used, 3=Sales Rank, etc.)' },
                            days: { type: 'number', minimum: 1, maximum: 365, default: 30, description: 'Number of days of history' }
                        },
                        required: ['asin', 'dataType']
                    }
                },
                {
                    name: 'keepa_product_finder',
                    description: 'Advanced product finder with filtering similar to Keepa Product Finder - find products by rating, price, sales, competition level',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            domain: { type: 'number', minimum: 1, maximum: 11, default: 1, description: 'Amazon domain (1=US, 2=UK, 3=DE, etc.)' },
                            categoryId: { type: 'number', description: 'Amazon category ID to search within' },
                            minRating: { type: 'number', minimum: 1, maximum: 5, description: 'Minimum product rating (1-5 stars)' },
                            maxRating: { type: 'number', minimum: 1, maximum: 5, description: 'Maximum product rating (1-5 stars)' },
                            minPrice: { type: 'number', minimum: 0, description: 'Minimum price in cents' },
                            maxPrice: { type: 'number', minimum: 0, description: 'Maximum price in cents' },
                            minShipping: { type: 'number', minimum: 0, description: 'Minimum shipping cost in cents' },
                            maxShipping: { type: 'number', minimum: 0, description: 'Maximum shipping cost in cents' },
                            minMonthlySales: { type: 'number', minimum: 0, description: 'Minimum estimated monthly sales' },
                            maxMonthlySales: { type: 'number', minimum: 0, description: 'Maximum estimated monthly sales' },
                            minSellerCount: { type: 'number', minimum: 0, description: 'Minimum number of sellers (lower = less competition)' },
                            maxSellerCount: { type: 'number', minimum: 0, description: 'Maximum number of sellers (higher = more competition)' },
                            isPrime: { type: 'boolean', description: 'Filter for Prime eligible products only' },
                            hasReviews: { type: 'boolean', description: 'Filter for products with reviews only' },
                            productType: { type: 'number', minimum: 0, maximum: 2, default: 0, description: 'Product type (0=standard, 1=variation parent, 2=variation child)' },
                            sortBy: { type: 'string', enum: ['monthlySold', 'price', 'rating', 'reviewCount', 'salesRank'], default: 'monthlySold', description: 'Sort results by field' },
                            sortOrder: { type: 'string', enum: ['asc', 'desc'], default: 'desc', description: 'Sort order (ascending or descending)' },
                            page: { type: 'number', minimum: 0, default: 0, description: 'Page number for pagination' },
                            perPage: { type: 'number', minimum: 1, maximum: 50, default: 25, description: 'Results per page (max 50)' }
                        },
                        required: []
                    }
                },
                {
                    name: 'keepa_category_analysis',
                    description: 'Comprehensive category analysis - find the best products, opportunities, and market insights in any category',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            domain: { type: 'number', minimum: 1, maximum: 11, default: 1, description: 'Amazon domain (1=US, 2=UK, 3=DE, etc.)' },
                            categoryId: { type: 'number', description: 'Amazon category ID to analyze' },
                            analysisType: { type: 'string', enum: ['overview', 'top_performers', 'opportunities', 'trends'], default: 'overview', description: 'Type of analysis to perform' },
                            priceRange: { type: 'string', enum: ['budget', 'mid', 'premium', 'luxury'], description: 'Focus on specific price range' },
                            minRating: { type: 'number', minimum: 1, maximum: 5, default: 3.0, description: 'Minimum rating for products to include' },
                            includeSubcategories: { type: 'boolean', default: false, description: 'Include analysis of subcategories' },
                            timeframe: { type: 'string', enum: ['week', 'month', 'quarter', 'year'], default: 'month', description: 'Timeframe for trend analysis' }
                        },
                        required: ['categoryId']
                    }
                },
                {
                    name: 'keepa_sales_velocity',
                    description: 'Analyze sales velocity and inventory turnover - find products that sell quickly and avoid slow movers',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            domain: { type: 'number', minimum: 1, maximum: 11, default: 1, description: 'Amazon domain (1=US, 2=UK, 3=DE, etc.)' },
                            categoryId: { type: 'number', description: 'Amazon category ID to filter by' },
                            asin: { type: 'string', description: 'Single ASIN to analyze' },
                            asins: { type: 'array', items: { type: 'string' }, maxItems: 50, description: 'Array of ASINs to analyze (max 50)' },
                            timeframe: { type: 'string', enum: ['week', 'month', 'quarter'], default: 'month', description: 'Time period for velocity calculation' },
                            minVelocity: { type: 'number', minimum: 0, description: 'Minimum daily sales velocity (units/day)' },
                            maxVelocity: { type: 'number', minimum: 0, description: 'Maximum daily sales velocity (units/day)' },
                            minPrice: { type: 'number', minimum: 0, description: 'Minimum price in cents' },
                            maxPrice: { type: 'number', minimum: 0, description: 'Maximum price in cents' },
                            minRating: { type: 'number', minimum: 1, maximum: 5, default: 3.0, description: 'Minimum product rating' },
                            sortBy: { type: 'string', enum: ['velocity', 'turnoverRate', 'revenueVelocity', 'trend'], default: 'velocity', description: 'Sort results by metric' },
                            sortOrder: { type: 'string', enum: ['asc', 'desc'], default: 'desc', description: 'Sort order' },
                            page: { type: 'number', minimum: 0, default: 0, description: 'Page number for pagination' },
                            perPage: { type: 'number', minimum: 1, maximum: 50, default: 25, description: 'Results per page (max 50)' }
                        },
                        required: []
                    }
                },
                {
                    name: 'keepa_inventory_analysis',
                    description: 'Comprehensive inventory analysis - identify fast movers, slow movers, stockout risks, and seasonal patterns',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            domain: { type: 'number', minimum: 1, maximum: 11, default: 1, description: 'Amazon domain (1=US, 2=UK, 3=DE, etc.)' },
                            categoryId: { type: 'number', description: 'Amazon category ID to analyze' },
                            asins: { type: 'array', items: { type: 'string' }, maxItems: 100, description: 'Specific ASINs to analyze (your current inventory)' },
                            analysisType: { type: 'string', enum: ['overview', 'fast_movers', 'slow_movers', 'stockout_risks', 'seasonal'], default: 'overview', description: 'Type of inventory analysis' },
                            timeframe: { type: 'string', enum: ['week', 'month', 'quarter'], default: 'month', description: 'Analysis timeframe' },
                            targetTurnoverRate: { type: 'number', minimum: 1, maximum: 50, default: 12, description: 'Target inventory turns per year' }
                        },
                        required: []
                    }
                },
                {
                    name: 'keepa_token_status',
                    description: 'Check remaining Keepa API tokens and account status',
                    inputSchema: {
                        type: 'object',
                        properties: {},
                        required: []
                    }
                },
            ];
            return { tools };
        });
        this.server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;
            try {
                if (!this.keepaClient || !this.keepaTools) {
                    this.initializeKeepaClient();
                }
                let result;
                switch (name) {
                    case 'keepa_product_lookup':
                        result = await this.keepaTools.lookupProduct(tools_js_1.ProductLookupSchema.parse(args));
                        break;
                    case 'keepa_batch_product_lookup':
                        result = await this.keepaTools.batchLookupProducts(tools_js_1.BatchProductLookupSchema.parse(args));
                        break;
                    case 'keepa_search_deals':
                        result = await this.keepaTools.searchDeals(tools_js_1.DealSearchSchema.parse(args));
                        break;
                    case 'keepa_seller_lookup':
                        result = await this.keepaTools.lookupSeller(tools_js_1.SellerLookupSchema.parse(args));
                        break;
                    case 'keepa_best_sellers':
                        result = await this.keepaTools.getBestSellers(tools_js_1.BestSellersSchema.parse(args));
                        break;
                    case 'keepa_price_history':
                        result = await this.keepaTools.getPriceHistory(tools_js_1.PriceHistorySchema.parse(args));
                        break;
                    case 'keepa_product_finder':
                        result = await this.keepaTools.findProducts(tools_js_1.ProductFinderSchema.parse(args));
                        break;
                    case 'keepa_category_analysis':
                        result = await this.keepaTools.analyzeCategory(tools_js_1.CategoryAnalysisSchema.parse(args));
                        break;
                    case 'keepa_sales_velocity':
                        result = await this.keepaTools.analyzeSalesVelocity(tools_js_1.SalesVelocitySchema.parse(args));
                        break;
                    case 'keepa_inventory_analysis':
                        result = await this.keepaTools.analyzeInventory(tools_js_1.InventoryAnalysisSchema.parse(args));
                        break;
                    case 'keepa_token_status':
                        result = await this.keepaTools.getTokenStatus(tools_js_1.TokenStatusSchema.parse(args));
                        break;
                    default:
                        throw new Error(`Unknown tool: ${name}`);
                }
                return {
                    content: [
                        {
                            type: 'text',
                            text: result,
                        },
                    ],
                };
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error: ${errorMessage}`,
                        },
                    ],
                    isError: true,
                };
            }
        });
    }
    setupErrorHandling() {
        this.server.onerror = (error) => {
            console.error('[MCP Error]', error);
        };
        process.on('SIGINT', async () => {
            await this.server.close();
            process.exit(0);
        });
    }
    async run() {
        const transport = new stdio_js_1.StdioServerTransport();
        await this.server.connect(transport);
        console.error('Keepa MCP server running on stdio');
        console.error('Make sure to set KEEPA_API_KEY environment variable');
    }
}
const server = new KeepaServer();
server.run().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFFQSx3RUFBbUU7QUFDbkUsd0VBQWlGO0FBQ2pGLGlFQUk0QztBQUM1Qyx1REFBZ0Q7QUFDaEQseUNBYW9CO0FBRXBCLE1BQU0sV0FBVztJQUNQLE1BQU0sQ0FBUztJQUNmLFdBQVcsQ0FBZTtJQUMxQixVQUFVLENBQWM7SUFFaEM7UUFDRSxJQUFJLENBQUMsTUFBTSxHQUFHLElBQUksaUJBQU0sQ0FDdEI7WUFDRSxJQUFJLEVBQUUsa0JBQWtCO1lBQ3hCLE9BQU8sRUFBRSxPQUFPO1NBQ2pCLEVBQ0Q7WUFDRSxZQUFZLEVBQUU7Z0JBQ1osS0FBSyxFQUFFLEVBQUU7YUFDVjtTQUNGLENBQ0YsQ0FBQztRQUVGLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO1FBQ3pCLElBQUksQ0FBQyxrQkFBa0IsRUFBRSxDQUFDO0lBQzVCLENBQUM7SUFFTyxxQkFBcUI7UUFDM0IsTUFBTSxNQUFNLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUM7UUFDekMsSUFBSSxDQUFDLE1BQU0sRUFBRTtZQUNYLE1BQU0sSUFBSSxLQUFLLENBQ2Isa0RBQWtEO2dCQUNsRCw2Q0FBNkMsQ0FDOUMsQ0FBQztTQUNIO1FBRUQsSUFBSSxDQUFDLFdBQVcsR0FBRyxJQUFJLDZCQUFXLENBQUM7WUFDakMsTUFBTTtZQUNOLGNBQWMsRUFBRSxRQUFRLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxzQkFBc0IsSUFBSSxNQUFNLENBQUM7WUFDdEUsT0FBTyxFQUFFLFFBQVEsQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLGFBQWEsSUFBSSxPQUFPLENBQUM7U0FDeEQsQ0FBQyxDQUFDO1FBRUgsSUFBSSxDQUFDLFVBQVUsR0FBRyxJQUFJLHFCQUFVLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxDQUFDO0lBQ3JELENBQUM7SUFFTyxpQkFBaUI7UUFD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QyIsInNvdXJjZXNDb250ZW50IjpbIiMhL3Vzci9iaW4vZW52IG5vZGVcblxuaW1wb3J0IHsgU2VydmVyIH0gZnJvbSAnQG1vZGVsY29udGV4dHByb3RvY29sL3Nkay9zZXJ2ZXIvaW5kZXguanMnO1xuaW1wb3J0IHsgU3RkaW9TZXJ2ZXJUcmFuc3BvcnQgfSBmcm9tICdAbW9kZWxjb250ZXh0cHJvdG9jb2wvc2RrL3NlcnZlci9zdGRpby5qcyc7XG5pbXBvcnQge1xuICBDYWxsVG9vbFJlcXVlc3RTY2hlbWEsXG4gIExpc3RUb29sc1JlcXVlc3RTY2hlbWEsXG4gIFRvb2wsXG59IGZyb20gJ0Btb2RlbGNvbnRleHRwcm90b2NvbC9zZGsvdHlwZXMuanMnO1xuaW1wb3J0IHsgS2VlcGFDbGllbnQgfSBmcm9tICcuL2tlZXBhLWNsaWVudC5qcyc7XG5pbXBvcnQgeyBcbiAgS2VlcGFUb29scyxcbiAgUHJvZHVjdExvb2t1cFNjaGVtYSxcbiAgQmF0Y2hQcm9kdWN0TG9va3VwU2NoZW1hLFxuICBEZWFsU2VhcmNoU2NoZW1hLFxuICBTZWxsZXJMb29rdXBTY2hlbWEsXG4gIEJlc3RTZWxsZXJzU2NoZW1hLFxuICBQcmljZUhpc3RvcnlTY2hlbWEsXG4gIFByb2R1Y3RGaW5kZXJTY2hlbWEsXG4gIENhdGVnb3J5QW5hbHlzaXNTY2hlbWEsXG4gIFNhbGVzVmVsb2NpdHlTY2hlbWEsXG4gIEludmVudG9yeUFuYWx5c2lzU2NoZW1hLFxuICBUb2tlblN0YXR1c1NjaGVtYSxcbn0gZnJvbSAnLi90b29scy5qcyc7XG5cbmNsYXNzIEtlZXBhU2VydmVyIHtcbiAgcHJpdmF0ZSBzZXJ2ZXI6IFNlcnZlcjtcbiAgcHJpdmF0ZSBrZWVwYUNsaWVudD86IEtlZXBhQ2xpZW50O1xuICBwcml2YXRlIGtlZXBhVG9vbHM/OiBLZWVwYVRvb2xzO1xuXG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIHRoaXMuc2VydmVyID0gbmV3IFNlcnZlcihcbiAgICAgIHtcbiAgICAgICAgbmFtZTogJ2tlZXBhLW1jcC1zZXJ2ZXInLFxuICAgICAgICB2ZXJzaW9uOiAnMS4wLjAnLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgY2FwYWJpbGl0aWVzOiB7XG4gICAgICAgICAgdG9vbHM6IHt9LFxuICAgICAgICB9LFxuICAgICAgfVxuICAgICk7XG5cbiAgICB0aGlzLnNldHVwVG9vbEhhbmRsZXJzKCk7XG4gICAgdGhpcy5zZXR1cEVycm9ySGFuZGxpbmcoKTtcbiAgfVxuXG4gIHByaXZhdGUgaW5pdGlhbGl6ZUtlZXBhQ2xpZW50KCk6IHZvaWQge1xuICAgIGNvbnN0IGFwaUtleSA9IHByb2Nlc3MuZW52LktFRVBBX0FQSV9LRVk7XG4gICAgaWYgKCFhcGlLZXkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgJ0tFRVBBX0FQSV9LRVkgZW52aXJvbm1lbnQgdmFyaWFibGUgaXMgcmVxdWlyZWQuICcgK1xuICAgICAgICAnR2V0IHlvdXIgQVBJIGtleSBhdCBodHRwczovL2tlZXBhLmNvbS8jIWFwaSdcbiAgICAgICk7XG4gICAgfVxuXG4gICAgdGhpcy5rZWVwYUNsaWVudCA9IG5ldyBLZWVwYUNsaWVudCh7XG4gICAgICBhcGlLZXksXG4gICAgICByYXRlTGltaXREZWxheTogcGFyc2VJbnQocHJvY2Vzcy5lbnYuS0VFUEFfUkFURV9MSU1JVF9ERUxBWSB8fCAnMTAwMCcpLFxuICAgICAgdGltZW91dDogcGFyc2VJbnQocHJvY2Vzcy5lbnYuS0VFUEFfVElNRU9VVCB8fCAnMzAwMDAnKSxcbiAgICB9KTtcblxuICAgIHRoaXMua2VlcGFUb29scyA9IG5ldyBLZWVwYVRvb2xzKHRoaXMua2VlcGFDbGllbnQpO1xuICB9XG5cbiAgcHJpdmF0ZSBzZXR1cFRvb2xIYW5kbGVycygpOiB2b2lkIHtcbiAgICB0aGlzLnNlcnZlci5zZXRSZXF1ZXN0SGFuZGxlcihMaXN0VG9vbHNSZXF1ZXN0U2NoZW1hLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCB0b29sczogVG9vbFtdID0gW1xuICAgICAgICB7XG4gICAgICAgICAgbmFtZTogJ2tlZXBhX3Byb2R1Y3RfbG9va3VwJyxcbiAgICAgICAgICBkZXNjcmlwdGlvbjogJ0xvb2sgdXAgZGV0YWlsZWQgaW5mb3JtYXRpb24gZm9yIGEgc2luZ2xlIEFtYXpvbiBwcm9kdWN0IGJ5IEFTSU4nLFxuICAgICAgICAgIGlucHV0U2NoZW1hOiB7XG4gICAgICAgICAgICB0eXBlOiAnb2JqZWN0JyxcbiAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgICAgYXNpbjogeyB0eXBlOiAnc3RyaW5nJywgZGVzY3JpcHRpb246ICdBbWF6b24gQVNJTiAocHJvZHVjdCBpZGVudGlmaWVyKScgfSxcbiAgICAgICAgICAgICAgZG9tYWluOiB7IHR5cGU6ICdudW1iZXInLCBtaW5pbXVtOiAxLCBtYXhpbXVtOiAxMSwgZGVmYXVsdDogMSwgZGVzY3JpcHRpb246ICdBbWF6b24gZG9tYWluICgxPVVTLCAyPVVLLCAzPURFLCBldGMuKScgfSxcbiAgICAgICAgICAgICAgZGF5czogeyB0eXBlOiAnbnVtYmVyJywgbWluaW11bTogMSwgbWF4aW11bTogMzY1LCBkZXNjcmlwdGlvbjogJ051bWJlciBvZiBkYXlzIG9mIHByaWNlIGhpc3RvcnkgdG8gaW5jbHVkZScgfSxcbiAgICAgICAgICAgICAgaGlzdG9yeTogeyB0eXBlOiAnYm9vbGVhbicsIGRlZmF1bHQ6IGZhbHNlLCBkZXNjcmlwdGlvbjogJ0luY2x1ZGUgZnVsbCBwcmljZSBoaXN0b3J5JyB9LFxuICAgICAgICAgICAgICBvZmZlcnM6IHsgdHlwZTogJ251bWJlcicsIG1pbmltdW06IDAsIG1heGltdW06IDEwMCwgZGVzY3JpcHRpb246ICdOdW1iZXIgb2YgbWFya2V0cGxhY2Ugb2ZmZXJzIHRvIGluY2x1ZGUnIH0sXG4gICAgICAgICAgICAgIHZhcmlhdGlvbnM6IHsgdHlwZTogJ2Jvb2xlYW4nLCBkZWZhdWx0OiBmYWxzZSwgZGVzY3JpcHRpb246ICdJbmNsdWRlIHByb2R1Y3QgdmFyaWF0aW9ucycgfSxcbiAgICAgICAgICAgICAgcmF0aW5nOiB7IHR5cGU6ICdib29sZWFuJywgZGVmYXVsdDogZmFsc2UsIGRlc2NyaXB0aW9uOiAnSW5jbHVkZSBwcm9kdWN0IHJhdGluZyBkYXRhJyB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcmVxdWlyZWQ6IFsnYXNpbiddXG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgbmFtZTogJ2tlZXBhX2JhdGNoX3Byb2R1Y3RfbG9va3VwJywgXG4gICAgICAgICAgZGVzY3JpcHRpb246ICdMb29rIHVwIGluZm9ybWF0aW9uIGZvciBtdWx0aXBsZSBBbWF6b24gcHJvZHVjdHMgYnkgQVNJTiAodXAgdG8gMTAwKScsXG4gICAgICAgICAgaW5wdXRTY2hlbWE6IHtcbiAgICAgICAgICAgIHR5cGU6ICdvYmplY3QnLFxuICAgICAgICAgICAgcHJvcGVydGllczoge1xuICAgICAgICAgICAgICBhc2luczogeyB0eXBlOiAnYXJyYXknLCBpdGVtczogeyB0eXBlOiAnc3RyaW5nJyB9LCBtYXhJdGVtczogMTAwLCBkZXNjcmlwdGlvbjogJ0FycmF5IG9mIEFtYXpvbiBBU0lOcyAobWF4IDEwMCknIH0sXG4gICAgICAgICAgICAgIGRvbWFpbjogeyB0eXBlOiAnbnVtYmVyJywgbWluaW11bTogMSwgbWF4aW11bTogMTEsIGRlZmF1bHQ6IDEsIGRlc2NyaXB0aW9uOiAnQW1hem9uIGRvbWFpbiAoMT1VUywgMj1VSywgMz1ERSwgZXRjLiknIH0sXG4gICAgICAgICAgICAgIGRheXM6IHsgdHlwZTogJ251bWJlcicsIG1pbmltdW06IDEsIG1heGltdW06IDM2NSwgZGVzY3JpcHRpb246ICdOdW1iZXIgb2YgZGF5cyBvZiBwcmljZSBoaXN0b3J5IHRvIGluY2x1ZGUnIH0sXG4gICAgICAgICAgICAgIGhpc3Rvcnk6IHsgdHlwZTogJ2Jvb2xlYW4nLCBkZWZhdWx0OiBmYWxzZSwgZGVzY3JpcHRpb246ICdJbmNsdWRlIGZ1bGwgcHJpY2UgaGlzdG9yeScgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHJlcXVpcmVkOiBbJ2FzaW5zJ11cbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBuYW1lOiAna2VlcGFfc2VhcmNoX2RlYWxzJyxcbiAgICAgICAgICBkZXNjcmlwdGlvbjogJ1NlYXJjaCBmb3IgY3VycmVudCBBbWF6b24gZGVhbHMgd2l0aCBmaWx0ZXJpbmcgb3B0aW9ucycsXG4gICAgICAgICAgaW5wdXRTY2hlbWE6IHtcbiAgICAgICAgICAgIHR5cGU6ICdvYmplY3QnLFxuICAgICAgICAgICAgcHJvcGVydGllczoge1xuICAgICAgICAgICAgICBkb21haW46IHsgdHlwZTogJ251bWJlcicsIG1pbmltdW06IDEsIG1heGltdW06IDExLCBkZWZhdWx0OiAxLCBkZXNjcmlwdGlvbjogJ0FtYXpvbiBkb21haW4gKDE9VVMsIDI9VUssIDM9REUsIGV0Yy4pJyB9LFxuICAgICAgICAgICAgICBjYXRlZ29yeUlkOiB7IHR5cGU6ICdudW1iZXInLCBkZXNjcmlwdGlvbjogJ0FtYXpvbiBjYXRlZ29yeSBJRCB0byBmaWx0ZXIgYnknIH0sXG4gICAgICAgICAgICAgIG1pblByaWNlOiB7IHR5cGU6ICdudW1iZXInLCBtaW5pbXVtOiAwLCBkZXNjcmlwdGlvbjogJ01pbmltdW0gcHJpY2UgaW4gY2VudHMnIH0sXG4gICAgICAgICAgICAgIG1heFByaWNlOiB7IHR5cGU6ICdudW1iZXInLCBtaW5pbXVtOiAwLCBkZXNjcmlwdGlvbjogJ01heGltdW0gcHJpY2UgaW4gY2VudHMnIH0sXG4gICAgICAgICAgICAgIG1pbkRpc2NvdW50OiB7IHR5cGU6ICdudW1iZXInLCBtaW5pbXVtOiAwLCBtYXhpbXVtOiAxMDAsIGRlc2NyaXB0aW9uOiAnTWluaW11bSBkaXNjb3VudCBwZXJjZW50YWdlJyB9LFxuICAgICAgICAgICAgICBtaW5SYXRpbmc6IHsgdHlwZTogJ251bWJlcicsIG1pbmltdW06IDEsIG1heGltdW06IDUsIGRlc2NyaXB0aW9uOiAnTWluaW11bSBwcm9kdWN0IHJhdGluZyAoMS01IHN0YXJzKScgfSxcbiAgICAgICAgICAgICAgaXNQcmltZTogeyB0eXBlOiAnYm9vbGVhbicsIGRlc2NyaXB0aW9uOiAnRmlsdGVyIGZvciBQcmltZSBlbGlnaWJsZSBkZWFscyBvbmx5JyB9LFxuICAgICAgICAgICAgICBzb3J0VHlwZTogeyB0eXBlOiAnbnVtYmVyJywgbWluaW11bTogMCwgbWF4aW11bTogNCwgZGVmYXVsdDogMCwgZGVzY3JpcHRpb246ICdTb3J0IHR5cGUgKDA9ZGVhbCBzY29yZSwgMT1wcmljZSwgMj1kaXNjb3VudCwgMz1yYXRpbmcsIDQ9cmV2aWV3cyknIH0sXG4gICAgICAgICAgICAgIHBhZ2U6IHsgdHlwZTogJ251bWJlcicsIG1pbmltdW06IDAsIGRlZmF1bHQ6IDAsIGRlc2NyaXB0aW9uOiAnUGFnZSBudW1iZXIgZm9yIHBhZ2luYXRpb24nIH0sXG4gICAgICAgICAgICAgIHBlclBhZ2U6IHsgdHlwZTogJ251bWJlcicsIG1pbmltdW06IDEsIG1heGltdW06IDUwLCBkZWZhdWx0OiAyNSwgZGVzY3JpcHRpb246ICdSZXN1bHRzIHBlciBwYWdlIChtYXggNTApJyB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcmVxdWlyZWQ6IFsnZG9tYWluJ11cbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBuYW1lOiAna2VlcGFfc2VsbGVyX2xvb2t1cCcsXG4gICAgICAgICAgZGVzY3JpcHRpb246ICdHZXQgZGV0YWlsZWQgaW5mb3JtYXRpb24gYWJvdXQgYW4gQW1hem9uIHNlbGxlcicsXG4gICAgICAgICAgaW5wdXRTY2hlbWE6IHtcbiAgICAgICAgICAgIHR5cGU6ICdvYmplY3QnLFxuICAgICAgICAgICAgcHJvcGVydGllczoge1xuICAgICAgICAgICAgICBzZWxsZXI6IHsgdHlwZTogJ3N0cmluZycsIGRlc2NyaXB0aW9uOiAnU2VsbGVyIElEIG9yIG5hbWUnIH0sXG4gICAgICAgICAgICAgIGRvbWFpbjogeyB0eXBlOiAnbnVtYmVyJywgbWluaW11bTogMSwgbWF4aW11bTogMTEsIGRlZmF1bHQ6IDEsIGRlc2NyaXB0aW9uOiAnQW1hem9uIGRvbWFpbiAoMT1VUywgMj1VSywgMz1ERSwgZXRjLiknIH0sXG4gICAgICAgICAgICAgIHN0b3JlZnJvbnQ6IHsgdHlwZTogJ251bWJlcicsIG1pbmltdW06IDAsIG1heGltdW06IDEwMDAwMCwgZGVzY3JpcHRpb246ICdOdW1iZXIgb2Ygc3RvcmVmcm9udCBBU0lOcyB0byByZXRyaWV2ZScgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHJlcXVpcmVkOiBbJ3NlbGxlciddXG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgbmFtZTogJ2tlZXBhX2Jlc3Rfc2VsbGVycycsXG4gICAgICAgICAgZGVzY3JpcHRpb246ICdHZXQgYmVzdCBzZWxsZXJzIGxpc3QgZm9yIGEgc3BlY2lmaWMgQW1hem9uIGNhdGVnb3J5JyxcbiAgICAgICAgICBpbnB1dFNjaGVtYToge1xuICAgICAgICAgICAgdHlwZTogJ29iamVjdCcsXG4gICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICAgIGRvbWFpbjogeyB0eXBlOiAnbnVtYmVyJywgbWluaW11bTogMSwgbWF4aW11bTogMTEsIGRlZmF1bHQ6IDEsIGRlc2NyaXB0aW9uOiAnQW1hem9uIGRvbWFpbiAoMT1VUywgMj1VSywgMz1ERSwgZXRjLiknIH0sXG4gICAgICAgICAgICAgIGNhdGVnb3J5OiB7IHR5cGU6ICdudW1iZXInLCBkZXNjcmlwdGlvbjogJ0FtYXpvbiBjYXRlZ29yeSBJRCcgfSxcbiAgICAgICAgICAgICAgcGFnZTogeyB0eXBlOiAnbnVtYmVyJywgbWluaW11bTogMCwgZGVmYXVsdDogMCwgZGVzY3JpcHRpb246ICdQYWdlIG51bWJlciBmb3IgcGFnaW5hdGlvbicgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHJlcXVpcmVkOiBbJ2NhdGVnb3J5J11cbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBuYW1lOiAna2VlcGFfcHJpY2VfaGlzdG9yeScsXG4gICAgICAgICAgZGVzY3JpcHRpb246ICdHZXQgaGlzdG9yaWNhbCBwcmljZSBkYXRhIGZvciBhbiBBbWF6b24gcHJvZHVjdCcsXG4gICAgICAgICAgaW5wdXRTY2hlbWE6IHtcbiAgICAgICAgICAgIHR5cGU6ICdvYmplY3QnLFxuICAgICAgICAgICAgcHJvcGVydGllczoge1xuICAgICAgICAgICAgICBhc2luOiB7IHR5cGU6ICdzdHJpbmcnLCBkZXNjcmlwdGlvbjogJ0FtYXpvbiBBU0lOIChwcm9kdWN0IGlkZW50aWZpZXIpJyB9LFxuICAgICAgICAgICAgICBkb21haW46IHsgdHlwZTogJ251bWJlcicsIG1pbmltdW06IDEsIG1heGltdW06IDExLCBkZWZhdWx0OiAxLCBkZXNjcmlwdGlvbjogJ0FtYXpvbiBkb21haW4gKDE9VVMsIDI9VUssIDM9REUsIGV0Yy4pJyB9LFxuICAgICAgICAgICAgICBkYXRhVHlwZTogeyB0eXBlOiAnbnVtYmVyJywgbWluaW11bTogMCwgbWF4aW11bTogMzAsIGRlc2NyaXB0aW9uOiAnRGF0YSB0eXBlICgwPUFtYXpvbiwgMT1OZXcsIDI9VXNlZCwgMz1TYWxlcyBSYW5rLCBldGMuKScgfSxcbiAgICAgICAgICAgICAgZGF5czogeyB0eXBlOiAnbnVtYmVyJywgbWluaW11bTogMSwgbWF4aW11bTogMzY1LCBkZWZhdWx0OiAzMCwgZGVzY3JpcHRpb246ICdOdW1iZXIgb2YgZGF5cyBvZiBoaXN0b3J5JyB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcmVxdWlyZWQ6IFsnYXNpbicsICdkYXRhVHlwZSddXG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgbmFtZTogJ2tlZXBhX3Byb2R1Y3RfZmluZGVyJyxcbiAgICAgICAgICBkZXNjcmlwdGlvbjogJ0FkdmFuY2VkIHByb2R1Y3QgZmluZGVyIHdpdGggZmlsdGVyaW5nIHNpbWlsYXIgdG8gS2VlcGEgUHJvZHVjdCBGaW5kZXIgLSBmaW5kIHByb2R1Y3RzIGJ5IHJhdGluZywgcHJpY2UsIHNhbGVzLCBjb21wZXRpdGlvbiBsZXZlbCcsXG4gICAgICAgICAgaW5wdXRTY2hlbWE6IHtcbiAgICAgICAgICAgIHR5cGU6ICdvYmplY3QnLFxuICAgICAgICAgICAgcHJvcGVydGllczoge1xuICAgICAgICAgICAgICBkb21haW46IHsgdHlwZTogJ251bWJlcicsIG1pbmltdW06IDEsIG1heGltdW06IDExLCBkZWZhdWx0OiAxLCBkZXNjcmlwdGlvbjogJ0FtYXpvbiBkb21haW4gKDE9VVMsIDI9VUssIDM9REUsIGV0Yy4pJyB9LFxuICAgICAgICAgICAgICBjYXRlZ29yeUlkOiB7IHR5cGU6ICdudW1iZXInLCBkZXNjcmlwdGlvbjogJ0FtYXpvbiBjYXRlZ29yeSBJRCB0byBzZWFyY2ggd2l0aGluJyB9LFxuICAgICAgICAgICAgICBtaW5SYXRpbmc6IHsgdHlwZTogJ251bWJlcicsIG1pbmltdW06IDEsIG1heGltdW06IDUsIGRlc2NyaXB0aW9uOiAnTWluaW11bSBwcm9kdWN0IHJhdGluZyAoMS01IHN0YXJzKScgfSxcbiAgICAgICAgICAgICAgbWF4UmF0aW5nOiB7IHR5cGU6ICdudW1iZXInLCBtaW5pbXVtOiAxLCBtYXhpbXVtOiA1LCBkZXNjcmlwdGlvbjogJ01heGltdW0gcHJvZHVjdCByYXRpbmcgKDEtNSBzdGFycyknIH0sXG4gICAgICAgICAgICAgIG1pblByaWNlOiB7IHR5cGU6ICdudW1iZXInLCBtaW5pbXVtOiAwLCBkZXNjcmlwdGlvbjogJ01pbmltdW0gcHJpY2UgaW4gY2VudHMnIH0sXG4gICAgICAgICAgICAgIG1heFByaWNlOiB7IHR5cGU6ICdudW1iZXInLCBtaW5pbXVtOiAwLCBkZXNjcmlwdGlvbjogJ01heGltdW0gcHJpY2UgaW4gY2VudHMnIH0sXG4gICAgICAgICAgICAgIG1pblNoaXBwaW5nOiB7IHR5cGU6ICdudW1iZXInLCBtaW5pbXVtOiAwLCBkZXNjcmlwdGlvbjogJ01pbmltdW0gc2hpcHBpbmcgY29zdCBpbiBjZW50cycgfSxcbiAgICAgICAgICAgICAgbWF4U2hpcHBpbmc6IHsgdHlwZTogJ251bWJlcicsIG1pbmltdW06IDAsIGRlc2NyaXB0aW9uOiAnTWF4aW11bSBzaGlwcGluZyBjb3N0IGluIGNlbnRzJyB9LFxuICAgICAgICAgICAgICBtaW5Nb250aGx5U2FsZXM6IHsgdHlwZTogJ251bWJlcicsIG1pbmltdW06IDAsIGRlc2NyaXB0aW9uOiAnTWluaW11bSBlc3RpbWF0ZWQgbW9udGhseSBzYWxlcycgfSxcbiAgICAgICAgICAgICAgbWF4TW9udGhseVNhbGVzOiB7IHR5cGU6ICdudW1iZXInLCBtaW5pbXVtOiAwLCBkZXNjcmlwdGlvbjogJ01heGltdW0gZXN0aW1hdGVkIG1vbnRobHkgc2FsZXMnIH0sXG4gICAgICAgICAgICAgIG1pblNlbGxlckNvdW50OiB7IHR5cGU6ICdudW1iZXInLCBtaW5pbXVtOiAwLCBkZXNjcmlwdGlvbjogJ01pbmltdW0gbnVtYmVyIG9mIHNlbGxlcnMgKGxvd2VyID0gbGVzcyBjb21wZXRpdGlvbiknIH0sXG4gICAgICAgICAgICAgIG1heFNlbGxlckNvdW50OiB7IHR5cGU6ICdudW1iZXInLCBtaW5pbXVtOiAwLCBkZXNjcmlwdGlvbjogJ01heGltdW0gbnVtYmVyIG9mIHNlbGxlcnMgKGhpZ2hlciA9IG1vcmUgY29tcGV0aXRpb24pJyB9LFxuICAgICAgICAgICAgICBpc1ByaW1lOiB7IHR5cGU6ICdib29sZWFuJywgZGVzY3JpcHRpb246ICdGaWx0ZXIgZm9yIFByaW1lIGVsaWdpYmxlIHByb2R1Y3RzIG9ubHknIH0sXG4gICAgICAgICAgICAgIGhhc1Jldmlld3M6IHsgdHlwZTogJ2Jvb2xlYW4nLCBkZXNjcmlwdGlvbjogJ0ZpbHRlciBmb3IgcHJvZHVjdHMgd2l0aCByZXZpZXdzIG9ubHknIH0sXG4gICAgICAgICAgICAgIHByb2R1Y3RUeXBlOiB7IHR5cGU6ICdudW1iZXInLCBtaW5pbXVtOiAwLCBtYXhpbXVtOiAyLCBkZWZhdWx0OiAwLCBkZXNjcmlwdGlvbjogJ1Byb2R1Y3QgdHlwZSAoMD1zdGFuZGFyZCwgMT12YXJpYXRpb24gcGFyZW50LCAyPXZhcmlhdGlvbiBjaGlsZCknIH0sXG4gICAgICAgICAgICAgIHNvcnRCeTogeyB0eXBlOiAnc3RyaW5nJywgZW51bTogWydtb250aGx5U29sZCcsICdwcmljZScsICdyYXRpbmcnLCAncmV2aWV3Q291bnQnLCAnc2FsZXNSYW5rJ10sIGRlZmF1bHQ6ICdtb250aGx5U29sZCcsIGRlc2NyaXB0aW9uOiAnU29ydCByZXN1bHRzIGJ5IGZpZWxkJyB9LFxuICAgICAgICAgICAgICBzb3J0T3JkZXI6IHsgdHlwZTogJ3N0cmluZycsIGVudW06IFsnYXNjJywgJ2Rlc2MnXSwgZGVmYXVsdDogJ2Rlc2MnLCBkZXNjcmlwdGlvbjogJ1NvcnQgb3JkZXIgKGFzY2VuZGluZyBvciBkZXNjZW5kaW5nKScgfSxcbiAgICAgICAgICAgICAgcGFnZTogeyB0eXBlOiAnbnVtYmVyJywgbWluaW11bTogMCwgZGVmYXVsdDogMCwgZGVzY3JpcHRpb246ICdQYWdlIG51bWJlciBmb3IgcGFnaW5hdGlvbicgfSxcbiAgICAgICAgICAgICAgcGVyUGFnZTogeyB0eXBlOiAnbnVtYmVyJywgbWluaW11bTogMSwgbWF4aW11bTogNTAsIGRlZmF1bHQ6IDI1LCBkZXNjcmlwdGlvbjogJ1Jlc3VsdHMgcGVyIHBhZ2UgKG1heCA1MCknIH1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICByZXF1aXJlZDogW11cbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBuYW1lOiAna2VlcGFfY2F0ZWdvcnlfYW5hbHlzaXMnLFxuICAgICAgICAgIGRlc2NyaXB0aW9uOiAnQ29tcHJlaGVuc2l2ZSBjYXRlZ29yeSBhbmFseXNpcyAtIGZpbmQgdGhlIGJlc3QgcHJvZHVjdHMsIG9wcG9ydHVuaXRpZXMsIGFuZCBtYXJrZXQgaW5zaWdodHMgaW4gYW55IGNhdGVnb3J5JyxcbiAgICAgICAgICBpbnB1dFNjaGVtYToge1xuICAgICAgICAgICAgdHlwZTogJ29iamVjdCcsXG4gICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICAgIGRvbWFpbjogeyB0eXBlOiAnbnVtYmVyJywgbWluaW11bTogMSwgbWF4aW11bTogMTEsIGRlZmF1bHQ6IDEsIGRlc2NyaXB0aW9uOiAnQW1hem9uIGRvbWFpbiAoMT1VUywgMj1VSywgMz1ERSwgZXRjLiknIH0sXG4gICAgICAgICAgICAgIGNhdGVnb3J5SWQ6IHsgdHlwZTogJ251bWJlcicsIGRlc2NyaXB0aW9uOiAnQW1hem9uIGNhdGVnb3J5IElEIHRvIGFuYWx5emUnIH0sXG4gICAgICAgICAgICAgIGFuYWx5c2lzVHlwZTogeyB0eXBlOiAnc3RyaW5nJywgZW51bTogWydvdmVydmlldycsICd0b3BfcGVyZm9ybWVycycsICdvcHBvcnR1bml0aWVzJywgJ3RyZW5kcyddLCBkZWZhdWx0OiAnb3ZlcnZpZXcnLCBkZXNjcmlwdGlvbjogJ1R5cGUgb2YgYW5hbHlzaXMgdG8gcGVyZm9ybScgfSxcbiAgICAgICAgICAgICAgcHJpY2VSYW5nZTogeyB0eXBlOiAnc3RyaW5nJywgZW51bTogWydidWRnZXQnLCAnbWlkJywgJ3ByZW1pdW0nLCAnbHV4dXJ5J10sIGRlc2NyaXB0aW9uOiAnRm9jdXMgb24gc3BlY2lmaWMgcHJpY2UgcmFuZ2UnIH0sXG4gICAgICAgICAgICAgIG1pblJhdGluZzogeyB0eXBlOiAnbnVtYmVyJywgbWluaW11bTogMSwgbWF4aW11bTogNSwgZGVmYXVsdDogMy4wLCBkZXNjcmlwdGlvbjogJ01pbmltdW0gcmF0aW5nIGZvciBwcm9kdWN0cyB0byBpbmNsdWRlJyB9LFxuICAgICAgICAgICAgICBpbmNsdWRlU3ViY2F0ZWdvcmllczogeyB0eXBlOiAnYm9vbGVhbicsIGRlZmF1bHQ6IGZhbHNlLCBkZXNjcmlwdGlvbjogJ0luY2x1ZGUgYW5hbHlzaXMgb2Ygc3ViY2F0ZWdvcmllcycgfSxcbiAgICAgICAgICAgICAgdGltZWZyYW1lOiB7IHR5cGU6ICdzdHJpbmcnLCBlbnVtOiBbJ3dlZWsnLCAnbW9udGgnLCAncXVhcnRlcicsICd5ZWFyJ10sIGRlZmF1bHQ6ICdtb250aCcsIGRlc2NyaXB0aW9uOiAnVGltZWZyYW1lIGZvciB0cmVuZCBhbmFseXNpcycgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHJlcXVpcmVkOiBbJ2NhdGVnb3J5SWQnXVxuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIG5hbWU6ICdrZWVwYV9zYWxlc192ZWxvY2l0eScsXG4gICAgICAgICAgZGVzY3JpcHRpb246ICdBbmFseXplIHNhbGVzIHZlbG9jaXR5IGFuZCBpbnZlbnRvcnkgdHVybm92ZXIgLSBmaW5kIHByb2R1Y3RzIHRoYXQgc2VsbCBxdWlja2x5IGFuZCBhdm9pZCBzbG93IG1vdmVycycsXG4gICAgICAgICAgaW5wdXRTY2hlbWE6IHtcbiAgICAgICAgICAgIHR5cGU6ICdvYmplY3QnLFxuICAgICAgICAgICAgcHJvcGVydGllczoge1xuICAgICAgICAgICAgICBkb21haW46IHsgdHlwZTogJ251bWJlcicsIG1pbmltdW06IDEsIG1heGltdW06IDExLCBkZWZhdWx0OiAxLCBkZXNjcmlwdGlvbjogJ0FtYXpvbiBkb21haW4gKDE9VVMsIDI9VUssIDM9REUsIGV0Yy4pJyB9LFxuICAgICAgICAgICAgICBjYXRlZ29yeUlkOiB7IHR5cGU6ICdudW1iZXInLCBkZXNjcmlwdGlvbjogJ0FtYXpvbiBjYXRlZ29yeSBJRCB0byBmaWx0ZXIgYnknIH0sXG4gICAgICAgICAgICAgIGFzaW46IHsgdHlwZTogJ3N0cmluZycsIGRlc2NyaXB0aW9uOiAnU2luZ2xlIEFTSU4gdG8gYW5hbHl6ZScgfSxcbiAgICAgICAgICAgICAgYXNpbnM6IHsgdHlwZTogJ2FycmF5JywgaXRlbXM6IHsgdHlwZTogJ3N0cmluZycgfSwgbWF4SXRlbXM6IDUwLCBkZXNjcmlwdGlvbjogJ0FycmF5IG9mIEFTSU5zIHRvIGFuYWx5emUgKG1heCA1MCknIH0sXG4gICAgICAgICAgICAgIHRpbWVmcmFtZTogeyB0eXBlOiAnc3RyaW5nJywgZW51bTogWyd3ZWVrJywgJ21vbnRoJywgJ3F1YXJ0ZXInXSwgZGVmYXVsdDogJ21vbnRoJywgZGVzY3JpcHRpb246ICdUaW1lIHBlcmlvZCBmb3IgdmVsb2NpdHkgY2FsY3VsYXRpb24nIH0sXG4gICAgICAgICAgICAgIG1pblZlbG9jaXR5OiB7IHR5cGU6ICdudW1iZXInLCBtaW5pbXVtOiAwLCBkZXNjcmlwdGlvbjogJ01pbmltdW0gZGFpbHkgc2FsZXMgdmVsb2NpdHkgKHVuaXRzL2RheSknIH0sXG4gICAgICAgICAgICAgIG1heFZlbG9jaXR5OiB7IHR5cGU6ICdudW1iZXInLCBtaW5pbXVtOiAwLCBkZXNjcmlwdGlvbjogJ01heGltdW0gZGFpbHkgc2FsZXMgdmVsb2NpdHkgKHVuaXRzL2RheSknIH0sXG4gICAgICAgICAgICAgIG1pblByaWNlOiB7IHR5cGU6ICdudW1iZXInLCBtaW5pbXVtOiAwLCBkZXNjcmlwdGlvbjogJ01pbmltdW0gcHJpY2UgaW4gY2VudHMnIH0sXG4gICAgICAgICAgICAgIG1heFByaWNlOiB7IHR5cGU6ICdudW1iZXInLCBtaW5pbXVtOiAwLCBkZXNjcmlwdGlvbjogJ01heGltdW0gcHJpY2UgaW4gY2VudHMnIH0sXG4gICAgICAgICAgICAgIG1pblJhdGluZzogeyB0eXBlOiAnbnVtYmVyJywgbWluaW11bTogMSwgbWF4aW11bTogNSwgZGVmYXVsdDogMy4wLCBkZXNjcmlwdGlvbjogJ01pbmltdW0gcHJvZHVjdCByYXRpbmcnIH0sXG4gICAgICAgICAgICAgIHNvcnRCeTogeyB0eXBlOiAnc3RyaW5nJywgZW51bTogWyd2ZWxvY2l0eScsICd0dXJub3ZlclJhdGUnLCAncmV2ZW51ZVZlbG9jaXR5JywgJ3RyZW5kJ10sIGRlZmF1bHQ6ICd2ZWxvY2l0eScsIGRlc2NyaXB0aW9uOiAnU29ydCByZXN1bHRzIGJ5IG1ldHJpYycgfSxcbiAgICAgICAgICAgICAgc29ydE9yZGVyOiB7IHR5cGU6ICdzdHJpbmcnLCBlbnVtOiBbJ2FzYycsICdkZXNjJ10sIGRlZmF1bHQ6ICdkZXNjJywgZGVzY3JpcHRpb246ICdTb3J0IG9yZGVyJyB9LFxuICAgICAgICAgICAgICBwYWdlOiB7IHR5cGU6ICdudW1iZXInLCBtaW5pbXVtOiAwLCBkZWZhdWx0OiAwLCBkZXNjcmlwdGlvbjogJ1BhZ2UgbnVtYmVyIGZvciBwYWdpbmF0aW9uJyB9LFxuICAgICAgICAgICAgICBwZXJQYWdlOiB7IHR5cGU6ICdudW1iZXInLCBtaW5pbXVtOiAxLCBtYXhpbXVtOiA1MCwgZGVmYXVsdDogMjUsIGRlc2NyaXB0aW9uOiAnUmVzdWx0cyBwZXIgcGFnZSAobWF4IDUwKScgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHJlcXVpcmVkOiBbXVxuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIG5hbWU6ICdrZWVwYV9pbnZlbnRvcnlfYW5hbHlzaXMnLFxuICAgICAgICAgIGRlc2NyaXB0aW9uOiAnQ29tcHJlaGVuc2l2ZSBpbnZlbnRvcnkgYW5hbHlzaXMgLSBpZGVudGlmeSBmYXN0IG1vdmVycywgc2xvdyBtb3ZlcnMsIHN0b2Nrb3V0IHJpc2tzLCBhbmQgc2Vhc29uYWwgcGF0dGVybnMnLFxuICAgICAgICAgIGlucHV0U2NoZW1hOiB7XG4gICAgICAgICAgICB0eXBlOiAnb2JqZWN0JyxcbiAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgICAgZG9tYWluOiB7IHR5cGU6ICdudW1iZXInLCBtaW5pbXVtOiAxLCBtYXhpbXVtOiAxMSwgZGVmYXVsdDogMSwgZGVzY3JpcHRpb246ICdBbWF6b24gZG9tYWluICgxPVVTLCAyPVVLLCAzPURFLCBldGMuKScgfSxcbiAgICAgICAgICAgICAgY2F0ZWdvcnlJZDogeyB0eXBlOiAnbnVtYmVyJywgZGVzY3JpcHRpb246ICdBbWF6b24gY2F0ZWdvcnkgSUQgdG8gYW5hbHl6ZScgfSxcbiAgICAgICAgICAgICAgYXNpbnM6IHsgdHlwZTogJ2FycmF5JywgaXRlbXM6IHsgdHlwZTogJ3N0cmluZycgfSwgbWF4SXRlbXM6IDEwMCwgZGVzY3JpcHRpb246ICdTcGVjaWZpYyBBU0lOcyB0byBhbmFseXplICh5b3VyIGN1cnJlbnQgaW52ZW50b3J5KScgfSxcbiAgICAgICAgICAgICAgYW5hbHlzaXNUeXBlOiB7IHR5cGU6ICdzdHJpbmcnLCBlbnVtOiBbJ292ZXJ2aWV3JywgJ2Zhc3RfbW92ZXJzJywgJ3Nsb3dfbW92ZXJzJywgJ3N0b2Nrb3V0X3Jpc2tzJywgJ3NlYXNvbmFsJ10sIGRlZmF1bHQ6ICdvdmVydmlldycsIGRlc2NyaXB0aW9uOiAnVHlwZSBvZiBpbnZlbnRvcnkgYW5hbHlzaXMnIH0sXG4gICAgICAgICAgICAgIHRpbWVmcmFtZTogeyB0eXBlOiAnc3RyaW5nJywgZW51bTogWyd3ZWVrJywgJ21vbnRoJywgJ3F1YXJ0ZXInXSwgZGVmYXVsdDogJ21vbnRoJywgZGVzY3JpcHRpb246ICdBbmFseXNpcyB0aW1lZnJhbWUnIH0sXG4gICAgICAgICAgICAgIHRhcmdldFR1cm5vdmVyUmF0ZTogeyB0eXBlOiAnbnVtYmVyJywgbWluaW11bTogMSwgbWF4aW11bTogNTAsIGRlZmF1bHQ6IDEyLCBkZXNjcmlwdGlvbjogJ1RhcmdldCBpbnZlbnRvcnkgdHVybnMgcGVyIHllYXInIH1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICByZXF1aXJlZDogW11cbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBuYW1lOiAna2VlcGFfdG9rZW5fc3RhdHVzJyxcbiAgICAgICAgICBkZXNjcmlwdGlvbjogJ0NoZWNrIHJlbWFpbmluZyBLZWVwYSBBUEkgdG9rZW5zIGFuZCBhY2NvdW50IHN0YXR1cycsXG4gICAgICAgICAgaW5wdXRTY2hlbWE6IHtcbiAgICAgICAgICAgIHR5cGU6ICdvYmplY3QnLFxuICAgICAgICAgICAgcHJvcGVydGllczoge30sXG4gICAgICAgICAgICByZXF1aXJlZDogW11cbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICBdO1xuXG4gICAgICByZXR1cm4geyB0b29scyB9O1xuICAgIH0pO1xuXG4gICAgdGhpcy5zZXJ2ZXIuc2V0UmVxdWVzdEhhbmRsZXIoQ2FsbFRvb2xSZXF1ZXN0U2NoZW1hLCBhc3luYyAocmVxdWVzdCkgPT4ge1xuICAgICAgY29uc3QgeyBuYW1lLCBhcmd1bWVudHM6IGFyZ3MgfSA9IHJlcXVlc3QucGFyYW1zO1xuXG4gICAgICB0cnkge1xuICAgICAgICBpZiAoIXRoaXMua2VlcGFDbGllbnQgfHwgIXRoaXMua2VlcGFUb29scykge1xuICAgICAgICAgIHRoaXMuaW5pdGlhbGl6ZUtlZXBhQ2xpZW50KCk7XG4gICAgICAgIH1cblxuICAgICAgICBsZXQgcmVzdWx0OiBzdHJpbmc7XG5cbiAgICAgICAgc3dpdGNoIChuYW1lKSB7XG4gICAgICAgICAgY2FzZSAna2VlcGFfcHJvZHVjdF9sb29rdXAnOlxuICAgICAgICAgICAgcmVzdWx0ID0gYXdhaXQgdGhpcy5rZWVwYVRvb2xzIS5sb29rdXBQcm9kdWN0KFxuICAgICAgICAgICAgICBQcm9kdWN0TG9va3VwU2NoZW1hLnBhcnNlKGFyZ3MpXG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICBjYXNlICdrZWVwYV9iYXRjaF9wcm9kdWN0X2xvb2t1cCc6XG4gICAgICAgICAgICByZXN1bHQgPSBhd2FpdCB0aGlzLmtlZXBhVG9vbHMhLmJhdGNoTG9va3VwUHJvZHVjdHMoXG4gICAgICAgICAgICAgIEJhdGNoUHJvZHVjdExvb2t1cFNjaGVtYS5wYXJzZShhcmdzKVxuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgICAgY2FzZSAna2VlcGFfc2VhcmNoX2RlYWxzJzpcbiAgICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IHRoaXMua2VlcGFUb29scyEuc2VhcmNoRGVhbHMoXG4gICAgICAgICAgICAgIERlYWxTZWFyY2hTY2hlbWEucGFyc2UoYXJncylcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgIGNhc2UgJ2tlZXBhX3NlbGxlcl9sb29rdXAnOlxuICAgICAgICAgICAgcmVzdWx0ID0gYXdhaXQgdGhpcy5rZWVwYVRvb2xzIS5sb29rdXBTZWxsZXIoXG4gICAgICAgICAgICAgIFNlbGxlckxvb2t1cFNjaGVtYS5wYXJzZShhcmdzKVxuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgICAgY2FzZSAna2VlcGFfYmVzdF9zZWxsZXJzJzpcbiAgICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IHRoaXMua2VlcGFUb29scyEuZ2V0QmVzdFNlbGxlcnMoXG4gICAgICAgICAgICAgIEJlc3RTZWxsZXJzU2NoZW1hLnBhcnNlKGFyZ3MpXG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICBjYXNlICdrZWVwYV9wcmljZV9oaXN0b3J5JzpcbiAgICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IHRoaXMua2VlcGFUb29scyEuZ2V0UHJpY2VIaXN0b3J5KFxuICAgICAgICAgICAgICBQcmljZUhpc3RvcnlTY2hlbWEucGFyc2UoYXJncylcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgIGNhc2UgJ2tlZXBhX3Byb2R1Y3RfZmluZGVyJzpcbiAgICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IHRoaXMua2VlcGFUb29scyEuZmluZFByb2R1Y3RzKFxuICAgICAgICAgICAgICBQcm9kdWN0RmluZGVyU2NoZW1hLnBhcnNlKGFyZ3MpXG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICBjYXNlICdrZWVwYV9jYXRlZ29yeV9hbmFseXNpcyc6XG4gICAgICAgICAgICByZXN1bHQgPSBhd2FpdCB0aGlzLmtlZXBhVG9vbHMhLmFuYWx5emVDYXRlZ29yeShcbiAgICAgICAgICAgICAgQ2F0ZWdvcnlBbmFseXNpc1NjaGVtYS5wYXJzZShhcmdzKVxuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgICAgY2FzZSAna2VlcGFfc2FsZXNfdmVsb2NpdHknOlxuICAgICAgICAgICAgcmVzdWx0ID0gYXdhaXQgdGhpcy5rZWVwYVRvb2xzIS5hbmFseXplU2FsZXNWZWxvY2l0eShcbiAgICAgICAgICAgICAgU2FsZXNWZWxvY2l0eVNjaGVtYS5wYXJzZShhcmdzKVxuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgICAgY2FzZSAna2VlcGFfaW52ZW50b3J5X2FuYWx5c2lzJzpcbiAgICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IHRoaXMua2VlcGFUb29scyEuYW5hbHl6ZUludmVudG9yeShcbiAgICAgICAgICAgICAgSW52ZW50b3J5QW5hbHlzaXNTY2hlbWEucGFyc2UoYXJncylcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgIGNhc2UgJ2tlZXBhX3Rva2VuX3N0YXR1cyc6XG4gICAgICAgICAgICByZXN1bHQgPSBhd2FpdCB0aGlzLmtlZXBhVG9vbHMhLmdldFRva2VuU3RhdHVzKFxuICAgICAgICAgICAgICBUb2tlblN0YXR1c1NjaGVtYS5wYXJzZShhcmdzKVxuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biB0b29sOiAke25hbWV9YCk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbnRlbnQ6IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgdHlwZTogJ3RleHQnLFxuICAgICAgICAgICAgICB0ZXh0OiByZXN1bHQsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIF0sXG4gICAgICAgIH07XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zdCBlcnJvck1lc3NhZ2UgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yIG9jY3VycmVkJztcbiAgICAgICAgXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29udGVudDogW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICB0eXBlOiAndGV4dCcsXG4gICAgICAgICAgICAgIHRleHQ6IGBFcnJvcjogJHtlcnJvck1lc3NhZ2V9YCxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgICBpc0Vycm9yOiB0cnVlLFxuICAgICAgICB9O1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBzZXR1cEVycm9ySGFuZGxpbmcoKTogdm9pZCB7XG4gICAgdGhpcy5zZXJ2ZXIub25lcnJvciA9IChlcnJvcikgPT4ge1xuICAgICAgY29uc29sZS5lcnJvcignW01DUCBFcnJvcl0nLCBlcnJvcik7XG4gICAgfTtcblxuICAgIHByb2Nlc3Mub24oJ1NJR0lOVCcsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuc2VydmVyLmNsb3NlKCk7XG4gICAgICBwcm9jZXNzLmV4aXQoMCk7XG4gICAgfSk7XG4gIH1cblxuICBhc3luYyBydW4oKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgdHJhbnNwb3J0ID0gbmV3IFN0ZGlvU2VydmVyVHJhbnNwb3J0KCk7XG4gICAgYXdhaXQgdGhpcy5zZXJ2ZXIuY29ubmVjdCh0cmFuc3BvcnQpO1xuICAgIFxuICAgIGNvbnNvbGUuZXJyb3IoJ0tlZXBhIE1DUCBzZXJ2ZXIgcnVubmluZyBvbiBzdGRpbycpO1xuICAgIGNvbnNvbGUuZXJyb3IoJ01ha2Ugc3VyZSB0byBzZXQgS0VFUEFfQVBJX0tFWSBlbnZpcm9ubWVudCB2YXJpYWJsZScpO1xuICB9XG59XG5cbmNvbnN0IHNlcnZlciA9IG5ldyBLZWVwYVNlcnZlcigpO1xuc2VydmVyLnJ1bigpLmNhdGNoKChlcnJvcikgPT4ge1xuICBjb25zb2xlLmVycm9yKCdGYWlsZWQgdG8gc3RhcnQgc2VydmVyOicsIGVycm9yKTtcbiAgcHJvY2Vzcy5leGl0KDEpO1xufSk7Il19