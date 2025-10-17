"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KeepaTools = exports.TokenStatusSchema = exports.InventoryAnalysisSchema = exports.SalesVelocitySchema = exports.CategoryAnalysisSchema = exports.ProductFinderSchema = exports.PriceHistorySchema = exports.BestSellersSchema = exports.SellerLookupSchema = exports.DealSearchSchema = exports.BatchProductLookupSchema = exports.ProductLookupSchema = void 0;
const zod_1 = require("zod");
const types_1 = require("./types");
exports.ProductLookupSchema = zod_1.z.object({
    asin: zod_1.z.string().describe('Amazon ASIN (product identifier)'),
    domain: zod_1.z.number().min(1).max(11).default(1).describe('Amazon domain (1=US, 2=UK, 3=DE, etc.)'),
    days: zod_1.z.number().min(1).max(365).optional().describe('Number of days of price history to include'),
    history: zod_1.z.boolean().default(false).describe('Include full price history'),
    offers: zod_1.z.number().min(0).max(100).optional().describe('Number of marketplace offers to include'),
    variations: zod_1.z.boolean().default(false).describe('Include product variations'),
    rating: zod_1.z.boolean().default(false).describe('Include product rating data'),
});
exports.BatchProductLookupSchema = zod_1.z.object({
    asins: zod_1.z.array(zod_1.z.string()).max(100).describe('Array of Amazon ASINs (max 100)'),
    domain: zod_1.z.number().min(1).max(11).default(1).describe('Amazon domain (1=US, 2=UK, 3=DE, etc.)'),
    days: zod_1.z.number().min(1).max(365).optional().describe('Number of days of price history to include'),
    history: zod_1.z.boolean().default(false).describe('Include full price history'),
});
exports.DealSearchSchema = zod_1.z.object({
    domain: zod_1.z.number().min(1).max(11).default(1).describe('Amazon domain (1=US, 2=UK, 3=DE, etc.)'),
    categoryId: zod_1.z.number().optional().describe('Amazon category ID to filter by'),
    minPrice: zod_1.z.number().min(0).optional().describe('Minimum price in cents'),
    maxPrice: zod_1.z.number().min(0).optional().describe('Maximum price in cents'),
    minDiscount: zod_1.z.number().min(0).max(100).optional().describe('Minimum discount percentage'),
    minRating: zod_1.z.number().min(1).max(5).optional().describe('Minimum product rating (1-5 stars)'),
    isPrime: zod_1.z.boolean().optional().describe('Filter for Prime eligible deals only'),
    sortType: zod_1.z.number().min(0).max(4).default(0).describe('Sort type (0=deal score, 1=price, 2=discount, 3=rating, 4=reviews)'),
    page: zod_1.z.number().min(0).default(0).describe('Page number for pagination'),
    perPage: zod_1.z.number().min(1).max(50).default(25).describe('Results per page (max 50)'),
});
exports.SellerLookupSchema = zod_1.z.object({
    seller: zod_1.z.string().describe('Seller ID or name'),
    domain: zod_1.z.number().min(1).max(11).default(1).describe('Amazon domain (1=US, 2=UK, 3=DE, etc.)'),
    storefront: zod_1.z.number().min(0).max(100000).optional().describe('Number of storefront ASINs to retrieve'),
});
exports.BestSellersSchema = zod_1.z.object({
    domain: zod_1.z.number().min(1).max(11).default(1).describe('Amazon domain (1=US, 2=UK, 3=DE, etc.)'),
    category: zod_1.z.number().describe('Amazon category ID'),
    page: zod_1.z.number().min(0).default(0).describe('Page number for pagination'),
});
exports.PriceHistorySchema = zod_1.z.object({
    asin: zod_1.z.string().describe('Amazon ASIN (product identifier)'),
    domain: zod_1.z.number().min(1).max(11).default(1).describe('Amazon domain (1=US, 2=UK, 3=DE, etc.)'),
    dataType: zod_1.z.number().min(0).max(30).describe('Data type (0=Amazon, 1=New, 2=Used, 3=Sales Rank, etc.)'),
    days: zod_1.z.number().min(1).max(365).default(30).describe('Number of days of history'),
});
exports.ProductFinderSchema = zod_1.z.object({
    domain: zod_1.z.number().min(1).max(11).default(1).describe('Amazon domain (1=US, 2=UK, 3=DE, etc.)'),
    categoryId: zod_1.z.number().optional().describe('Amazon category ID to search within'),
    minRating: zod_1.z.number().min(1).max(5).optional().describe('Minimum product rating (1-5 stars)'),
    maxRating: zod_1.z.number().min(1).max(5).optional().describe('Maximum product rating (1-5 stars)'),
    minPrice: zod_1.z.number().min(0).optional().describe('Minimum price in cents'),
    maxPrice: zod_1.z.number().min(0).optional().describe('Maximum price in cents'),
    minShipping: zod_1.z.number().min(0).optional().describe('Minimum shipping cost in cents'),
    maxShipping: zod_1.z.number().min(0).optional().describe('Maximum shipping cost in cents'),
    minMonthlySales: zod_1.z.number().min(0).optional().describe('Minimum estimated monthly sales'),
    maxMonthlySales: zod_1.z.number().min(0).optional().describe('Maximum estimated monthly sales'),
    minSellerCount: zod_1.z.number().min(0).optional().describe('Minimum number of sellers'),
    maxSellerCount: zod_1.z.number().min(0).optional().describe('Maximum number of sellers'),
    sellerCountTimeframe: zod_1.z.enum(['current', '30day', '90day', '180day', '365day']).default('90day').describe('Timeframe for seller count (current, 30day, 90day, 180day, 365day)'),
    isPrime: zod_1.z.boolean().optional().describe('Filter for Prime eligible products only'),
    hasReviews: zod_1.z.boolean().optional().describe('Filter for products with reviews only'),
    productType: zod_1.z.number().min(0).max(2).default(0).optional().describe('Product type (0=standard, 1=variation parent, 2=variation child)'),
    sortBy: zod_1.z.enum(['monthlySold', 'price', 'rating', 'reviewCount', 'salesRank']).default('monthlySold').describe('Sort results by field'),
    sortOrder: zod_1.z.enum(['asc', 'desc']).default('desc').describe('Sort order (ascending or descending)'),
    page: zod_1.z.number().min(0).default(0).describe('Page number for pagination'),
    perPage: zod_1.z.number().min(1).max(50).default(25).describe('Results per page (max 50)'),
});
exports.CategoryAnalysisSchema = zod_1.z.object({
    domain: zod_1.z.number().min(1).max(11).default(1).describe('Amazon domain (1=US, 2=UK, 3=DE, etc.)'),
    categoryId: zod_1.z.number().describe('Amazon category ID to analyze'),
    analysisType: zod_1.z.enum(['overview', 'top_performers', 'opportunities', 'trends']).default('overview').describe('Type of analysis to perform'),
    priceRange: zod_1.z.enum(['budget', 'mid', 'premium', 'luxury']).optional().describe('Focus on specific price range'),
    minRating: zod_1.z.number().min(1).max(5).default(3.0).describe('Minimum rating for products to include'),
    includeSubcategories: zod_1.z.boolean().default(false).describe('Include analysis of subcategories'),
    timeframe: zod_1.z.enum(['week', 'month', 'quarter', 'year']).default('month').describe('Timeframe for trend analysis'),
    sellerCountTimeframe: zod_1.z.enum(['current', '30day', '90day', '180day', '365day']).default('90day').describe('Timeframe for seller count analysis (current, 30day, 90day, 180day, 365day)'),
});
exports.SalesVelocitySchema = zod_1.z.object({
    domain: zod_1.z.number().min(1).max(11).default(1).describe('Amazon domain (1=US, 2=UK, 3=DE, etc.)'),
    categoryId: zod_1.z.number().optional().describe('Amazon category ID to filter by'),
    asin: zod_1.z.string().optional().describe('Single ASIN to analyze'),
    asins: zod_1.z.array(zod_1.z.string()).max(50).optional().describe('Array of ASINs to analyze (max 50)'),
    timeframe: zod_1.z.enum(['week', 'month', 'quarter']).default('month').describe('Time period for velocity calculation'),
    minVelocity: zod_1.z.number().min(0).optional().describe('Minimum daily sales velocity'),
    maxVelocity: zod_1.z.number().min(0).optional().describe('Maximum daily sales velocity'),
    minPrice: zod_1.z.number().min(0).optional().describe('Minimum price in cents'),
    maxPrice: zod_1.z.number().min(0).optional().describe('Maximum price in cents'),
    minRating: zod_1.z.number().min(1).max(5).default(3.0).describe('Minimum product rating'),
    sortBy: zod_1.z.enum(['velocity', 'turnoverRate', 'revenueVelocity', 'trend']).default('velocity').describe('Sort results by metric'),
    sortOrder: zod_1.z.enum(['asc', 'desc']).default('desc').describe('Sort order'),
    sellerCountTimeframe: zod_1.z.enum(['current', '30day', '90day', '180day', '365day']).default('90day').describe('Timeframe for seller count analysis (current, 30day, 90day, 180day, 365day)'),
    page: zod_1.z.number().min(0).default(0).describe('Page number for pagination'),
    perPage: zod_1.z.number().min(1).max(50).default(25).describe('Results per page (max 50)'),
});
exports.InventoryAnalysisSchema = zod_1.z.object({
    domain: zod_1.z.number().min(1).max(11).default(1).describe('Amazon domain (1=US, 2=UK, 3=DE, etc.)'),
    categoryId: zod_1.z.number().optional().describe('Amazon category ID to analyze'),
    asins: zod_1.z.array(zod_1.z.string()).max(100).optional().describe('Specific ASINs to analyze (your inventory)'),
    analysisType: zod_1.z.enum(['overview', 'fast_movers', 'slow_movers', 'stockout_risks', 'seasonal']).default('overview').describe('Type of inventory analysis'),
    timeframe: zod_1.z.enum(['week', 'month', 'quarter']).default('month').describe('Analysis timeframe'),
    sellerCountTimeframe: zod_1.z.enum(['current', '30day', '90day', '180day', '365day']).default('90day').describe('Timeframe for seller count analysis (current, 30day, 90day, 180day, 365day)'),
    targetTurnoverRate: zod_1.z.number().min(1).max(50).default(12).describe('Target inventory turns per year'),
});
exports.TokenStatusSchema = zod_1.z.object({});
class KeepaTools {
    client;
    constructor(client) {
        this.client = client;
    }
    async lookupProduct(params) {
        try {
            const product = await this.client.getProductByAsin(params.asin, params.domain, {
                days: params.days,
                history: params.history,
                offers: params.offers,
                variations: params.variations,
                rating: params.rating,
            });
            if (!product) {
                return `Product not found for ASIN: ${params.asin}`;
            }
            const domain = params.domain;
            const domainName = this.client.getDomainName(domain);
            let result = `**Product Information for ${params.asin}**\n\n`;
            result += `🏪 **Marketplace**: ${domainName}\n`;
            result += `📦 **Title**: ${product.title || 'N/A'}\n`;
            result += `🏷️ **Brand**: ${product.brand || 'N/A'}\n`;
            result += `📊 **Category**: ${product.productGroup || 'N/A'}\n`;
            if (product.stats) {
                const currentPrice = product.stats.current[0];
                if (currentPrice && currentPrice !== -1) {
                    result += `💰 **Current Price**: ${this.client.formatPrice(currentPrice, domain)}\n`;
                }
                const avgPrice = product.stats.avg[0];
                if (avgPrice && avgPrice !== -1) {
                    result += `📈 **Average Price**: ${this.client.formatPrice(avgPrice, domain)}\n`;
                }
                if (product.stats.salesRankReference) {
                    result += `📊 **Sales Rank**: #${product.stats.salesRankReference.toLocaleString()}\n`;
                }
            }
            if (params.rating && product.stats?.current[16]) {
                const rating = product.stats.current[16] / 10;
                const reviewCount = product.stats.current[17];
                result += `⭐ **Rating**: ${rating.toFixed(1)}/5.0 (${reviewCount} reviews)\n`;
            }
            if (product.offers && product.offers.length > 0) {
                result += `\n**Marketplace Offers**: ${product.offers.length} available\n`;
                const topOffers = product.offers.slice(0, 3);
                topOffers.forEach((offer, i) => {
                    result += `${i + 1}. ${offer.isAmazon ? '🟦 Amazon' : '🏪 3P Seller'} - `;
                    result += `${offer.isPrime ? '⚡ Prime' : 'Standard'} - `;
                    result += `${offer.isFBA ? 'FBA' : 'FBM'}\n`;
                });
            }
            if (params.variations && product.variations && product.variations.length > 0) {
                result += `\n**Variations**: ${product.variations.length} available\n`;
            }
            return result;
        }
        catch (error) {
            return `Error looking up product: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
    }
    async batchLookupProducts(params) {
        try {
            const products = await this.client.getProductsBatch(params.asins, params.domain, {
                days: params.days,
                history: params.history,
            });
            const domain = params.domain;
            const domainName = this.client.getDomainName(domain);
            let result = `**Batch Product Lookup Results (${products.length}/${params.asins.length} found)**\n\n`;
            result += `🏪 **Marketplace**: ${domainName}\n\n`;
            products.forEach((product, i) => {
                result += `**${i + 1}. ${product.asin}**\n`;
                result += `📦 ${product.title || 'N/A'}\n`;
                result += `🏷️ ${product.brand || 'N/A'}\n`;
                if (product.stats?.current[0] && product.stats.current[0] !== -1) {
                    result += `💰 ${this.client.formatPrice(product.stats.current[0], domain)}\n`;
                }
                if (product.stats?.salesRankReference) {
                    result += `📊 Rank: #${product.stats.salesRankReference.toLocaleString()}\n`;
                }
                result += '\n';
            });
            const notFound = params.asins.filter(asin => !products.some(product => product.asin === asin));
            if (notFound.length > 0) {
                result += `**Not Found**: ${notFound.join(', ')}\n`;
            }
            return result;
        }
        catch (error) {
            return `Error in batch lookup: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
    }
    async searchDeals(params) {
        try {
            const deals = await this.client.getDeals({
                domainId: params.domain,
                categoryId: params.categoryId,
                minPrice: params.minPrice,
                maxPrice: params.maxPrice,
                minDiscount: params.minDiscount,
                minRating: params.minRating,
                isPrime: params.isPrime,
                sortType: params.sortType,
                page: params.page,
                perPage: params.perPage,
            });
            if (deals.length === 0) {
                return 'No deals found matching your criteria.';
            }
            const domain = params.domain;
            const domainName = this.client.getDomainName(domain);
            let result = `**Amazon Deals Found: ${deals.length}**\n\n`;
            result += `🏪 **Marketplace**: ${domainName}\n\n`;
            deals.forEach((deal, i) => {
                result += `**${i + 1}. ${deal.asin}**\n`;
                result += `📦 **${deal.title}**\n`;
                result += `🏷️ Brand: ${deal.brand || 'N/A'}\n`;
                result += `💰 **Price**: ${this.client.formatPrice(deal.price, domain)}`;
                if (deal.shipping > 0) {
                    result += ` + ${this.client.formatPrice(deal.shipping, domain)} shipping`;
                }
                result += '\n';
                result += `📊 **Discount**: ${deal.deltaPercent}% (${this.client.formatPrice(Math.abs(deal.delta), domain)} off)\n`;
                result += `📈 **Avg Price**: ${this.client.formatPrice(deal.avgPrice, domain)}\n`;
                result += `🏆 **Deal Score**: ${deal.dealScore}\n`;
                if (deal.salesRank) {
                    result += `📊 **Sales Rank**: #${deal.salesRank.toLocaleString()}\n`;
                }
                if (deal.isLightningDeal) {
                    result += `⚡ **Lightning Deal**\n`;
                }
                if (deal.isPrimeExclusive) {
                    result += `🔥 **Prime Exclusive**\n`;
                }
                if (deal.coupon) {
                    result += `🎫 **Coupon**: ${deal.coupon}% additional discount\n`;
                }
                result += '\n';
            });
            return result;
        }
        catch (error) {
            return `Error searching deals: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
    }
    async lookupSeller(params) {
        try {
            const sellers = await this.client.getSeller({
                seller: params.seller,
                domain: params.domain,
                storefront: params.storefront,
            });
            if (sellers.length === 0) {
                return `Seller not found: ${params.seller}`;
            }
            const seller = sellers[0];
            const domain = params.domain;
            const domainName = this.client.getDomainName(domain);
            let result = `**Seller Information**\n\n`;
            result += `🏪 **Marketplace**: ${domainName}\n`;
            result += `🏷️ **Seller ID**: ${seller.sellerId}\n`;
            result += `📛 **Name**: ${seller.sellerName}\n`;
            result += `⭐ **Rating**: ${seller.avgRating ? `${seller.avgRating}/5.0` : 'N/A'}\n`;
            result += `📊 **Rating Count**: ${seller.ratingCount?.toLocaleString() || 'N/A'}\n`;
            result += `🚩 **Scammer Status**: ${seller.isScammer ? '⚠️ Flagged as scammer' : '✅ Clean'}\n`;
            result += `📦 **Amazon Seller**: ${seller.isAmazon ? 'Yes' : 'No'}\n`;
            result += `🚚 **FBA Available**: ${seller.hasFBA ? 'Yes' : 'No'}\n`;
            result += `📮 **FBM Available**: ${seller.hasFBM ? 'Yes' : 'No'}\n`;
            if (seller.totalStorefrontAsins) {
                result += `🏪 **Total Products**: ${seller.totalStorefrontAsins.toLocaleString()}\n`;
            }
            if (seller.startDate) {
                const startDate = new Date(this.client.keepaTimeToUnixTime(seller.startDate));
                result += `📅 **Started Selling**: ${startDate.toLocaleDateString()}\n`;
            }
            if (seller.storefront && seller.storefront.length > 0) {
                result += `\n**Sample Storefront Products**: ${Math.min(5, seller.storefront.length)} shown\n`;
                seller.storefront.slice(0, 5).forEach((asin, i) => {
                    result += `${i + 1}. ${asin}\n`;
                });
                if (seller.storefront.length > 5) {
                    result += `... and ${seller.storefront.length - 5} more\n`;
                }
            }
            return result;
        }
        catch (error) {
            return `Error looking up seller: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
    }
    async getBestSellers(params) {
        try {
            const bestSellers = await this.client.getBestSellers({
                domain: params.domain,
                category: params.category,
                page: params.page,
            });
            if (bestSellers.length === 0) {
                return `No best sellers found for category ${params.category}`;
            }
            const domain = params.domain;
            const domainName = this.client.getDomainName(domain);
            let result = `**Best Sellers - Category ${params.category}**\n\n`;
            result += `🏪 **Marketplace**: ${domainName}\n`;
            result += `📊 **Found**: ${bestSellers.length} products\n\n`;
            bestSellers.forEach((product, i) => {
                const rank = params.page * 100 + i + 1;
                result += `**#${rank} - ${product.asin}**\n`;
                result += `📦 **${product.title}**\n`;
                result += `📊 **Sales Rank**: #${product.salesRank.toLocaleString()}\n`;
                if (product.price) {
                    result += `💰 **Price**: ${this.client.formatPrice(product.price, domain)}\n`;
                }
                if (product.rating && product.reviewCount) {
                    result += `⭐ **Rating**: ${product.rating}/5.0 (${product.reviewCount.toLocaleString()} reviews)\n`;
                }
                result += `🚚 **Prime**: ${product.isPrime ? 'Yes' : 'No'}\n`;
                result += '\n';
            });
            return result;
        }
        catch (error) {
            return `Error getting best sellers: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
    }
    async getPriceHistory(params) {
        try {
            const product = await this.client.getProductByAsin(params.asin, params.domain, {
                days: params.days,
                history: true,
            });
            if (!product || !product.csv) {
                return `No price history found for ASIN: ${params.asin}`;
            }
            const priceData = this.client.parseCSVData(product.csv, params.dataType);
            if (priceData.length === 0) {
                return `No data available for the specified data type (${params.dataType})`;
            }
            const domain = params.domain;
            const domainName = this.client.getDomainName(domain);
            const dataTypeNames = {
                [types_1.KeepaDataType.AMAZON]: 'Amazon Price',
                [types_1.KeepaDataType.NEW]: 'New Price',
                [types_1.KeepaDataType.USED]: 'Used Price',
                [types_1.KeepaDataType.SALES_RANK]: 'Sales Rank',
                [types_1.KeepaDataType.RATING]: 'Rating',
                [types_1.KeepaDataType.COUNT_REVIEWS]: 'Review Count',
            };
            const dataTypeName = dataTypeNames[params.dataType] || `Data Type ${params.dataType}`;
            let result = `**Price History for ${params.asin}**\n\n`;
            result += `🏪 **Marketplace**: ${domainName}\n`;
            result += `📊 **Data Type**: ${dataTypeName}\n`;
            result += `📅 **Period**: Last ${params.days} days\n`;
            result += `📈 **Data Points**: ${priceData.length}\n\n`;
            if (priceData.length > 0) {
                const latest = priceData[priceData.length - 1];
                const oldest = priceData[0];
                result += `**Latest Value**: `;
                if (params.dataType <= 2 || params.dataType === 18) {
                    result += `${this.client.formatPrice(latest.value, domain)}\n`;
                }
                else {
                    result += `${latest.value.toLocaleString()}\n`;
                }
                result += `**Date**: ${new Date(latest.timestamp).toLocaleDateString()}\n\n`;
                if (params.dataType <= 2 || params.dataType === 18) {
                    const prices = priceData.map(d => d.value).filter(v => v > 0);
                    if (prices.length > 0) {
                        const min = Math.min(...prices);
                        const max = Math.max(...prices);
                        const avg = prices.reduce((sum, price) => sum + price, 0) / prices.length;
                        result += `**Price Statistics**:\n`;
                        result += `• Minimum: ${this.client.formatPrice(min, domain)}\n`;
                        result += `• Maximum: ${this.client.formatPrice(max, domain)}\n`;
                        result += `• Average: ${this.client.formatPrice(Math.round(avg), domain)}\n\n`;
                    }
                }
                result += `**Recent History** (last 10 data points):\n`;
                const recentData = priceData.slice(-10);
                recentData.forEach((point, i) => {
                    const date = new Date(point.timestamp).toLocaleDateString();
                    let value;
                    if (params.dataType <= 2 || params.dataType === 18) {
                        value = this.client.formatPrice(point.value, domain);
                    }
                    else {
                        value = point.value.toLocaleString();
                    }
                    result += `${recentData.length - i}. ${date}: ${value}\n`;
                });
            }
            return result;
        }
        catch (error) {
            return `Error getting price history: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
    }
    async findProducts(params) {
        try {
            const domain = params.domain;
            const domainName = this.client.getDomainName(domain);
            let result = `**Amazon Product Finder Results**\n\n`;
            result += `🏪 **Marketplace**: ${domainName}\n`;
            result += `🔍 **Search Criteria**:\n`;
            if (params.categoryId) {
                result += `• Category: ${params.categoryId}\n`;
            }
            if (params.minRating || params.maxRating) {
                const min = params.minRating || 1;
                const max = params.maxRating || 5;
                result += `• Rating: ${min}-${max} stars\n`;
            }
            if (params.minPrice || params.maxPrice) {
                const min = params.minPrice ? this.client.formatPrice(params.minPrice, domain) : 'Any';
                const max = params.maxPrice ? this.client.formatPrice(params.maxPrice, domain) : 'Any';
                result += `• Price: ${min} - ${max}\n`;
            }
            if (params.minShipping || params.maxShipping) {
                const min = params.minShipping ? this.client.formatPrice(params.minShipping, domain) : 'Any';
                const max = params.maxShipping ? this.client.formatPrice(params.maxShipping, domain) : 'Any';
                result += `• Shipping: ${min} - ${max}\n`;
            }
            if (params.minMonthlySales || params.maxMonthlySales) {
                const min = params.minMonthlySales?.toLocaleString() || 'Any';
                const max = params.maxMonthlySales?.toLocaleString() || 'Any';
                result += `• Monthly Sales: ${min} - ${max}\n`;
            }
            if (params.minSellerCount || params.maxSellerCount) {
                const min = params.minSellerCount || 'Any';
                const max = params.maxSellerCount || 'Any';
                const timeframeDesc = params.sellerCountTimeframe === '90day' ? '90-day average' :
                    params.sellerCountTimeframe === 'current' ? 'current' :
                        params.sellerCountTimeframe === '30day' ? '30-day average' :
                            params.sellerCountTimeframe === '180day' ? '180-day average' :
                                '365-day average';
                result += `• Seller Count: ${min} - ${max} (${timeframeDesc})\n`;
            }
            if (params.isPrime !== undefined) {
                result += `• Prime Only: ${params.isPrime ? 'Yes' : 'No'}\n`;
            }
            if (params.hasReviews !== undefined) {
                result += `• Has Reviews: ${params.hasReviews ? 'Yes' : 'No'}\n`;
            }
            result += `• Sort: ${params.sortBy} (${params.sortOrder})\n\n`;
            // Make real API call to Keepa
            const products = await this.client.searchProducts(params);
            if (products.length === 0) {
                result += `❌ **No products found** matching your criteria.\n\n`;
                result += `**Suggestions:**\n`;
                result += `• Try widening your price range\n`;
                result += `• Reduce minimum rating requirements\n`;
                result += `• Remove category restrictions\n`;
                result += `• Adjust monthly sales thresholds\n`;
                return result;
            }
            result += `📊 **Found ${products.length} products** (Page ${params.page + 1}):\n\n`;
            products.forEach((product, i) => {
                const rank = params.page * params.perPage + i + 1;
                const title = product.title || product.productTitle || 'Unknown Product';
                const monthlySold = product.monthlySold || product.stats?.monthlySold || 0;
                const rating = product.stats?.current_RATING ? product.stats.current_RATING / 10 : product.rating;
                const reviewCount = product.stats?.current_COUNT_REVIEWS || product.reviewCount;
                const price = product.stats?.current_AMAZON || product.price;
                const shipping = product.stats?.current_BUY_BOX_SHIPPING || product.shipping;
                const salesRank = product.stats?.current_SALES || product.salesRank;
                const sellerInfo = this.client.getSellerCount(product, params.sellerCountTimeframe);
                const sellerCount = sellerInfo.count;
                // Determine competition level
                let competition = 'Medium';
                if (sellerCount <= 3)
                    competition = 'Low';
                else if (sellerCount >= 10)
                    competition = 'High';
                result += `**${rank}. ${product.asin}** ${competition === 'Low' ? '🟢' : competition === 'Medium' ? '🟡' : '🔴'}\n`;
                result += `📦 **${title}**\n`;
                if (product.brand) {
                    result += `🏷️ Brand: ${product.brand}\n`;
                }
                if (price && price > 0) {
                    result += `💰 **Price**: ${this.client.formatPrice(price, domain)}`;
                    if (shipping && shipping > 0) {
                        result += ` + ${this.client.formatPrice(shipping, domain)} shipping`;
                    }
                    result += '\n';
                }
                if (rating && reviewCount) {
                    result += `⭐ **Rating**: ${rating.toFixed(1)}/5.0 (${reviewCount.toLocaleString()} reviews)\n`;
                }
                if (monthlySold && monthlySold > 0) {
                    result += `📈 **Monthly Sales**: ~${monthlySold.toLocaleString()} units\n`;
                }
                if (salesRank) {
                    result += `📊 **Sales Rank**: #${salesRank.toLocaleString()}\n`;
                }
                result += `🏪 **Sellers**: ${sellerCount} (${sellerInfo.description})\n`;
                if (product.isPrime) {
                    result += `⚡ **Prime Eligible**\n`;
                }
                // Calculate estimated profit margin
                if (price && price > 1000) {
                    const estimatedMargin = Math.max(15, Math.min(40, 30 - (sellerCount * 2)));
                    result += `💹 **Est. Profit Margin**: ${estimatedMargin}%\n`;
                }
                result += `🎯 **Competition**: ${competition}\n\n`;
            });
            result += `**💡 Pro Tips:**\n`;
            result += `• Green dots (🟢) indicate low competition opportunities\n`;
            result += `• High monthly sales + low competition = potential goldmine\n`;
            result += `• Check review velocity and listing quality before proceeding\n`;
            result += `• Use price history tool for deeper market analysis\n`;
            return result;
        }
        catch (error) {
            console.error('Product finder error:', error);
            const errorMessage = error instanceof Error ? error.message :
                typeof error === 'string' ? error :
                    JSON.stringify(error);
            return `Error in product finder: ${errorMessage}`;
        }
    }
    async analyzeCategory(params) {
        try {
            const domain = params.domain;
            const domainName = this.client.getDomainName(domain);
            let result = `**📊 Category Analysis Report**\n\n`;
            result += `🏪 **Marketplace**: ${domainName}\n`;
            result += `🏷️ **Category**: ID ${params.categoryId}\n`;
            result += `📈 **Analysis Type**: ${params.analysisType.charAt(0).toUpperCase() + params.analysisType.slice(1).replace('_', ' ')}\n`;
            result += `⏱️ **Timeframe**: ${params.timeframe}\n\n`;
            // Get real data based on analysis type
            switch (params.analysisType) {
                case 'overview':
                    result += await this.getCategoryOverview(params, domain);
                    break;
                case 'top_performers':
                    result += await this.getTopPerformers(params, domain);
                    break;
                case 'opportunities':
                    result += await this.getOpportunities(params, domain);
                    break;
                case 'trends':
                    result += await this.getTrends(params, domain);
                    break;
            }
            return result;
        }
        catch (error) {
            console.error('Category analysis error:', error);
            const errorMessage = error instanceof Error ? error.message :
                typeof error === 'string' ? error :
                    JSON.stringify(error);
            return `Error analyzing category: ${errorMessage}`;
        }
    }
    async getCategoryOverview(params, domain) {
        // Get best sellers for overview
        const bestSellers = await this.client.getBestSellers({
            domain: params.domain,
            category: params.categoryId,
            page: 0
        });
        // Get some products from the category using search
        const categoryProducts = await this.client.searchProducts({
            domain: params.domain,
            categoryId: params.categoryId,
            minRating: params.minRating,
            perPage: 20,
            sortBy: 'monthlySold'
        });
        let result = `**📈 Category Overview**\n\n`;
        if (bestSellers.length > 0) {
            result += `🏆 **Best Sellers**: ${bestSellers.length} products found\n`;
            result += `💰 **Price Range**: ${this.client.formatPrice(Math.min(...bestSellers.filter(p => p.price).map(p => p.price)), domain)} - ${this.client.formatPrice(Math.max(...bestSellers.filter(p => p.price).map(p => p.price)), domain)}\n`;
        }
        if (categoryProducts.length > 0) {
            const avgRating = categoryProducts
                .filter(p => p.stats?.current_RATING)
                .reduce((sum, p) => sum + (p.stats.current_RATING / 10), 0) / categoryProducts.length;
            result += `⭐ **Average Rating**: ${avgRating.toFixed(1)}/5.0\n`;
            result += `📊 **Sample Size**: ${categoryProducts.length} products analyzed\n\n`;
        }
        result += `**🎯 Market Insights:**\n`;
        result += `• Category shows ${categoryProducts.length > 15 ? 'high' : categoryProducts.length > 8 ? 'moderate' : 'low'} product diversity\n`;
        result += `• Competition level appears ${bestSellers.length > 50 ? 'high' : bestSellers.length > 20 ? 'moderate' : 'manageable'}\n`;
        result += `• Price points span multiple market segments\n\n`;
        return result;
    }
    async getTopPerformers(params, domain) {
        const topProducts = await this.client.searchProducts({
            domain: params.domain,
            categoryId: params.categoryId,
            minRating: Math.max(4.0, params.minRating || 4.0),
            sortBy: 'monthlySold',
            sortOrder: 'desc',
            perPage: 10
        });
        let result = `**🏆 Top Performers**\n\n`;
        if (topProducts.length === 0) {
            result += `❌ No top performers found in this category.\n\n`;
            return result;
        }
        topProducts.forEach((product, i) => {
            const title = product.title || product.productTitle || `Product ${product.asin}`;
            const rating = product.stats?.current_RATING ? product.stats.current_RATING / 10 : 0;
            const monthlySold = product.monthlySold || 0;
            const price = product.stats?.current_AMAZON || 0;
            result += `**${i + 1}. ${title.substring(0, 50)}${title.length > 50 ? '...' : ''}**\n`;
            result += `📦 ASIN: ${product.asin}\n`;
            if (rating > 0)
                result += `⭐ ${rating.toFixed(1)}/5.0\n`;
            if (monthlySold > 0)
                result += `📈 ~${monthlySold.toLocaleString()} monthly sales\n`;
            if (price > 0)
                result += `💰 ${this.client.formatPrice(price, domain)}\n`;
            result += `\n`;
        });
        return result;
    }
    async getOpportunities(params, domain) {
        // Look for products with good ratings but low competition (few sellers)
        const opportunities = await this.client.searchProducts({
            domain: params.domain,
            categoryId: params.categoryId,
            minRating: 4.0,
            maxSellerCount: 5,
            minMonthlySales: 500,
            sortBy: 'monthlySold',
            sortOrder: 'desc',
            perPage: 15
        });
        let result = `**🎯 Market Opportunities**\n\n`;
        if (opportunities.length === 0) {
            result += `❌ No clear opportunities found with current criteria.\n`;
            result += `💡 Try expanding search criteria or exploring subcategories.\n\n`;
            return result;
        }
        result += `Found ${opportunities.length} potential opportunities with low competition:\n\n`;
        opportunities.slice(0, 8).forEach((product, i) => {
            const title = product.title || product.productTitle || `Product ${product.asin}`;
            const rating = product.stats?.current_RATING ? product.stats.current_RATING / 10 : 0;
            const sellerInfo = this.client.getSellerCount(product, params.sellerCountTimeframe);
            const sellerCount = sellerInfo.count;
            const monthlySold = product.monthlySold || 0;
            result += `**${i + 1}. ${title.substring(0, 40)}${title.length > 40 ? '...' : ''}** 🟢\n`;
            result += `📦 ${product.asin} | ⭐ ${rating.toFixed(1)} | 👥 ${sellerCount} sellers (${sellerInfo.description}) | 📈 ${monthlySold} monthly\n\n`;
        });
        result += `**💡 Opportunity Insights:**\n`;
        result += `• Low seller count indicates less competition\n`;
        result += `• Good ratings suggest market acceptance\n`;
        result += `• Monthly sales show proven demand\n\n`;
        return result;
    }
    async getTrends(params, domain) {
        // Get recent products and best sellers to analyze trends
        const recentProducts = await this.client.searchProducts({
            domain: params.domain,
            categoryId: params.categoryId,
            sortBy: 'monthlySold',
            sortOrder: 'desc',
            perPage: 20
        });
        let result = `**📊 Category Trends**\n\n`;
        if (recentProducts.length === 0) {
            result += `❌ Insufficient data for trend analysis.\n\n`;
            return result;
        }
        // Analyze price trends
        const prices = recentProducts
            .filter(p => p.stats?.current_AMAZON && p.stats.current_AMAZON > 0)
            .map(p => p.stats.current_AMAZON);
        if (prices.length > 0) {
            const avgPrice = prices.reduce((sum, price) => sum + price, 0) / prices.length;
            const medianPrice = prices.sort((a, b) => a - b)[Math.floor(prices.length / 2)];
            result += `**💰 Pricing Trends:**\n`;
            result += `• Average Price: ${this.client.formatPrice(avgPrice, domain)}\n`;
            result += `• Median Price: ${this.client.formatPrice(medianPrice, domain)}\n`;
            result += `• Price Range: ${this.client.formatPrice(Math.min(...prices), domain)} - ${this.client.formatPrice(Math.max(...prices), domain)}\n\n`;
        }
        // Analyze rating trends
        const ratings = recentProducts
            .filter(p => p.stats?.current_RATING)
            .map(p => p.stats.current_RATING / 10);
        if (ratings.length > 0) {
            const avgRating = ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length;
            const highRatedCount = ratings.filter(r => r >= 4.5).length;
            result += `**⭐ Quality Trends:**\n`;
            result += `• Average Rating: ${avgRating.toFixed(1)}/5.0\n`;
            result += `• High-Rated Products (4.5+): ${highRatedCount}/${ratings.length} (${Math.round(highRatedCount / ratings.length * 100)}%)\n\n`;
        }
        result += `**📈 Market Insights:**\n`;
        result += `• Category appears ${ratings.length > 15 ? 'mature' : 'developing'} with ${recentProducts.length} active products\n`;
        result += `• Quality standards are ${ratings.length > 0 && ratings.reduce((sum, r) => sum + r, 0) / ratings.length > 4.0 ? 'high' : 'moderate'}\n`;
        result += `• Competition level suggests ${prices.length > 0 && prices.length > 10 ? 'saturated' : 'growing'} market\n\n`;
        return result;
    }
    generateRecommendations(params, insights) {
        const recommendations = [];
        if (insights.opportunityScore > 70) {
            recommendations.push('🎯 High opportunity category - consider immediate entry with differentiated product');
        }
        else if (insights.opportunityScore > 40) {
            recommendations.push('⚖️ Moderate opportunity - focus on niche segments or product improvements');
        }
        else {
            recommendations.push('⚠️ Saturated market - only enter with significant competitive advantages');
        }
        if (insights.competitionLevel === 'Low') {
            recommendations.push('🟢 Low competition detected - opportunity for premium positioning');
        }
        else if (insights.competitionLevel === 'High') {
            recommendations.push('🔴 High competition - focus on unique value propositions and cost optimization');
        }
        if (insights.averagePrice > 5000) {
            recommendations.push('💰 Higher price point category - justify premium with quality and features');
        }
        else {
            recommendations.push('💸 Price-sensitive market - optimize for cost-effectiveness and value');
        }
        if (params.analysisType === 'opportunities') {
            recommendations.push('🔍 Use Product Finder tool to identify specific low-competition products');
            recommendations.push('📊 Analyze top performers for successful product patterns');
        }
        recommendations.push('📈 Monitor trends regularly to time market entry/exit decisions');
        return recommendations;
    }
    async analyzeSalesVelocity(params) {
        try {
            const domain = params.domain;
            const domainName = this.client.getDomainName(domain);
            let result = `**🚀 Sales Velocity Analysis**\n\n`;
            result += `🏪 **Marketplace**: ${domainName}\n`;
            result += `⏱️ **Timeframe**: ${params.timeframe}\n`;
            result += `📊 **Sort By**: ${params.sortBy} (${params.sortOrder})\n\n`;
            // Get real sales velocity data from Keepa API
            const velocityData = await this.getRealSalesVelocityData(params, domain);
            if (velocityData.length === 0) {
                result += `❌ **No products found** matching your velocity criteria.\n\n`;
                result += `**Suggestions:**\n`;
                result += `• Lower minimum velocity requirements\n`;
                result += `• Expand price range filters\n`;
                result += `• Try different category or remove category filter\n`;
                return result;
            }
            result += `📈 **Found ${velocityData.length} products** with velocity data:\n\n`;
            velocityData.forEach((product, i) => {
                const rank = params.page * params.perPage + i + 1;
                result += `**${rank}. ${product.asin}** ${this.getVelocityIndicator(product.salesVelocity.trend)}\n`;
                result += `📦 **${product.title}**\n`;
                result += `🏷️ Brand: ${product.brand || 'N/A'}\n`;
                result += `💰 Price: ${this.client.formatPrice(product.price, domain)}\n\n`;
                result += `**📊 Sales Velocity:**\n`;
                result += `• Daily: ${product.salesVelocity.daily} units\n`;
                result += `• Weekly: ${product.salesVelocity.weekly} units\n`;
                result += `• Monthly: ${product.salesVelocity.monthly} units\n`;
                result += `• Trend: ${product.salesVelocity.trend} (${product.salesVelocity.changePercent > 0 ? '+' : ''}${product.salesVelocity.changePercent}%)\n\n`;
                result += `**📦 Inventory Metrics:**\n`;
                result += `• Turnover Rate: ${product.inventoryMetrics.turnoverRate}x/month\n`;
                result += `• Days of Inventory: ${product.inventoryMetrics.daysOfInventory} days\n`;
                result += `• Stockout Risk: ${product.inventoryMetrics.stockoutRisk} ${this.getRiskEmoji(product.inventoryMetrics.stockoutRisk)}\n`;
                result += `• Recommended Order: ${product.inventoryMetrics.recommendedOrderQuantity} units\n\n`;
                result += `**💰 Revenue Metrics:**\n`;
                result += `• Revenue Velocity: ${this.client.formatPrice(product.profitability.revenueVelocity * 100, domain)}/day\n`;
                result += `• Est. Gross Margin: ${product.profitability.grossMarginEstimate}%\n`;
                result += `• Profit Velocity: ${this.client.formatPrice(product.profitability.profitVelocity * 100, domain)}/day\n\n`;
                result += `**📈 Market Info:**\n`;
                result += `• Rating: ${product.marketMetrics.rating}/5.0 (${product.marketMetrics.reviewCount} reviews)\n`;
                result += `• Sales Rank: #${product.marketMetrics.salesRank.toLocaleString()}\n`;
                result += `• Competition: ${product.marketMetrics.competition}\n`;
                result += `• Seasonality: ${product.marketMetrics.seasonality}\n`;
                if (product.alerts.length > 0) {
                    result += `\n**⚠️ Alerts:**\n`;
                    product.alerts.forEach(alert => {
                        result += `• ${alert}\n`;
                    });
                }
                result += '\n---\n\n';
            });
            result += `**💡 Key Insights:**\n`;
            const fastMovers = velocityData.filter(p => p.salesVelocity.monthly >= 30).length;
            const slowMovers = velocityData.filter(p => p.salesVelocity.monthly < 10).length;
            const highRisk = velocityData.filter(p => p.inventoryMetrics.stockoutRisk === 'High').length;
            result += `• Fast Movers (>30/month): ${fastMovers} products\n`;
            result += `• Slow Movers (<10/month): ${slowMovers} products\n`;
            result += `• High Stockout Risk: ${highRisk} products\n`;
            result += `• Average Turnover: ${(velocityData.reduce((sum, p) => sum + p.inventoryMetrics.turnoverRate, 0) / velocityData.length).toFixed(1)}x/month\n\n`;
            result += `**🎯 Inventory Recommendations:**\n`;
            result += `• Focus on products with >20 units/month for consistent cash flow\n`;
            result += `• Avoid products with >30 days of inventory unless seasonal\n`;
            result += `• Monitor high stockout risk products for reorder points\n`;
            result += `• Consider increasing orders for accelerating trend products\n`;
            return result;
        }
        catch (error) {
            return `Error analyzing sales velocity: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
    }
    async getRealSalesVelocityData(params, domain) {
        let products = [];
        // If specific ASINs provided, get those products
        if (params.asin) {
            const product = await this.client.getProduct({
                asin: params.asin,
                domain: params.domain,
                history: true,
                rating: true
            });
            if (product.length > 0)
                products = product;
        }
        else if (params.asins && params.asins.length > 0) {
            products = await this.client.getProduct({
                asins: params.asins,
                domain: params.domain,
                history: true,
                rating: true
            });
        }
        else {
            // Search for products in category with sales velocity criteria
            const searchParams = {
                domain: params.domain,
                sortBy: 'monthlySold',
                sortOrder: params.sortOrder,
                perPage: params.perPage,
                page: params.page
            };
            if (params.categoryId)
                searchParams.categoryId = params.categoryId;
            if (params.minPrice)
                searchParams.minPrice = params.minPrice;
            if (params.maxPrice)
                searchParams.maxPrice = params.maxPrice;
            if (params.minRating)
                searchParams.minRating = params.minRating;
            if (params.minVelocity)
                searchParams.minMonthlySales = params.minVelocity * 30; // Convert daily to monthly
            if (params.maxVelocity)
                searchParams.maxMonthlySales = params.maxVelocity * 30; // Convert daily to monthly
            products = await this.client.searchProducts(searchParams);
        }
        // Convert to SalesVelocityData format
        const velocityData = products.map((product) => {
            const monthlySold = product.monthlySold || product.stats?.monthlySold || 0;
            const dailyVelocity = monthlySold / 30;
            const price = product.stats?.current_AMAZON || product.price || 0;
            const salesRank = product.stats?.current_SALES || product.salesRank || 0;
            const rating = product.stats?.current_RATING ? product.stats.current_RATING / 10 : product.rating || 0;
            // Calculate velocity metrics
            const monthlyRevenue = monthlySold * (price / 100); // Convert cents to dollars
            const turnoverRate = monthlySold > 0 ? Math.min(52, Math.round((monthlySold * 12) / 100)) : 1; // Estimate annual turns
            // Determine trend based on sales rank and velocity
            let trend = 'Stable';
            if (dailyVelocity > 50)
                trend = 'Accelerating';
            else if (dailyVelocity < 5)
                trend = 'Declining';
            // Calculate risk factors
            const seasonality = monthlySold > 1000 && salesRank < 10000 ? 'Low' : monthlySold < 100 ? 'High' : 'Medium';
            const sellerInfo = this.client.getSellerCount(product, params.sellerCountTimeframe);
            const sellerCount = sellerInfo.count;
            const competition = sellerCount > 10 ? 'High' : sellerCount < 5 ? 'Low' : 'Medium';
            // Calculate profitability metrics
            const grossMarginPercent = Math.max(15, Math.min(40, 35 - sellerCount * 2));
            const dailyRevenue = dailyVelocity * (price / 100);
            const dailyProfit = dailyRevenue * (grossMarginPercent / 100);
            const alerts = [];
            if (dailyVelocity > 20)
                alerts.push('High velocity - monitor inventory levels');
            if (dailyVelocity < 3)
                alerts.push('Low velocity - consider promotion or markdown');
            if (sellerCount > 8)
                alerts.push('High competition - monitor pricing');
            return {
                asin: product.asin,
                title: product.title || product.productTitle || 'Unknown Product',
                brand: product.brand || 'Unknown',
                price: price,
                salesVelocity: {
                    daily: Math.round(dailyVelocity * 10) / 10,
                    weekly: Math.round(dailyVelocity * 7 * 10) / 10,
                    monthly: monthlySold,
                    trend: trend,
                    changePercent: trend === 'Accelerating' ? Math.round(dailyVelocity / 10 * 5) :
                        trend === 'Declining' ? -Math.round(dailyVelocity / 10 * 3) : 0
                },
                inventoryMetrics: {
                    turnoverRate: turnoverRate,
                    daysOfInventory: Math.round(100 / Math.max(dailyVelocity, 0.1)),
                    stockoutRisk: dailyVelocity > 20 ? 'High' : dailyVelocity > 5 ? 'Medium' : 'Low',
                    recommendedOrderQuantity: Math.round(dailyVelocity * 30) // 30 days of supply
                },
                marketMetrics: {
                    rating: rating,
                    reviewCount: product.stats?.current_COUNT_REVIEWS || product.reviewCount || 0,
                    salesRank: salesRank,
                    competition: competition,
                    seasonality: seasonality
                },
                profitability: {
                    revenueVelocity: Math.round(dailyRevenue * 100) / 100,
                    grossMarginEstimate: grossMarginPercent,
                    profitVelocity: Math.round(dailyProfit * 100) / 100
                },
                alerts: alerts
            };
        });
        // Filter by velocity if specified
        let filteredData = velocityData;
        if (params.minVelocity) {
            filteredData = filteredData.filter(p => p.salesVelocity.daily >= params.minVelocity);
        }
        if (params.maxVelocity) {
            filteredData = filteredData.filter(p => p.salesVelocity.daily <= params.maxVelocity);
        }
        // Sort by the specified metric
        filteredData.sort((a, b) => {
            let aValue, bValue;
            switch (params.sortBy) {
                case 'velocity':
                    aValue = a.salesVelocity.daily;
                    bValue = b.salesVelocity.daily;
                    break;
                case 'turnoverRate':
                    aValue = a.inventoryMetrics.turnoverRate;
                    bValue = b.inventoryMetrics.turnoverRate;
                    break;
                case 'revenueVelocity':
                    aValue = a.profitability.revenueVelocity;
                    bValue = b.profitability.revenueVelocity;
                    break;
                case 'trend':
                    aValue = a.salesVelocity.trend === 'Accelerating' ? 3 : a.salesVelocity.trend === 'Stable' ? 2 : 1;
                    bValue = b.salesVelocity.trend === 'Accelerating' ? 3 : b.salesVelocity.trend === 'Stable' ? 2 : 1;
                    break;
                default:
                    aValue = a.salesVelocity.daily;
                    bValue = b.salesVelocity.daily;
            }
            return params.sortOrder === 'desc' ? bValue - aValue : aValue - bValue;
        });
        return filteredData;
    }
    async analyzeInventory(params) {
        try {
            const domain = params.domain;
            const domainName = this.client.getDomainName(domain);
            let result = `**📦 Inventory Analysis Report**\n\n`;
            result += `🏪 **Marketplace**: ${domainName}\n`;
            result += `📊 **Analysis Type**: ${params.analysisType.charAt(0).toUpperCase() + params.analysisType.slice(1).replace('_', ' ')}\n`;
            result += `⏱️ **Timeframe**: ${params.timeframe}\n`;
            result += `🎯 **Target Turnover**: ${params.targetTurnoverRate} turns/year\n\n`;
            // Get real inventory analysis using sales velocity data
            const inventoryAnalysis = await this.getRealInventoryAnalysis(params, domain);
            switch (params.analysisType) {
                case 'overview':
                    result += this.formatInventoryOverview(inventoryAnalysis, domain);
                    break;
                case 'fast_movers':
                    result += this.formatFastMovers(inventoryAnalysis, domain);
                    break;
                case 'slow_movers':
                    result += this.formatSlowMovers(inventoryAnalysis, domain);
                    break;
                case 'stockout_risks':
                    result += this.formatStockoutRisks(inventoryAnalysis, domain);
                    break;
                case 'seasonal':
                    result += this.formatSeasonalAnalysis(inventoryAnalysis, domain);
                    break;
            }
            result += `\n**💡 Inventory Management Recommendations:**\n`;
            inventoryAnalysis.recommendations.forEach((rec, i) => {
                result += `${i + 1}. ${rec}\n`;
            });
            return result;
        }
        catch (error) {
            return `Error analyzing inventory: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
    }
    async getRealInventoryAnalysis(params, domain) {
        // Get sales velocity data to build inventory analysis
        const velocityParams = {
            domain: params.domain,
            categoryId: params.categoryId,
            asins: params.asins,
            timeframe: params.timeframe,
            sellerCountTimeframe: params.sellerCountTimeframe || '90day',
            perPage: 50,
            page: 0,
            sortBy: 'velocity',
            sortOrder: 'desc',
            minRating: 3.0
        };
        const allProducts = await this.getRealSalesVelocityData(velocityParams, domain);
        // Categorize products based on velocity and turnover
        const fastMovers = allProducts.filter(p => p.salesVelocity.monthly >= 30);
        const slowMovers = allProducts.filter(p => p.salesVelocity.monthly < 10);
        const stockoutRisks = allProducts.filter(p => p.inventoryMetrics.stockoutRisk === 'High');
        // Calculate seasonal patterns
        const seasonalPatterns = [
            {
                period: 'Q4 Holiday Season',
                velocityMultiplier: 2.5,
                recommendation: 'Increase inventory 60-90 days before peak season'
            },
            {
                period: 'Summer Season',
                velocityMultiplier: 1.3,
                recommendation: 'Monitor outdoor/seasonal products for increased demand'
            }
        ];
        // Generate recommendations
        const recommendations = [];
        if (fastMovers.length > allProducts.length * 0.3) {
            recommendations.push("Consider increasing inventory for fast-moving products to avoid stockouts");
        }
        if (slowMovers.length > allProducts.length * 0.4) {
            recommendations.push("Implement markdown strategy for slow-moving inventory to improve cash flow");
        }
        if (stockoutRisks.length > 0) {
            recommendations.push(`Monitor ${stockoutRisks.length} high-risk products for immediate reordering`);
        }
        if (seasonalPatterns.length > 0) {
            recommendations.push("Plan inventory levels around seasonal demand patterns");
        }
        // Calculate portfolio metrics
        const avgTurnover = allProducts.length > 0
            ? allProducts.reduce((sum, p) => sum + p.inventoryMetrics.turnoverRate, 0) / allProducts.length
            : 0;
        return {
            totalProducts: allProducts.length,
            averageTurnoverRate: Math.round(avgTurnover * 10) / 10,
            fastMovers: fastMovers,
            slowMovers: slowMovers,
            stockoutRisks: stockoutRisks,
            seasonalPatterns: seasonalPatterns,
            recommendations: recommendations
        };
    }
    sortVelocityData(products, sortBy, sortOrder) {
        return products.sort((a, b) => {
            let aVal, bVal;
            switch (sortBy) {
                case 'velocity':
                    aVal = a.salesVelocity.daily;
                    bVal = b.salesVelocity.daily;
                    break;
                case 'turnoverRate':
                    aVal = a.inventoryMetrics.turnoverRate;
                    bVal = b.inventoryMetrics.turnoverRate;
                    break;
                case 'revenueVelocity':
                    aVal = a.profitability.revenueVelocity;
                    bVal = b.profitability.revenueVelocity;
                    break;
                case 'trend':
                    aVal = a.salesVelocity.changePercent;
                    bVal = b.salesVelocity.changePercent;
                    break;
                default:
                    aVal = a.salesVelocity.daily;
                    bVal = b.salesVelocity.daily;
            }
            return sortOrder === 'desc' ? bVal - aVal : aVal - bVal;
        });
    }
    getVelocityIndicator(trend) {
        switch (trend) {
            case 'Accelerating': return '🚀';
            case 'Declining': return '📉';
            default: return '➡️';
        }
    }
    getRiskEmoji(risk) {
        switch (risk) {
            case 'High': return '🔴';
            case 'Medium': return '🟡';
            default: return '🟢';
        }
    }
    formatInventoryOverview(analysis, domain) {
        let result = `**📊 Inventory Portfolio Overview**\n\n`;
        result += `• **Total Products**: ${analysis.totalProducts}\n`;
        result += `• **Average Turnover Rate**: ${analysis.averageTurnoverRate.toFixed(1)}x/month\n`;
        result += `• **Fast Movers**: ${analysis.fastMovers.length} (>${30}/month)\n`;
        result += `• **Slow Movers**: ${analysis.slowMovers.length} (<${10}/month)\n`;
        result += `• **High Stockout Risk**: ${analysis.stockoutRisks.length} products\n\n`;
        result += `**🏆 Top 5 Fast Movers:**\n`;
        analysis.fastMovers.slice(0, 5).forEach((product, i) => {
            result += `${i + 1}. ${product.asin}: ${product.salesVelocity.monthly}/month\n`;
        });
        result += `\n**🐌 Top 5 Slow Movers:**\n`;
        analysis.slowMovers.slice(0, 5).forEach((product, i) => {
            result += `${i + 1}. ${product.asin}: ${product.salesVelocity.monthly}/month\n`;
        });
        return result;
    }
    formatFastMovers(analysis, domain) {
        let result = `**🚀 Fast Moving Products (>30 units/month)**\n\n`;
        analysis.fastMovers.forEach((product, i) => {
            result += `**${i + 1}. ${product.asin}**\n`;
            result += `📦 ${product.title}\n`;
            result += `📈 ${product.salesVelocity.monthly} units/month\n`;
            result += `💰 ${this.client.formatPrice(product.profitability.revenueVelocity * 100, domain)}/day revenue\n`;
            result += `🔄 ${product.inventoryMetrics.turnoverRate}x turnover rate\n\n`;
        });
        return result;
    }
    formatSlowMovers(analysis, domain) {
        let result = `**🐌 Slow Moving Products (<10 units/month)**\n\n`;
        analysis.slowMovers.forEach((product, i) => {
            result += `**${i + 1}. ${product.asin}**\n`;
            result += `📦 ${product.title}\n`;
            result += `📉 ${product.salesVelocity.monthly} units/month\n`;
            result += `📅 ${product.inventoryMetrics.daysOfInventory} days of inventory\n`;
            result += `⚠️ Consider promotion or liquidation\n\n`;
        });
        return result;
    }
    formatStockoutRisks(analysis, domain) {
        let result = `**🔴 High Stockout Risk Products**\n\n`;
        analysis.stockoutRisks.forEach((product, i) => {
            result += `**${i + 1}. ${product.asin}**\n`;
            result += `📦 ${product.title}\n`;
            result += `⚡ ${product.salesVelocity.daily} units/day velocity\n`;
            result += `📅 ${product.inventoryMetrics.daysOfInventory} days left\n`;
            result += `📋 Reorder: ${product.inventoryMetrics.recommendedOrderQuantity} units\n\n`;
        });
        return result;
    }
    formatSeasonalAnalysis(analysis, domain) {
        let result = `**🗓️ Seasonal Velocity Patterns**\n\n`;
        analysis.seasonalPatterns.forEach((pattern, i) => {
            result += `**${pattern.period}**\n`;
            result += `📊 Velocity Multiplier: ${pattern.velocityMultiplier}x\n`;
            result += `💡 ${pattern.recommendation}\n\n`;
        });
        return result;
    }
    generateInventoryRecommendations(products, targetTurnover) {
        const recommendations = [];
        const averageVelocity = products.reduce((sum, p) => sum + p.salesVelocity.monthly, 0) / products.length;
        const highRiskCount = products.filter(p => p.inventoryMetrics.stockoutRisk === 'High').length;
        const slowMoversCount = products.filter(p => p.salesVelocity.monthly < 10).length;
        if (averageVelocity > 25) {
            recommendations.push('🚀 Strong portfolio velocity - maintain current strategy');
        }
        else if (averageVelocity < 15) {
            recommendations.push('⚠️ Low portfolio velocity - consider more aggressive promotions');
        }
        if (highRiskCount > products.length * 0.2) {
            recommendations.push('🔴 High stockout exposure - improve reorder point management');
        }
        if (slowMoversCount > products.length * 0.3) {
            recommendations.push('🐌 Too many slow movers - evaluate product mix and consider liquidation');
        }
        recommendations.push('📊 Monitor daily for velocity changes and adjust reorder points');
        recommendations.push('🎯 Aim for 15-45 day inventory levels for optimal cash flow');
        recommendations.push('📈 Focus marketing spend on products with accelerating trends');
        return recommendations;
    }
    async getTokenStatus(params) {
        try {
            const tokensLeft = await this.client.getTokensLeft();
            let result = `**🪙 Keepa API Token Status**\n\n`;
            result += `💰 **Tokens Remaining**: ${tokensLeft}\n\n`;
            if (tokensLeft <= 0) {
                result += `❌ **Status**: EXHAUSTED - All tools will fail until tokens refresh\n`;
                result += `⚠️ **Impact**: Searches will return "No products found" instead of real data\n\n`;
                result += `**🔧 Solutions:**\n`;
                result += `• Wait for daily/monthly token refresh\n`;
                result += `• Upgrade your Keepa plan for more tokens\n`;
                result += `• Check usage at https://keepa.com/#!api\n`;
            }
            else if (tokensLeft <= 5) {
                result += `⚠️ **Status**: LOW - Use carefully to avoid exhaustion\n`;
                result += `💡 **Recommendation**: Conserve tokens for critical queries\n\n`;
                result += `**Token Usage Guidelines:**\n`;
                result += `• Product Lookup: ~1 token\n`;
                result += `• Category Analysis: ~5-15 tokens\n`;
                result += `• Deal Discovery: ~3-8 tokens\n`;
            }
            else if (tokensLeft <= 25) {
                result += `🟡 **Status**: MODERATE - Monitor usage\n`;
                result += `💡 **Recommendation**: Plan your queries efficiently\n`;
            }
            else if (tokensLeft <= 100) {
                result += `🟢 **Status**: GOOD - Adequate for regular usage\n`;
                result += `💡 **Recommendation**: Normal usage, monitor daily\n`;
            }
            else {
                result += `✅ **Status**: EXCELLENT - Plenty of tokens available\n`;
                result += `💡 **Recommendation**: Use advanced analytics freely\n`;
            }
            result += `\n**📊 Check detailed usage**: https://keepa.com/#!api\n`;
            result += `**⏰ Tokens refresh**: According to your Keepa subscription plan\n`;
            return result;
        }
        catch (error) {
            return `Error checking token status: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
    }
}
exports.KeepaTools = KeepaTools;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidG9vbHMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJ0b29scy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSw2QkFBd0I7QUFFeEIsbUNBQWtJO0FBRXJILFFBQUEsbUJBQW1CLEdBQUcsT0FBQyxDQUFDLE1BQU0sQ0FBQztJQUMxQyxJQUFJLEVBQUUsT0FBQyxDQUFDLE1BQU0sRUFBRSxDQUFDLFFBQVEsQ0FBQyxrQ0FBa0MsQ0FBQztJQUM3RCxNQUFNLEVBQUUsT0FBQyxDQUFDLE1BQU0sRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyx3Q0FBd0MsQ0FBQztJQUMvRixJQUFJLEVBQUUsT0FBQyxDQUFDLE1BQU0sRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsUUFBUSxFQUFFLENBQUMsUUFBUSxDQUFDLDRDQUE0QyxDQUFDO0lBQ2xHLE9BQU8sRUFBRSxPQUFDLENBQUMsT0FBTyxFQUFFLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDLFFBQVEsQ0FBQyw0QkFBNEIsQ0FBQztJQUMxRSxNQUFNLEVBQUUsT0FBQyxDQUFDLE1BQU0sRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsUUFBUSxFQUFFLENBQUMsUUFBUSxDQUFDLHlDQUF5QyxDQUFDO0lBQ2pHLFVBQVUsRUFBRSxPQUFDLENBQUMsT0FBTyxFQUFFLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDLFFBQVEsQ0FBQyw0QkFBNEIsQ0FBQztJQUM3RSxNQUFNLEVBQUUsT0FBQyxDQUFDLE9BQU8sRUFBRSxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQyxRQUFRLENBQUMsNkJBQTZCLENBQUM7Q0FDM0UsQ0FBQyxDQUFDO0FBRVUsUUFBQSx3QkFBd0IsR0FBRyxPQUFDLENBQUMsTUFBTSxDQUFDO0lBQy9DLEtBQUssRUFBRSxPQUFDLENBQUMsS0FBSyxDQUFDLE9BQUMsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxRQUFRLENBQUMsaUNBQWlDLENBQUM7SUFDL0UsTUFBTSxFQUFFLE9BQUMsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsd0NBQXdDLENBQUM7SUFDL0YsSUFBSSxFQUFFLE9BQUMsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDLFFBQVEsRUFBRSxDQUFDLFFBQVEsQ0FBQyw0Q0FBNEMsQ0FBQztJQUNsRyxPQUFPLEVBQUUsT0FBQyxDQUFDLE9BQU8sRUFBRSxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQyxRQUFRLENBQUMsNEJBQTRCLENBQUM7Q0FDM0UsQ0FBQyxDQUFDO0FBRVUsUUFBQSxnQkFBZ0IsR0FBRyxPQUFDLENBQUMsTUFBTSxDQUFDO0lBQ3ZDLE1BQU0sRUFBRSxPQUFDLENBQUMsTUFBTSxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLHdDQUF3QyxDQUFDO0lBQy9GLFVBQVUsRUFBRSxPQUFDLENBQUMsTUFBTSxFQUFFLENBQUMsUUFBUSxFQUFFLENBQUMsUUFBUSxDQUFDLGlDQUFpQyxDQUFDO0lBQzdFLFFBQVEsRUFBRSxPQUFDLENBQUMsTUFBTSxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsRUFBRSxDQUFDLFFBQVEsQ0FBQyx3QkFBd0IsQ0FBQztJQUN6RSxRQUFRLEVBQUUsT0FBQyxDQUFDLE1BQU0sRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLEVBQUUsQ0FBQyxRQUFRLENBQUMsd0JBQXdCLENBQUM7SUFDekUsV0FBVyxFQUFFLE9BQUMsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDLFFBQVEsRUFBRSxDQUFDLFFBQVEsQ0FBQyw2QkFBNkIsQ0FBQztJQUMxRixTQUFTLEVBQUUsT0FBQyxDQUFDLE1BQU0sRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxFQUFFLENBQUMsUUFBUSxDQUFDLG9DQUFvQyxDQUFDO0lBQzdGLE9BQU8sRUFBRSxPQUFDLENBQUMsT0FBTyxFQUFFLENBQUMsUUFBUSxFQUFFLENBQUMsUUFBUSxDQUFDLHNDQUFzQyxDQUFDO0lBQ2hGLFFBQVEsRUFBRSxPQUFDLENBQUMsTUFBTSxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLG9FQUFvRSxDQUFDO0lBQzVILElBQUksRUFBRSxPQUFDLENBQUMsTUFBTSxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsNEJBQTRCLENBQUM7SUFDekUsT0FBTyxFQUFFLE9BQUMsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUMsQ0FBQyxRQUFRLENBQUMsMkJBQTJCLENBQUM7Q0FDckYsQ0FBQyxDQUFDO0FBRVUsUUFBQSxrQkFBa0IsR0FBRyxPQUFDLENBQUMsTUFBTSxDQUFDO0lBQ3pDLE1BQU0sRUFBRSxPQUFDLENBQUMsTUFBTSxFQUFFLENBQUMsUUFBUSxDQUFDLG1CQUFtQixDQUFDO0lBQ2hELE1BQU0sRUFBRSxPQUFDLENBQUMsTUFBTSxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLHdDQUF3QyxDQUFDO0lBQy9GLFVBQVUsRUFBRSxPQUFDLENBQUMsTUFBTSxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQyxRQUFRLEVBQUUsQ0FBQyxRQUFRLENBQUMsd0NBQXdDLENBQUM7Q0FDeEcsQ0FBQyxDQUFDO0FBRVUsUUFBQSxpQkFBaUIsR0FBRyxPQUFDLENBQUMsTUFBTSxDQUFDO0lBQ3hDLE1BQU0sRUFBRSxPQUFDLENBQUMsTUFBTSxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLHdDQUF3QyxDQUFDO0lBQy9GLFFBQVEsRUFBRSxPQUFDLENBQUMsTUFBTSxFQUFFLENBQUMsUUFBUSxDQUFDLG9CQUFvQixDQUFDO0lBQ25ELElBQUksRUFBRSxPQUFDLENBQUMsTUFBTSxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsNEJBQTRCLENBQUM7Q0FDMUUsQ0FBQyxDQUFDO0FBRVUsUUFBQSxrQkFBa0IsR0FBRyxPQUFDLENBQUMsTUFBTSxDQUFDO0lBQ3pDLElBQUksRUFBRSxPQUFDLENBQUMsTUFBTSxFQUFFLENBQUMsUUFBUSxDQUFDLGtDQUFrQyxDQUFDO0lBQzdELE1BQU0sRUFBRSxPQUFDLENBQUMsTUFBTSxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLHdDQUF3QyxDQUFDO0lBQy9GLFFBQVEsRUFBRSxPQUFDLENBQUMsTUFBTSxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsQ0FBQyxRQUFRLENBQUMseURBQXlELENBQUM7SUFDdkcsSUFBSSxFQUFFLE9BQUMsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUMsQ0FBQyxRQUFRLENBQUMsMkJBQTJCLENBQUM7Q0FDbkYsQ0FBQyxDQUFDO0FBRVUsUUFBQSxtQkFBbUIsR0FBRyxPQUFDLENBQUMsTUFBTSxDQUFDO0lBQzFDLE1BQU0sRUFBRSxPQUFDLENBQUMsTUFBTSxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLHdDQUF3QyxDQUFDO0lBQy9GLFVBQVUsRUFBRSxPQUFDLENBQUMsTUFBTSxFQUFFLENBQUMsUUFBUSxFQUFFLENBQUMsUUFBUSxDQUFDLHFDQUFxQyxDQUFDO0lBQ2pGLFNBQVMsRUFBRSxPQUFDLENBQUMsTUFBTSxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLEVBQUUsQ0FBQyxRQUFRLENBQUMsb0NBQW9DLENBQUM7SUFDN0YsU0FBUyxFQUFFLE9BQUMsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsRUFBRSxDQUFDLFFBQVEsQ0FBQyxvQ0FBb0MsQ0FBQztJQUM3RixRQUFRLEVBQUUsT0FBQyxDQUFDLE1BQU0sRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLEVBQUUsQ0FBQyxRQUFRLENBQUMsd0JBQXdCLENBQUM7SUFDekUsUUFBUSxFQUFFLE9BQUMsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxFQUFFLENBQUMsUUFBUSxDQUFDLHdCQUF3QixDQUFDO0lBQ3pFLFdBQVcsRUFBRSxPQUFDLENBQUMsTUFBTSxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsRUFBRSxDQUFDLFFBQVEsQ0FBQyxnQ0FBZ0MsQ0FBQztJQUNwRixXQUFXLEVBQUUsT0FBQyxDQUFDLE1BQU0sRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLEVBQUUsQ0FBQyxRQUFRLENBQUMsZ0NBQWdDLENBQUM7SUFDcEYsZUFBZSxFQUFFLE9BQUMsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxFQUFFLENBQUMsUUFBUSxDQUFDLGlDQUFpQyxDQUFDO0lBQ3pGLGVBQWUsRUFBRSxPQUFDLENBQUMsTUFBTSxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsRUFBRSxDQUFDLFFBQVEsQ0FBQyxpQ0FBaUMsQ0FBQztJQUN6RixjQUFjLEVBQUUsT0FBQyxDQUFDLE1BQU0sRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLEVBQUUsQ0FBQyxRQUFRLENBQUMsMkJBQTJCLENBQUM7SUFDbEYsY0FBYyxFQUFFLE9BQUMsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxFQUFFLENBQUMsUUFBUSxDQUFDLDJCQUEyQixDQUFDO0lBQ2xGLG9CQUFvQixFQUFFLE9BQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxTQUFTLEVBQUUsT0FBTyxFQUFFLE9BQU8sRUFBRSxRQUFRLEVBQUUsUUFBUSxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLENBQUMsUUFBUSxDQUFDLG9FQUFvRSxDQUFDO0lBQy9LLE9BQU8sRUFBRSxPQUFDLENBQUMsT0FBTyxFQUFFLENBQUMsUUFBUSxFQUFFLENBQUMsUUFBUSxDQUFDLHlDQUF5QyxDQUFDO0lBQ25GLFVBQVUsRUFBRSxPQUFDLENBQUMsT0FBTyxFQUFFLENBQUMsUUFBUSxFQUFFLENBQUMsUUFBUSxDQUFDLHVDQUF1QyxDQUFDO0lBQ3BGLFdBQVcsRUFBRSxPQUFDLENBQUMsTUFBTSxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxFQUFFLENBQUMsUUFBUSxDQUFDLGtFQUFrRSxDQUFDO0lBQ3hJLE1BQU0sRUFBRSxPQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsYUFBYSxFQUFFLE9BQU8sRUFBRSxRQUFRLEVBQUUsYUFBYSxFQUFFLFdBQVcsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLGFBQWEsQ0FBQyxDQUFDLFFBQVEsQ0FBQyx1QkFBdUIsQ0FBQztJQUN2SSxTQUFTLEVBQUUsT0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLEtBQUssRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQyxRQUFRLENBQUMsc0NBQXNDLENBQUM7SUFDbkcsSUFBSSxFQUFFLE9BQUMsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyw0QkFBNEIsQ0FBQztJQUN6RSxPQUFPLEVBQUUsT0FBQyxDQUFDLE1BQU0sRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQyxDQUFDLFFBQVEsQ0FBQywyQkFBMkIsQ0FBQztDQUNyRixDQUFDLENBQUM7QUFFVSxRQUFBLHNCQUFzQixHQUFHLE9BQUMsQ0FBQyxNQUFNLENBQUM7SUFDN0MsTUFBTSxFQUFFLE9BQUMsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsd0NBQXdDLENBQUM7SUFDL0YsVUFBVSxFQUFFLE9BQUMsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxRQUFRLENBQUMsK0JBQStCLENBQUM7SUFDaEUsWUFBWSxFQUFFLE9BQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxVQUFVLEVBQUUsZ0JBQWdCLEVBQUUsZUFBZSxFQUFFLFFBQVEsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxDQUFDLFFBQVEsQ0FBQyw2QkFBNkIsQ0FBQztJQUMzSSxVQUFVLEVBQUUsT0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLFFBQVEsRUFBRSxLQUFLLEVBQUUsU0FBUyxFQUFFLFFBQVEsQ0FBQyxDQUFDLENBQUMsUUFBUSxFQUFFLENBQUMsUUFBUSxDQUFDLCtCQUErQixDQUFDO0lBQy9HLFNBQVMsRUFBRSxPQUFDLENBQUMsTUFBTSxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUMsUUFBUSxDQUFDLHdDQUF3QyxDQUFDO0lBQ25HLG9CQUFvQixFQUFFLE9BQUMsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLENBQUMsUUFBUSxDQUFDLG1DQUFtQyxDQUFDO0lBQzlGLFNBQVMsRUFBRSxPQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsTUFBTSxFQUFFLE9BQU8sRUFBRSxTQUFTLEVBQUUsTUFBTSxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLENBQUMsUUFBUSxDQUFDLDhCQUE4QixDQUFDO0lBQ2pILG9CQUFvQixFQUFFLE9BQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxTQUFTLEVBQUUsT0FBTyxFQUFFLE9BQU8sRUFBRSxRQUFRLEVBQUUsUUFBUSxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLENBQUMsUUFBUSxDQUFDLDZFQUE2RSxDQUFDO0NBQ3pMLENBQUMsQ0FBQztBQUVVLFFBQUEsbUJBQW1CLEdBQUcsT0FBQyxDQUFDLE1BQU0sQ0FBQztJQUMxQyxNQUFNLEVBQUUsT0FBQyxDQUFDLE1BQU0sRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyx3Q0FBd0MsQ0FBQztJQUMvRixVQUFVLEVBQUUsT0FBQyxDQUFDLE1BQU0sRUFBRSxDQUFDLFFBQVEsRUFBRSxDQUFDLFFBQVEsQ0FBQyxpQ0FBaUMsQ0FBQztJQUM3RSxJQUFJLEVBQUUsT0FBQyxDQUFDLE1BQU0sRUFBRSxDQUFDLFFBQVEsRUFBRSxDQUFDLFFBQVEsQ0FBQyx3QkFBd0IsQ0FBQztJQUM5RCxLQUFLLEVBQUUsT0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFDLENBQUMsTUFBTSxFQUFFLENBQUMsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLENBQUMsUUFBUSxFQUFFLENBQUMsUUFBUSxDQUFDLG9DQUFvQyxDQUFDO0lBQzVGLFNBQVMsRUFBRSxPQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsTUFBTSxFQUFFLE9BQU8sRUFBRSxTQUFTLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsQ0FBQyxRQUFRLENBQUMsc0NBQXNDLENBQUM7SUFDakgsV0FBVyxFQUFFLE9BQUMsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxFQUFFLENBQUMsUUFBUSxDQUFDLDhCQUE4QixDQUFDO0lBQ2xGLFdBQVcsRUFBRSxPQUFDLENBQUMsTUFBTSxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsRUFBRSxDQUFDLFFBQVEsQ0FBQyw4QkFBOEIsQ0FBQztJQUNsRixRQUFRLEVBQUUsT0FBQyxDQUFDLE1BQU0sRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLEVBQUUsQ0FBQyxRQUFRLENBQUMsd0JBQXdCLENBQUM7SUFDekUsUUFBUSxFQUFFLE9BQUMsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxFQUFFLENBQUMsUUFBUSxDQUFDLHdCQUF3QixDQUFDO0lBQ3pFLFNBQVMsRUFBRSxPQUFDLENBQUMsTUFBTSxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUMsUUFBUSxDQUFDLHdCQUF3QixDQUFDO0lBQ25GLE1BQU0sRUFBRSxPQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsVUFBVSxFQUFFLGNBQWMsRUFBRSxpQkFBaUIsRUFBRSxPQUFPLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUMsQ0FBQyxRQUFRLENBQUMsd0JBQXdCLENBQUM7SUFDL0gsU0FBUyxFQUFFLE9BQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxLQUFLLEVBQUUsTUFBTSxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUMsUUFBUSxDQUFDLFlBQVksQ0FBQztJQUN6RSxvQkFBb0IsRUFBRSxPQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsU0FBUyxFQUFFLE9BQU8sRUFBRSxPQUFPLEVBQUUsUUFBUSxFQUFFLFFBQVEsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxDQUFDLFFBQVEsQ0FBQyw2RUFBNkUsQ0FBQztJQUN4TCxJQUFJLEVBQUUsT0FBQyxDQUFDLE1BQU0sRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLDRCQUE0QixDQUFDO0lBQ3pFLE9BQU8sRUFBRSxPQUFDLENBQUMsTUFBTSxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLENBQUMsUUFBUSxDQUFDLDJCQUEyQixDQUFDO0NBQ3JGLENBQUMsQ0FBQztBQUVVLFFBQUEsdUJBQXVCLEdBQUcsT0FBQyxDQUFDLE1BQU0sQ0FBQztJQUM5QyxNQUFNLEVBQUUsT0FBQyxDQUFDLE1BQU0sRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyx3Q0FBd0MsQ0FBQztJQUMvRixVQUFVLEVBQUUsT0FBQyxDQUFDLE1BQU0sRUFBRSxDQUFDLFFBQVEsRUFBRSxDQUFDLFFBQVEsQ0FBQywrQkFBK0IsQ0FBQztJQUMzRSxLQUFLLEVBQUUsT0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFDLENBQUMsTUFBTSxFQUFFLENBQUMsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsUUFBUSxFQUFFLENBQUMsUUFBUSxDQUFDLDRDQUE0QyxDQUFDO0lBQ3JHLFlBQVksRUFBRSxPQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsVUFBVSxFQUFFLGFBQWEsRUFBRSxhQUFhLEVBQUUsZ0JBQWdCLEVBQUUsVUFBVSxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLENBQUMsUUFBUSxDQUFDLDRCQUE0QixDQUFDO0lBQ3pKLFNBQVMsRUFBRSxPQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsTUFBTSxFQUFFLE9BQU8sRUFBRSxTQUFTLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsQ0FBQyxRQUFRLENBQUMsb0JBQW9CLENBQUM7SUFDL0Ysb0JBQW9CLEVBQUUsT0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLFNBQVMsRUFBRSxPQUFPLEVBQUUsT0FBTyxFQUFFLFFBQVEsRUFBRSxRQUFRLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsQ0FBQyxRQUFRLENBQUMsNkVBQTZFLENBQUM7SUFDeEwsa0JBQWtCLEVBQUUsT0FBQyxDQUFDLE1BQU0sRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxpQ0FBaUMsQ0FBQztDQUN0RyxDQUFDLENBQUM7QUFFVSxRQUFBLGlCQUFpQixHQUFHLE9BQUMsQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDLENBQUM7QUFFOUMsTUFBYSxVQUFVO0lBQ0Q7SUFBcEIsWUFBb0IsTUFBbUI7UUFBbkIsV0FBTSxHQUFOLE1BQU0sQ0FBYTtJQUFHLENBQUM7SUFFM0MsS0FBSyxDQUFDLGFBQWEsQ0FBQyxNQUEyQztRQUM3RCxJQUFJO1lBQ0YsTUFBTSxPQUFPLEdBQUcsTUFBTSxJQUFJLENBQUMsTUFBTSxDQUFDLGdCQUFnQixDQUNoRCxNQUFNLENBQUMsSUFBSSxFQUNYLE1BQU0sQ0FBQyxNQUFxQixFQUM1QjtnQkFDRSxJQUFJLEVBQUUsTUFBTSxDQUFDLElBQUk7Z0JBQ2pCLE9BQU8sRUFBRSxNQUFNLENBQUMsT0FBTztnQkFDdkIsTUFBTSxFQUFFLE1BQU0sQ0FBQyxNQUFNO2dCQUNyQixVQUFVLEVBQUUsTUFBTSxDQUFDLFVBQVU7Z0JBQzdCLE1BQU0sRUFBRSxNQUFNLENBQUMsTUFBTTthQUN0QixDQUNGLENBQUM7WUFFRixJQUFJLENBQUMsT0FBTyxFQUFFO2dCQUNaLE9BQU8sK0JBQStCLE1BQU0sQ0FBQyxJQUFJLEVBQUUsQ0FBQzthQUNyRDtZQUVELE1BQU0sTUFBTSxHQUFHLE1BQU0sQ0FBQyxNQUFxQixDQUFDO1lBQzVDLE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxNQUFNLENBQUMsYUFBYSxDQUFDLE1BQU0sQ0FBQyxDQUFDO1lBRXJELElBQUksTUFBTSxHQUFHLDZCQUE2QixNQUFNLENBQUMsSUFBSSxRQUFRLENBQUM7WUFDOUQsTUFBTSxJQUFJLHVCQUF1QixVQUFVLElBQUksQ0FBQztZQUNoRCxNQUFNLElBQUksaUJBQWlCLE9BQU8sQ0FBQyxLQUFLLElBQUksS0FBSyxJQUFJLENBQUM7WUFDdEQsTUFBTSxJQUFJLGtCQUFrQixPQUFPLENBQUMsS0FBSyxJQUFJLEtBQUssSUFBSSxDQUFDO1lBQ3ZELE1BQU0sSUFBSSxvQkFBb0IsT0FBTyxDQUFDLFlBQVksSUFBSSxLQUFLLElBQUksQ0FBQztZQUVoRSxJQUFJLE9BQU8sQ0FBQyxLQUFLLEVBQUU7Z0JBQ2pCLE1BQU0sWUFBWSxHQUFHLE9BQU8sQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDO2dCQUM5QyxJQUFJLFlBQVksSUFBSSxZQUFZLEtBQUssQ0FBQyxDQUFDLEVBQUU7b0JBQ3ZDLE1BQU0sSUFBSSx5QkFBeUIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxXQUFXLENBQUMsWUFBWSxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUM7aUJBQ3RGO2dCQUVELE1BQU0sUUFBUSxHQUFHLE9BQU8sQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDO2dCQUN0QyxJQUFJLFFBQVEsSUFBSSxRQUFRLEtBQUssQ0FBQyxDQUFDLEVBQUU7b0JBQy9CLE1BQU0sSUFBSSx5QkFBeUIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxXQUFXLENBQUMsUUFBUSxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUM7aUJBQ2xGO2dCQUVELElBQUksT0FBTyxDQUFDLEtBQUssQ0FBQyxrQkFBa0IsRUFBRTtvQkFDcEMsTUFBTSxJQUFJLHVCQUF1QixPQUFPLENBQUMsS0FBSyxDQUFDLGtCQUFrQixDQUFDLGNBQWMsRUFBRSxJQUFJLENBQUM7aUJBQ3hGO2FBQ0Y7WUFFRCxJQUFJLE1BQU0sQ0FBQyxNQUFNLElBQUksT0FBTyxDQUFDLEtBQUssRUFBRSxPQUFPLENBQUMsRUFBRSxDQUFDLEVBQUU7Z0JBQy9DLE1BQU0sTUFBTSxHQUFHLE9BQU8sQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQyxHQUFHLEVBQUUsQ0FBQztnQkFDOUMsTUFBTSxXQUFXLEdBQUcsT0FBTyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLENBQUM7Z0JBQzlDLE1BQU0sSUFBSSxpQkFBaUIsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsU0FBUyxXQUFXLGFBQWEsQ0FBQzthQUMvRTtZQUVELElBQUksT0FBTyxDQUFDLE1BQU0sSUFBSSxPQUFPLENBQUMsTUFBTSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUU7Z0JBQy9DLE1BQU0sSUFBSSw2QkFBNkIsT0FBTyxDQUFDLE1BQU0sQ0FBQyxNQUFNLGNBQWMsQ0FBQztnQkFDM0UsTUFBTSxTQUFTLEdBQUcsT0FBTyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDO2dCQUM3QyxTQUFTLENBQUMsT0FBTyxDQUFDLENBQUMsS0FBSyxFQUFFLENBQUMsRUFBRSxFQUFFO29CQUM3QixNQUFNLElBQUksR0FBRyxDQUFDLEdBQUcsQ0FBQyxLQUFLLEtBQUssQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUMsY0FBYyxLQUFLLENBQUM7b0JBQzFFLE1BQU0sSUFBSSxHQUFHLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsVUFBVSxLQUFLLENBQUM7b0JBQ3pELE1BQU0sSUFBSSxHQUFHLEtBQUssQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxJQUFJLENBQUM7Z0JBQy9DLENBQUMsQ0FBQyxDQUFDO2FBQ0o7WUFFRCxJQUFJLE1BQU0sQ0FBQyxVQUFVLElBQUksT0FBTyxDQUFDLFVBQVUsSUFBSSxPQUFPLENBQUMsVUFBVSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUU7Z0JBQzVFLE1BQU0sSUFBSSxxQkFBcUIsT0FBTyxDQUFDLFVBQVUsQ0FBQyxNQUFNLGNBQWMsQ0FBQzthQUN4RTtZQUVELE9BQU8sTUFBTSxDQUFDO1NBQ2Y7UUFBQyxPQUFPLEtBQUssRUFBRTtZQUNkLE9BQU8sNkJBQTZCLEtBQUssWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLGVBQWUsRUFBRSxDQUFDO1NBQ2hHO0lBQ0gsQ0FBQztJQUVELEtBQUssQ0FBQyxtQkFBbUIsQ0FBQyxNQUFnRDtRQUN4RSxJQUFJO1lBQ0YsTUFBTSxRQUFRLEdBQUcsTUFBTSxJQUFJLENBQUMsTUFBTSxDQUFDLGdCQUFnQixDQUNqRCxNQUFNLENBQUMsS0FBSyxFQUNaLE1BQU0sQ0FBQyxNQUFxQixFQUM1QjtnQkFDRSxJQUFJLEVBQUUsTUFBTSxDQUFDLElBQUk7Z0JBQ2pCLE9BQU8sRUFBRSxNQUFNLENBQUMsT0FBTzthQUN4QixDQUNGLENBQUM7WUFFRixNQUFNLE1BQU0sR0FBRyxNQUFNLENBQUMsTUFBcUIsQ0FBQztZQUM1QyxNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDLGFBQWEsQ0FBQyxNQUFNLENBQUMsQ0FBQztZQUVyRCxJQUFJLE1BQU0sR0FBRyxtQ0FBbUMsUUFBUSxDQUFDLE1BQU0sSUFBSSxNQUFNLENBQUMsS0FBSyxDQUFDLE1BQU0sZUFBZSxDQUFDO1lBQ3RHLE1BQU0sSUFBSSx1QkFBdUIsVUFBVSxNQUFNLENBQUM7WUFFbEQsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDLE9BQU8sRUFBRSxDQUFDLEVBQUUsRUFBRTtnQkFDOUIsTUFBTSxJQUFJLEtBQUssQ0FBQyxHQUFHLENBQUMsS0FBSyxPQUFPLENBQUMsSUFBSSxNQUFNLENBQUM7Z0JBQzVDLE1BQU0sSUFBSSxNQUFNLE9BQU8sQ0FBQyxLQUFLLElBQUksS0FBSyxJQUFJLENBQUM7Z0JBQzNDLE1BQU0sSUFBSSxPQUFPLE9BQU8sQ0FBQyxLQUFLLElBQUksS0FBSyxJQUFJLENBQUM7Z0JBRTVDLElBQUksT0FBTyxDQUFDLEtBQUssRUFBRSxPQUFPLENBQUMsQ0FBQyxDQUFDLElBQUksT0FBTyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUU7b0JBQ2hFLE1BQU0sSUFBSSxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsV0FBVyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUM7aUJBQy9FO2dCQUVELElBQUksT0FBTyxDQUFDLEtBQUssRUFBRSxrQkFBa0IsRUFBRTtvQkFDckMsTUFBTSxJQUFJLGFBQWEsT0FBTyxDQUFDLEtBQUssQ0FBQyxrQkFBa0IsQ0FBQyxjQUFjLEVBQUUsSUFBSSxDQUFDO2lCQUM5RTtnQkFFRCxNQUFNLElBQUksSUFBSSxDQUFDO1lBQ2pCLENBQUMsQ0FBQyxDQUFDO1lBRUgsTUFBTSxRQUFRLEdBQUcsTUFBTSxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FDMUMsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUMsT0FBTyxDQUFDLElBQUksS0FBSyxJQUFJLENBQUMsQ0FDakQsQ0FBQztZQUVGLElBQUksUUFBUSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUU7Z0JBQ3ZCLE1BQU0sSUFBSSxrQkFBa0IsUUFBUSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDO2FBQ3JEO1lBRUQsT0FBTyxNQUFNLENBQUM7U0FDZjtRQUFDLE9BQU8sS0FBSyxFQUFFO1lBQ2QsT0FBTywwQkFBMEIsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsZUFBZSxFQUFFLENBQUM7U0FDN0Y7SUFDSCxDQUFDO0lBRUQsS0FBSyxDQUFDLFdBQVcsQ0FBQyxNQUF3QztRQUN4RCxJQUFJO1lBQ0YsTUFBTSxLQUFLLEdBQUcsTUFBTSxJQUFJLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQztnQkFDdkMsUUFBUSxFQUFFLE1BQU0sQ0FBQyxNQUFNO2dCQUN2QixVQUFVLEVBQUUsTUFBTSxDQUFDLFVBQVU7Z0JBQzdCLFFBQVEsRUFBRSxNQUFNLENBQUMsUUFBUTtnQkFDekIsUUFBUSxFQUFFLE1BQU0sQ0FBQyxRQUFRO2dCQUN6QixXQUFXLEVBQUUsTUFBTSxDQUFDLFdBQVc7Z0JBQy9CLFNBQVMsRUFBRSxNQUFNLENBQUMsU0FBUztnQkFDM0IsT0FBTyxFQUFFLE1BQU0sQ0FBQyxPQUFPO2dCQUN2QixRQUFRLEVBQUUsTUFBTSxDQUFDLFFBQVE7Z0JBQ3pCLElBQUksRUFBRSxNQUFNLENBQUMsSUFBSTtnQkFDakIsT0FBTyxFQUFFLE1BQU0sQ0FBQyxPQUFPO2FBQ3hCLENBQUMsQ0FBQztZQUVILElBQUksS0FBSyxDQUFDLE1BQU0sS0FBSyxDQUFDLEVBQUU7Z0JBQ3RCLE9BQU8sd0NBQXdDLENBQUM7YUFDakQ7WUFFRCxNQUFNLE1BQU0sR0FBRyxNQUFNLENBQUMsTUFBcUIsQ0FBQztZQUM1QyxNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDLGFBQWEsQ0FBQyxNQUFNLENBQUMsQ0FBQztZQUVyRCxJQUFJLE1BQU0sR0FBRyx5QkFBeUIsS0FBSyxDQUFDLE1BQU0sUUFBUSxDQUFDO1lBQzNELE1BQU0sSUFBSSx1QkFBdUIsVUFBVSxNQUFNLENBQUM7WUFFbEQsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDLEVBQUUsRUFBRTtnQkFDeEIsTUFBTSxJQUFJLEtBQUssQ0FBQyxHQUFHLENBQUMsS0FBSyxJQUFJLENBQUMsSUFBSSxNQUFNLENBQUM7Z0JBQ3pDLE1BQU0sSUFBSSxRQUFRLElBQUksQ0FBQyxLQUFLLE1BQU0sQ0FBQztnQkFDbkMsTUFBTSxJQUFJLGNBQWMsSUFBSSxDQUFDLEtBQUssSUFBSSxLQUFLLElBQUksQ0FBQztnQkFDaEQsTUFBTSxJQUFJLGlCQUFpQixJQUFJLENBQUMsTUFBTSxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUMsS0FBSyxFQUFFLE1BQU0sQ0FBQyxFQUFFLENBQUM7Z0JBRXpFLElBQUksSUFBSSxDQUFDLFFBQVEsR0FBRyxDQUFDLEVBQUU7b0JBQ3JCLE1BQU0sSUFBSSxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsTUFBTSxDQUFDLFdBQVcsQ0FBQztpQkFDM0U7Z0JBQ0QsTUFBTSxJQUFJLElBQUksQ0FBQztnQkFFZixNQUFNLElBQUksb0JBQW9CLElBQUksQ0FBQyxZQUFZLE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLEVBQUUsTUFBTSxDQUFDLFNBQVMsQ0FBQztnQkFDcEgsTUFBTSxJQUFJLHFCQUFxQixJQUFJLENBQUMsTUFBTSxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUM7Z0JBQ2xGLE1BQU0sSUFBSSxzQkFBc0IsSUFBSSxDQUFDLFNBQVMsSUFBSSxDQUFDO2dCQUVuRCxJQUFJLElBQUksQ0FBQyxTQUFTLEVBQUU7b0JBQ2xCLE1BQU0sSUFBSSx1QkFBdUIsSUFBSSxDQUFDLFNBQVMsQ0FBQyxjQUFjLEVBQUUsSUFBSSxDQUFDO2lCQUN0RTtnQkFFRCxJQUFJLElBQUksQ0FBQyxlQUFlLEVBQUU7b0JBQ3hCLE1BQU0sSUFBSSx3QkFBd0IsQ0FBQztpQkFDcEM7Z0JBRUQsSUFBSSxJQUFJLENBQUMsZ0JBQWdCLEVBQUU7b0JBQ3pCLE1BQU0sSUFBSSwwQkFBMEIsQ0FBQztpQkFDdEM7Z0JBRUQsSUFBSSxJQUFJLENBQUMsTUFBTSxFQUFFO29CQUNmLE1BQU0sSUFBSSxrQkFBa0IsSUFBSSxDQUFDLE1BQU0seUJBQXlCLENBQUM7aUJBQ2xFO2dCQUVELE1BQU0sSUFBSSxJQUFJLENBQUM7WUFDakIsQ0FBQyxDQUFDLENBQUM7WUFFSCxPQUFPLE1BQU0sQ0FBQztTQUNmO1FBQUMsT0FBTyxLQUFLLEVBQUU7WUFDZCxPQUFPLDBCQUEwQixLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxlQUFlLEVBQUUsQ0FBQztTQUM3RjtJQUNILENBQUM7SUFFRCxLQUFLLENBQUMsWUFBWSxDQUFDLE1BQTBDO1FBQzNELElBQUk7WUFDRixNQUFNLE9BQU8sR0FBRyxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDO2dCQUMxQyxNQUFNLEVBQUUsTUFBTSxDQUFDLE1BQU07Z0JBQ3JCLE1BQU0sRUFBRSxNQUFNLENBQUMsTUFBTTtnQkFDckIsVUFBVSxFQUFFLE1BQU0sQ0FBQyxVQUFVO2FBQzlCLENBQUMsQ0FBQztZQUVILElBQUksT0FBTyxDQUFDLE1BQU0sS0FBSyxDQUFDLEVBQUU7Z0JBQ3hCLE9BQU8scUJBQXFCLE1BQU0sQ0FBQyxNQUFNLEVBQUUsQ0FBQzthQUM3QztZQUVELE1BQU0sTUFBTSxHQUFHLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUMxQixNQUFNLE1BQU0sR0FBRyxNQUFNLENBQUMsTUFBcUIsQ0FBQztZQUM1QyxNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDLGFBQWEsQ0FBQyxNQUFNLENBQUMsQ0FBQztZQUVyRCxJQUFJLE1BQU0sR0FBRyw0QkFBNEIsQ0FBQztZQUMxQyxNQUFNLElBQUksdUJBQXVCLFVBQVUsSUFBSSxDQUFDO1lBQ2hELE1BQU0sSUFBSSxzQkFBc0IsTUFBTSxDQUFDLFFBQVEsSUFBSSxDQUFDO1lBQ3BELE1BQU0sSUFBSSxnQkFBZ0IsTUFBTSxDQUFDLFVBQVUsSUFBSSxDQUFDO1lBQ2hELE1BQU0sSUFBSSxpQkFBaUIsTUFBTSxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsR0FBRyxNQUFNLENBQUMsU0FBUyxNQUFNLENBQUMsQ0FBQyxDQUFDLEtBQUssSUFBSSxDQUFDO1lBQ3BGLE1BQU0sSUFBSSx3QkFBd0IsTUFBTSxDQUFDLFdBQVcsRUFBRSxjQUFjLEVBQUUsSUFBSSxLQUFLLElBQUksQ0FBQztZQUNwRixNQUFNLElBQUksMEJBQTBCLE1BQU0sQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLHVCQUF1QixDQUFDLENBQUMsQ0FBQyxTQUFTLElBQUksQ0FBQztZQUMvRixNQUFNLElBQUkseUJBQXlCLE1BQU0sQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsSUFBSSxJQUFJLENBQUM7WUFDdEUsTUFBTSxJQUFJLHlCQUF5QixNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLElBQUksSUFBSSxDQUFDO1lBQ3BFLE1BQU0sSUFBSSx5QkFBeUIsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxJQUFJLElBQUksQ0FBQztZQUVwRSxJQUFJLE1BQU0sQ0FBQyxvQkFBb0IsRUFBRTtnQkFDL0IsTUFBTSxJQUFJLDBCQUEwQixNQUFNLENBQUMsb0JBQW9CLENBQUMsY0FBYyxFQUFFLElBQUksQ0FBQzthQUN0RjtZQUVELElBQUksTUFBTSxDQUFDLFNBQVMsRUFBRTtnQkFDcEIsTUFBTSxTQUFTLEdBQUcsSUFBSSxJQUFJLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxtQkFBbUIsQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQztnQkFDOUUsTUFBTSxJQUFJLDJCQUEyQixTQUFTLENBQUMsa0JBQWtCLEVBQUUsSUFBSSxDQUFDO2FBQ3pFO1lBRUQsSUFBSSxNQUFNLENBQUMsVUFBVSxJQUFJLE1BQU0sQ0FBQyxVQUFVLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRTtnQkFDckQsTUFBTSxJQUFJLHFDQUFxQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxNQUFNLENBQUMsVUFBVSxDQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUM7Z0JBQy9GLE1BQU0sQ0FBQyxVQUFVLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxFQUFFLEVBQUU7b0JBQ2hELE1BQU0sSUFBSSxHQUFHLENBQUMsR0FBRyxDQUFDLEtBQUssSUFBSSxJQUFJLENBQUM7Z0JBQ2xDLENBQUMsQ0FBQyxDQUFDO2dCQUVILElBQUksTUFBTSxDQUFDLFVBQVUsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFO29CQUNoQyxNQUFNLElBQUksV0FBVyxNQUFNLENBQUMsVUFBVSxDQUFDLE1BQU0sR0FBRyxDQUFDLFNBQVMsQ0FBQztpQkFDNUQ7YUFDRjtZQUVELE9BQU8sTUFBTSxDQUFDO1NBQ2Y7UUFBQyxPQUFPLEtBQUssRUFBRTtZQUNkLE9BQU8sNEJBQTRCLEtBQUssWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLGVBQWUsRUFBRSxDQUFDO1NBQy9GO0lBQ0gsQ0FBQztJQUVELEtBQUssQ0FBQyxjQUFjLENBQUMsTUFBeUM7UUFDNUQsSUFBSTtZQUNGLE1BQU0sV0FBVyxHQUFHLE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxjQUFjLENBQUM7Z0JBQ25ELE1BQU0sRUFBRSxNQUFNLENBQUMsTUFBTTtnQkFDckIsUUFBUSxFQUFFLE1BQU0sQ0FBQyxRQUFRO2dCQUN6QixJQUFJLEVBQUUsTUFBTSxDQUFDLElBQUk7YUFDbEIsQ0FBQyxDQUFDO1lBRUgsSUFBSSxXQUFXLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRTtnQkFDNUIsT0FBTyxzQ0FBc0MsTUFBTSxDQUFDLFFBQVEsRUFBRSxDQUFDO2FBQ2hFO1lBRUQsTUFBTSxNQUFNLEdBQUcsTUFBTSxDQUFDLE1BQXFCLENBQUM7WUFDNUMsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBQyxhQUFhLENBQUMsTUFBTSxDQUFDLENBQUM7WUFFckQsSUFBSSxNQUFNLEdBQUcsNkJBQTZCLE1BQU0sQ0FBQyxRQUFRLFFBQVEsQ0FBQztZQUNsRSxNQUFNLElBQUksdUJBQXVCLFVBQVUsSUFBSSxDQUFDO1lBQ2hELE1BQU0sSUFBSSxpQkFBaUIsV0FBVyxDQUFDLE1BQU0sZUFBZSxDQUFDO1lBRTdELFdBQVcsQ0FBQyxPQUFPLENBQUMsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxFQUFFLEVBQUU7Z0JBQ2pDLE1BQU0sSUFBSSxHQUFHLE1BQU0sQ0FBQyxJQUFJLEdBQUcsR0FBRyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUM7Z0JBQ3ZDLE1BQU0sSUFBSSxNQUFNLElBQUksTUFBTSxPQUFPLENBQUMsSUFBSSxNQUFNLENBQUM7Z0JBQzdDLE1BQU0sSUFBSSxRQUFRLE9BQU8sQ0FBQyxLQUFLLE1BQU0sQ0FBQztnQkFDdEMsTUFBTSxJQUFJLHVCQUF1QixPQUFPLENBQUMsU0FBUyxDQUFDLGNBQWMsRUFBRSxJQUFJLENBQUM7Z0JBRXhFLElBQUksT0FBTyxDQUFDLEtBQUssRUFBRTtvQkFDakIsTUFBTSxJQUFJLGlCQUFpQixJQUFJLENBQUMsTUFBTSxDQUFDLFdBQVcsQ0FBQyxPQUFPLENBQUMsS0FBSyxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUM7aUJBQy9FO2dCQUVELElBQUksT0FBTyxDQUFDLE1BQU0sSUFBSSxPQUFPLENBQUMsV0FBVyxFQUFFO29CQUN6QyxNQUFNLElBQUksaUJBQWlCLE9BQU8sQ0FBQyxNQUFNLFNBQVMsT0FBTyxDQUFDLFdBQVcsQ0FBQyxjQUFjLEVBQUUsYUFBYSxDQUFDO2lCQUNyRztnQkFFRCxNQUFNLElBQUksaUJBQWlCLE9BQU8sQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsSUFBSSxJQUFJLENBQUM7Z0JBQzlELE1BQU0sSUFBSSxJQUFJLENBQUM7WUFDakIsQ0FBQyxDQUFDLENBQUM7WUFFSCxPQUFPLE1BQU0sQ0FBQztTQUNmO1FBQUMsT0FBTyxLQUFLLEVBQUU7WUFDZCxPQUFPLCtCQUErQixLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxlQUFlLEVBQUUsQ0FBQztTQUNsRztJQUNILENBQUM7SUFFRCxLQUFLLENBQUMsZUFBZSxDQUFDLE1BQTBDO1FBQzlELElBQUk7WUFDRixNQUFNLE9BQU8sR0FBRyxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsZ0JBQWdCLENBQ2hELE1BQU0sQ0FBQyxJQUFJLEVBQ1gsTUFBTSxDQUFDLE1BQXFCLEVBQzVCO2dCQUNFLElBQUksRUFBRSxNQUFNLENBQUMsSUFBSTtnQkFDakIsT0FBTyxFQUFFLElBQUk7YUFDZCxDQUNGLENBQUM7WUFFRixJQUFJLENBQUMsT0FBTyxJQUFJLENBQUMsT0FBTyxDQUFDLEdBQUcsRUFBRTtnQkFDNUIsT0FBTyxvQ0FBb0MsTUFBTSxDQUFDLElBQUksRUFBRSxDQUFDO2FBQzFEO1lBRUQsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBQyxZQUFZLENBQUMsT0FBTyxDQUFDLEdBQUcsRUFBRSxNQUFNLENBQUMsUUFBUSxDQUFDLENBQUM7WUFFekUsSUFBSSxTQUFTLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRTtnQkFDMUIsT0FBTyxrREFBa0QsTUFBTSxDQUFDLFFBQVEsR0FBRyxDQUFDO2FBQzdFO1lBRUQsTUFBTSxNQUFNLEdBQUcsTUFBTSxDQUFDLE1BQXFCLENBQUM7WUFDNUMsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBQyxhQUFhLENBQUMsTUFBTSxDQUFDLENBQUM7WUFFckQsTUFBTSxhQUFhLEdBQTJCO2dCQUM1QyxDQUFDLHFCQUFhLENBQUMsTUFBTSxDQUFDLEVBQUUsY0FBYztnQkFDdEMsQ0FBQyxxQkFBYSxDQUFDLEdBQUcsQ0FBQyxFQUFFLFdBQVc7Z0JBQ2hDLENBQUMscUJBQWEsQ0FBQyxJQUFJLENBQUMsRUFBRSxZQUFZO2dCQUNsQyxDQUFDLHFCQUFhLENBQUMsVUFBVSxDQUFDLEVBQUUsWUFBWTtnQkFDeEMsQ0FBQyxxQkFBYSxDQUFDLE1BQU0sQ0FBQyxFQUFFLFFBQVE7Z0JBQ2hDLENBQUMscUJBQWEsQ0FBQyxhQUFhLENBQUMsRUFBRSxjQUFjO2FBQzlDLENBQUM7WUFFRixNQUFNLFlBQVksR0FBRyxhQUFhLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxJQUFJLGFBQWEsTUFBTSxDQUFDLFFBQVEsRUFBRSxDQUFDO1lBRXRGLElBQUksTUFBTSxHQUFHLHVCQUF1QixNQUFNLENBQUMsSUFBSSxRQUFRLENBQUM7WUFDeEQsTUFBTSxJQUFJLHVCQUF1QixVQUFVLElBQUksQ0FBQztZQUNoRCxNQUFNLElBQUkscUJBQXFCLFlBQVksSUFBSSxDQUFDO1lBQ2hELE1BQU0sSUFBSSx1QkFBdUIsTUFBTSxDQUFDLElBQUksU0FBUyxDQUFDO1lBQ3RELE1BQU0sSUFBSSx1QkFBdUIsU0FBUyxDQUFDLE1BQU0sTUFBTSxDQUFDO1lBRXhELElBQUksU0FBUyxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUU7Z0JBQ3hCLE1BQU0sTUFBTSxHQUFHLFNBQVMsQ0FBQyxTQUFTLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQyxDQUFDO2dCQUMvQyxNQUFNLE1BQU0sR0FBRyxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUM7Z0JBRTVCLE1BQU0sSUFBSSxvQkFBb0IsQ0FBQztnQkFDL0IsSUFBSSxNQUFNLENBQUMsUUFBUSxJQUFJLENBQUMsSUFBSSxNQUFNLENBQUMsUUFBUSxLQUFLLEVBQUUsRUFBRTtvQkFDbEQsTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBQyxXQUFXLENBQUMsTUFBTSxDQUFDLEtBQUssRUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDO2lCQUNoRTtxQkFBTTtvQkFDTCxNQUFNLElBQUksR0FBRyxNQUFNLENBQUMsS0FBSyxDQUFDLGNBQWMsRUFBRSxJQUFJLENBQUM7aUJBQ2hEO2dCQUVELE1BQU0sSUFBSSxhQUFhLElBQUksSUFBSSxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsQ0FBQyxrQkFBa0IsRUFBRSxNQUFNLENBQUM7Z0JBRTdFLElBQUksTUFBTSxDQUFDLFFBQVEsSUFBSSxDQUFDLElBQUksTUFBTSxDQUFDLFFBQVEsS0FBSyxFQUFFLEVBQUU7b0JBQ2xELE1BQU0sTUFBTSxHQUFHLFNBQVMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDO29CQUM5RCxJQUFJLE1BQU0sQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFO3dCQUNyQixNQUFNLEdBQUcsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLEdBQUcsTUFBTSxDQUFDLENBQUM7d0JBQ2hDLE1BQU0sR0FBRyxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsR0FBRyxNQUFNLENBQUMsQ0FBQzt3QkFDaEMsTUFBTSxHQUFHLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLEdBQUcsRUFBRSxLQUFLLEVBQUUsRUFBRSxDQUFDLEdBQUcsR0FBRyxLQUFLLEVBQUUsQ0FBQyxDQUFDLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQzt3QkFFMUUsTUFBTSxJQUFJLHlCQUF5QixDQUFDO3dCQUNwQyxNQUFNLElBQUksY0FBYyxJQUFJLENBQUMsTUFBTSxDQUFDLFdBQVcsQ0FBQyxHQUFHLEVBQUUsTUFBTSxDQUFDLElBQUksQ0FBQzt3QkFDakUsTUFBTSxJQUFJLGNBQWMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxXQUFXLENBQUMsR0FBRyxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUM7d0JBQ2pFLE1BQU0sSUFBSSxjQUFjLElBQUksQ0FBQyxNQUFNLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLEVBQUUsTUFBTSxDQUFDLE1BQU0sQ0FBQztxQkFDaEY7aUJBQ0Y7Z0JBRUQsTUFBTSxJQUFJLDZDQUE2QyxDQUFDO2dCQUN4RCxNQUFNLFVBQVUsR0FBRyxTQUFTLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUM7Z0JBQ3hDLFVBQVUsQ0FBQyxPQUFPLENBQUMsQ0FBQyxLQUFLLEVBQUUsQ0FBQyxFQUFFLEVBQUU7b0JBQzlCLE1BQU0sSUFBSSxHQUFHLElBQUksSUFBSSxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsQ0FBQyxrQkFBa0IsRUFBRSxDQUFDO29CQUM1RCxJQUFJLEtBQWEsQ0FBQztvQkFFbEIsSUFBSSxNQUFNLENBQUMsUUFBUSxJQUFJLENBQUMsSUFBSSxNQUFNLENBQUMsUUFBUSxLQUFLLEVBQUUsRUFBRTt3QkFDbEQsS0FBSyxHQUFHLElBQUksQ0FBQyxNQUFNLENBQUMsV0FBVyxDQUFDLEtBQUssQ0FBQyxLQUFLLEVBQUUsTUFBTSxDQUFDLENBQUM7cUJBQ3REO3lCQUFNO3dCQUNMLEtBQUssR0FBRyxLQUFLLENBQUMsS0FBSyxDQUFDLGNBQWMsRUFBRSxDQUFDO3FCQUN0QztvQkFFRCxNQUFNLElBQUksR0FBRyxVQUFVLENBQUMsTUFBTSxHQUFHLENBQUMsS0FBSyxJQUFJLEtBQUssS0FBSyxJQUFJLENBQUM7Z0JBQzVELENBQUMsQ0FBQyxDQUFDO2FBQ0o7WUFFRCxPQUFPLE1BQU0sQ0FBQztTQUNmO1FBQUMsT0FBTyxLQUFLLEVBQUU7WUFDZCxPQUFPLGdDQUFnQyxLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxlQUFlLEVBQUUsQ0FBQztTQUNuRztJQUNILENBQUM7SUFFRCxLQUFLLENBQUMsWUFBWSxDQUFDLE1BQTJDO1FBQzVELElBQUk7WUFDRixNQUFNLE1BQU0sR0FBRyxNQUFNLENBQUMsTUFBcUIsQ0FBQztZQUM1QyxNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDLGFBQWEsQ0FBQyxNQUFNLENBQUMsQ0FBQztZQUVyRCxJQUFJLE1BQU0sR0FBRyx1Q0FBdUMsQ0FBQztZQUNyRCxNQUFNLElBQUksdUJBQXVCLFVBQVUsSUFBSSxDQUFDO1lBQ2hELE1BQU0sSUFBSSwyQkFBMkIsQ0FBQztZQUV0QyxJQUFJLE1BQU0sQ0FBQyxVQUFVLEVBQUU7Z0JBQ3JCLE1BQU0sSUFBSSxlQUFlLE1BQU0sQ0FBQyxVQUFVLElBQUksQ0FBQzthQUNoRDtZQUNELElBQUksTUFBTSxDQUFDLFNBQVMsSUFBSSxNQUFNLENBQUMsU0FBUyxFQUFFO2dCQUN4QyxNQUFNLEdBQUcsR0FBRyxNQUFNLENBQUMsU0FBUyxJQUFJLENBQUMsQ0FBQztnQkFDbEMsTUFBTSxHQUFHLEdBQUcsTUFBTSxDQUFDLFNBQVMsSUFBSSxDQUFDLENBQUM7Z0JBQ2xDLE1BQU0sSUFBSSxhQUFhLEdBQUcsSUFBSSxHQUFHLFVBQVUsQ0FBQzthQUM3QztZQUNELElBQUksTUFBTSxDQUFDLFFBQVEsSUFBSSxNQUFNLENBQUMsUUFBUSxFQUFFO2dCQUN0QyxNQUFNLEdBQUcsR0FBRyxNQUFNLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLFdBQVcsQ0FBQyxNQUFNLENBQUMsUUFBUSxFQUFFLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUM7Z0JBQ3ZGLE1BQU0sR0FBRyxHQUFHLE1BQU0sQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsV0FBVyxDQUFDLE1BQU0sQ0FBQyxRQUFRLEVBQUUsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQztnQkFDdkYsTUFBTSxJQUFJLFlBQVksR0FBRyxNQUFNLEdBQUcsSUFBSSxDQUFDO2FBQ3hDO1lBQ0QsSUFBSSxNQUFNLENBQUMsV0FBVyxJQUFJLE1BQU0sQ0FBQyxXQUFXLEVBQUU7Z0JBQzVDLE1BQU0sR0FBRyxHQUFHLE1BQU0sQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsV0FBVyxDQUFDLE1BQU0sQ0FBQyxXQUFXLEVBQUUsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQztnQkFDN0YsTUFBTSxHQUFHLEdBQUcsTUFBTSxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxXQUFXLENBQUMsTUFBTSxDQUFDLFdBQVcsRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDO2dCQUM3RixNQUFNLElBQUksZUFBZSxHQUFHLE1BQU0sR0FBRyxJQUFJLENBQUM7YUFDM0M7WUFDRCxJQUFJLE1BQU0sQ0FBQyxlQUFlLElBQUksTUFBTSxDQUFDLGVBQWUsRUFBRTtnQkFDcEQsTUFBTSxHQUFHLEdBQUcsTUFBTSxDQUFDLGVBQWUsRUFBRSxjQUFjLEVBQUUsSUFBSSxLQUFLLENBQUM7Z0JBQzlELE1BQU0sR0FBRyxHQUFHLE1BQU0sQ0FBQyxlQUFlLEVBQUUsY0FBYyxFQUFFLElBQUksS0FBSyxDQUFDO2dCQUM5RCxNQUFNLElBQUksb0JBQW9CLEdBQUcsTUFBTSxHQUFHLElBQUksQ0FBQzthQUNoRDtZQUNELElBQUksTUFBTSxDQUFDLGNBQWMsSUFBSSxNQUFNLENBQUMsY0FBYyxFQUFFO2dCQUNsRCxNQUFNLEdBQUcsR0FBRyxNQUFNLENBQUMsY0FBYyxJQUFJLEtBQUssQ0FBQztnQkFDM0MsTUFBTSxHQUFHLEdBQUcsTUFBTSxDQUFDLGNBQWMsSUFBSSxLQUFLLENBQUM7Z0JBQzNDLE1BQU0sYUFBYSxHQUFHLE1BQU0sQ0FBQyxvQkFBb0IsS0FBSyxPQUFPLENBQUMsQ0FBQyxDQUFDLGdCQUFnQixDQUFDLENBQUM7b0JBQzdELE1BQU0sQ0FBQyxvQkFBb0IsS0FBSyxTQUFTLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDO3dCQUN2RCxNQUFNLENBQUMsb0JBQW9CLEtBQUssT0FBTyxDQUFDLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDOzRCQUM1RCxNQUFNLENBQUMsb0JBQW9CLEtBQUssUUFBUSxDQUFDLENBQUMsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDO2dDQUM5RCxpQkFBaUIsQ0FBQztnQkFDdkMsTUFBTSxJQUFJLG1CQUFtQixHQUFHLE1BQU0sR0FBRyxLQUFLLGFBQWEsS0FBSyxDQUFDO2FBQ2xFO1lBQ0QsSUFBSSxNQUFNLENBQUMsT0FBTyxLQUFLLFNBQVMsRUFBRTtnQkFDaEMsTUFBTSxJQUFJLGlCQUFpQixNQUFNLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLElBQUksSUFBSSxDQUFDO2FBQzlEO1lBQ0QsSUFBSSxNQUFNLENBQUMsVUFBVSxLQUFLLFNBQVMsRUFBRTtnQkFDbkMsTUFBTSxJQUFJLGtCQUFrQixNQUFNLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLElBQUksSUFBSSxDQUFDO2FBQ2xFO1lBRUQsTUFBTSxJQUFJLFdBQVcsTUFBTSxDQUFDLE1BQU0sS0FBSyxNQUFNLENBQUMsU0FBUyxPQUFPLENBQUM7WUFFL0QsOEJBQThCO1lBQzlCLE1BQU0sUUFBUSxHQUFHLE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxjQUFjLENBQUMsTUFBTSxDQUFDLENBQUM7WUFFMUQsSUFBSSxRQUFRLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRTtnQkFDekIsTUFBTSxJQUFJLHFEQUFxRCxDQUFDO2dCQUNoRSxNQUFNLElBQUksb0JBQW9CLENBQUM7Z0JBQy9CLE1BQU0sSUFBSSxtQ0FBbUMsQ0FBQztnQkFDOUMsTUFBTSxJQUFJLHdDQUF3QyxDQUFDO2dCQUNuRCxNQUFNLElBQUksa0NBQWtDLENBQUM7Z0JBQzdDLE1BQU0sSUFBSSxxQ0FBcUMsQ0FBQztnQkFDaEQsT0FBTyxNQUFNLENBQUM7YUFDZjtZQUVELE1BQU0sSUFBSSxjQUFjLFFBQVEsQ0FBQyxNQUFNLHFCQUFxQixNQUFNLENBQUMsSUFBSSxHQUFHLENBQUMsUUFBUSxDQUFDO1lBRXBGLFFBQVEsQ0FBQyxPQUFPLENBQUMsQ0FBQyxPQUFZLEVBQUUsQ0FBUyxFQUFFLEVBQUU7Z0JBQzNDLE1BQU0sSUFBSSxHQUFHLE1BQU0sQ0FBQyxJQUFJLEdBQUcsTUFBTSxDQUFDLE9BQU8sR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDO2dCQUNsRCxNQUFNLEtBQUssR0FBRyxPQUFPLENBQUMsS0FBSyxJQUFJLE9BQU8sQ0FBQyxZQUFZLElBQUksaUJBQWlCLENBQUM7Z0JBQ3pFLE1BQU0sV0FBVyxHQUFHLE9BQU8sQ0FBQyxXQUFXLElBQUksT0FBTyxDQUFDLEtBQUssRUFBRSxXQUFXLElBQUksQ0FBQyxDQUFDO2dCQUMzRSxNQUFNLE1BQU0sR0FBRyxPQUFPLENBQUMsS0FBSyxFQUFFLGNBQWMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxjQUFjLEdBQUcsRUFBRSxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDO2dCQUNsRyxNQUFNLFdBQVcsR0FBRyxPQUFPLENBQUMsS0FBSyxFQUFFLHFCQUFxQixJQUFJLE9BQU8sQ0FBQyxXQUFXLENBQUM7Z0JBQ2hGLE1BQU0sS0FBSyxHQUFHLE9BQU8sQ0FBQyxLQUFLLEVBQUUsY0FBYyxJQUFJLE9BQU8sQ0FBQyxLQUFLLENBQUM7Z0JBQzdELE1BQU0sUUFBUSxHQUFHLE9BQU8sQ0FBQyxLQUFLLEVBQUUsd0JBQXdCLElBQUksT0FBTyxDQUFDLFFBQVEsQ0FBQztnQkFDN0UsTUFBTSxTQUFTLEdBQUcsT0FBTyxDQUFDLEtBQUssRUFBRSxhQUFhLElBQUksT0FBTyxDQUFDLFNBQVMsQ0FBQztnQkFDcEUsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBQyxjQUFjLENBQUMsT0FBTyxFQUFFLE1BQU0sQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDO2dCQUNwRixNQUFNLFdBQVcsR0FBRyxVQUFVLENBQUMsS0FBSyxDQUFDO2dCQUVyQyw4QkFBOEI7Z0JBQzlCLElBQUksV0FBVyxHQUFHLFFBQVEsQ0FBQztnQkFDM0IsSUFBSSxXQUFXLElBQUksQ0FBQztvQkFBRSxXQUFXLEdBQUcsS0FBSyxDQUFDO3FCQUNyQyxJQUFJLFdBQVcsSUFBSSxFQUFFO29CQUFFLFdBQVcsR0FBRyxNQUFNLENBQUM7Z0JBRWpELE1BQU0sSUFBSSxLQUFLLElBQUksS0FBSyxPQUFPLENBQUMsSUFBSSxNQUFNLFdBQVcsS0FBSyxLQUFLLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsV0FBVyxLQUFLLFFBQVEsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxJQUFJLElBQUksQ0FBQztnQkFDcEgsTUFBTSxJQUFJLFFBQVEsS0FBSyxNQUFNLENBQUM7Z0JBRTlCLElBQUksT0FBTyxDQUFDLEtBQUssRUFBRTtvQkFDakIsTUFBTSxJQUFJLGNBQWMsT0FBTyxDQUFDLEtBQUssSUFBSSxDQUFDO2lCQUMzQztnQkFFRCxJQUFJLEtBQUssSUFBSSxLQUFLLEdBQUcsQ0FBQyxFQUFFO29CQUN0QixNQUFNLElBQUksaUJBQWlCLElBQUksQ0FBQyxNQUFNLENBQUMsV0FBVyxDQUFDLEtBQUssRUFBRSxNQUFNLENBQUMsRUFBRSxDQUFDO29CQUNwRSxJQUFJLFFBQVEsSUFBSSxRQUFRLEdBQUcsQ0FBQyxFQUFFO3dCQUM1QixNQUFNLElBQUksTUFBTSxJQUFJLENBQUMsTUFBTSxDQUFDLFdBQVcsQ0FBQyxRQUFRLEVBQUUsTUFBTSxDQUFDLFdBQVcsQ0FBQztxQkFDdEU7b0JBQ0QsTUFBTSxJQUFJLElBQUksQ0FBQztpQkFDaEI7Z0JBRUQsSUFBSSxNQUFNLElBQUksV0FBVyxFQUFFO29CQUN6QixNQUFNLElBQUksaUJBQWlCLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLFNBQVMsV0FBVyxDQUFDLGNBQWMsRUFBRSxhQUFhLENBQUM7aUJBQ2hHO2dCQUVELElBQUksV0FBVyxJQUFJLFdBQVcsR0FBRyxDQUFDLEVBQUU7b0JBQ2xDLE1BQU0sSUFBSSwwQkFBMEIsV0FBVyxDQUFDLGNBQWMsRUFBRSxVQUFVLENBQUM7aUJBQzVFO2dCQUVELElBQUksU0FBUyxFQUFFO29CQUNiLE1BQU0sSUFBSSx1QkFBdUIsU0FBUyxDQUFDLGNBQWMsRUFBRSxJQUFJLENBQUM7aUJBQ2pFO2dCQUVELE1BQU0sSUFBSSxtQkFBbUIsV0FBVyxLQUFLLFVBQVUsQ0FBQyxXQUFXLEtBQUssQ0FBQztnQkFFekUsSUFBSSxPQUFPLENBQUMsT0FBTyxFQUFFO29CQUNuQixNQUFNLElBQUksd0JBQXdCLENBQUM7aUJBQ3BDO2dCQUVELG9DQUFvQztnQkFDcEMsSUFBSSxLQUFLLElBQUksS0FBSyxHQUFHLElBQUksRUFBRTtvQkFDekIsTUFBTSxlQUFlLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLEVBQUUsSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLEVBQUUsRUFBRSxHQUFHLENBQUMsV0FBVyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztvQkFDM0UsTUFBTSxJQUFJLDhCQUE4QixlQUFlLEtBQUssQ0FBQztpQkFDOUQ7Z0JBRUQsTUFBTSxJQUFJLHVCQUF1QixXQUFXLE1BQU0sQ0FBQztZQUNyRCxDQUFDLENBQUMsQ0FBQztZQUVILE1BQU0sSUFBSSxvQkFBb0IsQ0FBQztZQUMvQixNQUFNLElBQUksNERBQTRELENBQUM7WUFDdkUsTUFBTSxJQUFJLCtEQUErRCxDQUFDO1lBQzFFLE1BQU0sSUFBSSxpRUFBaUUsQ0FBQztZQUM1RSxNQUFNLElBQUksdURBQXVELENBQUM7WUFFbEUsT0FBTyxNQUFNLENBQUM7U0FDZjtRQUFDLE9BQU8sS0FBSyxFQUFFO1lBQ2QsT0FBTyxDQUFDLEtBQUssQ0FBQyx1QkFBdUIsRUFBRSxLQUFLLENBQUMsQ0FBQztZQUM5QyxNQUFNLFlBQVksR0FBRyxLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUM7Z0JBQ3pDLE9BQU8sS0FBSyxLQUFLLFFBQVEsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUM7b0JBQ25DLElBQUksQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLENBQUM7WUFDMUMsT0FBTyw0QkFBNEIsWUFBWSxFQUFFLENBQUM7U0FDbkQ7SUFDSCxDQUFDO0lBR0QsS0FBSyxDQUFDLGVBQWUsQ0FBQyxNQUE4QztRQUNsRSxJQUFJO1lBQ0YsTUFBTSxNQUFNLEdBQUcsTUFBTSxDQUFDLE1BQXFCLENBQUM7WUFDNUMsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBQyxhQUFhLENBQUMsTUFBTSxDQUFDLENBQUM7WUFFckQsSUFBSSxNQUFNLEdBQUcscUNBQXFDLENBQUM7WUFDbkQsTUFBTSxJQUFJLHVCQUF1QixVQUFVLElBQUksQ0FBQztZQUNoRCxNQUFNLElBQUksd0JBQXdCLE1BQU0sQ0FBQyxVQUFVLElBQUksQ0FBQztZQUN4RCxNQUFNLElBQUkseUJBQXlCLE1BQU0sQ0FBQyxZQUFZLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLFdBQVcsRUFBRSxHQUFHLE1BQU0sQ0FBQyxZQUFZLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxHQUFHLEVBQUUsR0FBRyxDQUFDLElBQUksQ0FBQztZQUNwSSxNQUFNLElBQUkscUJBQXFCLE1BQU0sQ0FBQyxTQUFTLE1BQU0sQ0FBQztZQUV0RCx1Q0FBdUM7WUFDdkMsUUFBUSxNQUFNLENBQUMsWUFBWSxFQUFFO2dCQUMzQixLQUFLLFVBQVU7b0JBQ2IsTUFBTSxJQUFJLE1BQU0sSUFBSSxDQUFDLG1CQUFtQixDQUFDLE1BQU0sRUFBRSxNQUFNLENBQUMsQ0FBQztvQkFDekQsTUFBTTtnQkFDUixLQUFLLGdCQUFnQjtvQkFDbkIsTUFBTSxJQUFJLE1BQU0sSUFBSSxDQUFDLGdCQUFnQixDQUFDLE1BQU0sRUFBRSxNQUFNLENBQUMsQ0FBQztvQkFDdEQsTUFBTTtnQkFDUixLQUFLLGVBQWU7b0JBQ2xCLE1BQU0sSUFBSSxNQUFNLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxNQUFNLEVBQUUsTUFBTSxDQUFDLENBQUM7b0JBQ3RELE1BQU07Z0JBQ1IsS0FBSyxRQUFRO29CQUNYLE1BQU0sSUFBSSxNQUFNLElBQUksQ0FBQyxTQUFTLENBQUMsTUFBTSxFQUFFLE1BQU0sQ0FBQyxDQUFDO29CQUMvQyxNQUFNO2FBQ1Q7WUFFRCxPQUFPLE1BQU0sQ0FBQztTQUNmO1FBQUMsT0FBTyxLQUFLLEVBQUU7WUFDZCxPQUFPLENBQUMsS0FBSyxDQUFDLDBCQUEwQixFQUFFLEtBQUssQ0FBQyxDQUFDO1lBQ2pELE1BQU0sWUFBWSxHQUFHLEtBQUssWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQztnQkFDekMsT0FBTyxLQUFLLEtBQUssUUFBUSxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQztvQkFDbkMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsQ0FBQztZQUMxQyxPQUFPLDZCQUE2QixZQUFZLEVBQUUsQ0FBQztTQUNwRDtJQUNILENBQUM7SUFFTyxLQUFLLENBQUMsbUJBQW1CLENBQUMsTUFBOEMsRUFBRSxNQUFtQjtRQUNuRyxnQ0FBZ0M7UUFDaEMsTUFBTSxXQUFXLEdBQUcsTUFBTSxJQUFJLENBQUMsTUFBTSxDQUFDLGNBQWMsQ0FBQztZQUNuRCxNQUFNLEVBQUUsTUFBTSxDQUFDLE1BQU07WUFDckIsUUFBUSxFQUFFLE1BQU0sQ0FBQyxVQUFVO1lBQzNCLElBQUksRUFBRSxDQUFDO1NBQ1IsQ0FBQyxDQUFDO1FBRUgsbURBQW1EO1FBQ25ELE1BQU0sZ0JBQWdCLEdBQUcsTUFBTSxJQUFJLENBQUMsTUFBTSxDQUFDLGNBQWMsQ0FBQztZQUN4RCxNQUFNLEVBQUUsTUFBTSxDQUFDLE1BQU07WUFDckIsVUFBVSxFQUFFLE1BQU0sQ0FBQyxVQUFVO1lBQzdCLFNBQVMsRUFBRSxNQUFNLENBQUMsU0FBUztZQUMzQixPQUFPLEVBQUUsRUFBRTtZQUNYLE1BQU0sRUFBRSxhQUFhO1NBQ3RCLENBQUMsQ0FBQztRQUVILElBQUksTUFBTSxHQUFHLDhCQUE4QixDQUFDO1FBRTVDLElBQUksV0FBVyxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUU7WUFDMUIsTUFBTSxJQUFJLHdCQUF3QixXQUFXLENBQUMsTUFBTSxtQkFBbUIsQ0FBQztZQUN4RSxNQUFNLElBQUksdUJBQXVCLElBQUksQ0FBQyxNQUFNLENBQUMsV0FBVyxDQUN0RCxJQUFJLENBQUMsR0FBRyxDQUFDLEdBQUcsV0FBVyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsS0FBTSxDQUFDLENBQUMsRUFDaEUsTUFBTSxDQUNQLE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxXQUFXLENBQzVCLElBQUksQ0FBQyxHQUFHLENBQUMsR0FBRyxXQUFXLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxLQUFNLENBQUMsQ0FBQyxFQUNoRSxNQUFNLENBQ1AsSUFBSSxDQUFDO1NBQ1A7UUFFRCxJQUFJLGdCQUFnQixDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUU7WUFDL0IsTUFBTSxTQUFTLEdBQUcsZ0JBQWdCO2lCQUMvQixNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsS0FBSyxFQUFFLGNBQWMsQ0FBQztpQkFDcEMsTUFBTSxDQUFDLENBQUMsR0FBRyxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUMsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLEtBQU0sQ0FBQyxjQUFlLEdBQUcsRUFBRSxDQUFDLEVBQUUsQ0FBQyxDQUFDLEdBQUcsZ0JBQWdCLENBQUMsTUFBTSxDQUFDO1lBRTFGLE1BQU0sSUFBSSx5QkFBeUIsU0FBUyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDO1lBQ2hFLE1BQU0sSUFBSSx1QkFBdUIsZ0JBQWdCLENBQUMsTUFBTSx3QkFBd0IsQ0FBQztTQUNsRjtRQUVELE1BQU0sSUFBSSwyQkFBMkIsQ0FBQztRQUN0QyxNQUFNLElBQUksb0JBQW9CLGdCQUFnQixDQUFDLE1BQU0sR0FBRyxFQUFFLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsZ0JBQWdCLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxLQUFLLHNCQUFzQixDQUFDO1FBQzdJLE1BQU0sSUFBSSwrQkFBK0IsV0FBVyxDQUFDLE1BQU0sR0FBRyxFQUFFLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsV0FBVyxDQUFDLE1BQU0sR0FBRyxFQUFFLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsWUFBWSxJQUFJLENBQUM7UUFDcEksTUFBTSxJQUFJLGtEQUFrRCxDQUFDO1FBRTdELE9BQU8sTUFBTSxDQUFDO0lBQ2hCLENBQUM7SUFFTyxLQUFLLENBQUMsZ0JBQWdCLENBQUMsTUFBOEMsRUFBRSxNQUFtQjtRQUNoRyxNQUFNLFdBQVcsR0FBRyxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsY0FBYyxDQUFDO1lBQ25ELE1BQU0sRUFBRSxNQUFNLENBQUMsTUFBTTtZQUNyQixVQUFVLEVBQUUsTUFBTSxDQUFDLFVBQVU7WUFDN0IsU0FBUyxFQUFFLElBQUksQ0FBQyxHQUFHLENBQUMsR0FBRyxFQUFFLE1BQU0sQ0FBQyxTQUFTLElBQUksR0FBRyxDQUFDO1lBQ2pELE1BQU0sRUFBRSxhQUFhO1lBQ3JCLFNBQVMsRUFBRSxNQUFNO1lBQ2pCLE9BQU8sRUFBRSxFQUFFO1NBQ1osQ0FBQyxDQUFDO1FBRUgsSUFBSSxNQUFNLEdBQUcsMkJBQTJCLENBQUM7UUFFekMsSUFBSSxXQUFXLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRTtZQUM1QixNQUFNLElBQUksaURBQWlELENBQUM7WUFDNUQsT0FBTyxNQUFNLENBQUM7U0FDZjtRQUVELFdBQVcsQ0FBQyxPQUFPLENBQUMsQ0FBQyxPQUFZLEVBQUUsQ0FBUyxFQUFFLEVBQUU7WUFDOUMsTUFBTSxLQUFLLEdBQUcsT0FBTyxDQUFDLEtBQUssSUFBSSxPQUFPLENBQUMsWUFBWSxJQUFJLFdBQVcsT0FBTyxDQUFDLElBQUksRUFBRSxDQUFDO1lBQ2pGLE1BQU0sTUFBTSxHQUFHLE9BQU8sQ0FBQyxLQUFLLEVBQUUsY0FBYyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLGNBQWMsR0FBRyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUNyRixNQUFNLFdBQVcsR0FBRyxPQUFPLENBQUMsV0FBVyxJQUFJLENBQUMsQ0FBQztZQUM3QyxNQUFNLEtBQUssR0FBRyxPQUFPLENBQUMsS0FBSyxFQUFFLGNBQWMsSUFBSSxDQUFDLENBQUM7WUFFakQsTUFBTSxJQUFJLEtBQUssQ0FBQyxHQUFHLENBQUMsS0FBSyxLQUFLLENBQUMsU0FBUyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsR0FBRyxLQUFLLENBQUMsTUFBTSxHQUFHLEVBQUUsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxFQUFFLE1BQU0sQ0FBQztZQUN2RixNQUFNLElBQUksWUFBWSxPQUFPLENBQUMsSUFBSSxJQUFJLENBQUM7WUFDdkMsSUFBSSxNQUFNLEdBQUcsQ0FBQztnQkFBRSxNQUFNLElBQUksS0FBSyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUM7WUFDekQsSUFBSSxXQUFXLEdBQUcsQ0FBQztnQkFBRSxNQUFNLElBQUksT0FBTyxXQUFXLENBQUMsY0FBYyxFQUFFLGtCQUFrQixDQUFDO1lBQ3JGLElBQUksS0FBSyxHQUFHLENBQUM7Z0JBQUUsTUFBTSxJQUFJLE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxXQUFXLENBQUMsS0FBSyxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUM7WUFDMUUsTUFBTSxJQUFJLElBQUksQ0FBQztRQUNqQixDQUFDLENBQUMsQ0FBQztRQUVILE9BQU8sTUFBTSxDQUFDO0lBQ2hCLENBQUM7SUFFTyxLQUFLLENBQUMsZ0JBQWdCLENBQUMsTUFBOEMsRUFBRSxNQUFtQjtRQUNoRyx3RUFBd0U7UUFDeEUsTUFBTSxhQUFhLEdBQUcsTUFBTSxJQUFJLENBQUMsTUFBTSxDQUFDLGNBQWMsQ0FBQztZQUNyRCxNQUFNLEVBQUUsTUFBTSxDQUFDLE1BQU07WUFDckIsVUFBVSxFQUFFLE1BQU0sQ0FBQyxVQUFVO1lBQzdCLFNBQVMsRUFBRSxHQUFHO1lBQ2QsY0FBYyxFQUFFLENBQUM7WUFDakIsZUFBZSxFQUFFLEdBQUc7WUFDcEIsTUFBTSxFQUFFLGFBQWE7WUFDckIsU0FBUyxFQUFFLE1BQU07WUFDakIsT0FBTyxFQUFFLEVBQUU7U0FDWixDQUFDLENBQUM7UUFFSCxJQUFJLE1BQU0sR0FBRyxpQ0FBaUMsQ0FBQztRQUUvQyxJQUFJLGFBQWEsQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFO1lBQzlCLE1BQU0sSUFBSSx5REFBeUQsQ0FBQztZQUNwRSxNQUFNLElBQUksa0VBQWtFLENBQUM7WUFDN0UsT0FBTyxNQUFNLENBQUM7U0FDZjtRQUVELE1BQU0sSUFBSSxTQUFTLGFBQWEsQ0FBQyxNQUFNLG9EQUFvRCxDQUFDO1FBRTVGLGFBQWEsQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLE9BQVksRUFBRSxDQUFTLEVBQUUsRUFBRTtZQUM1RCxNQUFNLEtBQUssR0FBRyxPQUFPLENBQUMsS0FBSyxJQUFJLE9BQU8sQ0FBQyxZQUFZLElBQUksV0FBVyxPQUFPLENBQUMsSUFBSSxFQUFFLENBQUM7WUFDakYsTUFBTSxNQUFNLEdBQUcsT0FBTyxDQUFDLEtBQUssRUFBRSxjQUFjLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsY0FBYyxHQUFHLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQ3JGLE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxNQUFNLENBQUMsY0FBYyxDQUFDLE9BQU8sRUFBRSxNQUFNLENBQUMsb0JBQW9CLENBQUMsQ0FBQztZQUNwRixNQUFNLFdBQVcsR0FBRyxVQUFVLENBQUMsS0FBSyxDQUFDO1lBQ3JDLE1BQU0sV0FBVyxHQUFHLE9BQU8sQ0FBQyxXQUFXLElBQUksQ0FBQyxDQUFDO1lBRTdDLE1BQU0sSUFBSSxLQUFLLENBQUMsR0FBRyxDQUFDLEtBQUssS0FBSyxDQUFDLFNBQVMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLEdBQUcsS0FBSyxDQUFDLE1BQU0sR0FBRyxFQUFFLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsRUFBRSxTQUFTLENBQUM7WUFDMUYsTUFBTSxJQUFJLE1BQU0sT0FBTyxDQUFDLElBQUksUUFBUSxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxTQUFTLFdBQVcsYUFBYSxVQUFVLENBQUMsV0FBVyxVQUFVLFdBQVcsY0FBYyxDQUFDO1FBQ2xKLENBQUMsQ0FBQyxDQUFDO1FBRUgsTUFBTSxJQUFJLGdDQUFnQyxDQUFDO1FBQzNDLE1BQU0sSUFBSSxpREFBaUQsQ0FBQztRQUM1RCxNQUFNLElBQUksNENBQTRDLENBQUM7UUFDdkQsTUFBTSxJQUFJLHdDQUF3QyxDQUFDO1FBRW5ELE9BQU8sTUFBTSxDQUFDO0lBQ2hCLENBQUM7SUFFTyxLQUFLLENBQUMsU0FBUyxDQUFDLE1BQThDLEVBQUUsTUFBbUI7UUFDekYseURBQXlEO1FBQ3pELE1BQU0sY0FBYyxHQUFHLE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxjQUFjLENBQUM7WUFDdEQsTUFBTSxFQUFFLE1BQU0sQ0FBQyxNQUFNO1lBQ3JCLFVBQVUsRUFBRSxNQUFNLENBQUMsVUFBVTtZQUM3QixNQUFNLEVBQUUsYUFBYTtZQUNyQixTQUFTLEVBQUUsTUFBTTtZQUNqQixPQUFPLEVBQUUsRUFBRTtTQUNaLENBQUMsQ0FBQztRQUVILElBQUksTUFBTSxHQUFHLDRCQUE0QixDQUFDO1FBRTFDLElBQUksY0FBYyxDQUFDLE1BQU0sS0FBSyxDQUFDLEVBQUU7WUFDL0IsTUFBTSxJQUFJLDZDQUE2QyxDQUFDO1lBQ3hELE9BQU8sTUFBTSxDQUFDO1NBQ2Y7UUFFRCx1QkFBdUI7UUFDdkIsTUFBTSxNQUFNLEdBQUcsY0FBYzthQUMxQixNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsS0FBSyxFQUFFLGNBQWMsSUFBSSxDQUFDLENBQUMsS0FBSyxDQUFDLGNBQWMsR0FBRyxDQUFDLENBQUM7YUFDbEUsR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLEtBQU0sQ0FBQyxjQUFlLENBQUMsQ0FBQztRQUV0QyxJQUFJLE1BQU0sQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFO1lBQ3JCLE1BQU0sUUFBUSxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQyxHQUFHLEVBQUUsS0FBSyxFQUFFLEVBQUUsQ0FBQyxHQUFHLEdBQUcsS0FBSyxFQUFFLENBQUMsQ0FBQyxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUM7WUFDL0UsTUFBTSxXQUFXLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUVoRixNQUFNLElBQUksMEJBQTBCLENBQUM7WUFDckMsTUFBTSxJQUFJLG9CQUFvQixJQUFJLENBQUMsTUFBTSxDQUFDLFdBQVcsQ0FBQyxRQUFRLEVBQUUsTUFBTSxDQUFDLElBQUksQ0FBQztZQUM1RSxNQUFNLElBQUksbUJBQW1CLElBQUksQ0FBQyxNQUFNLENBQUMsV0FBVyxDQUFDLFdBQVcsRUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDO1lBQzlFLE1BQU0sSUFBSSxrQkFBa0IsSUFBSSxDQUFDLE1BQU0sQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxHQUFHLE1BQU0sQ0FBQyxFQUFFLE1BQU0sQ0FBQyxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsR0FBRyxNQUFNLENBQUMsRUFBRSxNQUFNLENBQUMsTUFBTSxDQUFDO1NBQ2xKO1FBRUQsd0JBQXdCO1FBQ3hCLE1BQU0sT0FBTyxHQUFHLGNBQWM7YUFDM0IsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLEtBQUssRUFBRSxjQUFjLENBQUM7YUFDcEMsR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLEtBQU0sQ0FBQyxjQUFlLEdBQUcsRUFBRSxDQUFDLENBQUM7UUFFM0MsSUFBSSxPQUFPLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRTtZQUN0QixNQUFNLFNBQVMsR0FBRyxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUMsR0FBRyxFQUFFLE1BQU0sRUFBRSxFQUFFLENBQUMsR0FBRyxHQUFHLE1BQU0sRUFBRSxDQUFDLENBQUMsR0FBRyxPQUFPLENBQUMsTUFBTSxDQUFDO1lBQ3BGLE1BQU0sY0FBYyxHQUFHLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLElBQUksR0FBRyxDQUFDLENBQUMsTUFBTSxDQUFDO1lBRTVELE1BQU0sSUFBSSx5QkFBeUIsQ0FBQztZQUNwQyxNQUFNLElBQUkscUJBQXFCLFNBQVMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQztZQUM1RCxNQUFNLElBQUksaUNBQWlDLGNBQWMsSUFBSSxPQUFPLENBQUMsTUFBTSxLQUFLLElBQUksQ0FBQyxLQUFLLENBQUMsY0FBYyxHQUFDLE9BQU8sQ0FBQyxNQUFNLEdBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQztTQUN2STtRQUVELE1BQU0sSUFBSSwyQkFBMkIsQ0FBQztRQUN0QyxNQUFNLElBQUksc0JBQXNCLE9BQU8sQ0FBQyxNQUFNLEdBQUcsRUFBRSxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLFlBQVksU0FBUyxjQUFjLENBQUMsTUFBTSxvQkFBb0IsQ0FBQztRQUNoSSxNQUFNLElBQUksMkJBQTJCLE9BQU8sQ0FBQyxNQUFNLEdBQUcsQ0FBQyxJQUFJLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxFQUFFLENBQUMsQ0FBQyxHQUFHLE9BQU8sQ0FBQyxNQUFNLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLFVBQVUsSUFBSSxDQUFDO1FBQ25KLE1BQU0sSUFBSSxnQ0FBZ0MsTUFBTSxDQUFDLE1BQU0sR0FBRyxDQUFDLElBQUksTUFBTSxDQUFDLE1BQU0sR0FBRyxFQUFFLENBQUMsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUMsU0FBUyxhQUFhLENBQUM7UUFFekgsT0FBTyxNQUFNLENBQUM7SUFDaEIsQ0FBQztJQU9PLHVCQUF1QixDQUFDLE1BQThDLEVBQUUsUUFBZ0g7UUFDOUwsTUFBTSxlQUFlLEdBQUcsRUFBRSxDQUFDO1FBRTNCLElBQUksUUFBUSxDQUFDLGdCQUFnQixHQUFHLEVBQUUsRUFBRTtZQUNsQyxlQUFlLENBQUMsSUFBSSxDQUFDLHFGQUFxRixDQUFDLENBQUM7U0FDN0c7YUFBTSxJQUFJLFFBQVEsQ0FBQyxnQkFBZ0IsR0FBRyxFQUFFLEVBQUU7WUFDekMsZUFBZSxDQUFDLElBQUksQ0FBQywyRUFBMkUsQ0FBQyxDQUFDO1NBQ25HO2FBQU07WUFDTCxlQUFlLENBQUMsSUFBSSxDQUFDLDBFQUEwRSxDQUFDLENBQUM7U0FDbEc7UUFFRCxJQUFJLFFBQVEsQ0FBQyxnQkFBZ0IsS0FBSyxLQUFLLEVBQUU7WUFDdkMsZUFBZSxDQUFDLElBQUksQ0FBQyxtRUFBbUUsQ0FBQyxDQUFDO1NBQzNGO2FBQU0sSUFBSSxRQUFRLENBQUMsZ0JBQWdCLEtBQUssTUFBTSxFQUFFO1lBQy9DLGVBQWUsQ0FBQyxJQUFJLENBQUMsZ0ZBQWdGLENBQUMsQ0FBQztTQUN4RztRQUVELElBQUksUUFBUSxDQUFDLFlBQVksR0FBRyxJQUFJLEVBQUU7WUFDaEMsZUFBZSxDQUFDLElBQUksQ0FBQyw0RUFBNEUsQ0FBQyxDQUFDO1NBQ3BHO2FBQU07WUFDTCxlQUFlLENBQUMsSUFBSSxDQUFDLHVFQUF1RSxDQUFDLENBQUM7U0FDL0Y7UUFFRCxJQUFJLE1BQU0sQ0FBQyxZQUFZLEtBQUssZUFBZSxFQUFFO1lBQzNDLGVBQWUsQ0FBQyxJQUFJLENBQUMsMEVBQTBFLENBQUMsQ0FBQztZQUNqRyxlQUFlLENBQUMsSUFBSSxDQUFDLDJEQUEyRCxDQUFDLENBQUM7U0FDbkY7UUFFRCxlQUFlLENBQUMsSUFBSSxDQUFDLGlFQUFpRSxDQUFDLENBQUM7UUFFeEYsT0FBTyxlQUFlLENBQUM7SUFDekIsQ0FBQztJQUVELEtBQUssQ0FBQyxvQkFBb0IsQ0FBQyxNQUEyQztRQUNwRSxJQUFJO1lBQ0YsTUFBTSxNQUFNLEdBQUcsTUFBTSxDQUFDLE1BQXFCLENBQUM7WUFDNUMsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBQyxhQUFhLENBQUMsTUFBTSxDQUFDLENBQUM7WUFFckQsSUFBSSxNQUFNLEdBQUcsb0NBQW9DLENBQUM7WUFDbEQsTUFBTSxJQUFJLHVCQUF1QixVQUFVLElBQUksQ0FBQztZQUNoRCxNQUFNLElBQUkscUJBQXFCLE1BQU0sQ0FBQyxTQUFTLElBQUksQ0FBQztZQUNwRCxNQUFNLElBQUksbUJBQW1CLE1BQU0sQ0FBQyxNQUFNLEtBQUssTUFBTSxDQUFDLFNBQVMsT0FBTyxDQUFDO1lBRXZFLDhDQUE4QztZQUM5QyxNQUFNLFlBQVksR0FBRyxNQUFNLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxNQUFNLEVBQUUsTUFBTSxDQUFDLENBQUM7WUFFekUsSUFBSSxZQUFZLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRTtnQkFDN0IsTUFBTSxJQUFJLDhEQUE4RCxDQUFDO2dCQUN6RSxNQUFNLElBQUksb0JBQW9CLENBQUM7Z0JBQy9CLE1BQU0sSUFBSSx5Q0FBeUMsQ0FBQztnQkFDcEQsTUFBTSxJQUFJLGdDQUFnQyxDQUFDO2dCQUMzQyxNQUFNLElBQUksc0RBQXNELENBQUM7Z0JBQ2pFLE9BQU8sTUFBTSxDQUFDO2FBQ2Y7WUFFRCxNQUFNLElBQUksY0FBYyxZQUFZLENBQUMsTUFBTSxxQ0FBcUMsQ0FBQztZQUVqRixZQUFZLENBQUMsT0FBTyxDQUFDLENBQUMsT0FBTyxFQUFFLENBQUMsRUFBRSxFQUFFO2dCQUNsQyxNQUFNLElBQUksR0FBRyxNQUFNLENBQUMsSUFBSSxHQUFHLE1BQU0sQ0FBQyxPQUFPLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQztnQkFDbEQsTUFBTSxJQUFJLEtBQUssSUFBSSxLQUFLLE9BQU8sQ0FBQyxJQUFJLE1BQU0sSUFBSSxDQUFDLG9CQUFvQixDQUFDLE9BQU8sQ0FBQyxhQUFhLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQztnQkFDckcsTUFBTSxJQUFJLFFBQVEsT0FBTyxDQUFDLEtBQUssTUFBTSxDQUFDO2dCQUN0QyxNQUFNLElBQUksY0FBYyxPQUFPLENBQUMsS0FBSyxJQUFJLEtBQUssSUFBSSxDQUFDO2dCQUNuRCxNQUFNLElBQUksYUFBYSxJQUFJLENBQUMsTUFBTSxDQUFDLFdBQVcsQ0FBQyxPQUFPLENBQUMsS0FBSyxFQUFFLE1BQU0sQ0FBQyxNQUFNLENBQUM7Z0JBRTVFLE1BQU0sSUFBSSwwQkFBMEIsQ0FBQztnQkFDckMsTUFBTSxJQUFJLFlBQVksT0FBTyxDQUFDLGFBQWEsQ0FBQyxLQUFLLFVBQVUsQ0FBQztnQkFDNUQsTUFBTSxJQUFJLGFBQWEsT0FBTyxDQUFDLGFBQWEsQ0FBQyxNQUFNLFVBQVUsQ0FBQztnQkFDOUQsTUFBTSxJQUFJLGNBQWMsT0FBTyxDQUFDLGFBQWEsQ0FBQyxPQUFPLFVBQVUsQ0FBQztnQkFDaEUsTUFBTSxJQUFJLFlBQVksT0FBTyxDQUFDLGFBQWEsQ0FBQyxLQUFLLEtBQUssT0FBTyxDQUFDLGFBQWEsQ0FBQyxhQUFhLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsR0FBRyxPQUFPLENBQUMsYUFBYSxDQUFDLGFBQWEsUUFBUSxDQUFDO2dCQUV2SixNQUFNLElBQUksNkJBQTZCLENBQUM7Z0JBQ3hDLE1BQU0sSUFBSSxvQkFBb0IsT0FBTyxDQUFDLGdCQUFnQixDQUFDLFlBQVksV0FBVyxDQUFDO2dCQUMvRSxNQUFNLElBQUksd0JBQXdCLE9BQU8sQ0FBQyxnQkFBZ0IsQ0FBQyxlQUFlLFNBQVMsQ0FBQztnQkFDcEYsTUFBTSxJQUFJLG9CQUFvQixPQUFPLENBQUMsZ0JBQWdCLENBQUMsWUFBWSxJQUFJLElBQUksQ0FBQyxZQUFZLENBQUMsT0FBTyxDQUFDLGdCQUFnQixDQUFDLFlBQVksQ0FBQyxJQUFJLENBQUM7Z0JBQ3BJLE1BQU0sSUFBSSx3QkFBd0IsT0FBTyxDQUFDLGdCQUFnQixDQUFDLHdCQUF3QixZQUFZLENBQUM7Z0JBRWhHLE1BQU0sSUFBSSwyQkFBMkIsQ0FBQztnQkFDdEMsTUFBTSxJQUFJLHVCQUF1QixJQUFJLENBQUMsTUFBTSxDQUFDLFdBQVcsQ0FBQyxPQUFPLENBQUMsYUFBYSxDQUFDLGVBQWUsR0FBRyxHQUFHLEVBQUUsTUFBTSxDQUFDLFFBQVEsQ0FBQztnQkFDdEgsTUFBTSxJQUFJLHdCQUF3QixPQUFPLENBQUMsYUFBYSxDQUFDLG1CQUFtQixLQUFLLENBQUM7Z0JBQ2pGLE1BQU0sSUFBSSxzQkFBc0IsSUFBSSxDQUFDLE1BQU0sQ0FBQyxXQUFXLENBQUMsT0FBTyxDQUFDLGFBQWEsQ0FBQyxjQUFjLEdBQUcsR0FBRyxFQUFFLE1BQU0sQ0FBQyxVQUFVLENBQUM7Z0JBRXRILE1BQU0sSUFBSSx1QkFBdUIsQ0FBQztnQkFDbEMsTUFBTSxJQUFJLGFBQWEsT0FBTyxDQUFDLGFBQWEsQ0FBQyxNQUFNLFNBQVMsT0FBTyxDQUFDLGFBQWEsQ0FBQyxXQUFXLGFBQWEsQ0FBQztnQkFDM0csTUFBTSxJQUFJLGtCQUFrQixPQUFPLENBQUMsYUFBYSxDQUFDLFNBQVMsQ0FBQyxjQUFjLEVBQUUsSUFBSSxDQUFDO2dCQUNqRixNQUFNLElBQUksa0JBQWtCLE9BQU8sQ0FBQyxhQUFhLENBQUMsV0FBVyxJQUFJLENBQUM7Z0JBQ2xFLE1BQU0sSUFBSSxrQkFBa0IsT0FBTyxDQUFDLGFBQWEsQ0FBQyxXQUFXLElBQUksQ0FBQztnQkFFbEUsSUFBSSxPQUFPLENBQUMsTUFBTSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUU7b0JBQzdCLE1BQU0sSUFBSSxvQkFBb0IsQ0FBQztvQkFDL0IsT0FBTyxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLEVBQUU7d0JBQzdCLE1BQU0sSUFBSSxLQUFLLEtBQUssSUFBSSxDQUFDO29CQUMzQixDQUFDLENBQUMsQ0FBQztpQkFDSjtnQkFFRCxNQUFNLElBQUksV0FBVyxDQUFDO1lBQ3hCLENBQUMsQ0FBQyxDQUFDO1lBRUgsTUFBTSxJQUFJLHdCQUF3QixDQUFDO1lBQ25DLE1BQU0sVUFBVSxHQUFHLFlBQVksQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDLE9BQU8sSUFBSSxFQUFFLENBQUMsQ0FBQyxNQUFNLENBQUM7WUFDbEYsTUFBTSxVQUFVLEdBQUcsWUFBWSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsT0FBTyxHQUFHLEVBQUUsQ0FBQyxDQUFDLE1BQU0sQ0FBQztZQUNqRixNQUFNLFFBQVEsR0FBRyxZQUFZLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLGdCQUFnQixDQUFDLFlBQVksS0FBSyxNQUFNLENBQUMsQ0FBQyxNQUFNLENBQUM7WUFFN0YsTUFBTSxJQUFJLDhCQUE4QixVQUFVLGFBQWEsQ0FBQztZQUNoRSxNQUFNLElBQUksOEJBQThCLFVBQVUsYUFBYSxDQUFDO1lBQ2hFLE1BQU0sSUFBSSx5QkFBeUIsUUFBUSxhQUFhLENBQUM7WUFDekQsTUFBTSxJQUFJLHVCQUF1QixDQUFDLFlBQVksQ0FBQyxNQUFNLENBQUMsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxDQUFDLGdCQUFnQixDQUFDLFlBQVksRUFBRSxDQUFDLENBQUMsR0FBRyxZQUFZLENBQUMsTUFBTSxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUM7WUFFM0osTUFBTSxJQUFJLHFDQUFxQyxDQUFDO1lBQ2hELE1BQU0sSUFBSSxxRUFBcUUsQ0FBQztZQUNoRixNQUFNLElBQUksK0RBQStELENBQUM7WUFDMUUsTUFBTSxJQUFJLDREQUE0RCxDQUFDO1lBQ3ZFLE1BQU0sSUFBSSxnRUFBZ0UsQ0FBQztZQUUzRSxPQUFPLE1BQU0sQ0FBQztTQUNmO1FBQUMsT0FBTyxLQUFLLEVBQUU7WUFDZCxPQUFPLG1DQUFtQyxLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxlQUFlLEVBQUUsQ0FBQztTQUN0RztJQUNILENBQUM7SUFFTyxLQUFLLENBQUMsd0JBQXdCLENBQUMsTUFBMkMsRUFBRSxNQUFtQjtRQUNyRyxJQUFJLFFBQVEsR0FBVSxFQUFFLENBQUM7UUFFekIsaURBQWlEO1FBQ2pELElBQUksTUFBTSxDQUFDLElBQUksRUFBRTtZQUNmLE1BQU0sT0FBTyxHQUFHLE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUM7Z0JBQzNDLElBQUksRUFBRSxNQUFNLENBQUMsSUFBSTtnQkFDakIsTUFBTSxFQUFFLE1BQU0sQ0FBQyxNQUFNO2dCQUNyQixPQUFPLEVBQUUsSUFBSTtnQkFDYixNQUFNLEVBQUUsSUFBSTthQUNiLENBQUMsQ0FBQztZQUNILElBQUksT0FBTyxDQUFDLE1BQU0sR0FBRyxDQUFDO2dCQUFFLFFBQVEsR0FBRyxPQUFPLENBQUM7U0FDNUM7YUFBTSxJQUFJLE1BQU0sQ0FBQyxLQUFLLElBQUksTUFBTSxDQUFDLEtBQUssQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFO1lBQ2xELFFBQVEsR0FBRyxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDO2dCQUN0QyxLQUFLLEVBQUUsTUFBTSxDQUFDLEtBQUs7Z0JBQ25CLE1BQU0sRUFBRSxNQUFNLENBQUMsTUFBTTtnQkFDckIsT0FBTyxFQUFFLElBQUk7Z0JBQ2IsTUFBTSxFQUFFLElBQUk7YUFDYixDQUFDLENBQUM7U0FDSjthQUFNO1lBQ0wsK0RBQStEO1lBQy9ELE1BQU0sWUFBWSxHQUFRO2dCQUN4QixNQUFNLEVBQUUsTUFBTSxDQUFDLE1BQU07Z0JBQ3JCLE1BQU0sRUFBRSxhQUFhO2dCQUNyQixTQUFTLEVBQUUsTUFBTSxDQUFDLFNBQVM7Z0JBQzNCLE9BQU8sRUFBRSxNQUFNLENBQUMsT0FBTztnQkFDdkIsSUFBSSxFQUFFLE1BQU0sQ0FBQyxJQUFJO2FBQ2xCLENBQUM7WUFFRixJQUFJLE1BQU0sQ0FBQyxVQUFVO2dCQUFFLFlBQVksQ0FBQyxVQUFVLEdBQUcsTUFBTSxDQUFDLFVBQVUsQ0FBQztZQUNuRSxJQUFJLE1BQU0sQ0FBQyxRQUFRO2dCQUFFLFlBQVksQ0FBQyxRQUFRLEdBQUcsTUFBTSxDQUFDLFFBQVEsQ0FBQztZQUM3RCxJQUFJLE1BQU0sQ0FBQyxRQUFRO2dCQUFFLFlBQVksQ0FBQyxRQUFRLEdBQUcsTUFBTSxDQUFDLFFBQVEsQ0FBQztZQUM3RCxJQUFJLE1BQU0sQ0FBQyxTQUFTO2dCQUFFLFlBQVksQ0FBQyxTQUFTLEdBQUcsTUFBTSxDQUFDLFNBQVMsQ0FBQztZQUNoRSxJQUFJLE1BQU0sQ0FBQyxXQUFXO2dCQUFFLFlBQVksQ0FBQyxlQUFlLEdBQUcsTUFBTSxDQUFDLFdBQVcsR0FBRyxFQUFFLENBQUMsQ0FBQywyQkFBMkI7WUFDM0csSUFBSSxNQUFNLENBQUMsV0FBVztnQkFBRSxZQUFZLENBQUMsZUFBZSxHQUFHLE1BQU0sQ0FBQyxXQUFXLEdBQUcsRUFBRSxDQUFDLENBQUMsMkJBQTJCO1lBRTNHLFFBQVEsR0FBRyxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsY0FBYyxDQUFDLFlBQVksQ0FBQyxDQUFDO1NBQzNEO1FBRUQsc0NBQXNDO1FBQ3RDLE1BQU0sWUFBWSxHQUF3QixRQUFRLENBQUMsR0FBRyxDQUFDLENBQUMsT0FBWSxFQUFFLEVBQUU7WUFDdEUsTUFBTSxXQUFXLEdBQUcsT0FBTyxDQUFDLFdBQVcsSUFBSSxPQUFPLENBQUMsS0FBSyxFQUFFLFdBQVcsSUFBSSxDQUFDLENBQUM7WUFDM0UsTUFBTSxhQUFhLEdBQUcsV0FBVyxHQUFHLEVBQUUsQ0FBQztZQUN2QyxNQUFNLEtBQUssR0FBRyxPQUFPLENBQUMsS0FBSyxFQUFFLGNBQWMsSUFBSSxPQUFPLENBQUMsS0FBSyxJQUFJLENBQUMsQ0FBQztZQUNsRSxNQUFNLFNBQVMsR0FBRyxPQUFPLENBQUMsS0FBSyxFQUFFLGFBQWEsSUFBSSxPQUFPLENBQUMsU0FBUyxJQUFJLENBQUMsQ0FBQztZQUN6RSxNQUFNLE1BQU0sR0FBRyxPQUFPLENBQUMsS0FBSyxFQUFFLGNBQWMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxjQUFjLEdBQUcsRUFBRSxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsTUFBTSxJQUFJLENBQUMsQ0FBQztZQUV2Ryw2QkFBNkI7WUFDN0IsTUFBTSxjQUFjLEdBQUcsV0FBVyxHQUFHLENBQUMsS0FBSyxHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUMsMkJBQTJCO1lBQy9FLE1BQU0sWUFBWSxHQUFHLFdBQVcsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxFQUFFLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxXQUFXLEdBQUcsRUFBRSxDQUFDLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsd0JBQXdCO1lBRXZILG1EQUFtRDtZQUNuRCxJQUFJLEtBQUssR0FBNEMsUUFBUSxDQUFDO1lBQzlELElBQUksYUFBYSxHQUFHLEVBQUU7Z0JBQUUsS0FBSyxHQUFHLGNBQWMsQ0FBQztpQkFDMUMsSUFBSSxhQUFhLEdBQUcsQ0FBQztnQkFBRSxLQUFLLEdBQUcsV0FBVyxDQUFDO1lBRWhELHlCQUF5QjtZQUN6QixNQUFNLFdBQVcsR0FBRyxXQUFXLEdBQUcsSUFBSSxJQUFJLFNBQVMsR0FBRyxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsV0FBVyxHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUM7WUFDNUcsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBQyxjQUFjLENBQUMsT0FBTyxFQUFFLE1BQU0sQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDO1lBQ3BGLE1BQU0sV0FBVyxHQUFHLFVBQVUsQ0FBQyxLQUFLLENBQUM7WUFDckMsTUFBTSxXQUFXLEdBQUcsV0FBVyxHQUFHLEVBQUUsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxXQUFXLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQztZQUVuRixrQ0FBa0M7WUFDbEMsTUFBTSxrQkFBa0IsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsRUFBRSxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsRUFBRSxFQUFFLEdBQUcsV0FBVyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDNUUsTUFBTSxZQUFZLEdBQUcsYUFBYSxHQUFHLENBQUMsS0FBSyxHQUFHLEdBQUcsQ0FBQyxDQUFDO1lBQ25ELE1BQU0sV0FBVyxHQUFHLFlBQVksR0FBRyxDQUFDLGtCQUFrQixHQUFHLEdBQUcsQ0FBQyxDQUFDO1lBRTlELE1BQU0sTUFBTSxHQUFhLEVBQUUsQ0FBQztZQUM1QixJQUFJLGFBQWEsR0FBRyxFQUFFO2dCQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsMENBQTBDLENBQUMsQ0FBQztZQUNoRixJQUFJLGFBQWEsR0FBRyxDQUFDO2dCQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsK0NBQStDLENBQUMsQ0FBQztZQUNwRixJQUFJLFdBQVcsR0FBRyxDQUFDO2dCQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsb0NBQW9DLENBQUMsQ0FBQztZQUV2RSxPQUFPO2dCQUNMLElBQUksRUFBRSxPQUFPLENBQUMsSUFBSTtnQkFDbEIsS0FBSyxFQUFFLE9BQU8sQ0FBQyxLQUFLLElBQUksT0FBTyxDQUFDLFlBQVksSUFBSSxpQkFBaUI7Z0JBQ2pFLEtBQUssRUFBRSxPQUFPLENBQUMsS0FBSyxJQUFJLFNBQVM7Z0JBQ2pDLEtBQUssRUFBRSxLQUFLO2dCQUNaLGFBQWEsRUFBRTtvQkFDYixLQUFLLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxhQUFhLEdBQUcsRUFBRSxDQUFDLEdBQUcsRUFBRTtvQkFDMUMsTUFBTSxFQUFFLElBQUksQ0FBQyxLQUFLLENBQUMsYUFBYSxHQUFHLENBQUMsR0FBRyxFQUFFLENBQUMsR0FBRyxFQUFFO29CQUMvQyxPQUFPLEVBQUUsV0FBVztvQkFDcEIsS0FBSyxFQUFFLEtBQUs7b0JBQ1osYUFBYSxFQUFFLEtBQUssS0FBSyxjQUFjLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsYUFBYSxHQUFHLEVBQUUsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDO3dCQUNqRSxLQUFLLEtBQUssV0FBVyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsYUFBYSxHQUFHLEVBQUUsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztpQkFDN0U7Z0JBQ0QsZ0JBQWdCLEVBQUU7b0JBQ2hCLFlBQVksRUFBRSxZQUFZO29CQUMxQixlQUFlLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxhQUFhLEVBQUUsR0FBRyxDQUFDLENBQUM7b0JBQy9ELFlBQVksRUFBRSxhQUFhLEdBQUcsRUFBRSxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLGFBQWEsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsS0FBSztvQkFDaEYsd0JBQXdCLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxhQUFhLEdBQUcsRUFBRSxDQUFDLENBQUMsb0JBQW9CO2lCQUM5RTtnQkFDRCxhQUFhLEVBQUU7b0JBQ2IsTUFBTSxFQUFFLE1BQU07b0JBQ2QsV0FBVyxFQUFFLE9BQU8sQ0FBQyxLQUFLLEVBQUUscUJBQXFCLElBQUksT0FBTyxDQUFDLFdBQVcsSUFBSSxDQUFDO29CQUM3RSxTQUFTLEVBQUUsU0FBUztvQkFDcEIsV0FBVyxFQUFFLFdBQXdDO29CQUNyRCxXQUFXLEVBQUUsV0FBd0M7aUJBQ3REO2dCQUNELGFBQWEsRUFBRTtvQkFDYixlQUFlLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxZQUFZLEdBQUcsR0FBRyxDQUFDLEdBQUcsR0FBRztvQkFDckQsbUJBQW1CLEVBQUUsa0JBQWtCO29CQUN2QyxjQUFjLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxXQUFXLEdBQUcsR0FBRyxDQUFDLEdBQUcsR0FBRztpQkFDcEQ7Z0JBQ0QsTUFBTSxFQUFFLE1BQU07YUFDZixDQUFDO1FBQ0osQ0FBQyxDQUFDLENBQUM7UUFFSCxrQ0FBa0M7UUFDbEMsSUFBSSxZQUFZLEdBQUcsWUFBWSxDQUFDO1FBQ2hDLElBQUksTUFBTSxDQUFDLFdBQVcsRUFBRTtZQUN0QixZQUFZLEdBQUcsWUFBWSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsS0FBSyxJQUFJLE1BQU0sQ0FBQyxXQUFZLENBQUMsQ0FBQztTQUN2RjtRQUNELElBQUksTUFBTSxDQUFDLFdBQVcsRUFBRTtZQUN0QixZQUFZLEdBQUcsWUFBWSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsS0FBSyxJQUFJLE1BQU0sQ0FBQyxXQUFZLENBQUMsQ0FBQztTQUN2RjtRQUVELCtCQUErQjtRQUMvQixZQUFZLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFBRSxFQUFFO1lBQ3pCLElBQUksTUFBYyxFQUFFLE1BQWMsQ0FBQztZQUNuQyxRQUFRLE1BQU0sQ0FBQyxNQUFNLEVBQUU7Z0JBQ3JCLEtBQUssVUFBVTtvQkFDYixNQUFNLEdBQUcsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxLQUFLLENBQUM7b0JBQy9CLE1BQU0sR0FBRyxDQUFDLENBQUMsYUFBYSxDQUFDLEtBQUssQ0FBQztvQkFDL0IsTUFBTTtnQkFDUixLQUFLLGNBQWM7b0JBQ2pCLE1BQU0sR0FBRyxDQUFDLENBQUMsZ0JBQWdCLENBQUMsWUFBWSxDQUFDO29CQUN6QyxNQUFNLEdBQUcsQ0FBQyxDQUFDLGdCQUFnQixDQUFDLFlBQVksQ0FBQztvQkFDekMsTUFBTTtnQkFDUixLQUFLLGlCQUFpQjtvQkFDcEIsTUFBTSxHQUFHLENBQUMsQ0FBQyxhQUFhLENBQUMsZUFBZSxDQUFDO29CQUN6QyxNQUFNLEdBQUcsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxlQUFlLENBQUM7b0JBQ3pDLE1BQU07Z0JBQ1IsS0FBSyxPQUFPO29CQUNWLE1BQU0sR0FBRyxDQUFDLENBQUMsYUFBYSxDQUFDLEtBQUssS0FBSyxjQUFjLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxLQUFLLEtBQUssUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztvQkFDbkcsTUFBTSxHQUFHLENBQUMsQ0FBQyxhQUFhLENBQUMsS0FBSyxLQUFLLGNBQWMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDLEtBQUssS0FBSyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO29CQUNuRyxNQUFNO2dCQUNSO29CQUNFLE1BQU0sR0FBRyxDQUFDLENBQUMsYUFBYSxDQUFDLEtBQUssQ0FBQztvQkFDL0IsTUFBTSxHQUFHLENBQUMsQ0FBQyxhQUFhLENBQUMsS0FBSyxDQUFDO2FBQ2xDO1lBRUQsT0FBTyxNQUFNLENBQUMsU0FBUyxLQUFLLE1BQU0sQ0FBQyxDQUFDLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQyxDQUFDLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQztRQUN6RSxDQUFDLENBQUMsQ0FBQztRQUVILE9BQU8sWUFBWSxDQUFDO0lBQ3RCLENBQUM7SUFFRCxLQUFLLENBQUMsZ0JBQWdCLENBQUMsTUFBK0M7UUFDcEUsSUFBSTtZQUNGLE1BQU0sTUFBTSxHQUFHLE1BQU0sQ0FBQyxNQUFxQixDQUFDO1lBQzVDLE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxNQUFNLENBQUMsYUFBYSxDQUFDLE1BQU0sQ0FBQyxDQUFDO1lBRXJELElBQUksTUFBTSxHQUFHLHNDQUFzQyxDQUFDO1lBQ3BELE1BQU0sSUFBSSx1QkFBdUIsVUFBVSxJQUFJLENBQUM7WUFDaEQsTUFBTSxJQUFJLHlCQUF5QixNQUFNLENBQUMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxXQUFXLEVBQUUsR0FBRyxNQUFNLENBQUMsWUFBWSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsR0FBRyxFQUFFLEdBQUcsQ0FBQyxJQUFJLENBQUM7WUFDcEksTUFBTSxJQUFJLHFCQUFxQixNQUFNLENBQUMsU0FBUyxJQUFJLENBQUM7WUFDcEQsTUFBTSxJQUFJLDJCQUEyQixNQUFNLENBQUMsa0JBQWtCLGlCQUFpQixDQUFDO1lBRWhGLHdEQUF3RDtZQUN4RCxNQUFNLGlCQUFpQixHQUFHLE1BQU0sSUFBSSxDQUFDLHdCQUF3QixDQUFDLE1BQU0sRUFBRSxNQUFNLENBQUMsQ0FBQztZQUU5RSxRQUFRLE1BQU0sQ0FBQyxZQUFZLEVBQUU7Z0JBQzNCLEtBQUssVUFBVTtvQkFDYixNQUFNLElBQUksSUFBSSxDQUFDLHVCQUF1QixDQUFDLGlCQUFpQixFQUFFLE1BQU0sQ0FBQyxDQUFDO29CQUNsRSxNQUFNO2dCQUNSLEtBQUssYUFBYTtvQkFDaEIsTUFBTSxJQUFJLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxpQkFBaUIsRUFBRSxNQUFNLENBQUMsQ0FBQztvQkFDM0QsTUFBTTtnQkFDUixLQUFLLGFBQWE7b0JBQ2hCLE1BQU0sSUFBSSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsaUJBQWlCLEVBQUUsTUFBTSxDQUFDLENBQUM7b0JBQzNELE1BQU07Z0JBQ1IsS0FBSyxnQkFBZ0I7b0JBQ25CLE1BQU0sSUFBSSxJQUFJLENBQUMsbUJBQW1CLENBQUMsaUJBQWlCLEVBQUUsTUFBTSxDQUFDLENBQUM7b0JBQzlELE1BQU07Z0JBQ1IsS0FBSyxVQUFVO29CQUNiLE1BQU0sSUFBSSxJQUFJLENBQUMsc0JBQXNCLENBQUMsaUJBQWlCLEVBQUUsTUFBTSxDQUFDLENBQUM7b0JBQ2pFLE1BQU07YUFDVDtZQUVELE1BQU0sSUFBSSxrREFBa0QsQ0FBQztZQUM3RCxpQkFBaUIsQ0FBQyxlQUFlLENBQUMsT0FBTyxDQUFDLENBQUMsR0FBRyxFQUFFLENBQUMsRUFBRSxFQUFFO2dCQUNuRCxNQUFNLElBQUksR0FBRyxDQUFDLEdBQUcsQ0FBQyxLQUFLLEdBQUcsSUFBSSxDQUFDO1lBQ2pDLENBQUMsQ0FBQyxDQUFDO1lBRUgsT0FBTyxNQUFNLENBQUM7U0FDZjtRQUFDLE9BQU8sS0FBSyxFQUFFO1lBQ2QsT0FBTyw4QkFBOEIsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsZUFBZSxFQUFFLENBQUM7U0FDakc7SUFDSCxDQUFDO0lBRU8sS0FBSyxDQUFDLHdCQUF3QixDQUFDLE1BQStDLEVBQUUsTUFBbUI7UUFDekcsc0RBQXNEO1FBQ3RELE1BQU0sY0FBYyxHQUFHO1lBQ3JCLE1BQU0sRUFBRSxNQUFNLENBQUMsTUFBTTtZQUNyQixVQUFVLEVBQUUsTUFBTSxDQUFDLFVBQVU7WUFDN0IsS0FBSyxFQUFFLE1BQU0sQ0FBQyxLQUFLO1lBQ25CLFNBQVMsRUFBRSxNQUFNLENBQUMsU0FBUztZQUMzQixvQkFBb0IsRUFBRSxNQUFNLENBQUMsb0JBQW9CLElBQUksT0FBTztZQUM1RCxPQUFPLEVBQUUsRUFBRTtZQUNYLElBQUksRUFBRSxDQUFDO1lBQ1AsTUFBTSxFQUFFLFVBQW1CO1lBQzNCLFNBQVMsRUFBRSxNQUFlO1lBQzFCLFNBQVMsRUFBRSxHQUFHO1NBQ2YsQ0FBQztRQUVGLE1BQU0sV0FBVyxHQUFHLE1BQU0sSUFBSSxDQUFDLHdCQUF3QixDQUFDLGNBQWMsRUFBRSxNQUFNLENBQUMsQ0FBQztRQUVoRixxREFBcUQ7UUFDckQsTUFBTSxVQUFVLEdBQUcsV0FBVyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsT0FBTyxJQUFJLEVBQUUsQ0FBQyxDQUFDO1FBQzFFLE1BQU0sVUFBVSxHQUFHLFdBQVcsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDLE9BQU8sR0FBRyxFQUFFLENBQUMsQ0FBQztRQUN6RSxNQUFNLGFBQWEsR0FBRyxXQUFXLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLGdCQUFnQixDQUFDLFlBQVksS0FBSyxNQUFNLENBQUMsQ0FBQztRQUUxRiw4QkFBOEI7UUFDOUIsTUFBTSxnQkFBZ0IsR0FBRztZQUN2QjtnQkFDRSxNQUFNLEVBQUUsbUJBQW1CO2dCQUMzQixrQkFBa0IsRUFBRSxHQUFHO2dCQUN2QixjQUFjLEVBQUUsa0RBQWtEO2FBQ25FO1lBQ0Q7Z0JBQ0UsTUFBTSxFQUFFLGVBQWU7Z0JBQ3ZCLGtCQUFrQixFQUFFLEdBQUc7Z0JBQ3ZCLGNBQWMsRUFBRSx3REFBd0Q7YUFDekU7U0FDRixDQUFDO1FBRUYsMkJBQTJCO1FBQzNCLE1BQU0sZUFBZSxHQUFhLEVBQUUsQ0FBQztRQUNyQyxJQUFJLFVBQVUsQ0FBQyxNQUFNLEdBQUcsV0FBVyxDQUFDLE1BQU0sR0FBRyxHQUFHLEVBQUU7WUFDaEQsZUFBZSxDQUFDLElBQUksQ0FBQywyRUFBMkUsQ0FBQyxDQUFDO1NBQ25HO1FBQ0QsSUFBSSxVQUFVLENBQUMsTUFBTSxHQUFHLFdBQVcsQ0FBQyxNQUFNLEdBQUcsR0FBRyxFQUFFO1lBQ2hELGVBQWUsQ0FBQyxJQUFJLENBQUMsNEVBQTRFLENBQUMsQ0FBQztTQUNwRztRQUNELElBQUksYUFBYSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUU7WUFDNUIsZUFBZSxDQUFDLElBQUksQ0FBQyxXQUFXLGFBQWEsQ0FBQyxNQUFNLDhDQUE4QyxDQUFDLENBQUM7U0FDckc7UUFDRCxJQUFJLGdCQUFnQixDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUU7WUFDL0IsZUFBZSxDQUFDLElBQUksQ0FBQyx1REFBdUQsQ0FBQyxDQUFDO1NBQy9FO1FBRUQsOEJBQThCO1FBQzlCLE1BQU0sV0FBVyxHQUFHLFdBQVcsQ0FBQyxNQUFNLEdBQUcsQ0FBQztZQUN4QyxDQUFDLENBQUMsV0FBVyxDQUFDLE1BQU0sQ0FBQyxDQUFDLEdBQUcsRUFBRSxDQUFDLEVBQUUsRUFBRSxDQUFDLEdBQUcsR0FBRyxDQUFDLENBQUMsZ0JBQWdCLENBQUMsWUFBWSxFQUFFLENBQUMsQ0FBQyxHQUFHLFdBQVcsQ0FBQyxNQUFNO1lBQy9GLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFFTixPQUFPO1lBQ0wsYUFBYSxFQUFFLFdBQVcsQ0FBQyxNQUFNO1lBQ2pDLG1CQUFtQixFQUFFLElBQUksQ0FBQyxLQUFLLENBQUMsV0FBVyxHQUFHLEVBQUUsQ0FBQyxHQUFHLEVBQUU7WUFDdEQsVUFBVSxFQUFFLFVBQVU7WUFDdEIsVUFBVSxFQUFFLFVBQVU7WUFDdEIsYUFBYSxFQUFFLGFBQWE7WUFDNUIsZ0JBQWdCLEVBQUUsZ0JBQWdCO1lBQ2xDLGVBQWUsRUFBRSxlQUFlO1NBQ2pDLENBQUM7SUFDSixDQUFDO0lBSU8sZ0JBQWdCLENBQUMsUUFBNkIsRUFBRSxNQUFjLEVBQUUsU0FBaUI7UUFDdkYsT0FBTyxRQUFRLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFBRSxFQUFFO1lBQzVCLElBQUksSUFBWSxFQUFFLElBQVksQ0FBQztZQUUvQixRQUFRLE1BQU0sRUFBRTtnQkFDZCxLQUFLLFVBQVU7b0JBQ2IsSUFBSSxHQUFHLENBQUMsQ0FBQyxhQUFhLENBQUMsS0FBSyxDQUFDO29CQUM3QixJQUFJLEdBQUcsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxLQUFLLENBQUM7b0JBQzdCLE1BQU07Z0JBQ1IsS0FBSyxjQUFjO29CQUNqQixJQUFJLEdBQUcsQ0FBQyxDQUFDLGdCQUFnQixDQUFDLFlBQVksQ0FBQztvQkFDdkMsSUFBSSxHQUFHLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxZQUFZLENBQUM7b0JBQ3ZDLE1BQU07Z0JBQ1IsS0FBSyxpQkFBaUI7b0JBQ3BCLElBQUksR0FBRyxDQUFDLENBQUMsYUFBYSxDQUFDLGVBQWUsQ0FBQztvQkFDdkMsSUFBSSxHQUFHLENBQUMsQ0FBQyxhQUFhLENBQUMsZUFBZSxDQUFDO29CQUN2QyxNQUFNO2dCQUNSLEtBQUssT0FBTztvQkFDVixJQUFJLEdBQUcsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxhQUFhLENBQUM7b0JBQ3JDLElBQUksR0FBRyxDQUFDLENBQUMsYUFBYSxDQUFDLGFBQWEsQ0FBQztvQkFDckMsTUFBTTtnQkFDUjtvQkFDRSxJQUFJLEdBQUcsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxLQUFLLENBQUM7b0JBQzdCLElBQUksR0FBRyxDQUFDLENBQUMsYUFBYSxDQUFDLEtBQUssQ0FBQzthQUNoQztZQUVELE9BQU8sU0FBUyxLQUFLLE1BQU0sQ0FBQyxDQUFDLENBQUMsSUFBSSxHQUFHLElBQUksQ0FBQyxDQUFDLENBQUMsSUFBSSxHQUFHLElBQUksQ0FBQztRQUMxRCxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUM7SUFFTyxvQkFBb0IsQ0FBQyxLQUFhO1FBQ3hDLFFBQVEsS0FBSyxFQUFFO1lBQ2IsS0FBSyxjQUFjLENBQUMsQ0FBQyxPQUFPLElBQUksQ0FBQztZQUNqQyxLQUFLLFdBQVcsQ0FBQyxDQUFDLE9BQU8sSUFBSSxDQUFDO1lBQzlCLE9BQU8sQ0FBQyxDQUFDLE9BQU8sSUFBSSxDQUFDO1NBQ3RCO0lBQ0gsQ0FBQztJQUVPLFlBQVksQ0FBQyxJQUFZO1FBQy9CLFFBQVEsSUFBSSxFQUFFO1lBQ1osS0FBSyxNQUFNLENBQUMsQ0FBQyxPQUFPLElBQUksQ0FBQztZQUN6QixLQUFLLFFBQVEsQ0FBQyxDQUFDLE9BQU8sSUFBSSxDQUFDO1lBQzNCLE9BQU8sQ0FBQyxDQUFDLE9BQU8sSUFBSSxDQUFDO1NBQ3RCO0lBQ0gsQ0FBQztJQUVPLHVCQUF1QixDQUFDLFFBQTJCLEVBQUUsTUFBbUI7UUFDOUUsSUFBSSxNQUFNLEdBQUcseUNBQXlDLENBQUM7UUFDdkQsTUFBTSxJQUFJLHlCQUF5QixRQUFRLENBQUMsYUFBYSxJQUFJLENBQUM7UUFDOUQsTUFBTSxJQUFJLGdDQUFnQyxRQUFRLENBQUMsbUJBQW1CLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxXQUFXLENBQUM7UUFDN0YsTUFBTSxJQUFJLHNCQUFzQixRQUFRLENBQUMsVUFBVSxDQUFDLE1BQU0sTUFBTSxFQUFFLFdBQVcsQ0FBQztRQUM5RSxNQUFNLElBQUksc0JBQXNCLFFBQVEsQ0FBQyxVQUFVLENBQUMsTUFBTSxNQUFNLEVBQUUsV0FBVyxDQUFDO1FBQzlFLE1BQU0sSUFBSSw2QkFBNkIsUUFBUSxDQUFDLGFBQWEsQ0FBQyxNQUFNLGVBQWUsQ0FBQztRQUVwRixNQUFNLElBQUksNkJBQTZCLENBQUM7UUFDeEMsUUFBUSxDQUFDLFVBQVUsQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLE9BQU8sRUFBRSxDQUFDLEVBQUUsRUFBRTtZQUNyRCxNQUFNLElBQUksR0FBRyxDQUFDLEdBQUcsQ0FBQyxLQUFLLE9BQU8sQ0FBQyxJQUFJLEtBQUssT0FBTyxDQUFDLGFBQWEsQ0FBQyxPQUFPLFVBQVUsQ0FBQztRQUNsRixDQUFDLENBQUMsQ0FBQztRQUVILE1BQU0sSUFBSSwrQkFBK0IsQ0FBQztRQUMxQyxRQUFRLENBQUMsVUFBVSxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsT0FBTyxFQUFFLENBQUMsRUFBRSxFQUFFO1lBQ3JELE1BQU0sSUFBSSxHQUFHLENBQUMsR0FBRyxDQUFDLEtBQUssT0FBTyxDQUFDLElBQUksS0FBSyxPQUFPLENBQUMsYUFBYSxDQUFDLE9BQU8sVUFBVSxDQUFDO1FBQ2xGLENBQUMsQ0FBQyxDQUFDO1FBRUgsT0FBTyxNQUFNLENBQUM7SUFDaEIsQ0FBQztJQUVPLGdCQUFnQixDQUFDLFFBQTJCLEVBQUUsTUFBbUI7UUFDdkUsSUFBSSxNQUFNLEdBQUcsbURBQW1ELENBQUM7UUFFakUsUUFBUSxDQUFDLFVBQVUsQ0FBQyxPQUFPLENBQUMsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxFQUFFLEVBQUU7WUFDekMsTUFBTSxJQUFJLEtBQUssQ0FBQyxHQUFHLENBQUMsS0FBSyxPQUFPLENBQUMsSUFBSSxNQUFNLENBQUM7WUFDNUMsTUFBTSxJQUFJLE1BQU0sT0FBTyxDQUFDLEtBQUssSUFBSSxDQUFDO1lBQ2xDLE1BQU0sSUFBSSxNQUFNLE9BQU8sQ0FBQyxhQUFhLENBQUMsT0FBTyxnQkFBZ0IsQ0FBQztZQUM5RCxNQUFNLElBQUksTUFBTSxJQUFJLENBQUMsTUFBTSxDQUFDLFdBQVcsQ0FBQyxPQUFPLENBQUMsYUFBYSxDQUFDLGVBQWUsR0FBRyxHQUFHLEVBQUUsTUFBTSxDQUFDLGdCQUFnQixDQUFDO1lBQzdHLE1BQU0sSUFBSSxNQUFNLE9BQU8sQ0FBQyxnQkFBZ0IsQ0FBQyxZQUFZLHFCQUFxQixDQUFDO1FBQzdFLENBQUMsQ0FBQyxDQUFDO1FBRUgsT0FBTyxNQUFNLENBQUM7SUFDaEIsQ0FBQztJQUVPLGdCQUFnQixDQUFDLFFBQTJCLEVBQUUsTUFBbUI7UUFDdkUsSUFBSSxNQUFNLEdBQUcsbURBQW1ELENBQUM7UUFFakUsUUFBUSxDQUFDLFVBQVUsQ0FBQyxPQUFPLENBQUMsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxFQUFFLEVBQUU7WUFDekMsTUFBTSxJQUFJLEtBQUssQ0FBQyxHQUFHLENBQUMsS0FBSyxPQUFPLENBQUMsSUFBSSxNQUFNLENBQUM7WUFDNUMsTUFBTSxJQUFJLE1BQU0sT0FBTyxDQUFDLEtBQUssSUFBSSxDQUFDO1lBQ2xDLE1BQU0sSUFBSSxNQUFNLE9BQU8sQ0FBQyxhQUFhLENBQUMsT0FBTyxnQkFBZ0IsQ0FBQztZQUM5RCxNQUFNLElBQUksTUFBTSxPQUFPLENBQUMsZ0JBQWdCLENBQUMsZUFBZSxzQkFBc0IsQ0FBQztZQUMvRSxNQUFNLElBQUksMENBQTBDLENBQUM7UUFDdkQsQ0FBQyxDQUFDLENBQUM7UUFFSCxPQUFPLE1BQU0sQ0FBQztJQUNoQixDQUFDO0lBRU8sbUJBQW1CLENBQUMsUUFBMkIsRUFBRSxNQUFtQjtRQUMxRSxJQUFJLE1BQU0sR0FBRyx3Q0FBd0MsQ0FBQztRQUV0RCxRQUFRLENBQUMsYUFBYSxDQUFDLE9BQU8sQ0FBQyxDQUFDLE9BQU8sRUFBRSxDQUFDLEVBQUUsRUFBRTtZQUM1QyxNQUFNLElBQUksS0FBSyxDQUFDLEdBQUcsQ0FBQyxLQUFLLE9BQU8sQ0FBQyxJQUFJLE1BQU0sQ0FBQztZQUM1QyxNQUFNLElBQUksTUFBTSxPQUFPLENBQUMsS0FBSyxJQUFJLENBQUM7WUFDbEMsTUFBTSxJQUFJLEtBQUssT0FBTyxDQUFDLGFBQWEsQ0FBQyxLQUFLLHVCQUF1QixDQUFDO1lBQ2xFLE1BQU0sSUFBSSxNQUFNLE9BQU8sQ0FBQyxnQkFBZ0IsQ0FBQyxlQUFlLGNBQWMsQ0FBQztZQUN2RSxNQUFNLElBQUksZUFBZSxPQUFPLENBQUMsZ0JBQWdCLENBQUMsd0JBQXdCLFlBQVksQ0FBQztRQUN6RixDQUFDLENBQUMsQ0FBQztRQUVILE9BQU8sTUFBTSxDQUFDO0lBQ2hCLENBQUM7SUFFTyxzQkFBc0IsQ0FBQyxRQUEyQixFQUFFLE1BQW1CO1FBQzdFLElBQUksTUFBTSxHQUFHLHdDQUF3QyxDQUFDO1FBRXRELFFBQVEsQ0FBQyxnQkFBZ0IsQ0FBQyxPQUFPLENBQUMsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxFQUFFLEVBQUU7WUFDL0MsTUFBTSxJQUFJLEtBQUssT0FBTyxDQUFDLE1BQU0sTUFBTSxDQUFDO1lBQ3BDLE1BQU0sSUFBSSwyQkFBMkIsT0FBTyxDQUFDLGtCQUFrQixLQUFLLENBQUM7WUFDckUsTUFBTSxJQUFJLE1BQU0sT0FBTyxDQUFDLGNBQWMsTUFBTSxDQUFDO1FBQy9DLENBQUMsQ0FBQyxDQUFDO1FBRUgsT0FBTyxNQUFNLENBQUM7SUFDaEIsQ0FBQztJQUVPLGdDQUFnQyxDQUFDLFFBQTZCLEVBQUUsY0FBc0I7UUFDNUYsTUFBTSxlQUFlLEdBQUcsRUFBRSxDQUFDO1FBRTNCLE1BQU0sZUFBZSxHQUFHLFFBQVEsQ0FBQyxNQUFNLENBQUMsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFDLEdBQUcsUUFBUSxDQUFDLE1BQU0sQ0FBQztRQUN4RyxNQUFNLGFBQWEsR0FBRyxRQUFRLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLGdCQUFnQixDQUFDLFlBQVksS0FBSyxNQUFNLENBQUMsQ0FBQyxNQUFNLENBQUM7UUFDOUYsTUFBTSxlQUFlLEdBQUcsUUFBUSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsT0FBTyxHQUFHLEVBQUUsQ0FBQyxDQUFDLE1BQU0sQ0FBQztRQUVsRixJQUFJLGVBQWUsR0FBRyxFQUFFLEVBQUU7WUFDeEIsZUFBZSxDQUFDLElBQUksQ0FBQywwREFBMEQsQ0FBQyxDQUFDO1NBQ2xGO2FBQU0sSUFBSSxlQUFlLEdBQUcsRUFBRSxFQUFFO1lBQy9CLGVBQWUsQ0FBQyxJQUFJLENBQUMsaUVBQWlFLENBQUMsQ0FBQztTQUN6RjtRQUVELElBQUksYUFBYSxHQUFHLFFBQVEsQ0FBQyxNQUFNLEdBQUcsR0FBRyxFQUFFO1lBQ3pDLGVBQWUsQ0FBQyxJQUFJLENBQUMsOERBQThELENBQUMsQ0FBQztTQUN0RjtRQUVELElBQUksZUFBZSxHQUFHLFFBQVEsQ0FBQyxNQUFNLEdBQUcsR0FBRyxFQUFFO1lBQzNDLGVBQWUsQ0FBQyxJQUFJLENBQUMseUVBQXlFLENBQUMsQ0FBQztTQUNqRztRQUVELGVBQWUsQ0FBQyxJQUFJLENBQUMsaUVBQWlFLENBQUMsQ0FBQztRQUN4RixlQUFlLENBQUMsSUFBSSxDQUFDLDZEQUE2RCxDQUFDLENBQUM7UUFDcEYsZUFBZSxDQUFDLElBQUksQ0FBQywrREFBK0QsQ0FBQyxDQUFDO1FBRXRGLE9BQU8sZUFBZSxDQUFDO0lBQ3pCLENBQUM7SUFFRCxLQUFLLENBQUMsY0FBYyxDQUFDLE1BQXlDO1FBQzVELElBQUk7WUFDRixNQUFNLFVBQVUsR0FBRyxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsYUFBYSxFQUFFLENBQUM7WUFFckQsSUFBSSxNQUFNLEdBQUcsbUNBQW1DLENBQUM7WUFDakQsTUFBTSxJQUFJLDRCQUE0QixVQUFVLE1BQU0sQ0FBQztZQUV2RCxJQUFJLFVBQVUsSUFBSSxDQUFDLEVBQUU7Z0JBQ25CLE1BQU0sSUFBSSxzRUFBc0UsQ0FBQztnQkFDakYsTUFBTSxJQUFJLGtGQUFrRixDQUFDO2dCQUM3RixNQUFNLElBQUkscUJBQXFCLENBQUM7Z0JBQ2hDLE1BQU0sSUFBSSwwQ0FBMEMsQ0FBQztnQkFDckQsTUFBTSxJQUFJLDZDQUE2QyxDQUFDO2dCQUN4RCxNQUFNLElBQUksNENBQTRDLENBQUM7YUFDeEQ7aUJBQU0sSUFBSSxVQUFVLElBQUksQ0FBQyxFQUFFO2dCQUMxQixNQUFNLElBQUksMERBQTBELENBQUM7Z0JBQ3JFLE1BQU0sSUFBSSxpRUFBaUUsQ0FBQztnQkFDNUUsTUFBTSxJQUFJLCtCQUErQixDQUFDO2dCQUMxQyxNQUFNLElBQUksOEJBQThCLENBQUM7Z0JBQ3pDLE1BQU0sSUFBSSxxQ0FBcUMsQ0FBQztnQkFDaEQsTUFBTSxJQUFJLGlDQUFpQyxDQUFDO2FBQzdDO2lCQUFNLElBQUksVUFBVSxJQUFJLEVBQUUsRUFBRTtnQkFDM0IsTUFBTSxJQUFJLDJDQUEyQyxDQUFDO2dCQUN0RCxNQUFNLElBQUksd0RBQXdELENBQUM7YUFDcEU7aUJBQU0sSUFBSSxVQUFVLElBQUksR0FBRyxFQUFFO2dCQUM1QixNQUFNLElBQUksb0RBQW9ELENBQUM7Z0JBQy9ELE1BQU0sSUFBSSxzREFBc0QsQ0FBQzthQUNsRTtpQkFBTTtnQkFDTCxNQUFNLElBQUksd0RBQXdELENBQUM7Z0JBQ25FLE1BQU0sSUFBSSx3REFBd0QsQ0FBQzthQUNwRTtZQUVELE1BQU0sSUFBSSwwREFBMEQsQ0FBQztZQUNyRSxNQUFNLElBQUksbUVBQW1FLENBQUM7WUFFOUUsT0FBTyxNQUFNLENBQUM7U0FDZjtRQUFDLE9BQU8sS0FBSyxFQUFFO1lBQ2QsT0FBTyxnQ0FBZ0MsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsZUFBZSxFQUFFLENBQUM7U0FDbkc7SUFDSCxDQUFDO0NBQ0Y7QUFseENELGdDQWt4Q0MiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyB6IH0gZnJvbSAnem9kJztcbmltcG9ydCB7IEtlZXBhQ2xpZW50IH0gZnJvbSAnLi9rZWVwYS1jbGllbnQnO1xuaW1wb3J0IHsgS2VlcGFEb21haW4sIEtlZXBhRGF0YVR5cGUsIFByb2R1Y3RGaW5kZXJSZXN1bHQsIENhdGVnb3J5SW5zaWdodHMsIFNhbGVzVmVsb2NpdHlEYXRhLCBJbnZlbnRvcnlBbmFseXNpcyB9IGZyb20gJy4vdHlwZXMnO1xuXG5leHBvcnQgY29uc3QgUHJvZHVjdExvb2t1cFNjaGVtYSA9IHoub2JqZWN0KHtcbiAgYXNpbjogei5zdHJpbmcoKS5kZXNjcmliZSgnQW1hem9uIEFTSU4gKHByb2R1Y3QgaWRlbnRpZmllciknKSxcbiAgZG9tYWluOiB6Lm51bWJlcigpLm1pbigxKS5tYXgoMTEpLmRlZmF1bHQoMSkuZGVzY3JpYmUoJ0FtYXpvbiBkb21haW4gKDE9VVMsIDI9VUssIDM9REUsIGV0Yy4pJyksXG4gIGRheXM6IHoubnVtYmVyKCkubWluKDEpLm1heCgzNjUpLm9wdGlvbmFsKCkuZGVzY3JpYmUoJ051bWJlciBvZiBkYXlzIG9mIHByaWNlIGhpc3RvcnkgdG8gaW5jbHVkZScpLFxuICBoaXN0b3J5OiB6LmJvb2xlYW4oKS5kZWZhdWx0KGZhbHNlKS5kZXNjcmliZSgnSW5jbHVkZSBmdWxsIHByaWNlIGhpc3RvcnknKSxcbiAgb2ZmZXJzOiB6Lm51bWJlcigpLm1pbigwKS5tYXgoMTAwKS5vcHRpb25hbCgpLmRlc2NyaWJlKCdOdW1iZXIgb2YgbWFya2V0cGxhY2Ugb2ZmZXJzIHRvIGluY2x1ZGUnKSxcbiAgdmFyaWF0aW9uczogei5ib29sZWFuKCkuZGVmYXVsdChmYWxzZSkuZGVzY3JpYmUoJ0luY2x1ZGUgcHJvZHVjdCB2YXJpYXRpb25zJyksXG4gIHJhdGluZzogei5ib29sZWFuKCkuZGVmYXVsdChmYWxzZSkuZGVzY3JpYmUoJ0luY2x1ZGUgcHJvZHVjdCByYXRpbmcgZGF0YScpLFxufSk7XG5cbmV4cG9ydCBjb25zdCBCYXRjaFByb2R1Y3RMb29rdXBTY2hlbWEgPSB6Lm9iamVjdCh7XG4gIGFzaW5zOiB6LmFycmF5KHouc3RyaW5nKCkpLm1heCgxMDApLmRlc2NyaWJlKCdBcnJheSBvZiBBbWF6b24gQVNJTnMgKG1heCAxMDApJyksXG4gIGRvbWFpbjogei5udW1iZXIoKS5taW4oMSkubWF4KDExKS5kZWZhdWx0KDEpLmRlc2NyaWJlKCdBbWF6b24gZG9tYWluICgxPVVTLCAyPVVLLCAzPURFLCBldGMuKScpLFxuICBkYXlzOiB6Lm51bWJlcigpLm1pbigxKS5tYXgoMzY1KS5vcHRpb25hbCgpLmRlc2NyaWJlKCdOdW1iZXIgb2YgZGF5cyBvZiBwcmljZSBoaXN0b3J5IHRvIGluY2x1ZGUnKSxcbiAgaGlzdG9yeTogei5ib29sZWFuKCkuZGVmYXVsdChmYWxzZSkuZGVzY3JpYmUoJ0luY2x1ZGUgZnVsbCBwcmljZSBoaXN0b3J5JyksXG59KTtcblxuZXhwb3J0IGNvbnN0IERlYWxTZWFyY2hTY2hlbWEgPSB6Lm9iamVjdCh7XG4gIGRvbWFpbjogei5udW1iZXIoKS5taW4oMSkubWF4KDExKS5kZWZhdWx0KDEpLmRlc2NyaWJlKCdBbWF6b24gZG9tYWluICgxPVVTLCAyPVVLLCAzPURFLCBldGMuKScpLFxuICBjYXRlZ29yeUlkOiB6Lm51bWJlcigpLm9wdGlvbmFsKCkuZGVzY3JpYmUoJ0FtYXpvbiBjYXRlZ29yeSBJRCB0byBmaWx0ZXIgYnknKSxcbiAgbWluUHJpY2U6IHoubnVtYmVyKCkubWluKDApLm9wdGlvbmFsKCkuZGVzY3JpYmUoJ01pbmltdW0gcHJpY2UgaW4gY2VudHMnKSxcbiAgbWF4UHJpY2U6IHoubnVtYmVyKCkubWluKDApLm9wdGlvbmFsKCkuZGVzY3JpYmUoJ01heGltdW0gcHJpY2UgaW4gY2VudHMnKSxcbiAgbWluRGlzY291bnQ6IHoubnVtYmVyKCkubWluKDApLm1heCgxMDApLm9wdGlvbmFsKCkuZGVzY3JpYmUoJ01pbmltdW0gZGlzY291bnQgcGVyY2VudGFnZScpLFxuICBtaW5SYXRpbmc6IHoubnVtYmVyKCkubWluKDEpLm1heCg1KS5vcHRpb25hbCgpLmRlc2NyaWJlKCdNaW5pbXVtIHByb2R1Y3QgcmF0aW5nICgxLTUgc3RhcnMpJyksXG4gIGlzUHJpbWU6IHouYm9vbGVhbigpLm9wdGlvbmFsKCkuZGVzY3JpYmUoJ0ZpbHRlciBmb3IgUHJpbWUgZWxpZ2libGUgZGVhbHMgb25seScpLFxuICBzb3J0VHlwZTogei5udW1iZXIoKS5taW4oMCkubWF4KDQpLmRlZmF1bHQoMCkuZGVzY3JpYmUoJ1NvcnQgdHlwZSAoMD1kZWFsIHNjb3JlLCAxPXByaWNlLCAyPWRpc2NvdW50LCAzPXJhdGluZywgND1yZXZpZXdzKScpLFxuICBwYWdlOiB6Lm51bWJlcigpLm1pbigwKS5kZWZhdWx0KDApLmRlc2NyaWJlKCdQYWdlIG51bWJlciBmb3IgcGFnaW5hdGlvbicpLFxuICBwZXJQYWdlOiB6Lm51bWJlcigpLm1pbigxKS5tYXgoNTApLmRlZmF1bHQoMjUpLmRlc2NyaWJlKCdSZXN1bHRzIHBlciBwYWdlIChtYXggNTApJyksXG59KTtcblxuZXhwb3J0IGNvbnN0IFNlbGxlckxvb2t1cFNjaGVtYSA9IHoub2JqZWN0KHtcbiAgc2VsbGVyOiB6LnN0cmluZygpLmRlc2NyaWJlKCdTZWxsZXIgSUQgb3IgbmFtZScpLFxuICBkb21haW46IHoubnVtYmVyKCkubWluKDEpLm1heCgxMSkuZGVmYXVsdCgxKS5kZXNjcmliZSgnQW1hem9uIGRvbWFpbiAoMT1VUywgMj1VSywgMz1ERSwgZXRjLiknKSxcbiAgc3RvcmVmcm9udDogei5udW1iZXIoKS5taW4oMCkubWF4KDEwMDAwMCkub3B0aW9uYWwoKS5kZXNjcmliZSgnTnVtYmVyIG9mIHN0b3JlZnJvbnQgQVNJTnMgdG8gcmV0cmlldmUnKSxcbn0pO1xuXG5leHBvcnQgY29uc3QgQmVzdFNlbGxlcnNTY2hlbWEgPSB6Lm9iamVjdCh7XG4gIGRvbWFpbjogei5udW1iZXIoKS5taW4oMSkubWF4KDExKS5kZWZhdWx0KDEpLmRlc2NyaWJlKCdBbWF6b24gZG9tYWluICgxPVVTLCAyPVVLLCAzPURFLCBldGMuKScpLFxuICBjYXRlZ29yeTogei5udW1iZXIoKS5kZXNjcmliZSgnQW1hem9uIGNhdGVnb3J5IElEJyksXG4gIHBhZ2U6IHoubnVtYmVyKCkubWluKDApLmRlZmF1bHQoMCkuZGVzY3JpYmUoJ1BhZ2UgbnVtYmVyIGZvciBwYWdpbmF0aW9uJyksXG59KTtcblxuZXhwb3J0IGNvbnN0IFByaWNlSGlzdG9yeVNjaGVtYSA9IHoub2JqZWN0KHtcbiAgYXNpbjogei5zdHJpbmcoKS5kZXNjcmliZSgnQW1hem9uIEFTSU4gKHByb2R1Y3QgaWRlbnRpZmllciknKSxcbiAgZG9tYWluOiB6Lm51bWJlcigpLm1pbigxKS5tYXgoMTEpLmRlZmF1bHQoMSkuZGVzY3JpYmUoJ0FtYXpvbiBkb21haW4gKDE9VVMsIDI9VUssIDM9REUsIGV0Yy4pJyksXG4gIGRhdGFUeXBlOiB6Lm51bWJlcigpLm1pbigwKS5tYXgoMzApLmRlc2NyaWJlKCdEYXRhIHR5cGUgKDA9QW1hem9uLCAxPU5ldywgMj1Vc2VkLCAzPVNhbGVzIFJhbmssIGV0Yy4pJyksXG4gIGRheXM6IHoubnVtYmVyKCkubWluKDEpLm1heCgzNjUpLmRlZmF1bHQoMzApLmRlc2NyaWJlKCdOdW1iZXIgb2YgZGF5cyBvZiBoaXN0b3J5JyksXG59KTtcblxuZXhwb3J0IGNvbnN0IFByb2R1Y3RGaW5kZXJTY2hlbWEgPSB6Lm9iamVjdCh7XG4gIGRvbWFpbjogei5udW1iZXIoKS5taW4oMSkubWF4KDExKS5kZWZhdWx0KDEpLmRlc2NyaWJlKCdBbWF6b24gZG9tYWluICgxPVVTLCAyPVVLLCAzPURFLCBldGMuKScpLFxuICBjYXRlZ29yeUlkOiB6Lm51bWJlcigpLm9wdGlvbmFsKCkuZGVzY3JpYmUoJ0FtYXpvbiBjYXRlZ29yeSBJRCB0byBzZWFyY2ggd2l0aGluJyksXG4gIG1pblJhdGluZzogei5udW1iZXIoKS5taW4oMSkubWF4KDUpLm9wdGlvbmFsKCkuZGVzY3JpYmUoJ01pbmltdW0gcHJvZHVjdCByYXRpbmcgKDEtNSBzdGFycyknKSxcbiAgbWF4UmF0aW5nOiB6Lm51bWJlcigpLm1pbigxKS5tYXgoNSkub3B0aW9uYWwoKS5kZXNjcmliZSgnTWF4aW11bSBwcm9kdWN0IHJhdGluZyAoMS01IHN0YXJzKScpLFxuICBtaW5QcmljZTogei5udW1iZXIoKS5taW4oMCkub3B0aW9uYWwoKS5kZXNjcmliZSgnTWluaW11bSBwcmljZSBpbiBjZW50cycpLFxuICBtYXhQcmljZTogei5udW1iZXIoKS5taW4oMCkub3B0aW9uYWwoKS5kZXNjcmliZSgnTWF4aW11bSBwcmljZSBpbiBjZW50cycpLFxuICBtaW5TaGlwcGluZzogei5udW1iZXIoKS5taW4oMCkub3B0aW9uYWwoKS5kZXNjcmliZSgnTWluaW11bSBzaGlwcGluZyBjb3N0IGluIGNlbnRzJyksXG4gIG1heFNoaXBwaW5nOiB6Lm51bWJlcigpLm1pbigwKS5vcHRpb25hbCgpLmRlc2NyaWJlKCdNYXhpbXVtIHNoaXBwaW5nIGNvc3QgaW4gY2VudHMnKSxcbiAgbWluTW9udGhseVNhbGVzOiB6Lm51bWJlcigpLm1pbigwKS5vcHRpb25hbCgpLmRlc2NyaWJlKCdNaW5pbXVtIGVzdGltYXRlZCBtb250aGx5IHNhbGVzJyksXG4gIG1heE1vbnRobHlTYWxlczogei5udW1iZXIoKS5taW4oMCkub3B0aW9uYWwoKS5kZXNjcmliZSgnTWF4aW11bSBlc3RpbWF0ZWQgbW9udGhseSBzYWxlcycpLFxuICBtaW5TZWxsZXJDb3VudDogei5udW1iZXIoKS5taW4oMCkub3B0aW9uYWwoKS5kZXNjcmliZSgnTWluaW11bSBudW1iZXIgb2Ygc2VsbGVycycpLFxuICBtYXhTZWxsZXJDb3VudDogei5udW1iZXIoKS5taW4oMCkub3B0aW9uYWwoKS5kZXNjcmliZSgnTWF4aW11bSBudW1iZXIgb2Ygc2VsbGVycycpLFxuICBzZWxsZXJDb3VudFRpbWVmcmFtZTogei5lbnVtKFsnY3VycmVudCcsICczMGRheScsICc5MGRheScsICcxODBkYXknLCAnMzY1ZGF5J10pLmRlZmF1bHQoJzkwZGF5JykuZGVzY3JpYmUoJ1RpbWVmcmFtZSBmb3Igc2VsbGVyIGNvdW50IChjdXJyZW50LCAzMGRheSwgOTBkYXksIDE4MGRheSwgMzY1ZGF5KScpLFxuICBpc1ByaW1lOiB6LmJvb2xlYW4oKS5vcHRpb25hbCgpLmRlc2NyaWJlKCdGaWx0ZXIgZm9yIFByaW1lIGVsaWdpYmxlIHByb2R1Y3RzIG9ubHknKSxcbiAgaGFzUmV2aWV3czogei5ib29sZWFuKCkub3B0aW9uYWwoKS5kZXNjcmliZSgnRmlsdGVyIGZvciBwcm9kdWN0cyB3aXRoIHJldmlld3Mgb25seScpLFxuICBwcm9kdWN0VHlwZTogei5udW1iZXIoKS5taW4oMCkubWF4KDIpLmRlZmF1bHQoMCkub3B0aW9uYWwoKS5kZXNjcmliZSgnUHJvZHVjdCB0eXBlICgwPXN0YW5kYXJkLCAxPXZhcmlhdGlvbiBwYXJlbnQsIDI9dmFyaWF0aW9uIGNoaWxkKScpLFxuICBzb3J0Qnk6IHouZW51bShbJ21vbnRobHlTb2xkJywgJ3ByaWNlJywgJ3JhdGluZycsICdyZXZpZXdDb3VudCcsICdzYWxlc1JhbmsnXSkuZGVmYXVsdCgnbW9udGhseVNvbGQnKS5kZXNjcmliZSgnU29ydCByZXN1bHRzIGJ5IGZpZWxkJyksXG4gIHNvcnRPcmRlcjogei5lbnVtKFsnYXNjJywgJ2Rlc2MnXSkuZGVmYXVsdCgnZGVzYycpLmRlc2NyaWJlKCdTb3J0IG9yZGVyIChhc2NlbmRpbmcgb3IgZGVzY2VuZGluZyknKSxcbiAgcGFnZTogei5udW1iZXIoKS5taW4oMCkuZGVmYXVsdCgwKS5kZXNjcmliZSgnUGFnZSBudW1iZXIgZm9yIHBhZ2luYXRpb24nKSxcbiAgcGVyUGFnZTogei5udW1iZXIoKS5taW4oMSkubWF4KDUwKS5kZWZhdWx0KDI1KS5kZXNjcmliZSgnUmVzdWx0cyBwZXIgcGFnZSAobWF4IDUwKScpLFxufSk7XG5cbmV4cG9ydCBjb25zdCBDYXRlZ29yeUFuYWx5c2lzU2NoZW1hID0gei5vYmplY3Qoe1xuICBkb21haW46IHoubnVtYmVyKCkubWluKDEpLm1heCgxMSkuZGVmYXVsdCgxKS5kZXNjcmliZSgnQW1hem9uIGRvbWFpbiAoMT1VUywgMj1VSywgMz1ERSwgZXRjLiknKSxcbiAgY2F0ZWdvcnlJZDogei5udW1iZXIoKS5kZXNjcmliZSgnQW1hem9uIGNhdGVnb3J5IElEIHRvIGFuYWx5emUnKSxcbiAgYW5hbHlzaXNUeXBlOiB6LmVudW0oWydvdmVydmlldycsICd0b3BfcGVyZm9ybWVycycsICdvcHBvcnR1bml0aWVzJywgJ3RyZW5kcyddKS5kZWZhdWx0KCdvdmVydmlldycpLmRlc2NyaWJlKCdUeXBlIG9mIGFuYWx5c2lzIHRvIHBlcmZvcm0nKSxcbiAgcHJpY2VSYW5nZTogei5lbnVtKFsnYnVkZ2V0JywgJ21pZCcsICdwcmVtaXVtJywgJ2x1eHVyeSddKS5vcHRpb25hbCgpLmRlc2NyaWJlKCdGb2N1cyBvbiBzcGVjaWZpYyBwcmljZSByYW5nZScpLFxuICBtaW5SYXRpbmc6IHoubnVtYmVyKCkubWluKDEpLm1heCg1KS5kZWZhdWx0KDMuMCkuZGVzY3JpYmUoJ01pbmltdW0gcmF0aW5nIGZvciBwcm9kdWN0cyB0byBpbmNsdWRlJyksXG4gIGluY2x1ZGVTdWJjYXRlZ29yaWVzOiB6LmJvb2xlYW4oKS5kZWZhdWx0KGZhbHNlKS5kZXNjcmliZSgnSW5jbHVkZSBhbmFseXNpcyBvZiBzdWJjYXRlZ29yaWVzJyksXG4gIHRpbWVmcmFtZTogei5lbnVtKFsnd2VlaycsICdtb250aCcsICdxdWFydGVyJywgJ3llYXInXSkuZGVmYXVsdCgnbW9udGgnKS5kZXNjcmliZSgnVGltZWZyYW1lIGZvciB0cmVuZCBhbmFseXNpcycpLFxuICBzZWxsZXJDb3VudFRpbWVmcmFtZTogei5lbnVtKFsnY3VycmVudCcsICczMGRheScsICc5MGRheScsICcxODBkYXknLCAnMzY1ZGF5J10pLmRlZmF1bHQoJzkwZGF5JykuZGVzY3JpYmUoJ1RpbWVmcmFtZSBmb3Igc2VsbGVyIGNvdW50IGFuYWx5c2lzIChjdXJyZW50LCAzMGRheSwgOTBkYXksIDE4MGRheSwgMzY1ZGF5KScpLFxufSk7XG5cbmV4cG9ydCBjb25zdCBTYWxlc1ZlbG9jaXR5U2NoZW1hID0gei5vYmplY3Qoe1xuICBkb21haW46IHoubnVtYmVyKCkubWluKDEpLm1heCgxMSkuZGVmYXVsdCgxKS5kZXNjcmliZSgnQW1hem9uIGRvbWFpbiAoMT1VUywgMj1VSywgMz1ERSwgZXRjLiknKSxcbiAgY2F0ZWdvcnlJZDogei5udW1iZXIoKS5vcHRpb25hbCgpLmRlc2NyaWJlKCdBbWF6b24gY2F0ZWdvcnkgSUQgdG8gZmlsdGVyIGJ5JyksXG4gIGFzaW46IHouc3RyaW5nKCkub3B0aW9uYWwoKS5kZXNjcmliZSgnU2luZ2xlIEFTSU4gdG8gYW5hbHl6ZScpLFxuICBhc2luczogei5hcnJheSh6LnN0cmluZygpKS5tYXgoNTApLm9wdGlvbmFsKCkuZGVzY3JpYmUoJ0FycmF5IG9mIEFTSU5zIHRvIGFuYWx5emUgKG1heCA1MCknKSxcbiAgdGltZWZyYW1lOiB6LmVudW0oWyd3ZWVrJywgJ21vbnRoJywgJ3F1YXJ0ZXInXSkuZGVmYXVsdCgnbW9udGgnKS5kZXNjcmliZSgnVGltZSBwZXJpb2QgZm9yIHZlbG9jaXR5IGNhbGN1bGF0aW9uJyksXG4gIG1pblZlbG9jaXR5OiB6Lm51bWJlcigpLm1pbigwKS5vcHRpb25hbCgpLmRlc2NyaWJlKCdNaW5pbXVtIGRhaWx5IHNhbGVzIHZlbG9jaXR5JyksXG4gIG1heFZlbG9jaXR5OiB6Lm51bWJlcigpLm1pbigwKS5vcHRpb25hbCgpLmRlc2NyaWJlKCdNYXhpbXVtIGRhaWx5IHNhbGVzIHZlbG9jaXR5JyksXG4gIG1pblByaWNlOiB6Lm51bWJlcigpLm1pbigwKS5vcHRpb25hbCgpLmRlc2NyaWJlKCdNaW5pbXVtIHByaWNlIGluIGNlbnRzJyksXG4gIG1heFByaWNlOiB6Lm51bWJlcigpLm1pbigwKS5vcHRpb25hbCgpLmRlc2NyaWJlKCdNYXhpbXVtIHByaWNlIGluIGNlbnRzJyksXG4gIG1pblJhdGluZzogei5udW1iZXIoKS5taW4oMSkubWF4KDUpLmRlZmF1bHQoMy4wKS5kZXNjcmliZSgnTWluaW11bSBwcm9kdWN0IHJhdGluZycpLFxuICBzb3J0Qnk6IHouZW51bShbJ3ZlbG9jaXR5JywgJ3R1cm5vdmVyUmF0ZScsICdyZXZlbnVlVmVsb2NpdHknLCAndHJlbmQnXSkuZGVmYXVsdCgndmVsb2NpdHknKS5kZXNjcmliZSgnU29ydCByZXN1bHRzIGJ5IG1ldHJpYycpLFxuICBzb3J0T3JkZXI6IHouZW51bShbJ2FzYycsICdkZXNjJ10pLmRlZmF1bHQoJ2Rlc2MnKS5kZXNjcmliZSgnU29ydCBvcmRlcicpLFxuICBzZWxsZXJDb3VudFRpbWVmcmFtZTogei5lbnVtKFsnY3VycmVudCcsICczMGRheScsICc5MGRheScsICcxODBkYXknLCAnMzY1ZGF5J10pLmRlZmF1bHQoJzkwZGF5JykuZGVzY3JpYmUoJ1RpbWVmcmFtZSBmb3Igc2VsbGVyIGNvdW50IGFuYWx5c2lzIChjdXJyZW50LCAzMGRheSwgOTBkYXksIDE4MGRheSwgMzY1ZGF5KScpLFxuICBwYWdlOiB6Lm51bWJlcigpLm1pbigwKS5kZWZhdWx0KDApLmRlc2NyaWJlKCdQYWdlIG51bWJlciBmb3IgcGFnaW5hdGlvbicpLFxuICBwZXJQYWdlOiB6Lm51bWJlcigpLm1pbigxKS5tYXgoNTApLmRlZmF1bHQoMjUpLmRlc2NyaWJlKCdSZXN1bHRzIHBlciBwYWdlIChtYXggNTApJyksXG59KTtcblxuZXhwb3J0IGNvbnN0IEludmVudG9yeUFuYWx5c2lzU2NoZW1hID0gei5vYmplY3Qoe1xuICBkb21haW46IHoubnVtYmVyKCkubWluKDEpLm1heCgxMSkuZGVmYXVsdCgxKS5kZXNjcmliZSgnQW1hem9uIGRvbWFpbiAoMT1VUywgMj1VSywgMz1ERSwgZXRjLiknKSxcbiAgY2F0ZWdvcnlJZDogei5udW1iZXIoKS5vcHRpb25hbCgpLmRlc2NyaWJlKCdBbWF6b24gY2F0ZWdvcnkgSUQgdG8gYW5hbHl6ZScpLFxuICBhc2luczogei5hcnJheSh6LnN0cmluZygpKS5tYXgoMTAwKS5vcHRpb25hbCgpLmRlc2NyaWJlKCdTcGVjaWZpYyBBU0lOcyB0byBhbmFseXplICh5b3VyIGludmVudG9yeSknKSxcbiAgYW5hbHlzaXNUeXBlOiB6LmVudW0oWydvdmVydmlldycsICdmYXN0X21vdmVycycsICdzbG93X21vdmVycycsICdzdG9ja291dF9yaXNrcycsICdzZWFzb25hbCddKS5kZWZhdWx0KCdvdmVydmlldycpLmRlc2NyaWJlKCdUeXBlIG9mIGludmVudG9yeSBhbmFseXNpcycpLFxuICB0aW1lZnJhbWU6IHouZW51bShbJ3dlZWsnLCAnbW9udGgnLCAncXVhcnRlciddKS5kZWZhdWx0KCdtb250aCcpLmRlc2NyaWJlKCdBbmFseXNpcyB0aW1lZnJhbWUnKSxcbiAgc2VsbGVyQ291bnRUaW1lZnJhbWU6IHouZW51bShbJ2N1cnJlbnQnLCAnMzBkYXknLCAnOTBkYXknLCAnMTgwZGF5JywgJzM2NWRheSddKS5kZWZhdWx0KCc5MGRheScpLmRlc2NyaWJlKCdUaW1lZnJhbWUgZm9yIHNlbGxlciBjb3VudCBhbmFseXNpcyAoY3VycmVudCwgMzBkYXksIDkwZGF5LCAxODBkYXksIDM2NWRheSknKSxcbiAgdGFyZ2V0VHVybm92ZXJSYXRlOiB6Lm51bWJlcigpLm1pbigxKS5tYXgoNTApLmRlZmF1bHQoMTIpLmRlc2NyaWJlKCdUYXJnZXQgaW52ZW50b3J5IHR1cm5zIHBlciB5ZWFyJyksXG59KTtcblxuZXhwb3J0IGNvbnN0IFRva2VuU3RhdHVzU2NoZW1hID0gei5vYmplY3Qoe30pO1xuXG5leHBvcnQgY2xhc3MgS2VlcGFUb29scyB7XG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgY2xpZW50OiBLZWVwYUNsaWVudCkge31cblxuICBhc3luYyBsb29rdXBQcm9kdWN0KHBhcmFtczogei5pbmZlcjx0eXBlb2YgUHJvZHVjdExvb2t1cFNjaGVtYT4pOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBwcm9kdWN0ID0gYXdhaXQgdGhpcy5jbGllbnQuZ2V0UHJvZHVjdEJ5QXNpbihcbiAgICAgICAgcGFyYW1zLmFzaW4sXG4gICAgICAgIHBhcmFtcy5kb21haW4gYXMgS2VlcGFEb21haW4sXG4gICAgICAgIHtcbiAgICAgICAgICBkYXlzOiBwYXJhbXMuZGF5cyxcbiAgICAgICAgICBoaXN0b3J5OiBwYXJhbXMuaGlzdG9yeSxcbiAgICAgICAgICBvZmZlcnM6IHBhcmFtcy5vZmZlcnMsXG4gICAgICAgICAgdmFyaWF0aW9uczogcGFyYW1zLnZhcmlhdGlvbnMsXG4gICAgICAgICAgcmF0aW5nOiBwYXJhbXMucmF0aW5nLFxuICAgICAgICB9XG4gICAgICApO1xuXG4gICAgICBpZiAoIXByb2R1Y3QpIHtcbiAgICAgICAgcmV0dXJuIGBQcm9kdWN0IG5vdCBmb3VuZCBmb3IgQVNJTjogJHtwYXJhbXMuYXNpbn1gO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBkb21haW4gPSBwYXJhbXMuZG9tYWluIGFzIEtlZXBhRG9tYWluO1xuICAgICAgY29uc3QgZG9tYWluTmFtZSA9IHRoaXMuY2xpZW50LmdldERvbWFpbk5hbWUoZG9tYWluKTtcbiAgICAgIFxuICAgICAgbGV0IHJlc3VsdCA9IGAqKlByb2R1Y3QgSW5mb3JtYXRpb24gZm9yICR7cGFyYW1zLmFzaW59KipcXG5cXG5gO1xuICAgICAgcmVzdWx0ICs9IGDwn4+qICoqTWFya2V0cGxhY2UqKjogJHtkb21haW5OYW1lfVxcbmA7XG4gICAgICByZXN1bHQgKz0gYPCfk6YgKipUaXRsZSoqOiAke3Byb2R1Y3QudGl0bGUgfHwgJ04vQSd9XFxuYDtcbiAgICAgIHJlc3VsdCArPSBg8J+Pt++4jyAqKkJyYW5kKio6ICR7cHJvZHVjdC5icmFuZCB8fCAnTi9BJ31cXG5gO1xuICAgICAgcmVzdWx0ICs9IGDwn5OKICoqQ2F0ZWdvcnkqKjogJHtwcm9kdWN0LnByb2R1Y3RHcm91cCB8fCAnTi9BJ31cXG5gO1xuXG4gICAgICBpZiAocHJvZHVjdC5zdGF0cykge1xuICAgICAgICBjb25zdCBjdXJyZW50UHJpY2UgPSBwcm9kdWN0LnN0YXRzLmN1cnJlbnRbMF07XG4gICAgICAgIGlmIChjdXJyZW50UHJpY2UgJiYgY3VycmVudFByaWNlICE9PSAtMSkge1xuICAgICAgICAgIHJlc3VsdCArPSBg8J+SsCAqKkN1cnJlbnQgUHJpY2UqKjogJHt0aGlzLmNsaWVudC5mb3JtYXRQcmljZShjdXJyZW50UHJpY2UsIGRvbWFpbil9XFxuYDtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGF2Z1ByaWNlID0gcHJvZHVjdC5zdGF0cy5hdmdbMF07XG4gICAgICAgIGlmIChhdmdQcmljZSAmJiBhdmdQcmljZSAhPT0gLTEpIHtcbiAgICAgICAgICByZXN1bHQgKz0gYPCfk4ggKipBdmVyYWdlIFByaWNlKio6ICR7dGhpcy5jbGllbnQuZm9ybWF0UHJpY2UoYXZnUHJpY2UsIGRvbWFpbil9XFxuYDtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChwcm9kdWN0LnN0YXRzLnNhbGVzUmFua1JlZmVyZW5jZSkge1xuICAgICAgICAgIHJlc3VsdCArPSBg8J+TiiAqKlNhbGVzIFJhbmsqKjogIyR7cHJvZHVjdC5zdGF0cy5zYWxlc1JhbmtSZWZlcmVuY2UudG9Mb2NhbGVTdHJpbmcoKX1cXG5gO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmIChwYXJhbXMucmF0aW5nICYmIHByb2R1Y3Quc3RhdHM/LmN1cnJlbnRbMTZdKSB7XG4gICAgICAgIGNvbnN0IHJhdGluZyA9IHByb2R1Y3Quc3RhdHMuY3VycmVudFsxNl0gLyAxMDtcbiAgICAgICAgY29uc3QgcmV2aWV3Q291bnQgPSBwcm9kdWN0LnN0YXRzLmN1cnJlbnRbMTddO1xuICAgICAgICByZXN1bHQgKz0gYOKtkCAqKlJhdGluZyoqOiAke3JhdGluZy50b0ZpeGVkKDEpfS81LjAgKCR7cmV2aWV3Q291bnR9IHJldmlld3MpXFxuYDtcbiAgICAgIH1cblxuICAgICAgaWYgKHByb2R1Y3Qub2ZmZXJzICYmIHByb2R1Y3Qub2ZmZXJzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgcmVzdWx0ICs9IGBcXG4qKk1hcmtldHBsYWNlIE9mZmVycyoqOiAke3Byb2R1Y3Qub2ZmZXJzLmxlbmd0aH0gYXZhaWxhYmxlXFxuYDtcbiAgICAgICAgY29uc3QgdG9wT2ZmZXJzID0gcHJvZHVjdC5vZmZlcnMuc2xpY2UoMCwgMyk7XG4gICAgICAgIHRvcE9mZmVycy5mb3JFYWNoKChvZmZlciwgaSkgPT4ge1xuICAgICAgICAgIHJlc3VsdCArPSBgJHtpICsgMX0uICR7b2ZmZXIuaXNBbWF6b24gPyAn8J+fpiBBbWF6b24nIDogJ/Cfj6ogM1AgU2VsbGVyJ30gLSBgO1xuICAgICAgICAgIHJlc3VsdCArPSBgJHtvZmZlci5pc1ByaW1lID8gJ+KaoSBQcmltZScgOiAnU3RhbmRhcmQnfSAtIGA7XG4gICAgICAgICAgcmVzdWx0ICs9IGAke29mZmVyLmlzRkJBID8gJ0ZCQScgOiAnRkJNJ31cXG5gO1xuICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgICAgaWYgKHBhcmFtcy52YXJpYXRpb25zICYmIHByb2R1Y3QudmFyaWF0aW9ucyAmJiBwcm9kdWN0LnZhcmlhdGlvbnMubGVuZ3RoID4gMCkge1xuICAgICAgICByZXN1bHQgKz0gYFxcbioqVmFyaWF0aW9ucyoqOiAke3Byb2R1Y3QudmFyaWF0aW9ucy5sZW5ndGh9IGF2YWlsYWJsZVxcbmA7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHJldHVybiBgRXJyb3IgbG9va2luZyB1cCBwcm9kdWN0OiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InfWA7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgYmF0Y2hMb29rdXBQcm9kdWN0cyhwYXJhbXM6IHouaW5mZXI8dHlwZW9mIEJhdGNoUHJvZHVjdExvb2t1cFNjaGVtYT4pOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBwcm9kdWN0cyA9IGF3YWl0IHRoaXMuY2xpZW50LmdldFByb2R1Y3RzQmF0Y2goXG4gICAgICAgIHBhcmFtcy5hc2lucyxcbiAgICAgICAgcGFyYW1zLmRvbWFpbiBhcyBLZWVwYURvbWFpbixcbiAgICAgICAge1xuICAgICAgICAgIGRheXM6IHBhcmFtcy5kYXlzLFxuICAgICAgICAgIGhpc3Rvcnk6IHBhcmFtcy5oaXN0b3J5LFxuICAgICAgICB9XG4gICAgICApO1xuXG4gICAgICBjb25zdCBkb21haW4gPSBwYXJhbXMuZG9tYWluIGFzIEtlZXBhRG9tYWluO1xuICAgICAgY29uc3QgZG9tYWluTmFtZSA9IHRoaXMuY2xpZW50LmdldERvbWFpbk5hbWUoZG9tYWluKTtcbiAgICAgIFxuICAgICAgbGV0IHJlc3VsdCA9IGAqKkJhdGNoIFByb2R1Y3QgTG9va3VwIFJlc3VsdHMgKCR7cHJvZHVjdHMubGVuZ3RofS8ke3BhcmFtcy5hc2lucy5sZW5ndGh9IGZvdW5kKSoqXFxuXFxuYDtcbiAgICAgIHJlc3VsdCArPSBg8J+PqiAqKk1hcmtldHBsYWNlKio6ICR7ZG9tYWluTmFtZX1cXG5cXG5gO1xuXG4gICAgICBwcm9kdWN0cy5mb3JFYWNoKChwcm9kdWN0LCBpKSA9PiB7XG4gICAgICAgIHJlc3VsdCArPSBgKioke2kgKyAxfS4gJHtwcm9kdWN0LmFzaW59KipcXG5gO1xuICAgICAgICByZXN1bHQgKz0gYPCfk6YgJHtwcm9kdWN0LnRpdGxlIHx8ICdOL0EnfVxcbmA7XG4gICAgICAgIHJlc3VsdCArPSBg8J+Pt++4jyAke3Byb2R1Y3QuYnJhbmQgfHwgJ04vQSd9XFxuYDtcbiAgICAgICAgXG4gICAgICAgIGlmIChwcm9kdWN0LnN0YXRzPy5jdXJyZW50WzBdICYmIHByb2R1Y3Quc3RhdHMuY3VycmVudFswXSAhPT0gLTEpIHtcbiAgICAgICAgICByZXN1bHQgKz0gYPCfkrAgJHt0aGlzLmNsaWVudC5mb3JtYXRQcmljZShwcm9kdWN0LnN0YXRzLmN1cnJlbnRbMF0sIGRvbWFpbil9XFxuYDtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgaWYgKHByb2R1Y3Quc3RhdHM/LnNhbGVzUmFua1JlZmVyZW5jZSkge1xuICAgICAgICAgIHJlc3VsdCArPSBg8J+TiiBSYW5rOiAjJHtwcm9kdWN0LnN0YXRzLnNhbGVzUmFua1JlZmVyZW5jZS50b0xvY2FsZVN0cmluZygpfVxcbmA7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIHJlc3VsdCArPSAnXFxuJztcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBub3RGb3VuZCA9IHBhcmFtcy5hc2lucy5maWx0ZXIoYXNpbiA9PiBcbiAgICAgICAgIXByb2R1Y3RzLnNvbWUocHJvZHVjdCA9PiBwcm9kdWN0LmFzaW4gPT09IGFzaW4pXG4gICAgICApO1xuXG4gICAgICBpZiAobm90Rm91bmQubGVuZ3RoID4gMCkge1xuICAgICAgICByZXN1bHQgKz0gYCoqTm90IEZvdW5kKio6ICR7bm90Rm91bmQuam9pbignLCAnKX1cXG5gO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICByZXR1cm4gYEVycm9yIGluIGJhdGNoIGxvb2t1cDogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJ31gO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHNlYXJjaERlYWxzKHBhcmFtczogei5pbmZlcjx0eXBlb2YgRGVhbFNlYXJjaFNjaGVtYT4pOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBkZWFscyA9IGF3YWl0IHRoaXMuY2xpZW50LmdldERlYWxzKHtcbiAgICAgICAgZG9tYWluSWQ6IHBhcmFtcy5kb21haW4sXG4gICAgICAgIGNhdGVnb3J5SWQ6IHBhcmFtcy5jYXRlZ29yeUlkLFxuICAgICAgICBtaW5QcmljZTogcGFyYW1zLm1pblByaWNlLFxuICAgICAgICBtYXhQcmljZTogcGFyYW1zLm1heFByaWNlLFxuICAgICAgICBtaW5EaXNjb3VudDogcGFyYW1zLm1pbkRpc2NvdW50LFxuICAgICAgICBtaW5SYXRpbmc6IHBhcmFtcy5taW5SYXRpbmcsXG4gICAgICAgIGlzUHJpbWU6IHBhcmFtcy5pc1ByaW1lLFxuICAgICAgICBzb3J0VHlwZTogcGFyYW1zLnNvcnRUeXBlLFxuICAgICAgICBwYWdlOiBwYXJhbXMucGFnZSxcbiAgICAgICAgcGVyUGFnZTogcGFyYW1zLnBlclBhZ2UsXG4gICAgICB9KTtcblxuICAgICAgaWYgKGRlYWxzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICByZXR1cm4gJ05vIGRlYWxzIGZvdW5kIG1hdGNoaW5nIHlvdXIgY3JpdGVyaWEuJztcbiAgICAgIH1cblxuICAgICAgY29uc3QgZG9tYWluID0gcGFyYW1zLmRvbWFpbiBhcyBLZWVwYURvbWFpbjtcbiAgICAgIGNvbnN0IGRvbWFpbk5hbWUgPSB0aGlzLmNsaWVudC5nZXREb21haW5OYW1lKGRvbWFpbik7XG4gICAgICBcbiAgICAgIGxldCByZXN1bHQgPSBgKipBbWF6b24gRGVhbHMgRm91bmQ6ICR7ZGVhbHMubGVuZ3RofSoqXFxuXFxuYDtcbiAgICAgIHJlc3VsdCArPSBg8J+PqiAqKk1hcmtldHBsYWNlKio6ICR7ZG9tYWluTmFtZX1cXG5cXG5gO1xuXG4gICAgICBkZWFscy5mb3JFYWNoKChkZWFsLCBpKSA9PiB7XG4gICAgICAgIHJlc3VsdCArPSBgKioke2kgKyAxfS4gJHtkZWFsLmFzaW59KipcXG5gO1xuICAgICAgICByZXN1bHQgKz0gYPCfk6YgKioke2RlYWwudGl0bGV9KipcXG5gO1xuICAgICAgICByZXN1bHQgKz0gYPCfj7fvuI8gQnJhbmQ6ICR7ZGVhbC5icmFuZCB8fCAnTi9BJ31cXG5gO1xuICAgICAgICByZXN1bHQgKz0gYPCfkrAgKipQcmljZSoqOiAke3RoaXMuY2xpZW50LmZvcm1hdFByaWNlKGRlYWwucHJpY2UsIGRvbWFpbil9YDtcbiAgICAgICAgXG4gICAgICAgIGlmIChkZWFsLnNoaXBwaW5nID4gMCkge1xuICAgICAgICAgIHJlc3VsdCArPSBgICsgJHt0aGlzLmNsaWVudC5mb3JtYXRQcmljZShkZWFsLnNoaXBwaW5nLCBkb21haW4pfSBzaGlwcGluZ2A7XG4gICAgICAgIH1cbiAgICAgICAgcmVzdWx0ICs9ICdcXG4nO1xuICAgICAgICBcbiAgICAgICAgcmVzdWx0ICs9IGDwn5OKICoqRGlzY291bnQqKjogJHtkZWFsLmRlbHRhUGVyY2VudH0lICgke3RoaXMuY2xpZW50LmZvcm1hdFByaWNlKE1hdGguYWJzKGRlYWwuZGVsdGEpLCBkb21haW4pfSBvZmYpXFxuYDtcbiAgICAgICAgcmVzdWx0ICs9IGDwn5OIICoqQXZnIFByaWNlKio6ICR7dGhpcy5jbGllbnQuZm9ybWF0UHJpY2UoZGVhbC5hdmdQcmljZSwgZG9tYWluKX1cXG5gO1xuICAgICAgICByZXN1bHQgKz0gYPCfj4YgKipEZWFsIFNjb3JlKio6ICR7ZGVhbC5kZWFsU2NvcmV9XFxuYDtcbiAgICAgICAgXG4gICAgICAgIGlmIChkZWFsLnNhbGVzUmFuaykge1xuICAgICAgICAgIHJlc3VsdCArPSBg8J+TiiAqKlNhbGVzIFJhbmsqKjogIyR7ZGVhbC5zYWxlc1JhbmsudG9Mb2NhbGVTdHJpbmcoKX1cXG5gO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBpZiAoZGVhbC5pc0xpZ2h0bmluZ0RlYWwpIHtcbiAgICAgICAgICByZXN1bHQgKz0gYOKaoSAqKkxpZ2h0bmluZyBEZWFsKipcXG5gO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBpZiAoZGVhbC5pc1ByaW1lRXhjbHVzaXZlKSB7XG4gICAgICAgICAgcmVzdWx0ICs9IGDwn5SlICoqUHJpbWUgRXhjbHVzaXZlKipcXG5gO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBpZiAoZGVhbC5jb3Vwb24pIHtcbiAgICAgICAgICByZXN1bHQgKz0gYPCfjqsgKipDb3Vwb24qKjogJHtkZWFsLmNvdXBvbn0lIGFkZGl0aW9uYWwgZGlzY291bnRcXG5gO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICByZXN1bHQgKz0gJ1xcbic7XG4gICAgICB9KTtcblxuICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgcmV0dXJuIGBFcnJvciBzZWFyY2hpbmcgZGVhbHM6ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcid9YDtcbiAgICB9XG4gIH1cblxuICBhc3luYyBsb29rdXBTZWxsZXIocGFyYW1zOiB6LmluZmVyPHR5cGVvZiBTZWxsZXJMb29rdXBTY2hlbWE+KTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3Qgc2VsbGVycyA9IGF3YWl0IHRoaXMuY2xpZW50LmdldFNlbGxlcih7XG4gICAgICAgIHNlbGxlcjogcGFyYW1zLnNlbGxlcixcbiAgICAgICAgZG9tYWluOiBwYXJhbXMuZG9tYWluLFxuICAgICAgICBzdG9yZWZyb250OiBwYXJhbXMuc3RvcmVmcm9udCxcbiAgICAgIH0pO1xuXG4gICAgICBpZiAoc2VsbGVycy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgcmV0dXJuIGBTZWxsZXIgbm90IGZvdW5kOiAke3BhcmFtcy5zZWxsZXJ9YDtcbiAgICAgIH1cblxuICAgICAgY29uc3Qgc2VsbGVyID0gc2VsbGVyc1swXTtcbiAgICAgIGNvbnN0IGRvbWFpbiA9IHBhcmFtcy5kb21haW4gYXMgS2VlcGFEb21haW47XG4gICAgICBjb25zdCBkb21haW5OYW1lID0gdGhpcy5jbGllbnQuZ2V0RG9tYWluTmFtZShkb21haW4pO1xuICAgICAgXG4gICAgICBsZXQgcmVzdWx0ID0gYCoqU2VsbGVyIEluZm9ybWF0aW9uKipcXG5cXG5gO1xuICAgICAgcmVzdWx0ICs9IGDwn4+qICoqTWFya2V0cGxhY2UqKjogJHtkb21haW5OYW1lfVxcbmA7XG4gICAgICByZXN1bHQgKz0gYPCfj7fvuI8gKipTZWxsZXIgSUQqKjogJHtzZWxsZXIuc2VsbGVySWR9XFxuYDtcbiAgICAgIHJlc3VsdCArPSBg8J+TmyAqKk5hbWUqKjogJHtzZWxsZXIuc2VsbGVyTmFtZX1cXG5gO1xuICAgICAgcmVzdWx0ICs9IGDirZAgKipSYXRpbmcqKjogJHtzZWxsZXIuYXZnUmF0aW5nID8gYCR7c2VsbGVyLmF2Z1JhdGluZ30vNS4wYCA6ICdOL0EnfVxcbmA7XG4gICAgICByZXN1bHQgKz0gYPCfk4ogKipSYXRpbmcgQ291bnQqKjogJHtzZWxsZXIucmF0aW5nQ291bnQ/LnRvTG9jYWxlU3RyaW5nKCkgfHwgJ04vQSd9XFxuYDtcbiAgICAgIHJlc3VsdCArPSBg8J+aqSAqKlNjYW1tZXIgU3RhdHVzKio6ICR7c2VsbGVyLmlzU2NhbW1lciA/ICfimqDvuI8gRmxhZ2dlZCBhcyBzY2FtbWVyJyA6ICfinIUgQ2xlYW4nfVxcbmA7XG4gICAgICByZXN1bHQgKz0gYPCfk6YgKipBbWF6b24gU2VsbGVyKio6ICR7c2VsbGVyLmlzQW1hem9uID8gJ1llcycgOiAnTm8nfVxcbmA7XG4gICAgICByZXN1bHQgKz0gYPCfmpogKipGQkEgQXZhaWxhYmxlKio6ICR7c2VsbGVyLmhhc0ZCQSA/ICdZZXMnIDogJ05vJ31cXG5gO1xuICAgICAgcmVzdWx0ICs9IGDwn5OuICoqRkJNIEF2YWlsYWJsZSoqOiAke3NlbGxlci5oYXNGQk0gPyAnWWVzJyA6ICdObyd9XFxuYDtcbiAgICAgIFxuICAgICAgaWYgKHNlbGxlci50b3RhbFN0b3JlZnJvbnRBc2lucykge1xuICAgICAgICByZXN1bHQgKz0gYPCfj6ogKipUb3RhbCBQcm9kdWN0cyoqOiAke3NlbGxlci50b3RhbFN0b3JlZnJvbnRBc2lucy50b0xvY2FsZVN0cmluZygpfVxcbmA7XG4gICAgICB9XG4gICAgICBcbiAgICAgIGlmIChzZWxsZXIuc3RhcnREYXRlKSB7XG4gICAgICAgIGNvbnN0IHN0YXJ0RGF0ZSA9IG5ldyBEYXRlKHRoaXMuY2xpZW50LmtlZXBhVGltZVRvVW5peFRpbWUoc2VsbGVyLnN0YXJ0RGF0ZSkpO1xuICAgICAgICByZXN1bHQgKz0gYPCfk4UgKipTdGFydGVkIFNlbGxpbmcqKjogJHtzdGFydERhdGUudG9Mb2NhbGVEYXRlU3RyaW5nKCl9XFxuYDtcbiAgICAgIH1cblxuICAgICAgaWYgKHNlbGxlci5zdG9yZWZyb250ICYmIHNlbGxlci5zdG9yZWZyb250Lmxlbmd0aCA+IDApIHtcbiAgICAgICAgcmVzdWx0ICs9IGBcXG4qKlNhbXBsZSBTdG9yZWZyb250IFByb2R1Y3RzKio6ICR7TWF0aC5taW4oNSwgc2VsbGVyLnN0b3JlZnJvbnQubGVuZ3RoKX0gc2hvd25cXG5gO1xuICAgICAgICBzZWxsZXIuc3RvcmVmcm9udC5zbGljZSgwLCA1KS5mb3JFYWNoKChhc2luLCBpKSA9PiB7XG4gICAgICAgICAgcmVzdWx0ICs9IGAke2kgKyAxfS4gJHthc2lufVxcbmA7XG4gICAgICAgIH0pO1xuICAgICAgICBcbiAgICAgICAgaWYgKHNlbGxlci5zdG9yZWZyb250Lmxlbmd0aCA+IDUpIHtcbiAgICAgICAgICByZXN1bHQgKz0gYC4uLiBhbmQgJHtzZWxsZXIuc3RvcmVmcm9udC5sZW5ndGggLSA1fSBtb3JlXFxuYDtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICByZXR1cm4gYEVycm9yIGxvb2tpbmcgdXAgc2VsbGVyOiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InfWA7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgZ2V0QmVzdFNlbGxlcnMocGFyYW1zOiB6LmluZmVyPHR5cGVvZiBCZXN0U2VsbGVyc1NjaGVtYT4pOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBiZXN0U2VsbGVycyA9IGF3YWl0IHRoaXMuY2xpZW50LmdldEJlc3RTZWxsZXJzKHtcbiAgICAgICAgZG9tYWluOiBwYXJhbXMuZG9tYWluLFxuICAgICAgICBjYXRlZ29yeTogcGFyYW1zLmNhdGVnb3J5LFxuICAgICAgICBwYWdlOiBwYXJhbXMucGFnZSxcbiAgICAgIH0pO1xuXG4gICAgICBpZiAoYmVzdFNlbGxlcnMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIHJldHVybiBgTm8gYmVzdCBzZWxsZXJzIGZvdW5kIGZvciBjYXRlZ29yeSAke3BhcmFtcy5jYXRlZ29yeX1gO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBkb21haW4gPSBwYXJhbXMuZG9tYWluIGFzIEtlZXBhRG9tYWluO1xuICAgICAgY29uc3QgZG9tYWluTmFtZSA9IHRoaXMuY2xpZW50LmdldERvbWFpbk5hbWUoZG9tYWluKTtcbiAgICAgIFxuICAgICAgbGV0IHJlc3VsdCA9IGAqKkJlc3QgU2VsbGVycyAtIENhdGVnb3J5ICR7cGFyYW1zLmNhdGVnb3J5fSoqXFxuXFxuYDtcbiAgICAgIHJlc3VsdCArPSBg8J+PqiAqKk1hcmtldHBsYWNlKio6ICR7ZG9tYWluTmFtZX1cXG5gO1xuICAgICAgcmVzdWx0ICs9IGDwn5OKICoqRm91bmQqKjogJHtiZXN0U2VsbGVycy5sZW5ndGh9IHByb2R1Y3RzXFxuXFxuYDtcblxuICAgICAgYmVzdFNlbGxlcnMuZm9yRWFjaCgocHJvZHVjdCwgaSkgPT4ge1xuICAgICAgICBjb25zdCByYW5rID0gcGFyYW1zLnBhZ2UgKiAxMDAgKyBpICsgMTtcbiAgICAgICAgcmVzdWx0ICs9IGAqKiMke3Jhbmt9IC0gJHtwcm9kdWN0LmFzaW59KipcXG5gO1xuICAgICAgICByZXN1bHQgKz0gYPCfk6YgKioke3Byb2R1Y3QudGl0bGV9KipcXG5gO1xuICAgICAgICByZXN1bHQgKz0gYPCfk4ogKipTYWxlcyBSYW5rKio6ICMke3Byb2R1Y3Quc2FsZXNSYW5rLnRvTG9jYWxlU3RyaW5nKCl9XFxuYDtcbiAgICAgICAgXG4gICAgICAgIGlmIChwcm9kdWN0LnByaWNlKSB7XG4gICAgICAgICAgcmVzdWx0ICs9IGDwn5KwICoqUHJpY2UqKjogJHt0aGlzLmNsaWVudC5mb3JtYXRQcmljZShwcm9kdWN0LnByaWNlLCBkb21haW4pfVxcbmA7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIGlmIChwcm9kdWN0LnJhdGluZyAmJiBwcm9kdWN0LnJldmlld0NvdW50KSB7XG4gICAgICAgICAgcmVzdWx0ICs9IGDirZAgKipSYXRpbmcqKjogJHtwcm9kdWN0LnJhdGluZ30vNS4wICgke3Byb2R1Y3QucmV2aWV3Q291bnQudG9Mb2NhbGVTdHJpbmcoKX0gcmV2aWV3cylcXG5gO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICByZXN1bHQgKz0gYPCfmpogKipQcmltZSoqOiAke3Byb2R1Y3QuaXNQcmltZSA/ICdZZXMnIDogJ05vJ31cXG5gO1xuICAgICAgICByZXN1bHQgKz0gJ1xcbic7XG4gICAgICB9KTtcblxuICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgcmV0dXJuIGBFcnJvciBnZXR0aW5nIGJlc3Qgc2VsbGVyczogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJ31gO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGdldFByaWNlSGlzdG9yeShwYXJhbXM6IHouaW5mZXI8dHlwZW9mIFByaWNlSGlzdG9yeVNjaGVtYT4pOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBwcm9kdWN0ID0gYXdhaXQgdGhpcy5jbGllbnQuZ2V0UHJvZHVjdEJ5QXNpbihcbiAgICAgICAgcGFyYW1zLmFzaW4sXG4gICAgICAgIHBhcmFtcy5kb21haW4gYXMgS2VlcGFEb21haW4sXG4gICAgICAgIHtcbiAgICAgICAgICBkYXlzOiBwYXJhbXMuZGF5cyxcbiAgICAgICAgICBoaXN0b3J5OiB0cnVlLFxuICAgICAgICB9XG4gICAgICApO1xuXG4gICAgICBpZiAoIXByb2R1Y3QgfHwgIXByb2R1Y3QuY3N2KSB7XG4gICAgICAgIHJldHVybiBgTm8gcHJpY2UgaGlzdG9yeSBmb3VuZCBmb3IgQVNJTjogJHtwYXJhbXMuYXNpbn1gO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBwcmljZURhdGEgPSB0aGlzLmNsaWVudC5wYXJzZUNTVkRhdGEocHJvZHVjdC5jc3YsIHBhcmFtcy5kYXRhVHlwZSk7XG4gICAgICBcbiAgICAgIGlmIChwcmljZURhdGEubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIHJldHVybiBgTm8gZGF0YSBhdmFpbGFibGUgZm9yIHRoZSBzcGVjaWZpZWQgZGF0YSB0eXBlICgke3BhcmFtcy5kYXRhVHlwZX0pYDtcbiAgICAgIH1cblxuICAgICAgY29uc3QgZG9tYWluID0gcGFyYW1zLmRvbWFpbiBhcyBLZWVwYURvbWFpbjtcbiAgICAgIGNvbnN0IGRvbWFpbk5hbWUgPSB0aGlzLmNsaWVudC5nZXREb21haW5OYW1lKGRvbWFpbik7XG4gICAgICBcbiAgICAgIGNvbnN0IGRhdGFUeXBlTmFtZXM6IFJlY29yZDxudW1iZXIsIHN0cmluZz4gPSB7XG4gICAgICAgIFtLZWVwYURhdGFUeXBlLkFNQVpPTl06ICdBbWF6b24gUHJpY2UnLFxuICAgICAgICBbS2VlcGFEYXRhVHlwZS5ORVddOiAnTmV3IFByaWNlJyxcbiAgICAgICAgW0tlZXBhRGF0YVR5cGUuVVNFRF06ICdVc2VkIFByaWNlJyxcbiAgICAgICAgW0tlZXBhRGF0YVR5cGUuU0FMRVNfUkFOS106ICdTYWxlcyBSYW5rJyxcbiAgICAgICAgW0tlZXBhRGF0YVR5cGUuUkFUSU5HXTogJ1JhdGluZycsXG4gICAgICAgIFtLZWVwYURhdGFUeXBlLkNPVU5UX1JFVklFV1NdOiAnUmV2aWV3IENvdW50JyxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGRhdGFUeXBlTmFtZSA9IGRhdGFUeXBlTmFtZXNbcGFyYW1zLmRhdGFUeXBlXSB8fCBgRGF0YSBUeXBlICR7cGFyYW1zLmRhdGFUeXBlfWA7XG4gICAgICBcbiAgICAgIGxldCByZXN1bHQgPSBgKipQcmljZSBIaXN0b3J5IGZvciAke3BhcmFtcy5hc2lufSoqXFxuXFxuYDtcbiAgICAgIHJlc3VsdCArPSBg8J+PqiAqKk1hcmtldHBsYWNlKio6ICR7ZG9tYWluTmFtZX1cXG5gO1xuICAgICAgcmVzdWx0ICs9IGDwn5OKICoqRGF0YSBUeXBlKio6ICR7ZGF0YVR5cGVOYW1lfVxcbmA7XG4gICAgICByZXN1bHQgKz0gYPCfk4UgKipQZXJpb2QqKjogTGFzdCAke3BhcmFtcy5kYXlzfSBkYXlzXFxuYDtcbiAgICAgIHJlc3VsdCArPSBg8J+TiCAqKkRhdGEgUG9pbnRzKio6ICR7cHJpY2VEYXRhLmxlbmd0aH1cXG5cXG5gO1xuXG4gICAgICBpZiAocHJpY2VEYXRhLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY29uc3QgbGF0ZXN0ID0gcHJpY2VEYXRhW3ByaWNlRGF0YS5sZW5ndGggLSAxXTtcbiAgICAgICAgY29uc3Qgb2xkZXN0ID0gcHJpY2VEYXRhWzBdO1xuICAgICAgICBcbiAgICAgICAgcmVzdWx0ICs9IGAqKkxhdGVzdCBWYWx1ZSoqOiBgO1xuICAgICAgICBpZiAocGFyYW1zLmRhdGFUeXBlIDw9IDIgfHwgcGFyYW1zLmRhdGFUeXBlID09PSAxOCkge1xuICAgICAgICAgIHJlc3VsdCArPSBgJHt0aGlzLmNsaWVudC5mb3JtYXRQcmljZShsYXRlc3QudmFsdWUsIGRvbWFpbil9XFxuYDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXN1bHQgKz0gYCR7bGF0ZXN0LnZhbHVlLnRvTG9jYWxlU3RyaW5nKCl9XFxuYDtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgcmVzdWx0ICs9IGAqKkRhdGUqKjogJHtuZXcgRGF0ZShsYXRlc3QudGltZXN0YW1wKS50b0xvY2FsZURhdGVTdHJpbmcoKX1cXG5cXG5gO1xuICAgICAgICBcbiAgICAgICAgaWYgKHBhcmFtcy5kYXRhVHlwZSA8PSAyIHx8IHBhcmFtcy5kYXRhVHlwZSA9PT0gMTgpIHtcbiAgICAgICAgICBjb25zdCBwcmljZXMgPSBwcmljZURhdGEubWFwKGQgPT4gZC52YWx1ZSkuZmlsdGVyKHYgPT4gdiA+IDApO1xuICAgICAgICAgIGlmIChwcmljZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgY29uc3QgbWluID0gTWF0aC5taW4oLi4ucHJpY2VzKTtcbiAgICAgICAgICAgIGNvbnN0IG1heCA9IE1hdGgubWF4KC4uLnByaWNlcyk7XG4gICAgICAgICAgICBjb25zdCBhdmcgPSBwcmljZXMucmVkdWNlKChzdW0sIHByaWNlKSA9PiBzdW0gKyBwcmljZSwgMCkgLyBwcmljZXMubGVuZ3RoO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXN1bHQgKz0gYCoqUHJpY2UgU3RhdGlzdGljcyoqOlxcbmA7XG4gICAgICAgICAgICByZXN1bHQgKz0gYOKAoiBNaW5pbXVtOiAke3RoaXMuY2xpZW50LmZvcm1hdFByaWNlKG1pbiwgZG9tYWluKX1cXG5gO1xuICAgICAgICAgICAgcmVzdWx0ICs9IGDigKIgTWF4aW11bTogJHt0aGlzLmNsaWVudC5mb3JtYXRQcmljZShtYXgsIGRvbWFpbil9XFxuYDtcbiAgICAgICAgICAgIHJlc3VsdCArPSBg4oCiIEF2ZXJhZ2U6ICR7dGhpcy5jbGllbnQuZm9ybWF0UHJpY2UoTWF0aC5yb3VuZChhdmcpLCBkb21haW4pfVxcblxcbmA7XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmVzdWx0ICs9IGAqKlJlY2VudCBIaXN0b3J5KiogKGxhc3QgMTAgZGF0YSBwb2ludHMpOlxcbmA7XG4gICAgICAgIGNvbnN0IHJlY2VudERhdGEgPSBwcmljZURhdGEuc2xpY2UoLTEwKTtcbiAgICAgICAgcmVjZW50RGF0YS5mb3JFYWNoKChwb2ludCwgaSkgPT4ge1xuICAgICAgICAgIGNvbnN0IGRhdGUgPSBuZXcgRGF0ZShwb2ludC50aW1lc3RhbXApLnRvTG9jYWxlRGF0ZVN0cmluZygpO1xuICAgICAgICAgIGxldCB2YWx1ZTogc3RyaW5nO1xuICAgICAgICAgIFxuICAgICAgICAgIGlmIChwYXJhbXMuZGF0YVR5cGUgPD0gMiB8fCBwYXJhbXMuZGF0YVR5cGUgPT09IDE4KSB7XG4gICAgICAgICAgICB2YWx1ZSA9IHRoaXMuY2xpZW50LmZvcm1hdFByaWNlKHBvaW50LnZhbHVlLCBkb21haW4pO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB2YWx1ZSA9IHBvaW50LnZhbHVlLnRvTG9jYWxlU3RyaW5nKCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIFxuICAgICAgICAgIHJlc3VsdCArPSBgJHtyZWNlbnREYXRhLmxlbmd0aCAtIGl9LiAke2RhdGV9OiAke3ZhbHVlfVxcbmA7XG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICByZXR1cm4gYEVycm9yIGdldHRpbmcgcHJpY2UgaGlzdG9yeTogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJ31gO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGZpbmRQcm9kdWN0cyhwYXJhbXM6IHouaW5mZXI8dHlwZW9mIFByb2R1Y3RGaW5kZXJTY2hlbWE+KTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgZG9tYWluID0gcGFyYW1zLmRvbWFpbiBhcyBLZWVwYURvbWFpbjtcbiAgICAgIGNvbnN0IGRvbWFpbk5hbWUgPSB0aGlzLmNsaWVudC5nZXREb21haW5OYW1lKGRvbWFpbik7XG4gICAgICBcbiAgICAgIGxldCByZXN1bHQgPSBgKipBbWF6b24gUHJvZHVjdCBGaW5kZXIgUmVzdWx0cyoqXFxuXFxuYDtcbiAgICAgIHJlc3VsdCArPSBg8J+PqiAqKk1hcmtldHBsYWNlKio6ICR7ZG9tYWluTmFtZX1cXG5gO1xuICAgICAgcmVzdWx0ICs9IGDwn5SNICoqU2VhcmNoIENyaXRlcmlhKio6XFxuYDtcbiAgICAgIFxuICAgICAgaWYgKHBhcmFtcy5jYXRlZ29yeUlkKSB7XG4gICAgICAgIHJlc3VsdCArPSBg4oCiIENhdGVnb3J5OiAke3BhcmFtcy5jYXRlZ29yeUlkfVxcbmA7XG4gICAgICB9XG4gICAgICBpZiAocGFyYW1zLm1pblJhdGluZyB8fCBwYXJhbXMubWF4UmF0aW5nKSB7XG4gICAgICAgIGNvbnN0IG1pbiA9IHBhcmFtcy5taW5SYXRpbmcgfHwgMTtcbiAgICAgICAgY29uc3QgbWF4ID0gcGFyYW1zLm1heFJhdGluZyB8fCA1O1xuICAgICAgICByZXN1bHQgKz0gYOKAoiBSYXRpbmc6ICR7bWlufS0ke21heH0gc3RhcnNcXG5gO1xuICAgICAgfVxuICAgICAgaWYgKHBhcmFtcy5taW5QcmljZSB8fCBwYXJhbXMubWF4UHJpY2UpIHtcbiAgICAgICAgY29uc3QgbWluID0gcGFyYW1zLm1pblByaWNlID8gdGhpcy5jbGllbnQuZm9ybWF0UHJpY2UocGFyYW1zLm1pblByaWNlLCBkb21haW4pIDogJ0FueSc7XG4gICAgICAgIGNvbnN0IG1heCA9IHBhcmFtcy5tYXhQcmljZSA/IHRoaXMuY2xpZW50LmZvcm1hdFByaWNlKHBhcmFtcy5tYXhQcmljZSwgZG9tYWluKSA6ICdBbnknO1xuICAgICAgICByZXN1bHQgKz0gYOKAoiBQcmljZTogJHttaW59IC0gJHttYXh9XFxuYDtcbiAgICAgIH1cbiAgICAgIGlmIChwYXJhbXMubWluU2hpcHBpbmcgfHwgcGFyYW1zLm1heFNoaXBwaW5nKSB7XG4gICAgICAgIGNvbnN0IG1pbiA9IHBhcmFtcy5taW5TaGlwcGluZyA/IHRoaXMuY2xpZW50LmZvcm1hdFByaWNlKHBhcmFtcy5taW5TaGlwcGluZywgZG9tYWluKSA6ICdBbnknO1xuICAgICAgICBjb25zdCBtYXggPSBwYXJhbXMubWF4U2hpcHBpbmcgPyB0aGlzLmNsaWVudC5mb3JtYXRQcmljZShwYXJhbXMubWF4U2hpcHBpbmcsIGRvbWFpbikgOiAnQW55JztcbiAgICAgICAgcmVzdWx0ICs9IGDigKIgU2hpcHBpbmc6ICR7bWlufSAtICR7bWF4fVxcbmA7XG4gICAgICB9XG4gICAgICBpZiAocGFyYW1zLm1pbk1vbnRobHlTYWxlcyB8fCBwYXJhbXMubWF4TW9udGhseVNhbGVzKSB7XG4gICAgICAgIGNvbnN0IG1pbiA9IHBhcmFtcy5taW5Nb250aGx5U2FsZXM/LnRvTG9jYWxlU3RyaW5nKCkgfHwgJ0FueSc7XG4gICAgICAgIGNvbnN0IG1heCA9IHBhcmFtcy5tYXhNb250aGx5U2FsZXM/LnRvTG9jYWxlU3RyaW5nKCkgfHwgJ0FueSc7XG4gICAgICAgIHJlc3VsdCArPSBg4oCiIE1vbnRobHkgU2FsZXM6ICR7bWlufSAtICR7bWF4fVxcbmA7XG4gICAgICB9XG4gICAgICBpZiAocGFyYW1zLm1pblNlbGxlckNvdW50IHx8IHBhcmFtcy5tYXhTZWxsZXJDb3VudCkge1xuICAgICAgICBjb25zdCBtaW4gPSBwYXJhbXMubWluU2VsbGVyQ291bnQgfHwgJ0FueSc7XG4gICAgICAgIGNvbnN0IG1heCA9IHBhcmFtcy5tYXhTZWxsZXJDb3VudCB8fCAnQW55JztcbiAgICAgICAgY29uc3QgdGltZWZyYW1lRGVzYyA9IHBhcmFtcy5zZWxsZXJDb3VudFRpbWVmcmFtZSA9PT0gJzkwZGF5JyA/ICc5MC1kYXkgYXZlcmFnZScgOiBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcGFyYW1zLnNlbGxlckNvdW50VGltZWZyYW1lID09PSAnY3VycmVudCcgPyAnY3VycmVudCcgOlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYXJhbXMuc2VsbGVyQ291bnRUaW1lZnJhbWUgPT09ICczMGRheScgPyAnMzAtZGF5IGF2ZXJhZ2UnIDpcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcGFyYW1zLnNlbGxlckNvdW50VGltZWZyYW1lID09PSAnMTgwZGF5JyA/ICcxODAtZGF5IGF2ZXJhZ2UnIDpcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJzM2NS1kYXkgYXZlcmFnZSc7XG4gICAgICAgIHJlc3VsdCArPSBg4oCiIFNlbGxlciBDb3VudDogJHttaW59IC0gJHttYXh9ICgke3RpbWVmcmFtZURlc2N9KVxcbmA7XG4gICAgICB9XG4gICAgICBpZiAocGFyYW1zLmlzUHJpbWUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICByZXN1bHQgKz0gYOKAoiBQcmltZSBPbmx5OiAke3BhcmFtcy5pc1ByaW1lID8gJ1llcycgOiAnTm8nfVxcbmA7XG4gICAgICB9XG4gICAgICBpZiAocGFyYW1zLmhhc1Jldmlld3MgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICByZXN1bHQgKz0gYOKAoiBIYXMgUmV2aWV3czogJHtwYXJhbXMuaGFzUmV2aWV3cyA/ICdZZXMnIDogJ05vJ31cXG5gO1xuICAgICAgfVxuICAgICAgXG4gICAgICByZXN1bHQgKz0gYOKAoiBTb3J0OiAke3BhcmFtcy5zb3J0Qnl9ICgke3BhcmFtcy5zb3J0T3JkZXJ9KVxcblxcbmA7XG5cbiAgICAgIC8vIE1ha2UgcmVhbCBBUEkgY2FsbCB0byBLZWVwYVxuICAgICAgY29uc3QgcHJvZHVjdHMgPSBhd2FpdCB0aGlzLmNsaWVudC5zZWFyY2hQcm9kdWN0cyhwYXJhbXMpO1xuICAgICAgXG4gICAgICBpZiAocHJvZHVjdHMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIHJlc3VsdCArPSBg4p2MICoqTm8gcHJvZHVjdHMgZm91bmQqKiBtYXRjaGluZyB5b3VyIGNyaXRlcmlhLlxcblxcbmA7XG4gICAgICAgIHJlc3VsdCArPSBgKipTdWdnZXN0aW9uczoqKlxcbmA7XG4gICAgICAgIHJlc3VsdCArPSBg4oCiIFRyeSB3aWRlbmluZyB5b3VyIHByaWNlIHJhbmdlXFxuYDtcbiAgICAgICAgcmVzdWx0ICs9IGDigKIgUmVkdWNlIG1pbmltdW0gcmF0aW5nIHJlcXVpcmVtZW50c1xcbmA7XG4gICAgICAgIHJlc3VsdCArPSBg4oCiIFJlbW92ZSBjYXRlZ29yeSByZXN0cmljdGlvbnNcXG5gO1xuICAgICAgICByZXN1bHQgKz0gYOKAoiBBZGp1c3QgbW9udGhseSBzYWxlcyB0aHJlc2hvbGRzXFxuYDtcbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgIH1cblxuICAgICAgcmVzdWx0ICs9IGDwn5OKICoqRm91bmQgJHtwcm9kdWN0cy5sZW5ndGh9IHByb2R1Y3RzKiogKFBhZ2UgJHtwYXJhbXMucGFnZSArIDF9KTpcXG5cXG5gO1xuXG4gICAgICBwcm9kdWN0cy5mb3JFYWNoKChwcm9kdWN0OiBhbnksIGk6IG51bWJlcikgPT4ge1xuICAgICAgICBjb25zdCByYW5rID0gcGFyYW1zLnBhZ2UgKiBwYXJhbXMucGVyUGFnZSArIGkgKyAxO1xuICAgICAgICBjb25zdCB0aXRsZSA9IHByb2R1Y3QudGl0bGUgfHwgcHJvZHVjdC5wcm9kdWN0VGl0bGUgfHwgJ1Vua25vd24gUHJvZHVjdCc7XG4gICAgICAgIGNvbnN0IG1vbnRobHlTb2xkID0gcHJvZHVjdC5tb250aGx5U29sZCB8fCBwcm9kdWN0LnN0YXRzPy5tb250aGx5U29sZCB8fCAwO1xuICAgICAgICBjb25zdCByYXRpbmcgPSBwcm9kdWN0LnN0YXRzPy5jdXJyZW50X1JBVElORyA/IHByb2R1Y3Quc3RhdHMuY3VycmVudF9SQVRJTkcgLyAxMCA6IHByb2R1Y3QucmF0aW5nO1xuICAgICAgICBjb25zdCByZXZpZXdDb3VudCA9IHByb2R1Y3Quc3RhdHM/LmN1cnJlbnRfQ09VTlRfUkVWSUVXUyB8fCBwcm9kdWN0LnJldmlld0NvdW50O1xuICAgICAgICBjb25zdCBwcmljZSA9IHByb2R1Y3Quc3RhdHM/LmN1cnJlbnRfQU1BWk9OIHx8IHByb2R1Y3QucHJpY2U7XG4gICAgICAgIGNvbnN0IHNoaXBwaW5nID0gcHJvZHVjdC5zdGF0cz8uY3VycmVudF9CVVlfQk9YX1NISVBQSU5HIHx8IHByb2R1Y3Quc2hpcHBpbmc7XG4gICAgICAgIGNvbnN0IHNhbGVzUmFuayA9IHByb2R1Y3Quc3RhdHM/LmN1cnJlbnRfU0FMRVMgfHwgcHJvZHVjdC5zYWxlc1Jhbms7XG4gICAgICAgIGNvbnN0IHNlbGxlckluZm8gPSB0aGlzLmNsaWVudC5nZXRTZWxsZXJDb3VudChwcm9kdWN0LCBwYXJhbXMuc2VsbGVyQ291bnRUaW1lZnJhbWUpO1xuICAgICAgICBjb25zdCBzZWxsZXJDb3VudCA9IHNlbGxlckluZm8uY291bnQ7XG4gICAgICAgIFxuICAgICAgICAvLyBEZXRlcm1pbmUgY29tcGV0aXRpb24gbGV2ZWxcbiAgICAgICAgbGV0IGNvbXBldGl0aW9uID0gJ01lZGl1bSc7XG4gICAgICAgIGlmIChzZWxsZXJDb3VudCA8PSAzKSBjb21wZXRpdGlvbiA9ICdMb3cnO1xuICAgICAgICBlbHNlIGlmIChzZWxsZXJDb3VudCA+PSAxMCkgY29tcGV0aXRpb24gPSAnSGlnaCc7XG4gICAgICAgIFxuICAgICAgICByZXN1bHQgKz0gYCoqJHtyYW5rfS4gJHtwcm9kdWN0LmFzaW59KiogJHtjb21wZXRpdGlvbiA9PT0gJ0xvdycgPyAn8J+foicgOiBjb21wZXRpdGlvbiA9PT0gJ01lZGl1bScgPyAn8J+foScgOiAn8J+UtCd9XFxuYDtcbiAgICAgICAgcmVzdWx0ICs9IGDwn5OmICoqJHt0aXRsZX0qKlxcbmA7XG4gICAgICAgIFxuICAgICAgICBpZiAocHJvZHVjdC5icmFuZCkge1xuICAgICAgICAgIHJlc3VsdCArPSBg8J+Pt++4jyBCcmFuZDogJHtwcm9kdWN0LmJyYW5kfVxcbmA7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIGlmIChwcmljZSAmJiBwcmljZSA+IDApIHtcbiAgICAgICAgICByZXN1bHQgKz0gYPCfkrAgKipQcmljZSoqOiAke3RoaXMuY2xpZW50LmZvcm1hdFByaWNlKHByaWNlLCBkb21haW4pfWA7XG4gICAgICAgICAgaWYgKHNoaXBwaW5nICYmIHNoaXBwaW5nID4gMCkge1xuICAgICAgICAgICAgcmVzdWx0ICs9IGAgKyAke3RoaXMuY2xpZW50LmZvcm1hdFByaWNlKHNoaXBwaW5nLCBkb21haW4pfSBzaGlwcGluZ2A7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJlc3VsdCArPSAnXFxuJztcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgaWYgKHJhdGluZyAmJiByZXZpZXdDb3VudCkge1xuICAgICAgICAgIHJlc3VsdCArPSBg4q2QICoqUmF0aW5nKio6ICR7cmF0aW5nLnRvRml4ZWQoMSl9LzUuMCAoJHtyZXZpZXdDb3VudC50b0xvY2FsZVN0cmluZygpfSByZXZpZXdzKVxcbmA7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIGlmIChtb250aGx5U29sZCAmJiBtb250aGx5U29sZCA+IDApIHtcbiAgICAgICAgICByZXN1bHQgKz0gYPCfk4ggKipNb250aGx5IFNhbGVzKio6IH4ke21vbnRobHlTb2xkLnRvTG9jYWxlU3RyaW5nKCl9IHVuaXRzXFxuYDtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgaWYgKHNhbGVzUmFuaykge1xuICAgICAgICAgIHJlc3VsdCArPSBg8J+TiiAqKlNhbGVzIFJhbmsqKjogIyR7c2FsZXNSYW5rLnRvTG9jYWxlU3RyaW5nKCl9XFxuYDtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgcmVzdWx0ICs9IGDwn4+qICoqU2VsbGVycyoqOiAke3NlbGxlckNvdW50fSAoJHtzZWxsZXJJbmZvLmRlc2NyaXB0aW9ufSlcXG5gO1xuICAgICAgICBcbiAgICAgICAgaWYgKHByb2R1Y3QuaXNQcmltZSkge1xuICAgICAgICAgIHJlc3VsdCArPSBg4pqhICoqUHJpbWUgRWxpZ2libGUqKlxcbmA7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIC8vIENhbGN1bGF0ZSBlc3RpbWF0ZWQgcHJvZml0IG1hcmdpblxuICAgICAgICBpZiAocHJpY2UgJiYgcHJpY2UgPiAxMDAwKSB7XG4gICAgICAgICAgY29uc3QgZXN0aW1hdGVkTWFyZ2luID0gTWF0aC5tYXgoMTUsIE1hdGgubWluKDQwLCAzMCAtIChzZWxsZXJDb3VudCAqIDIpKSk7XG4gICAgICAgICAgcmVzdWx0ICs9IGDwn5K5ICoqRXN0LiBQcm9maXQgTWFyZ2luKio6ICR7ZXN0aW1hdGVkTWFyZ2lufSVcXG5gO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICByZXN1bHQgKz0gYPCfjq8gKipDb21wZXRpdGlvbioqOiAke2NvbXBldGl0aW9ufVxcblxcbmA7XG4gICAgICB9KTtcblxuICAgICAgcmVzdWx0ICs9IGAqKvCfkqEgUHJvIFRpcHM6KipcXG5gO1xuICAgICAgcmVzdWx0ICs9IGDigKIgR3JlZW4gZG90cyAo8J+foikgaW5kaWNhdGUgbG93IGNvbXBldGl0aW9uIG9wcG9ydHVuaXRpZXNcXG5gO1xuICAgICAgcmVzdWx0ICs9IGDigKIgSGlnaCBtb250aGx5IHNhbGVzICsgbG93IGNvbXBldGl0aW9uID0gcG90ZW50aWFsIGdvbGRtaW5lXFxuYDtcbiAgICAgIHJlc3VsdCArPSBg4oCiIENoZWNrIHJldmlldyB2ZWxvY2l0eSBhbmQgbGlzdGluZyBxdWFsaXR5IGJlZm9yZSBwcm9jZWVkaW5nXFxuYDtcbiAgICAgIHJlc3VsdCArPSBg4oCiIFVzZSBwcmljZSBoaXN0b3J5IHRvb2wgZm9yIGRlZXBlciBtYXJrZXQgYW5hbHlzaXNcXG5gO1xuXG4gICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdQcm9kdWN0IGZpbmRlciBlcnJvcjonLCBlcnJvcik7XG4gICAgICBjb25zdCBlcnJvck1lc3NhZ2UgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFxuICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlb2YgZXJyb3IgPT09ICdzdHJpbmcnID8gZXJyb3IgOiBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgSlNPTi5zdHJpbmdpZnkoZXJyb3IpO1xuICAgICAgcmV0dXJuIGBFcnJvciBpbiBwcm9kdWN0IGZpbmRlcjogJHtlcnJvck1lc3NhZ2V9YDtcbiAgICB9XG4gIH1cblxuXG4gIGFzeW5jIGFuYWx5emVDYXRlZ29yeShwYXJhbXM6IHouaW5mZXI8dHlwZW9mIENhdGVnb3J5QW5hbHlzaXNTY2hlbWE+KTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgZG9tYWluID0gcGFyYW1zLmRvbWFpbiBhcyBLZWVwYURvbWFpbjtcbiAgICAgIGNvbnN0IGRvbWFpbk5hbWUgPSB0aGlzLmNsaWVudC5nZXREb21haW5OYW1lKGRvbWFpbik7XG4gICAgICBcbiAgICAgIGxldCByZXN1bHQgPSBgKirwn5OKIENhdGVnb3J5IEFuYWx5c2lzIFJlcG9ydCoqXFxuXFxuYDtcbiAgICAgIHJlc3VsdCArPSBg8J+PqiAqKk1hcmtldHBsYWNlKio6ICR7ZG9tYWluTmFtZX1cXG5gO1xuICAgICAgcmVzdWx0ICs9IGDwn4+377iPICoqQ2F0ZWdvcnkqKjogSUQgJHtwYXJhbXMuY2F0ZWdvcnlJZH1cXG5gO1xuICAgICAgcmVzdWx0ICs9IGDwn5OIICoqQW5hbHlzaXMgVHlwZSoqOiAke3BhcmFtcy5hbmFseXNpc1R5cGUuY2hhckF0KDApLnRvVXBwZXJDYXNlKCkgKyBwYXJhbXMuYW5hbHlzaXNUeXBlLnNsaWNlKDEpLnJlcGxhY2UoJ18nLCAnICcpfVxcbmA7XG4gICAgICByZXN1bHQgKz0gYOKPse+4jyAqKlRpbWVmcmFtZSoqOiAke3BhcmFtcy50aW1lZnJhbWV9XFxuXFxuYDtcblxuICAgICAgLy8gR2V0IHJlYWwgZGF0YSBiYXNlZCBvbiBhbmFseXNpcyB0eXBlXG4gICAgICBzd2l0Y2ggKHBhcmFtcy5hbmFseXNpc1R5cGUpIHtcbiAgICAgICAgY2FzZSAnb3ZlcnZpZXcnOlxuICAgICAgICAgIHJlc3VsdCArPSBhd2FpdCB0aGlzLmdldENhdGVnb3J5T3ZlcnZpZXcocGFyYW1zLCBkb21haW4pO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlICd0b3BfcGVyZm9ybWVycyc6XG4gICAgICAgICAgcmVzdWx0ICs9IGF3YWl0IHRoaXMuZ2V0VG9wUGVyZm9ybWVycyhwYXJhbXMsIGRvbWFpbik7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgJ29wcG9ydHVuaXRpZXMnOlxuICAgICAgICAgIHJlc3VsdCArPSBhd2FpdCB0aGlzLmdldE9wcG9ydHVuaXRpZXMocGFyYW1zLCBkb21haW4pO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlICd0cmVuZHMnOlxuICAgICAgICAgIHJlc3VsdCArPSBhd2FpdCB0aGlzLmdldFRyZW5kcyhwYXJhbXMsIGRvbWFpbik7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0NhdGVnb3J5IGFuYWx5c2lzIGVycm9yOicsIGVycm9yKTtcbiAgICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGVvZiBlcnJvciA9PT0gJ3N0cmluZycgPyBlcnJvciA6IFxuICAgICAgICAgICAgICAgICAgICAgICAgICBKU09OLnN0cmluZ2lmeShlcnJvcik7XG4gICAgICByZXR1cm4gYEVycm9yIGFuYWx5emluZyBjYXRlZ29yeTogJHtlcnJvck1lc3NhZ2V9YDtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGdldENhdGVnb3J5T3ZlcnZpZXcocGFyYW1zOiB6LmluZmVyPHR5cGVvZiBDYXRlZ29yeUFuYWx5c2lzU2NoZW1hPiwgZG9tYWluOiBLZWVwYURvbWFpbik6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgLy8gR2V0IGJlc3Qgc2VsbGVycyBmb3Igb3ZlcnZpZXdcbiAgICBjb25zdCBiZXN0U2VsbGVycyA9IGF3YWl0IHRoaXMuY2xpZW50LmdldEJlc3RTZWxsZXJzKHtcbiAgICAgIGRvbWFpbjogcGFyYW1zLmRvbWFpbixcbiAgICAgIGNhdGVnb3J5OiBwYXJhbXMuY2F0ZWdvcnlJZCxcbiAgICAgIHBhZ2U6IDBcbiAgICB9KTtcblxuICAgIC8vIEdldCBzb21lIHByb2R1Y3RzIGZyb20gdGhlIGNhdGVnb3J5IHVzaW5nIHNlYXJjaFxuICAgIGNvbnN0IGNhdGVnb3J5UHJvZHVjdHMgPSBhd2FpdCB0aGlzLmNsaWVudC5zZWFyY2hQcm9kdWN0cyh7XG4gICAgICBkb21haW46IHBhcmFtcy5kb21haW4sXG4gICAgICBjYXRlZ29yeUlkOiBwYXJhbXMuY2F0ZWdvcnlJZCxcbiAgICAgIG1pblJhdGluZzogcGFyYW1zLm1pblJhdGluZyxcbiAgICAgIHBlclBhZ2U6IDIwLFxuICAgICAgc29ydEJ5OiAnbW9udGhseVNvbGQnXG4gICAgfSk7XG5cbiAgICBsZXQgcmVzdWx0ID0gYCoq8J+TiCBDYXRlZ29yeSBPdmVydmlldyoqXFxuXFxuYDtcbiAgICBcbiAgICBpZiAoYmVzdFNlbGxlcnMubGVuZ3RoID4gMCkge1xuICAgICAgcmVzdWx0ICs9IGDwn4+GICoqQmVzdCBTZWxsZXJzKio6ICR7YmVzdFNlbGxlcnMubGVuZ3RofSBwcm9kdWN0cyBmb3VuZFxcbmA7XG4gICAgICByZXN1bHQgKz0gYPCfkrAgKipQcmljZSBSYW5nZSoqOiAke3RoaXMuY2xpZW50LmZvcm1hdFByaWNlKFxuICAgICAgICBNYXRoLm1pbiguLi5iZXN0U2VsbGVycy5maWx0ZXIocCA9PiBwLnByaWNlKS5tYXAocCA9PiBwLnByaWNlISkpLFxuICAgICAgICBkb21haW5cbiAgICAgICl9IC0gJHt0aGlzLmNsaWVudC5mb3JtYXRQcmljZShcbiAgICAgICAgTWF0aC5tYXgoLi4uYmVzdFNlbGxlcnMuZmlsdGVyKHAgPT4gcC5wcmljZSkubWFwKHAgPT4gcC5wcmljZSEpKSxcbiAgICAgICAgZG9tYWluXG4gICAgICApfVxcbmA7XG4gICAgfVxuICAgIFxuICAgIGlmIChjYXRlZ29yeVByb2R1Y3RzLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IGF2Z1JhdGluZyA9IGNhdGVnb3J5UHJvZHVjdHNcbiAgICAgICAgLmZpbHRlcihwID0+IHAuc3RhdHM/LmN1cnJlbnRfUkFUSU5HKVxuICAgICAgICAucmVkdWNlKChzdW0sIHApID0+IHN1bSArIChwLnN0YXRzIS5jdXJyZW50X1JBVElORyEgLyAxMCksIDApIC8gY2F0ZWdvcnlQcm9kdWN0cy5sZW5ndGg7XG4gICAgICBcbiAgICAgIHJlc3VsdCArPSBg4q2QICoqQXZlcmFnZSBSYXRpbmcqKjogJHthdmdSYXRpbmcudG9GaXhlZCgxKX0vNS4wXFxuYDtcbiAgICAgIHJlc3VsdCArPSBg8J+TiiAqKlNhbXBsZSBTaXplKio6ICR7Y2F0ZWdvcnlQcm9kdWN0cy5sZW5ndGh9IHByb2R1Y3RzIGFuYWx5emVkXFxuXFxuYDtcbiAgICB9XG5cbiAgICByZXN1bHQgKz0gYCoq8J+OryBNYXJrZXQgSW5zaWdodHM6KipcXG5gO1xuICAgIHJlc3VsdCArPSBg4oCiIENhdGVnb3J5IHNob3dzICR7Y2F0ZWdvcnlQcm9kdWN0cy5sZW5ndGggPiAxNSA/ICdoaWdoJyA6IGNhdGVnb3J5UHJvZHVjdHMubGVuZ3RoID4gOCA/ICdtb2RlcmF0ZScgOiAnbG93J30gcHJvZHVjdCBkaXZlcnNpdHlcXG5gO1xuICAgIHJlc3VsdCArPSBg4oCiIENvbXBldGl0aW9uIGxldmVsIGFwcGVhcnMgJHtiZXN0U2VsbGVycy5sZW5ndGggPiA1MCA/ICdoaWdoJyA6IGJlc3RTZWxsZXJzLmxlbmd0aCA+IDIwID8gJ21vZGVyYXRlJyA6ICdtYW5hZ2VhYmxlJ31cXG5gO1xuICAgIHJlc3VsdCArPSBg4oCiIFByaWNlIHBvaW50cyBzcGFuIG11bHRpcGxlIG1hcmtldCBzZWdtZW50c1xcblxcbmA7XG5cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBnZXRUb3BQZXJmb3JtZXJzKHBhcmFtczogei5pbmZlcjx0eXBlb2YgQ2F0ZWdvcnlBbmFseXNpc1NjaGVtYT4sIGRvbWFpbjogS2VlcGFEb21haW4pOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGNvbnN0IHRvcFByb2R1Y3RzID0gYXdhaXQgdGhpcy5jbGllbnQuc2VhcmNoUHJvZHVjdHMoe1xuICAgICAgZG9tYWluOiBwYXJhbXMuZG9tYWluLFxuICAgICAgY2F0ZWdvcnlJZDogcGFyYW1zLmNhdGVnb3J5SWQsXG4gICAgICBtaW5SYXRpbmc6IE1hdGgubWF4KDQuMCwgcGFyYW1zLm1pblJhdGluZyB8fCA0LjApLFxuICAgICAgc29ydEJ5OiAnbW9udGhseVNvbGQnLFxuICAgICAgc29ydE9yZGVyOiAnZGVzYycsXG4gICAgICBwZXJQYWdlOiAxMFxuICAgIH0pO1xuXG4gICAgbGV0IHJlc3VsdCA9IGAqKvCfj4YgVG9wIFBlcmZvcm1lcnMqKlxcblxcbmA7XG4gICAgXG4gICAgaWYgKHRvcFByb2R1Y3RzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgcmVzdWx0ICs9IGDinYwgTm8gdG9wIHBlcmZvcm1lcnMgZm91bmQgaW4gdGhpcyBjYXRlZ29yeS5cXG5cXG5gO1xuICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9XG5cbiAgICB0b3BQcm9kdWN0cy5mb3JFYWNoKChwcm9kdWN0OiBhbnksIGk6IG51bWJlcikgPT4ge1xuICAgICAgY29uc3QgdGl0bGUgPSBwcm9kdWN0LnRpdGxlIHx8IHByb2R1Y3QucHJvZHVjdFRpdGxlIHx8IGBQcm9kdWN0ICR7cHJvZHVjdC5hc2lufWA7XG4gICAgICBjb25zdCByYXRpbmcgPSBwcm9kdWN0LnN0YXRzPy5jdXJyZW50X1JBVElORyA/IHByb2R1Y3Quc3RhdHMuY3VycmVudF9SQVRJTkcgLyAxMCA6IDA7XG4gICAgICBjb25zdCBtb250aGx5U29sZCA9IHByb2R1Y3QubW9udGhseVNvbGQgfHwgMDtcbiAgICAgIGNvbnN0IHByaWNlID0gcHJvZHVjdC5zdGF0cz8uY3VycmVudF9BTUFaT04gfHwgMDtcbiAgICAgIFxuICAgICAgcmVzdWx0ICs9IGAqKiR7aSArIDF9LiAke3RpdGxlLnN1YnN0cmluZygwLCA1MCl9JHt0aXRsZS5sZW5ndGggPiA1MCA/ICcuLi4nIDogJyd9KipcXG5gO1xuICAgICAgcmVzdWx0ICs9IGDwn5OmIEFTSU46ICR7cHJvZHVjdC5hc2lufVxcbmA7XG4gICAgICBpZiAocmF0aW5nID4gMCkgcmVzdWx0ICs9IGDirZAgJHtyYXRpbmcudG9GaXhlZCgxKX0vNS4wXFxuYDtcbiAgICAgIGlmIChtb250aGx5U29sZCA+IDApIHJlc3VsdCArPSBg8J+TiCB+JHttb250aGx5U29sZC50b0xvY2FsZVN0cmluZygpfSBtb250aGx5IHNhbGVzXFxuYDtcbiAgICAgIGlmIChwcmljZSA+IDApIHJlc3VsdCArPSBg8J+SsCAke3RoaXMuY2xpZW50LmZvcm1hdFByaWNlKHByaWNlLCBkb21haW4pfVxcbmA7XG4gICAgICByZXN1bHQgKz0gYFxcbmA7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBnZXRPcHBvcnR1bml0aWVzKHBhcmFtczogei5pbmZlcjx0eXBlb2YgQ2F0ZWdvcnlBbmFseXNpc1NjaGVtYT4sIGRvbWFpbjogS2VlcGFEb21haW4pOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIC8vIExvb2sgZm9yIHByb2R1Y3RzIHdpdGggZ29vZCByYXRpbmdzIGJ1dCBsb3cgY29tcGV0aXRpb24gKGZldyBzZWxsZXJzKVxuICAgIGNvbnN0IG9wcG9ydHVuaXRpZXMgPSBhd2FpdCB0aGlzLmNsaWVudC5zZWFyY2hQcm9kdWN0cyh7XG4gICAgICBkb21haW46IHBhcmFtcy5kb21haW4sXG4gICAgICBjYXRlZ29yeUlkOiBwYXJhbXMuY2F0ZWdvcnlJZCxcbiAgICAgIG1pblJhdGluZzogNC4wLFxuICAgICAgbWF4U2VsbGVyQ291bnQ6IDUsIC8vIExvdyBjb21wZXRpdGlvblxuICAgICAgbWluTW9udGhseVNhbGVzOiA1MDAsIC8vIERlY2VudCBzYWxlc1xuICAgICAgc29ydEJ5OiAnbW9udGhseVNvbGQnLFxuICAgICAgc29ydE9yZGVyOiAnZGVzYycsXG4gICAgICBwZXJQYWdlOiAxNVxuICAgIH0pO1xuXG4gICAgbGV0IHJlc3VsdCA9IGAqKvCfjq8gTWFya2V0IE9wcG9ydHVuaXRpZXMqKlxcblxcbmA7XG4gICAgXG4gICAgaWYgKG9wcG9ydHVuaXRpZXMubGVuZ3RoID09PSAwKSB7XG4gICAgICByZXN1bHQgKz0gYOKdjCBObyBjbGVhciBvcHBvcnR1bml0aWVzIGZvdW5kIHdpdGggY3VycmVudCBjcml0ZXJpYS5cXG5gO1xuICAgICAgcmVzdWx0ICs9IGDwn5KhIFRyeSBleHBhbmRpbmcgc2VhcmNoIGNyaXRlcmlhIG9yIGV4cGxvcmluZyBzdWJjYXRlZ29yaWVzLlxcblxcbmA7XG4gICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH1cblxuICAgIHJlc3VsdCArPSBgRm91bmQgJHtvcHBvcnR1bml0aWVzLmxlbmd0aH0gcG90ZW50aWFsIG9wcG9ydHVuaXRpZXMgd2l0aCBsb3cgY29tcGV0aXRpb246XFxuXFxuYDtcblxuICAgIG9wcG9ydHVuaXRpZXMuc2xpY2UoMCwgOCkuZm9yRWFjaCgocHJvZHVjdDogYW55LCBpOiBudW1iZXIpID0+IHtcbiAgICAgIGNvbnN0IHRpdGxlID0gcHJvZHVjdC50aXRsZSB8fCBwcm9kdWN0LnByb2R1Y3RUaXRsZSB8fCBgUHJvZHVjdCAke3Byb2R1Y3QuYXNpbn1gO1xuICAgICAgY29uc3QgcmF0aW5nID0gcHJvZHVjdC5zdGF0cz8uY3VycmVudF9SQVRJTkcgPyBwcm9kdWN0LnN0YXRzLmN1cnJlbnRfUkFUSU5HIC8gMTAgOiAwO1xuICAgICAgY29uc3Qgc2VsbGVySW5mbyA9IHRoaXMuY2xpZW50LmdldFNlbGxlckNvdW50KHByb2R1Y3QsIHBhcmFtcy5zZWxsZXJDb3VudFRpbWVmcmFtZSk7XG4gICAgICBjb25zdCBzZWxsZXJDb3VudCA9IHNlbGxlckluZm8uY291bnQ7XG4gICAgICBjb25zdCBtb250aGx5U29sZCA9IHByb2R1Y3QubW9udGhseVNvbGQgfHwgMDtcbiAgICAgIFxuICAgICAgcmVzdWx0ICs9IGAqKiR7aSArIDF9LiAke3RpdGxlLnN1YnN0cmluZygwLCA0MCl9JHt0aXRsZS5sZW5ndGggPiA0MCA/ICcuLi4nIDogJyd9Kiog8J+folxcbmA7XG4gICAgICByZXN1bHQgKz0gYPCfk6YgJHtwcm9kdWN0LmFzaW59IHwg4q2QICR7cmF0aW5nLnRvRml4ZWQoMSl9IHwg8J+RpSAke3NlbGxlckNvdW50fSBzZWxsZXJzICgke3NlbGxlckluZm8uZGVzY3JpcHRpb259KSB8IPCfk4ggJHttb250aGx5U29sZH0gbW9udGhseVxcblxcbmA7XG4gICAgfSk7XG5cbiAgICByZXN1bHQgKz0gYCoq8J+SoSBPcHBvcnR1bml0eSBJbnNpZ2h0czoqKlxcbmA7XG4gICAgcmVzdWx0ICs9IGDigKIgTG93IHNlbGxlciBjb3VudCBpbmRpY2F0ZXMgbGVzcyBjb21wZXRpdGlvblxcbmA7XG4gICAgcmVzdWx0ICs9IGDigKIgR29vZCByYXRpbmdzIHN1Z2dlc3QgbWFya2V0IGFjY2VwdGFuY2VcXG5gO1xuICAgIHJlc3VsdCArPSBg4oCiIE1vbnRobHkgc2FsZXMgc2hvdyBwcm92ZW4gZGVtYW5kXFxuXFxuYDtcblxuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGdldFRyZW5kcyhwYXJhbXM6IHouaW5mZXI8dHlwZW9mIENhdGVnb3J5QW5hbHlzaXNTY2hlbWE+LCBkb21haW46IEtlZXBhRG9tYWluKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICAvLyBHZXQgcmVjZW50IHByb2R1Y3RzIGFuZCBiZXN0IHNlbGxlcnMgdG8gYW5hbHl6ZSB0cmVuZHNcbiAgICBjb25zdCByZWNlbnRQcm9kdWN0cyA9IGF3YWl0IHRoaXMuY2xpZW50LnNlYXJjaFByb2R1Y3RzKHtcbiAgICAgIGRvbWFpbjogcGFyYW1zLmRvbWFpbixcbiAgICAgIGNhdGVnb3J5SWQ6IHBhcmFtcy5jYXRlZ29yeUlkLFxuICAgICAgc29ydEJ5OiAnbW9udGhseVNvbGQnLFxuICAgICAgc29ydE9yZGVyOiAnZGVzYycsXG4gICAgICBwZXJQYWdlOiAyMFxuICAgIH0pO1xuXG4gICAgbGV0IHJlc3VsdCA9IGAqKvCfk4ogQ2F0ZWdvcnkgVHJlbmRzKipcXG5cXG5gO1xuICAgIFxuICAgIGlmIChyZWNlbnRQcm9kdWN0cy5sZW5ndGggPT09IDApIHtcbiAgICAgIHJlc3VsdCArPSBg4p2MIEluc3VmZmljaWVudCBkYXRhIGZvciB0cmVuZCBhbmFseXNpcy5cXG5cXG5gO1xuICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9XG5cbiAgICAvLyBBbmFseXplIHByaWNlIHRyZW5kc1xuICAgIGNvbnN0IHByaWNlcyA9IHJlY2VudFByb2R1Y3RzXG4gICAgICAuZmlsdGVyKHAgPT4gcC5zdGF0cz8uY3VycmVudF9BTUFaT04gJiYgcC5zdGF0cy5jdXJyZW50X0FNQVpPTiA+IDApXG4gICAgICAubWFwKHAgPT4gcC5zdGF0cyEuY3VycmVudF9BTUFaT04hKTtcbiAgICBcbiAgICBpZiAocHJpY2VzLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IGF2Z1ByaWNlID0gcHJpY2VzLnJlZHVjZSgoc3VtLCBwcmljZSkgPT4gc3VtICsgcHJpY2UsIDApIC8gcHJpY2VzLmxlbmd0aDtcbiAgICAgIGNvbnN0IG1lZGlhblByaWNlID0gcHJpY2VzLnNvcnQoKGEsIGIpID0+IGEgLSBiKVtNYXRoLmZsb29yKHByaWNlcy5sZW5ndGggLyAyKV07XG4gICAgICBcbiAgICAgIHJlc3VsdCArPSBgKirwn5KwIFByaWNpbmcgVHJlbmRzOioqXFxuYDtcbiAgICAgIHJlc3VsdCArPSBg4oCiIEF2ZXJhZ2UgUHJpY2U6ICR7dGhpcy5jbGllbnQuZm9ybWF0UHJpY2UoYXZnUHJpY2UsIGRvbWFpbil9XFxuYDtcbiAgICAgIHJlc3VsdCArPSBg4oCiIE1lZGlhbiBQcmljZTogJHt0aGlzLmNsaWVudC5mb3JtYXRQcmljZShtZWRpYW5QcmljZSwgZG9tYWluKX1cXG5gO1xuICAgICAgcmVzdWx0ICs9IGDigKIgUHJpY2UgUmFuZ2U6ICR7dGhpcy5jbGllbnQuZm9ybWF0UHJpY2UoTWF0aC5taW4oLi4ucHJpY2VzKSwgZG9tYWluKX0gLSAke3RoaXMuY2xpZW50LmZvcm1hdFByaWNlKE1hdGgubWF4KC4uLnByaWNlcyksIGRvbWFpbil9XFxuXFxuYDtcbiAgICB9XG5cbiAgICAvLyBBbmFseXplIHJhdGluZyB0cmVuZHNcbiAgICBjb25zdCByYXRpbmdzID0gcmVjZW50UHJvZHVjdHNcbiAgICAgIC5maWx0ZXIocCA9PiBwLnN0YXRzPy5jdXJyZW50X1JBVElORylcbiAgICAgIC5tYXAocCA9PiBwLnN0YXRzIS5jdXJyZW50X1JBVElORyEgLyAxMCk7XG4gICAgXG4gICAgaWYgKHJhdGluZ3MubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgYXZnUmF0aW5nID0gcmF0aW5ncy5yZWR1Y2UoKHN1bSwgcmF0aW5nKSA9PiBzdW0gKyByYXRpbmcsIDApIC8gcmF0aW5ncy5sZW5ndGg7XG4gICAgICBjb25zdCBoaWdoUmF0ZWRDb3VudCA9IHJhdGluZ3MuZmlsdGVyKHIgPT4gciA+PSA0LjUpLmxlbmd0aDtcbiAgICAgIFxuICAgICAgcmVzdWx0ICs9IGAqKuKtkCBRdWFsaXR5IFRyZW5kczoqKlxcbmA7XG4gICAgICByZXN1bHQgKz0gYOKAoiBBdmVyYWdlIFJhdGluZzogJHthdmdSYXRpbmcudG9GaXhlZCgxKX0vNS4wXFxuYDtcbiAgICAgIHJlc3VsdCArPSBg4oCiIEhpZ2gtUmF0ZWQgUHJvZHVjdHMgKDQuNSspOiAke2hpZ2hSYXRlZENvdW50fS8ke3JhdGluZ3MubGVuZ3RofSAoJHtNYXRoLnJvdW5kKGhpZ2hSYXRlZENvdW50L3JhdGluZ3MubGVuZ3RoKjEwMCl9JSlcXG5cXG5gO1xuICAgIH1cblxuICAgIHJlc3VsdCArPSBgKirwn5OIIE1hcmtldCBJbnNpZ2h0czoqKlxcbmA7XG4gICAgcmVzdWx0ICs9IGDigKIgQ2F0ZWdvcnkgYXBwZWFycyAke3JhdGluZ3MubGVuZ3RoID4gMTUgPyAnbWF0dXJlJyA6ICdkZXZlbG9waW5nJ30gd2l0aCAke3JlY2VudFByb2R1Y3RzLmxlbmd0aH0gYWN0aXZlIHByb2R1Y3RzXFxuYDtcbiAgICByZXN1bHQgKz0gYOKAoiBRdWFsaXR5IHN0YW5kYXJkcyBhcmUgJHtyYXRpbmdzLmxlbmd0aCA+IDAgJiYgcmF0aW5ncy5yZWR1Y2UoKHN1bSwgcikgPT4gc3VtICsgciwgMCkgLyByYXRpbmdzLmxlbmd0aCA+IDQuMCA/ICdoaWdoJyA6ICdtb2RlcmF0ZSd9XFxuYDtcbiAgICByZXN1bHQgKz0gYOKAoiBDb21wZXRpdGlvbiBsZXZlbCBzdWdnZXN0cyAke3ByaWNlcy5sZW5ndGggPiAwICYmIHByaWNlcy5sZW5ndGggPiAxMCA/ICdzYXR1cmF0ZWQnIDogJ2dyb3dpbmcnfSBtYXJrZXRcXG5cXG5gO1xuXG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxuXG5cblxuXG5cblxuICBwcml2YXRlIGdlbmVyYXRlUmVjb21tZW5kYXRpb25zKHBhcmFtczogei5pbmZlcjx0eXBlb2YgQ2F0ZWdvcnlBbmFseXNpc1NjaGVtYT4sIGluc2lnaHRzOiB7IGNvbXBldGl0aW9uTGV2ZWw6IHN0cmluZzsgYXZlcmFnZVByaWNlOiBudW1iZXI7IG1hcmtldFNhdHVyYXRpb246IG51bWJlcjsgb3Bwb3J0dW5pdHlTY29yZTogbnVtYmVyIH0pOiBzdHJpbmdbXSB7XG4gICAgY29uc3QgcmVjb21tZW5kYXRpb25zID0gW107XG5cbiAgICBpZiAoaW5zaWdodHMub3Bwb3J0dW5pdHlTY29yZSA+IDcwKSB7XG4gICAgICByZWNvbW1lbmRhdGlvbnMucHVzaCgn8J+OryBIaWdoIG9wcG9ydHVuaXR5IGNhdGVnb3J5IC0gY29uc2lkZXIgaW1tZWRpYXRlIGVudHJ5IHdpdGggZGlmZmVyZW50aWF0ZWQgcHJvZHVjdCcpO1xuICAgIH0gZWxzZSBpZiAoaW5zaWdodHMub3Bwb3J0dW5pdHlTY29yZSA+IDQwKSB7XG4gICAgICByZWNvbW1lbmRhdGlvbnMucHVzaCgn4pqW77iPIE1vZGVyYXRlIG9wcG9ydHVuaXR5IC0gZm9jdXMgb24gbmljaGUgc2VnbWVudHMgb3IgcHJvZHVjdCBpbXByb3ZlbWVudHMnKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmVjb21tZW5kYXRpb25zLnB1c2goJ+KaoO+4jyBTYXR1cmF0ZWQgbWFya2V0IC0gb25seSBlbnRlciB3aXRoIHNpZ25pZmljYW50IGNvbXBldGl0aXZlIGFkdmFudGFnZXMnKTtcbiAgICB9XG5cbiAgICBpZiAoaW5zaWdodHMuY29tcGV0aXRpb25MZXZlbCA9PT0gJ0xvdycpIHtcbiAgICAgIHJlY29tbWVuZGF0aW9ucy5wdXNoKCfwn5+iIExvdyBjb21wZXRpdGlvbiBkZXRlY3RlZCAtIG9wcG9ydHVuaXR5IGZvciBwcmVtaXVtIHBvc2l0aW9uaW5nJyk7XG4gICAgfSBlbHNlIGlmIChpbnNpZ2h0cy5jb21wZXRpdGlvbkxldmVsID09PSAnSGlnaCcpIHtcbiAgICAgIHJlY29tbWVuZGF0aW9ucy5wdXNoKCfwn5S0IEhpZ2ggY29tcGV0aXRpb24gLSBmb2N1cyBvbiB1bmlxdWUgdmFsdWUgcHJvcG9zaXRpb25zIGFuZCBjb3N0IG9wdGltaXphdGlvbicpO1xuICAgIH1cblxuICAgIGlmIChpbnNpZ2h0cy5hdmVyYWdlUHJpY2UgPiA1MDAwKSB7XG4gICAgICByZWNvbW1lbmRhdGlvbnMucHVzaCgn8J+SsCBIaWdoZXIgcHJpY2UgcG9pbnQgY2F0ZWdvcnkgLSBqdXN0aWZ5IHByZW1pdW0gd2l0aCBxdWFsaXR5IGFuZCBmZWF0dXJlcycpO1xuICAgIH0gZWxzZSB7XG4gICAgICByZWNvbW1lbmRhdGlvbnMucHVzaCgn8J+SuCBQcmljZS1zZW5zaXRpdmUgbWFya2V0IC0gb3B0aW1pemUgZm9yIGNvc3QtZWZmZWN0aXZlbmVzcyBhbmQgdmFsdWUnKTtcbiAgICB9XG5cbiAgICBpZiAocGFyYW1zLmFuYWx5c2lzVHlwZSA9PT0gJ29wcG9ydHVuaXRpZXMnKSB7XG4gICAgICByZWNvbW1lbmRhdGlvbnMucHVzaCgn8J+UjSBVc2UgUHJvZHVjdCBGaW5kZXIgdG9vbCB0byBpZGVudGlmeSBzcGVjaWZpYyBsb3ctY29tcGV0aXRpb24gcHJvZHVjdHMnKTtcbiAgICAgIHJlY29tbWVuZGF0aW9ucy5wdXNoKCfwn5OKIEFuYWx5emUgdG9wIHBlcmZvcm1lcnMgZm9yIHN1Y2Nlc3NmdWwgcHJvZHVjdCBwYXR0ZXJucycpO1xuICAgIH1cblxuICAgIHJlY29tbWVuZGF0aW9ucy5wdXNoKCfwn5OIIE1vbml0b3IgdHJlbmRzIHJlZ3VsYXJseSB0byB0aW1lIG1hcmtldCBlbnRyeS9leGl0IGRlY2lzaW9ucycpO1xuXG4gICAgcmV0dXJuIHJlY29tbWVuZGF0aW9ucztcbiAgfVxuXG4gIGFzeW5jIGFuYWx5emVTYWxlc1ZlbG9jaXR5KHBhcmFtczogei5pbmZlcjx0eXBlb2YgU2FsZXNWZWxvY2l0eVNjaGVtYT4pOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBkb21haW4gPSBwYXJhbXMuZG9tYWluIGFzIEtlZXBhRG9tYWluO1xuICAgICAgY29uc3QgZG9tYWluTmFtZSA9IHRoaXMuY2xpZW50LmdldERvbWFpbk5hbWUoZG9tYWluKTtcbiAgICAgIFxuICAgICAgbGV0IHJlc3VsdCA9IGAqKvCfmoAgU2FsZXMgVmVsb2NpdHkgQW5hbHlzaXMqKlxcblxcbmA7XG4gICAgICByZXN1bHQgKz0gYPCfj6ogKipNYXJrZXRwbGFjZSoqOiAke2RvbWFpbk5hbWV9XFxuYDtcbiAgICAgIHJlc3VsdCArPSBg4o+x77iPICoqVGltZWZyYW1lKio6ICR7cGFyYW1zLnRpbWVmcmFtZX1cXG5gO1xuICAgICAgcmVzdWx0ICs9IGDwn5OKICoqU29ydCBCeSoqOiAke3BhcmFtcy5zb3J0Qnl9ICgke3BhcmFtcy5zb3J0T3JkZXJ9KVxcblxcbmA7XG5cbiAgICAgIC8vIEdldCByZWFsIHNhbGVzIHZlbG9jaXR5IGRhdGEgZnJvbSBLZWVwYSBBUElcbiAgICAgIGNvbnN0IHZlbG9jaXR5RGF0YSA9IGF3YWl0IHRoaXMuZ2V0UmVhbFNhbGVzVmVsb2NpdHlEYXRhKHBhcmFtcywgZG9tYWluKTtcbiAgICAgIFxuICAgICAgaWYgKHZlbG9jaXR5RGF0YS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgcmVzdWx0ICs9IGDinYwgKipObyBwcm9kdWN0cyBmb3VuZCoqIG1hdGNoaW5nIHlvdXIgdmVsb2NpdHkgY3JpdGVyaWEuXFxuXFxuYDtcbiAgICAgICAgcmVzdWx0ICs9IGAqKlN1Z2dlc3Rpb25zOioqXFxuYDtcbiAgICAgICAgcmVzdWx0ICs9IGDigKIgTG93ZXIgbWluaW11bSB2ZWxvY2l0eSByZXF1aXJlbWVudHNcXG5gO1xuICAgICAgICByZXN1bHQgKz0gYOKAoiBFeHBhbmQgcHJpY2UgcmFuZ2UgZmlsdGVyc1xcbmA7XG4gICAgICAgIHJlc3VsdCArPSBg4oCiIFRyeSBkaWZmZXJlbnQgY2F0ZWdvcnkgb3IgcmVtb3ZlIGNhdGVnb3J5IGZpbHRlclxcbmA7XG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICB9XG5cbiAgICAgIHJlc3VsdCArPSBg8J+TiCAqKkZvdW5kICR7dmVsb2NpdHlEYXRhLmxlbmd0aH0gcHJvZHVjdHMqKiB3aXRoIHZlbG9jaXR5IGRhdGE6XFxuXFxuYDtcblxuICAgICAgdmVsb2NpdHlEYXRhLmZvckVhY2goKHByb2R1Y3QsIGkpID0+IHtcbiAgICAgICAgY29uc3QgcmFuayA9IHBhcmFtcy5wYWdlICogcGFyYW1zLnBlclBhZ2UgKyBpICsgMTtcbiAgICAgICAgcmVzdWx0ICs9IGAqKiR7cmFua30uICR7cHJvZHVjdC5hc2lufSoqICR7dGhpcy5nZXRWZWxvY2l0eUluZGljYXRvcihwcm9kdWN0LnNhbGVzVmVsb2NpdHkudHJlbmQpfVxcbmA7XG4gICAgICAgIHJlc3VsdCArPSBg8J+TpiAqKiR7cHJvZHVjdC50aXRsZX0qKlxcbmA7XG4gICAgICAgIHJlc3VsdCArPSBg8J+Pt++4jyBCcmFuZDogJHtwcm9kdWN0LmJyYW5kIHx8ICdOL0EnfVxcbmA7XG4gICAgICAgIHJlc3VsdCArPSBg8J+SsCBQcmljZTogJHt0aGlzLmNsaWVudC5mb3JtYXRQcmljZShwcm9kdWN0LnByaWNlLCBkb21haW4pfVxcblxcbmA7XG4gICAgICAgIFxuICAgICAgICByZXN1bHQgKz0gYCoq8J+TiiBTYWxlcyBWZWxvY2l0eToqKlxcbmA7XG4gICAgICAgIHJlc3VsdCArPSBg4oCiIERhaWx5OiAke3Byb2R1Y3Quc2FsZXNWZWxvY2l0eS5kYWlseX0gdW5pdHNcXG5gO1xuICAgICAgICByZXN1bHQgKz0gYOKAoiBXZWVrbHk6ICR7cHJvZHVjdC5zYWxlc1ZlbG9jaXR5LndlZWtseX0gdW5pdHNcXG5gO1xuICAgICAgICByZXN1bHQgKz0gYOKAoiBNb250aGx5OiAke3Byb2R1Y3Quc2FsZXNWZWxvY2l0eS5tb250aGx5fSB1bml0c1xcbmA7XG4gICAgICAgIHJlc3VsdCArPSBg4oCiIFRyZW5kOiAke3Byb2R1Y3Quc2FsZXNWZWxvY2l0eS50cmVuZH0gKCR7cHJvZHVjdC5zYWxlc1ZlbG9jaXR5LmNoYW5nZVBlcmNlbnQgPiAwID8gJysnIDogJyd9JHtwcm9kdWN0LnNhbGVzVmVsb2NpdHkuY2hhbmdlUGVyY2VudH0lKVxcblxcbmA7XG4gICAgICAgIFxuICAgICAgICByZXN1bHQgKz0gYCoq8J+TpiBJbnZlbnRvcnkgTWV0cmljczoqKlxcbmA7XG4gICAgICAgIHJlc3VsdCArPSBg4oCiIFR1cm5vdmVyIFJhdGU6ICR7cHJvZHVjdC5pbnZlbnRvcnlNZXRyaWNzLnR1cm5vdmVyUmF0ZX14L21vbnRoXFxuYDtcbiAgICAgICAgcmVzdWx0ICs9IGDigKIgRGF5cyBvZiBJbnZlbnRvcnk6ICR7cHJvZHVjdC5pbnZlbnRvcnlNZXRyaWNzLmRheXNPZkludmVudG9yeX0gZGF5c1xcbmA7XG4gICAgICAgIHJlc3VsdCArPSBg4oCiIFN0b2Nrb3V0IFJpc2s6ICR7cHJvZHVjdC5pbnZlbnRvcnlNZXRyaWNzLnN0b2Nrb3V0Umlza30gJHt0aGlzLmdldFJpc2tFbW9qaShwcm9kdWN0LmludmVudG9yeU1ldHJpY3Muc3RvY2tvdXRSaXNrKX1cXG5gO1xuICAgICAgICByZXN1bHQgKz0gYOKAoiBSZWNvbW1lbmRlZCBPcmRlcjogJHtwcm9kdWN0LmludmVudG9yeU1ldHJpY3MucmVjb21tZW5kZWRPcmRlclF1YW50aXR5fSB1bml0c1xcblxcbmA7XG4gICAgICAgIFxuICAgICAgICByZXN1bHQgKz0gYCoq8J+SsCBSZXZlbnVlIE1ldHJpY3M6KipcXG5gO1xuICAgICAgICByZXN1bHQgKz0gYOKAoiBSZXZlbnVlIFZlbG9jaXR5OiAke3RoaXMuY2xpZW50LmZvcm1hdFByaWNlKHByb2R1Y3QucHJvZml0YWJpbGl0eS5yZXZlbnVlVmVsb2NpdHkgKiAxMDAsIGRvbWFpbil9L2RheVxcbmA7XG4gICAgICAgIHJlc3VsdCArPSBg4oCiIEVzdC4gR3Jvc3MgTWFyZ2luOiAke3Byb2R1Y3QucHJvZml0YWJpbGl0eS5ncm9zc01hcmdpbkVzdGltYXRlfSVcXG5gO1xuICAgICAgICByZXN1bHQgKz0gYOKAoiBQcm9maXQgVmVsb2NpdHk6ICR7dGhpcy5jbGllbnQuZm9ybWF0UHJpY2UocHJvZHVjdC5wcm9maXRhYmlsaXR5LnByb2ZpdFZlbG9jaXR5ICogMTAwLCBkb21haW4pfS9kYXlcXG5cXG5gO1xuICAgICAgICBcbiAgICAgICAgcmVzdWx0ICs9IGAqKvCfk4ggTWFya2V0IEluZm86KipcXG5gO1xuICAgICAgICByZXN1bHQgKz0gYOKAoiBSYXRpbmc6ICR7cHJvZHVjdC5tYXJrZXRNZXRyaWNzLnJhdGluZ30vNS4wICgke3Byb2R1Y3QubWFya2V0TWV0cmljcy5yZXZpZXdDb3VudH0gcmV2aWV3cylcXG5gO1xuICAgICAgICByZXN1bHQgKz0gYOKAoiBTYWxlcyBSYW5rOiAjJHtwcm9kdWN0Lm1hcmtldE1ldHJpY3Muc2FsZXNSYW5rLnRvTG9jYWxlU3RyaW5nKCl9XFxuYDtcbiAgICAgICAgcmVzdWx0ICs9IGDigKIgQ29tcGV0aXRpb246ICR7cHJvZHVjdC5tYXJrZXRNZXRyaWNzLmNvbXBldGl0aW9ufVxcbmA7XG4gICAgICAgIHJlc3VsdCArPSBg4oCiIFNlYXNvbmFsaXR5OiAke3Byb2R1Y3QubWFya2V0TWV0cmljcy5zZWFzb25hbGl0eX1cXG5gO1xuICAgICAgICBcbiAgICAgICAgaWYgKHByb2R1Y3QuYWxlcnRzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICByZXN1bHQgKz0gYFxcbioq4pqg77iPIEFsZXJ0czoqKlxcbmA7XG4gICAgICAgICAgcHJvZHVjdC5hbGVydHMuZm9yRWFjaChhbGVydCA9PiB7XG4gICAgICAgICAgICByZXN1bHQgKz0gYOKAoiAke2FsZXJ0fVxcbmA7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIHJlc3VsdCArPSAnXFxuLS0tXFxuXFxuJztcbiAgICAgIH0pO1xuXG4gICAgICByZXN1bHQgKz0gYCoq8J+SoSBLZXkgSW5zaWdodHM6KipcXG5gO1xuICAgICAgY29uc3QgZmFzdE1vdmVycyA9IHZlbG9jaXR5RGF0YS5maWx0ZXIocCA9PiBwLnNhbGVzVmVsb2NpdHkubW9udGhseSA+PSAzMCkubGVuZ3RoO1xuICAgICAgY29uc3Qgc2xvd01vdmVycyA9IHZlbG9jaXR5RGF0YS5maWx0ZXIocCA9PiBwLnNhbGVzVmVsb2NpdHkubW9udGhseSA8IDEwKS5sZW5ndGg7XG4gICAgICBjb25zdCBoaWdoUmlzayA9IHZlbG9jaXR5RGF0YS5maWx0ZXIocCA9PiBwLmludmVudG9yeU1ldHJpY3Muc3RvY2tvdXRSaXNrID09PSAnSGlnaCcpLmxlbmd0aDtcbiAgICAgIFxuICAgICAgcmVzdWx0ICs9IGDigKIgRmFzdCBNb3ZlcnMgKD4zMC9tb250aCk6ICR7ZmFzdE1vdmVyc30gcHJvZHVjdHNcXG5gO1xuICAgICAgcmVzdWx0ICs9IGDigKIgU2xvdyBNb3ZlcnMgKDwxMC9tb250aCk6ICR7c2xvd01vdmVyc30gcHJvZHVjdHNcXG5gO1xuICAgICAgcmVzdWx0ICs9IGDigKIgSGlnaCBTdG9ja291dCBSaXNrOiAke2hpZ2hSaXNrfSBwcm9kdWN0c1xcbmA7XG4gICAgICByZXN1bHQgKz0gYOKAoiBBdmVyYWdlIFR1cm5vdmVyOiAkeyh2ZWxvY2l0eURhdGEucmVkdWNlKChzdW0sIHApID0+IHN1bSArIHAuaW52ZW50b3J5TWV0cmljcy50dXJub3ZlclJhdGUsIDApIC8gdmVsb2NpdHlEYXRhLmxlbmd0aCkudG9GaXhlZCgxKX14L21vbnRoXFxuXFxuYDtcblxuICAgICAgcmVzdWx0ICs9IGAqKvCfjq8gSW52ZW50b3J5IFJlY29tbWVuZGF0aW9uczoqKlxcbmA7XG4gICAgICByZXN1bHQgKz0gYOKAoiBGb2N1cyBvbiBwcm9kdWN0cyB3aXRoID4yMCB1bml0cy9tb250aCBmb3IgY29uc2lzdGVudCBjYXNoIGZsb3dcXG5gO1xuICAgICAgcmVzdWx0ICs9IGDigKIgQXZvaWQgcHJvZHVjdHMgd2l0aCA+MzAgZGF5cyBvZiBpbnZlbnRvcnkgdW5sZXNzIHNlYXNvbmFsXFxuYDtcbiAgICAgIHJlc3VsdCArPSBg4oCiIE1vbml0b3IgaGlnaCBzdG9ja291dCByaXNrIHByb2R1Y3RzIGZvciByZW9yZGVyIHBvaW50c1xcbmA7XG4gICAgICByZXN1bHQgKz0gYOKAoiBDb25zaWRlciBpbmNyZWFzaW5nIG9yZGVycyBmb3IgYWNjZWxlcmF0aW5nIHRyZW5kIHByb2R1Y3RzXFxuYDtcblxuICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgcmV0dXJuIGBFcnJvciBhbmFseXppbmcgc2FsZXMgdmVsb2NpdHk6ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcid9YDtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGdldFJlYWxTYWxlc1ZlbG9jaXR5RGF0YShwYXJhbXM6IHouaW5mZXI8dHlwZW9mIFNhbGVzVmVsb2NpdHlTY2hlbWE+LCBkb21haW46IEtlZXBhRG9tYWluKTogUHJvbWlzZTxTYWxlc1ZlbG9jaXR5RGF0YVtdPiB7XG4gICAgbGV0IHByb2R1Y3RzOiBhbnlbXSA9IFtdO1xuXG4gICAgLy8gSWYgc3BlY2lmaWMgQVNJTnMgcHJvdmlkZWQsIGdldCB0aG9zZSBwcm9kdWN0c1xuICAgIGlmIChwYXJhbXMuYXNpbikge1xuICAgICAgY29uc3QgcHJvZHVjdCA9IGF3YWl0IHRoaXMuY2xpZW50LmdldFByb2R1Y3Qoe1xuICAgICAgICBhc2luOiBwYXJhbXMuYXNpbixcbiAgICAgICAgZG9tYWluOiBwYXJhbXMuZG9tYWluLFxuICAgICAgICBoaXN0b3J5OiB0cnVlLFxuICAgICAgICByYXRpbmc6IHRydWVcbiAgICAgIH0pO1xuICAgICAgaWYgKHByb2R1Y3QubGVuZ3RoID4gMCkgcHJvZHVjdHMgPSBwcm9kdWN0O1xuICAgIH0gZWxzZSBpZiAocGFyYW1zLmFzaW5zICYmIHBhcmFtcy5hc2lucy5sZW5ndGggPiAwKSB7XG4gICAgICBwcm9kdWN0cyA9IGF3YWl0IHRoaXMuY2xpZW50LmdldFByb2R1Y3Qoe1xuICAgICAgICBhc2luczogcGFyYW1zLmFzaW5zLFxuICAgICAgICBkb21haW46IHBhcmFtcy5kb21haW4sXG4gICAgICAgIGhpc3Rvcnk6IHRydWUsXG4gICAgICAgIHJhdGluZzogdHJ1ZVxuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIFNlYXJjaCBmb3IgcHJvZHVjdHMgaW4gY2F0ZWdvcnkgd2l0aCBzYWxlcyB2ZWxvY2l0eSBjcml0ZXJpYVxuICAgICAgY29uc3Qgc2VhcmNoUGFyYW1zOiBhbnkgPSB7XG4gICAgICAgIGRvbWFpbjogcGFyYW1zLmRvbWFpbixcbiAgICAgICAgc29ydEJ5OiAnbW9udGhseVNvbGQnLFxuICAgICAgICBzb3J0T3JkZXI6IHBhcmFtcy5zb3J0T3JkZXIsXG4gICAgICAgIHBlclBhZ2U6IHBhcmFtcy5wZXJQYWdlLFxuICAgICAgICBwYWdlOiBwYXJhbXMucGFnZVxuICAgICAgfTtcblxuICAgICAgaWYgKHBhcmFtcy5jYXRlZ29yeUlkKSBzZWFyY2hQYXJhbXMuY2F0ZWdvcnlJZCA9IHBhcmFtcy5jYXRlZ29yeUlkO1xuICAgICAgaWYgKHBhcmFtcy5taW5QcmljZSkgc2VhcmNoUGFyYW1zLm1pblByaWNlID0gcGFyYW1zLm1pblByaWNlO1xuICAgICAgaWYgKHBhcmFtcy5tYXhQcmljZSkgc2VhcmNoUGFyYW1zLm1heFByaWNlID0gcGFyYW1zLm1heFByaWNlO1xuICAgICAgaWYgKHBhcmFtcy5taW5SYXRpbmcpIHNlYXJjaFBhcmFtcy5taW5SYXRpbmcgPSBwYXJhbXMubWluUmF0aW5nO1xuICAgICAgaWYgKHBhcmFtcy5taW5WZWxvY2l0eSkgc2VhcmNoUGFyYW1zLm1pbk1vbnRobHlTYWxlcyA9IHBhcmFtcy5taW5WZWxvY2l0eSAqIDMwOyAvLyBDb252ZXJ0IGRhaWx5IHRvIG1vbnRobHlcbiAgICAgIGlmIChwYXJhbXMubWF4VmVsb2NpdHkpIHNlYXJjaFBhcmFtcy5tYXhNb250aGx5U2FsZXMgPSBwYXJhbXMubWF4VmVsb2NpdHkgKiAzMDsgLy8gQ29udmVydCBkYWlseSB0byBtb250aGx5XG5cbiAgICAgIHByb2R1Y3RzID0gYXdhaXQgdGhpcy5jbGllbnQuc2VhcmNoUHJvZHVjdHMoc2VhcmNoUGFyYW1zKTtcbiAgICB9XG5cbiAgICAvLyBDb252ZXJ0IHRvIFNhbGVzVmVsb2NpdHlEYXRhIGZvcm1hdFxuICAgIGNvbnN0IHZlbG9jaXR5RGF0YTogU2FsZXNWZWxvY2l0eURhdGFbXSA9IHByb2R1Y3RzLm1hcCgocHJvZHVjdDogYW55KSA9PiB7XG4gICAgICBjb25zdCBtb250aGx5U29sZCA9IHByb2R1Y3QubW9udGhseVNvbGQgfHwgcHJvZHVjdC5zdGF0cz8ubW9udGhseVNvbGQgfHwgMDtcbiAgICAgIGNvbnN0IGRhaWx5VmVsb2NpdHkgPSBtb250aGx5U29sZCAvIDMwO1xuICAgICAgY29uc3QgcHJpY2UgPSBwcm9kdWN0LnN0YXRzPy5jdXJyZW50X0FNQVpPTiB8fCBwcm9kdWN0LnByaWNlIHx8IDA7XG4gICAgICBjb25zdCBzYWxlc1JhbmsgPSBwcm9kdWN0LnN0YXRzPy5jdXJyZW50X1NBTEVTIHx8IHByb2R1Y3Quc2FsZXNSYW5rIHx8IDA7XG4gICAgICBjb25zdCByYXRpbmcgPSBwcm9kdWN0LnN0YXRzPy5jdXJyZW50X1JBVElORyA/IHByb2R1Y3Quc3RhdHMuY3VycmVudF9SQVRJTkcgLyAxMCA6IHByb2R1Y3QucmF0aW5nIHx8IDA7XG4gICAgICBcbiAgICAgIC8vIENhbGN1bGF0ZSB2ZWxvY2l0eSBtZXRyaWNzXG4gICAgICBjb25zdCBtb250aGx5UmV2ZW51ZSA9IG1vbnRobHlTb2xkICogKHByaWNlIC8gMTAwKTsgLy8gQ29udmVydCBjZW50cyB0byBkb2xsYXJzXG4gICAgICBjb25zdCB0dXJub3ZlclJhdGUgPSBtb250aGx5U29sZCA+IDAgPyBNYXRoLm1pbig1MiwgTWF0aC5yb3VuZCgobW9udGhseVNvbGQgKiAxMikgLyAxMDApKSA6IDE7IC8vIEVzdGltYXRlIGFubnVhbCB0dXJuc1xuICAgICAgXG4gICAgICAvLyBEZXRlcm1pbmUgdHJlbmQgYmFzZWQgb24gc2FsZXMgcmFuayBhbmQgdmVsb2NpdHlcbiAgICAgIGxldCB0cmVuZDogJ0FjY2VsZXJhdGluZycgfCAnU3RhYmxlJyB8ICdEZWNsaW5pbmcnID0gJ1N0YWJsZSc7XG4gICAgICBpZiAoZGFpbHlWZWxvY2l0eSA+IDUwKSB0cmVuZCA9ICdBY2NlbGVyYXRpbmcnO1xuICAgICAgZWxzZSBpZiAoZGFpbHlWZWxvY2l0eSA8IDUpIHRyZW5kID0gJ0RlY2xpbmluZyc7XG5cbiAgICAgIC8vIENhbGN1bGF0ZSByaXNrIGZhY3RvcnNcbiAgICAgIGNvbnN0IHNlYXNvbmFsaXR5ID0gbW9udGhseVNvbGQgPiAxMDAwICYmIHNhbGVzUmFuayA8IDEwMDAwID8gJ0xvdycgOiBtb250aGx5U29sZCA8IDEwMCA/ICdIaWdoJyA6ICdNZWRpdW0nO1xuICAgICAgY29uc3Qgc2VsbGVySW5mbyA9IHRoaXMuY2xpZW50LmdldFNlbGxlckNvdW50KHByb2R1Y3QsIHBhcmFtcy5zZWxsZXJDb3VudFRpbWVmcmFtZSk7XG4gICAgICBjb25zdCBzZWxsZXJDb3VudCA9IHNlbGxlckluZm8uY291bnQ7XG4gICAgICBjb25zdCBjb21wZXRpdGlvbiA9IHNlbGxlckNvdW50ID4gMTAgPyAnSGlnaCcgOiBzZWxsZXJDb3VudCA8IDUgPyAnTG93JyA6ICdNZWRpdW0nO1xuXG4gICAgICAvLyBDYWxjdWxhdGUgcHJvZml0YWJpbGl0eSBtZXRyaWNzXG4gICAgICBjb25zdCBncm9zc01hcmdpblBlcmNlbnQgPSBNYXRoLm1heCgxNSwgTWF0aC5taW4oNDAsIDM1IC0gc2VsbGVyQ291bnQgKiAyKSk7XG4gICAgICBjb25zdCBkYWlseVJldmVudWUgPSBkYWlseVZlbG9jaXR5ICogKHByaWNlIC8gMTAwKTtcbiAgICAgIGNvbnN0IGRhaWx5UHJvZml0ID0gZGFpbHlSZXZlbnVlICogKGdyb3NzTWFyZ2luUGVyY2VudCAvIDEwMCk7XG5cbiAgICAgIGNvbnN0IGFsZXJ0czogc3RyaW5nW10gPSBbXTtcbiAgICAgIGlmIChkYWlseVZlbG9jaXR5ID4gMjApIGFsZXJ0cy5wdXNoKCdIaWdoIHZlbG9jaXR5IC0gbW9uaXRvciBpbnZlbnRvcnkgbGV2ZWxzJyk7XG4gICAgICBpZiAoZGFpbHlWZWxvY2l0eSA8IDMpIGFsZXJ0cy5wdXNoKCdMb3cgdmVsb2NpdHkgLSBjb25zaWRlciBwcm9tb3Rpb24gb3IgbWFya2Rvd24nKTtcbiAgICAgIGlmIChzZWxsZXJDb3VudCA+IDgpIGFsZXJ0cy5wdXNoKCdIaWdoIGNvbXBldGl0aW9uIC0gbW9uaXRvciBwcmljaW5nJyk7XG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIGFzaW46IHByb2R1Y3QuYXNpbixcbiAgICAgICAgdGl0bGU6IHByb2R1Y3QudGl0bGUgfHwgcHJvZHVjdC5wcm9kdWN0VGl0bGUgfHwgJ1Vua25vd24gUHJvZHVjdCcsXG4gICAgICAgIGJyYW5kOiBwcm9kdWN0LmJyYW5kIHx8ICdVbmtub3duJyxcbiAgICAgICAgcHJpY2U6IHByaWNlLFxuICAgICAgICBzYWxlc1ZlbG9jaXR5OiB7XG4gICAgICAgICAgZGFpbHk6IE1hdGgucm91bmQoZGFpbHlWZWxvY2l0eSAqIDEwKSAvIDEwLFxuICAgICAgICAgIHdlZWtseTogTWF0aC5yb3VuZChkYWlseVZlbG9jaXR5ICogNyAqIDEwKSAvIDEwLFxuICAgICAgICAgIG1vbnRobHk6IG1vbnRobHlTb2xkLFxuICAgICAgICAgIHRyZW5kOiB0cmVuZCxcbiAgICAgICAgICBjaGFuZ2VQZXJjZW50OiB0cmVuZCA9PT0gJ0FjY2VsZXJhdGluZycgPyBNYXRoLnJvdW5kKGRhaWx5VmVsb2NpdHkgLyAxMCAqIDUpIDogXG4gICAgICAgICAgICAgICAgICAgICAgIHRyZW5kID09PSAnRGVjbGluaW5nJyA/IC1NYXRoLnJvdW5kKGRhaWx5VmVsb2NpdHkgLyAxMCAqIDMpIDogMFxuICAgICAgICB9LFxuICAgICAgICBpbnZlbnRvcnlNZXRyaWNzOiB7XG4gICAgICAgICAgdHVybm92ZXJSYXRlOiB0dXJub3ZlclJhdGUsXG4gICAgICAgICAgZGF5c09mSW52ZW50b3J5OiBNYXRoLnJvdW5kKDEwMCAvIE1hdGgubWF4KGRhaWx5VmVsb2NpdHksIDAuMSkpLFxuICAgICAgICAgIHN0b2Nrb3V0UmlzazogZGFpbHlWZWxvY2l0eSA+IDIwID8gJ0hpZ2gnIDogZGFpbHlWZWxvY2l0eSA+IDUgPyAnTWVkaXVtJyA6ICdMb3cnLFxuICAgICAgICAgIHJlY29tbWVuZGVkT3JkZXJRdWFudGl0eTogTWF0aC5yb3VuZChkYWlseVZlbG9jaXR5ICogMzApIC8vIDMwIGRheXMgb2Ygc3VwcGx5XG4gICAgICAgIH0sXG4gICAgICAgIG1hcmtldE1ldHJpY3M6IHtcbiAgICAgICAgICByYXRpbmc6IHJhdGluZyxcbiAgICAgICAgICByZXZpZXdDb3VudDogcHJvZHVjdC5zdGF0cz8uY3VycmVudF9DT1VOVF9SRVZJRVdTIHx8IHByb2R1Y3QucmV2aWV3Q291bnQgfHwgMCxcbiAgICAgICAgICBzYWxlc1Jhbms6IHNhbGVzUmFuayxcbiAgICAgICAgICBjb21wZXRpdGlvbjogY29tcGV0aXRpb24gYXMgJ0xvdycgfCAnTWVkaXVtJyB8ICdIaWdoJyxcbiAgICAgICAgICBzZWFzb25hbGl0eTogc2Vhc29uYWxpdHkgYXMgJ0xvdycgfCAnTWVkaXVtJyB8ICdIaWdoJ1xuICAgICAgICB9LFxuICAgICAgICBwcm9maXRhYmlsaXR5OiB7XG4gICAgICAgICAgcmV2ZW51ZVZlbG9jaXR5OiBNYXRoLnJvdW5kKGRhaWx5UmV2ZW51ZSAqIDEwMCkgLyAxMDAsXG4gICAgICAgICAgZ3Jvc3NNYXJnaW5Fc3RpbWF0ZTogZ3Jvc3NNYXJnaW5QZXJjZW50LFxuICAgICAgICAgIHByb2ZpdFZlbG9jaXR5OiBNYXRoLnJvdW5kKGRhaWx5UHJvZml0ICogMTAwKSAvIDEwMFxuICAgICAgICB9LFxuICAgICAgICBhbGVydHM6IGFsZXJ0c1xuICAgICAgfTtcbiAgICB9KTtcblxuICAgIC8vIEZpbHRlciBieSB2ZWxvY2l0eSBpZiBzcGVjaWZpZWRcbiAgICBsZXQgZmlsdGVyZWREYXRhID0gdmVsb2NpdHlEYXRhO1xuICAgIGlmIChwYXJhbXMubWluVmVsb2NpdHkpIHtcbiAgICAgIGZpbHRlcmVkRGF0YSA9IGZpbHRlcmVkRGF0YS5maWx0ZXIocCA9PiBwLnNhbGVzVmVsb2NpdHkuZGFpbHkgPj0gcGFyYW1zLm1pblZlbG9jaXR5ISk7XG4gICAgfVxuICAgIGlmIChwYXJhbXMubWF4VmVsb2NpdHkpIHtcbiAgICAgIGZpbHRlcmVkRGF0YSA9IGZpbHRlcmVkRGF0YS5maWx0ZXIocCA9PiBwLnNhbGVzVmVsb2NpdHkuZGFpbHkgPD0gcGFyYW1zLm1heFZlbG9jaXR5ISk7XG4gICAgfVxuXG4gICAgLy8gU29ydCBieSB0aGUgc3BlY2lmaWVkIG1ldHJpY1xuICAgIGZpbHRlcmVkRGF0YS5zb3J0KChhLCBiKSA9PiB7XG4gICAgICBsZXQgYVZhbHVlOiBudW1iZXIsIGJWYWx1ZTogbnVtYmVyO1xuICAgICAgc3dpdGNoIChwYXJhbXMuc29ydEJ5KSB7XG4gICAgICAgIGNhc2UgJ3ZlbG9jaXR5JzpcbiAgICAgICAgICBhVmFsdWUgPSBhLnNhbGVzVmVsb2NpdHkuZGFpbHk7XG4gICAgICAgICAgYlZhbHVlID0gYi5zYWxlc1ZlbG9jaXR5LmRhaWx5O1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlICd0dXJub3ZlclJhdGUnOlxuICAgICAgICAgIGFWYWx1ZSA9IGEuaW52ZW50b3J5TWV0cmljcy50dXJub3ZlclJhdGU7XG4gICAgICAgICAgYlZhbHVlID0gYi5pbnZlbnRvcnlNZXRyaWNzLnR1cm5vdmVyUmF0ZTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSAncmV2ZW51ZVZlbG9jaXR5JzpcbiAgICAgICAgICBhVmFsdWUgPSBhLnByb2ZpdGFiaWxpdHkucmV2ZW51ZVZlbG9jaXR5O1xuICAgICAgICAgIGJWYWx1ZSA9IGIucHJvZml0YWJpbGl0eS5yZXZlbnVlVmVsb2NpdHk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgJ3RyZW5kJzpcbiAgICAgICAgICBhVmFsdWUgPSBhLnNhbGVzVmVsb2NpdHkudHJlbmQgPT09ICdBY2NlbGVyYXRpbmcnID8gMyA6IGEuc2FsZXNWZWxvY2l0eS50cmVuZCA9PT0gJ1N0YWJsZScgPyAyIDogMTtcbiAgICAgICAgICBiVmFsdWUgPSBiLnNhbGVzVmVsb2NpdHkudHJlbmQgPT09ICdBY2NlbGVyYXRpbmcnID8gMyA6IGIuc2FsZXNWZWxvY2l0eS50cmVuZCA9PT0gJ1N0YWJsZScgPyAyIDogMTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICBhVmFsdWUgPSBhLnNhbGVzVmVsb2NpdHkuZGFpbHk7XG4gICAgICAgICAgYlZhbHVlID0gYi5zYWxlc1ZlbG9jaXR5LmRhaWx5O1xuICAgICAgfVxuICAgICAgXG4gICAgICByZXR1cm4gcGFyYW1zLnNvcnRPcmRlciA9PT0gJ2Rlc2MnID8gYlZhbHVlIC0gYVZhbHVlIDogYVZhbHVlIC0gYlZhbHVlO1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIGZpbHRlcmVkRGF0YTtcbiAgfVxuXG4gIGFzeW5jIGFuYWx5emVJbnZlbnRvcnkocGFyYW1zOiB6LmluZmVyPHR5cGVvZiBJbnZlbnRvcnlBbmFseXNpc1NjaGVtYT4pOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBkb21haW4gPSBwYXJhbXMuZG9tYWluIGFzIEtlZXBhRG9tYWluO1xuICAgICAgY29uc3QgZG9tYWluTmFtZSA9IHRoaXMuY2xpZW50LmdldERvbWFpbk5hbWUoZG9tYWluKTtcbiAgICAgIFxuICAgICAgbGV0IHJlc3VsdCA9IGAqKvCfk6YgSW52ZW50b3J5IEFuYWx5c2lzIFJlcG9ydCoqXFxuXFxuYDtcbiAgICAgIHJlc3VsdCArPSBg8J+PqiAqKk1hcmtldHBsYWNlKio6ICR7ZG9tYWluTmFtZX1cXG5gO1xuICAgICAgcmVzdWx0ICs9IGDwn5OKICoqQW5hbHlzaXMgVHlwZSoqOiAke3BhcmFtcy5hbmFseXNpc1R5cGUuY2hhckF0KDApLnRvVXBwZXJDYXNlKCkgKyBwYXJhbXMuYW5hbHlzaXNUeXBlLnNsaWNlKDEpLnJlcGxhY2UoJ18nLCAnICcpfVxcbmA7XG4gICAgICByZXN1bHQgKz0gYOKPse+4jyAqKlRpbWVmcmFtZSoqOiAke3BhcmFtcy50aW1lZnJhbWV9XFxuYDtcbiAgICAgIHJlc3VsdCArPSBg8J+OryAqKlRhcmdldCBUdXJub3ZlcioqOiAke3BhcmFtcy50YXJnZXRUdXJub3ZlclJhdGV9IHR1cm5zL3llYXJcXG5cXG5gO1xuXG4gICAgICAvLyBHZXQgcmVhbCBpbnZlbnRvcnkgYW5hbHlzaXMgdXNpbmcgc2FsZXMgdmVsb2NpdHkgZGF0YVxuICAgICAgY29uc3QgaW52ZW50b3J5QW5hbHlzaXMgPSBhd2FpdCB0aGlzLmdldFJlYWxJbnZlbnRvcnlBbmFseXNpcyhwYXJhbXMsIGRvbWFpbik7XG4gICAgICBcbiAgICAgIHN3aXRjaCAocGFyYW1zLmFuYWx5c2lzVHlwZSkge1xuICAgICAgICBjYXNlICdvdmVydmlldyc6XG4gICAgICAgICAgcmVzdWx0ICs9IHRoaXMuZm9ybWF0SW52ZW50b3J5T3ZlcnZpZXcoaW52ZW50b3J5QW5hbHlzaXMsIGRvbWFpbik7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgJ2Zhc3RfbW92ZXJzJzpcbiAgICAgICAgICByZXN1bHQgKz0gdGhpcy5mb3JtYXRGYXN0TW92ZXJzKGludmVudG9yeUFuYWx5c2lzLCBkb21haW4pO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlICdzbG93X21vdmVycyc6XG4gICAgICAgICAgcmVzdWx0ICs9IHRoaXMuZm9ybWF0U2xvd01vdmVycyhpbnZlbnRvcnlBbmFseXNpcywgZG9tYWluKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSAnc3RvY2tvdXRfcmlza3MnOlxuICAgICAgICAgIHJlc3VsdCArPSB0aGlzLmZvcm1hdFN0b2Nrb3V0Umlza3MoaW52ZW50b3J5QW5hbHlzaXMsIGRvbWFpbik7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgJ3NlYXNvbmFsJzpcbiAgICAgICAgICByZXN1bHQgKz0gdGhpcy5mb3JtYXRTZWFzb25hbEFuYWx5c2lzKGludmVudG9yeUFuYWx5c2lzLCBkb21haW4pO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgfVxuXG4gICAgICByZXN1bHQgKz0gYFxcbioq8J+SoSBJbnZlbnRvcnkgTWFuYWdlbWVudCBSZWNvbW1lbmRhdGlvbnM6KipcXG5gO1xuICAgICAgaW52ZW50b3J5QW5hbHlzaXMucmVjb21tZW5kYXRpb25zLmZvckVhY2goKHJlYywgaSkgPT4ge1xuICAgICAgICByZXN1bHQgKz0gYCR7aSArIDF9LiAke3JlY31cXG5gO1xuICAgICAgfSk7XG5cbiAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHJldHVybiBgRXJyb3IgYW5hbHl6aW5nIGludmVudG9yeTogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJ31gO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZ2V0UmVhbEludmVudG9yeUFuYWx5c2lzKHBhcmFtczogei5pbmZlcjx0eXBlb2YgSW52ZW50b3J5QW5hbHlzaXNTY2hlbWE+LCBkb21haW46IEtlZXBhRG9tYWluKTogUHJvbWlzZTxJbnZlbnRvcnlBbmFseXNpcz4ge1xuICAgIC8vIEdldCBzYWxlcyB2ZWxvY2l0eSBkYXRhIHRvIGJ1aWxkIGludmVudG9yeSBhbmFseXNpc1xuICAgIGNvbnN0IHZlbG9jaXR5UGFyYW1zID0ge1xuICAgICAgZG9tYWluOiBwYXJhbXMuZG9tYWluLFxuICAgICAgY2F0ZWdvcnlJZDogcGFyYW1zLmNhdGVnb3J5SWQsXG4gICAgICBhc2luczogcGFyYW1zLmFzaW5zLFxuICAgICAgdGltZWZyYW1lOiBwYXJhbXMudGltZWZyYW1lLFxuICAgICAgc2VsbGVyQ291bnRUaW1lZnJhbWU6IHBhcmFtcy5zZWxsZXJDb3VudFRpbWVmcmFtZSB8fCAnOTBkYXknLFxuICAgICAgcGVyUGFnZTogNTAsXG4gICAgICBwYWdlOiAwLFxuICAgICAgc29ydEJ5OiAndmVsb2NpdHknIGFzIGNvbnN0LFxuICAgICAgc29ydE9yZGVyOiAnZGVzYycgYXMgY29uc3QsXG4gICAgICBtaW5SYXRpbmc6IDMuMFxuICAgIH07XG5cbiAgICBjb25zdCBhbGxQcm9kdWN0cyA9IGF3YWl0IHRoaXMuZ2V0UmVhbFNhbGVzVmVsb2NpdHlEYXRhKHZlbG9jaXR5UGFyYW1zLCBkb21haW4pO1xuICAgIFxuICAgIC8vIENhdGVnb3JpemUgcHJvZHVjdHMgYmFzZWQgb24gdmVsb2NpdHkgYW5kIHR1cm5vdmVyXG4gICAgY29uc3QgZmFzdE1vdmVycyA9IGFsbFByb2R1Y3RzLmZpbHRlcihwID0+IHAuc2FsZXNWZWxvY2l0eS5tb250aGx5ID49IDMwKTtcbiAgICBjb25zdCBzbG93TW92ZXJzID0gYWxsUHJvZHVjdHMuZmlsdGVyKHAgPT4gcC5zYWxlc1ZlbG9jaXR5Lm1vbnRobHkgPCAxMCk7XG4gICAgY29uc3Qgc3RvY2tvdXRSaXNrcyA9IGFsbFByb2R1Y3RzLmZpbHRlcihwID0+IHAuaW52ZW50b3J5TWV0cmljcy5zdG9ja291dFJpc2sgPT09ICdIaWdoJyk7XG4gICAgXG4gICAgLy8gQ2FsY3VsYXRlIHNlYXNvbmFsIHBhdHRlcm5zXG4gICAgY29uc3Qgc2Vhc29uYWxQYXR0ZXJucyA9IFtcbiAgICAgIHtcbiAgICAgICAgcGVyaW9kOiAnUTQgSG9saWRheSBTZWFzb24nLFxuICAgICAgICB2ZWxvY2l0eU11bHRpcGxpZXI6IDIuNSxcbiAgICAgICAgcmVjb21tZW5kYXRpb246ICdJbmNyZWFzZSBpbnZlbnRvcnkgNjAtOTAgZGF5cyBiZWZvcmUgcGVhayBzZWFzb24nXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBwZXJpb2Q6ICdTdW1tZXIgU2Vhc29uJyxcbiAgICAgICAgdmVsb2NpdHlNdWx0aXBsaWVyOiAxLjMsXG4gICAgICAgIHJlY29tbWVuZGF0aW9uOiAnTW9uaXRvciBvdXRkb29yL3NlYXNvbmFsIHByb2R1Y3RzIGZvciBpbmNyZWFzZWQgZGVtYW5kJ1xuICAgICAgfVxuICAgIF07XG5cbiAgICAvLyBHZW5lcmF0ZSByZWNvbW1lbmRhdGlvbnNcbiAgICBjb25zdCByZWNvbW1lbmRhdGlvbnM6IHN0cmluZ1tdID0gW107XG4gICAgaWYgKGZhc3RNb3ZlcnMubGVuZ3RoID4gYWxsUHJvZHVjdHMubGVuZ3RoICogMC4zKSB7XG4gICAgICByZWNvbW1lbmRhdGlvbnMucHVzaChcIkNvbnNpZGVyIGluY3JlYXNpbmcgaW52ZW50b3J5IGZvciBmYXN0LW1vdmluZyBwcm9kdWN0cyB0byBhdm9pZCBzdG9ja291dHNcIik7XG4gICAgfVxuICAgIGlmIChzbG93TW92ZXJzLmxlbmd0aCA+IGFsbFByb2R1Y3RzLmxlbmd0aCAqIDAuNCkge1xuICAgICAgcmVjb21tZW5kYXRpb25zLnB1c2goXCJJbXBsZW1lbnQgbWFya2Rvd24gc3RyYXRlZ3kgZm9yIHNsb3ctbW92aW5nIGludmVudG9yeSB0byBpbXByb3ZlIGNhc2ggZmxvd1wiKTtcbiAgICB9XG4gICAgaWYgKHN0b2Nrb3V0Umlza3MubGVuZ3RoID4gMCkge1xuICAgICAgcmVjb21tZW5kYXRpb25zLnB1c2goYE1vbml0b3IgJHtzdG9ja291dFJpc2tzLmxlbmd0aH0gaGlnaC1yaXNrIHByb2R1Y3RzIGZvciBpbW1lZGlhdGUgcmVvcmRlcmluZ2ApO1xuICAgIH1cbiAgICBpZiAoc2Vhc29uYWxQYXR0ZXJucy5sZW5ndGggPiAwKSB7XG4gICAgICByZWNvbW1lbmRhdGlvbnMucHVzaChcIlBsYW4gaW52ZW50b3J5IGxldmVscyBhcm91bmQgc2Vhc29uYWwgZGVtYW5kIHBhdHRlcm5zXCIpO1xuICAgIH1cbiAgICBcbiAgICAvLyBDYWxjdWxhdGUgcG9ydGZvbGlvIG1ldHJpY3NcbiAgICBjb25zdCBhdmdUdXJub3ZlciA9IGFsbFByb2R1Y3RzLmxlbmd0aCA+IDAgXG4gICAgICA/IGFsbFByb2R1Y3RzLnJlZHVjZSgoc3VtLCBwKSA9PiBzdW0gKyBwLmludmVudG9yeU1ldHJpY3MudHVybm92ZXJSYXRlLCAwKSAvIGFsbFByb2R1Y3RzLmxlbmd0aCBcbiAgICAgIDogMDtcblxuICAgIHJldHVybiB7XG4gICAgICB0b3RhbFByb2R1Y3RzOiBhbGxQcm9kdWN0cy5sZW5ndGgsXG4gICAgICBhdmVyYWdlVHVybm92ZXJSYXRlOiBNYXRoLnJvdW5kKGF2Z1R1cm5vdmVyICogMTApIC8gMTAsXG4gICAgICBmYXN0TW92ZXJzOiBmYXN0TW92ZXJzLFxuICAgICAgc2xvd01vdmVyczogc2xvd01vdmVycyxcbiAgICAgIHN0b2Nrb3V0Umlza3M6IHN0b2Nrb3V0Umlza3MsXG4gICAgICBzZWFzb25hbFBhdHRlcm5zOiBzZWFzb25hbFBhdHRlcm5zLFxuICAgICAgcmVjb21tZW5kYXRpb25zOiByZWNvbW1lbmRhdGlvbnNcbiAgICB9O1xuICB9XG5cblxuXG4gIHByaXZhdGUgc29ydFZlbG9jaXR5RGF0YShwcm9kdWN0czogU2FsZXNWZWxvY2l0eURhdGFbXSwgc29ydEJ5OiBzdHJpbmcsIHNvcnRPcmRlcjogc3RyaW5nKTogU2FsZXNWZWxvY2l0eURhdGFbXSB7XG4gICAgcmV0dXJuIHByb2R1Y3RzLnNvcnQoKGEsIGIpID0+IHtcbiAgICAgIGxldCBhVmFsOiBudW1iZXIsIGJWYWw6IG51bWJlcjtcbiAgICAgIFxuICAgICAgc3dpdGNoIChzb3J0QnkpIHtcbiAgICAgICAgY2FzZSAndmVsb2NpdHknOlxuICAgICAgICAgIGFWYWwgPSBhLnNhbGVzVmVsb2NpdHkuZGFpbHk7XG4gICAgICAgICAgYlZhbCA9IGIuc2FsZXNWZWxvY2l0eS5kYWlseTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSAndHVybm92ZXJSYXRlJzpcbiAgICAgICAgICBhVmFsID0gYS5pbnZlbnRvcnlNZXRyaWNzLnR1cm5vdmVyUmF0ZTtcbiAgICAgICAgICBiVmFsID0gYi5pbnZlbnRvcnlNZXRyaWNzLnR1cm5vdmVyUmF0ZTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSAncmV2ZW51ZVZlbG9jaXR5JzpcbiAgICAgICAgICBhVmFsID0gYS5wcm9maXRhYmlsaXR5LnJldmVudWVWZWxvY2l0eTtcbiAgICAgICAgICBiVmFsID0gYi5wcm9maXRhYmlsaXR5LnJldmVudWVWZWxvY2l0eTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSAndHJlbmQnOlxuICAgICAgICAgIGFWYWwgPSBhLnNhbGVzVmVsb2NpdHkuY2hhbmdlUGVyY2VudDtcbiAgICAgICAgICBiVmFsID0gYi5zYWxlc1ZlbG9jaXR5LmNoYW5nZVBlcmNlbnQ7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgYVZhbCA9IGEuc2FsZXNWZWxvY2l0eS5kYWlseTtcbiAgICAgICAgICBiVmFsID0gYi5zYWxlc1ZlbG9jaXR5LmRhaWx5O1xuICAgICAgfVxuICAgICAgXG4gICAgICByZXR1cm4gc29ydE9yZGVyID09PSAnZGVzYycgPyBiVmFsIC0gYVZhbCA6IGFWYWwgLSBiVmFsO1xuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBnZXRWZWxvY2l0eUluZGljYXRvcih0cmVuZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBzd2l0Y2ggKHRyZW5kKSB7XG4gICAgICBjYXNlICdBY2NlbGVyYXRpbmcnOiByZXR1cm4gJ/CfmoAnO1xuICAgICAgY2FzZSAnRGVjbGluaW5nJzogcmV0dXJuICfwn5OJJztcbiAgICAgIGRlZmF1bHQ6IHJldHVybiAn4p6h77iPJztcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGdldFJpc2tFbW9qaShyaXNrOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIHN3aXRjaCAocmlzaykge1xuICAgICAgY2FzZSAnSGlnaCc6IHJldHVybiAn8J+UtCc7XG4gICAgICBjYXNlICdNZWRpdW0nOiByZXR1cm4gJ/Cfn6EnO1xuICAgICAgZGVmYXVsdDogcmV0dXJuICfwn5+iJztcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGZvcm1hdEludmVudG9yeU92ZXJ2aWV3KGFuYWx5c2lzOiBJbnZlbnRvcnlBbmFseXNpcywgZG9tYWluOiBLZWVwYURvbWFpbik6IHN0cmluZyB7XG4gICAgbGV0IHJlc3VsdCA9IGAqKvCfk4ogSW52ZW50b3J5IFBvcnRmb2xpbyBPdmVydmlldyoqXFxuXFxuYDtcbiAgICByZXN1bHQgKz0gYOKAoiAqKlRvdGFsIFByb2R1Y3RzKio6ICR7YW5hbHlzaXMudG90YWxQcm9kdWN0c31cXG5gO1xuICAgIHJlc3VsdCArPSBg4oCiICoqQXZlcmFnZSBUdXJub3ZlciBSYXRlKio6ICR7YW5hbHlzaXMuYXZlcmFnZVR1cm5vdmVyUmF0ZS50b0ZpeGVkKDEpfXgvbW9udGhcXG5gO1xuICAgIHJlc3VsdCArPSBg4oCiICoqRmFzdCBNb3ZlcnMqKjogJHthbmFseXNpcy5mYXN0TW92ZXJzLmxlbmd0aH0gKD4kezMwfS9tb250aClcXG5gO1xuICAgIHJlc3VsdCArPSBg4oCiICoqU2xvdyBNb3ZlcnMqKjogJHthbmFseXNpcy5zbG93TW92ZXJzLmxlbmd0aH0gKDwkezEwfS9tb250aClcXG5gO1xuICAgIHJlc3VsdCArPSBg4oCiICoqSGlnaCBTdG9ja291dCBSaXNrKio6ICR7YW5hbHlzaXMuc3RvY2tvdXRSaXNrcy5sZW5ndGh9IHByb2R1Y3RzXFxuXFxuYDtcblxuICAgIHJlc3VsdCArPSBgKirwn4+GIFRvcCA1IEZhc3QgTW92ZXJzOioqXFxuYDtcbiAgICBhbmFseXNpcy5mYXN0TW92ZXJzLnNsaWNlKDAsIDUpLmZvckVhY2goKHByb2R1Y3QsIGkpID0+IHtcbiAgICAgIHJlc3VsdCArPSBgJHtpICsgMX0uICR7cHJvZHVjdC5hc2lufTogJHtwcm9kdWN0LnNhbGVzVmVsb2NpdHkubW9udGhseX0vbW9udGhcXG5gO1xuICAgIH0pO1xuXG4gICAgcmVzdWx0ICs9IGBcXG4qKvCfkIwgVG9wIDUgU2xvdyBNb3ZlcnM6KipcXG5gO1xuICAgIGFuYWx5c2lzLnNsb3dNb3ZlcnMuc2xpY2UoMCwgNSkuZm9yRWFjaCgocHJvZHVjdCwgaSkgPT4ge1xuICAgICAgcmVzdWx0ICs9IGAke2kgKyAxfS4gJHtwcm9kdWN0LmFzaW59OiAke3Byb2R1Y3Quc2FsZXNWZWxvY2l0eS5tb250aGx5fS9tb250aFxcbmA7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG5cbiAgcHJpdmF0ZSBmb3JtYXRGYXN0TW92ZXJzKGFuYWx5c2lzOiBJbnZlbnRvcnlBbmFseXNpcywgZG9tYWluOiBLZWVwYURvbWFpbik6IHN0cmluZyB7XG4gICAgbGV0IHJlc3VsdCA9IGAqKvCfmoAgRmFzdCBNb3ZpbmcgUHJvZHVjdHMgKD4zMCB1bml0cy9tb250aCkqKlxcblxcbmA7XG4gICAgXG4gICAgYW5hbHlzaXMuZmFzdE1vdmVycy5mb3JFYWNoKChwcm9kdWN0LCBpKSA9PiB7XG4gICAgICByZXN1bHQgKz0gYCoqJHtpICsgMX0uICR7cHJvZHVjdC5hc2lufSoqXFxuYDtcbiAgICAgIHJlc3VsdCArPSBg8J+TpiAke3Byb2R1Y3QudGl0bGV9XFxuYDtcbiAgICAgIHJlc3VsdCArPSBg8J+TiCAke3Byb2R1Y3Quc2FsZXNWZWxvY2l0eS5tb250aGx5fSB1bml0cy9tb250aFxcbmA7XG4gICAgICByZXN1bHQgKz0gYPCfkrAgJHt0aGlzLmNsaWVudC5mb3JtYXRQcmljZShwcm9kdWN0LnByb2ZpdGFiaWxpdHkucmV2ZW51ZVZlbG9jaXR5ICogMTAwLCBkb21haW4pfS9kYXkgcmV2ZW51ZVxcbmA7XG4gICAgICByZXN1bHQgKz0gYPCflIQgJHtwcm9kdWN0LmludmVudG9yeU1ldHJpY3MudHVybm92ZXJSYXRlfXggdHVybm92ZXIgcmF0ZVxcblxcbmA7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG5cbiAgcHJpdmF0ZSBmb3JtYXRTbG93TW92ZXJzKGFuYWx5c2lzOiBJbnZlbnRvcnlBbmFseXNpcywgZG9tYWluOiBLZWVwYURvbWFpbik6IHN0cmluZyB7XG4gICAgbGV0IHJlc3VsdCA9IGAqKvCfkIwgU2xvdyBNb3ZpbmcgUHJvZHVjdHMgKDwxMCB1bml0cy9tb250aCkqKlxcblxcbmA7XG4gICAgXG4gICAgYW5hbHlzaXMuc2xvd01vdmVycy5mb3JFYWNoKChwcm9kdWN0LCBpKSA9PiB7XG4gICAgICByZXN1bHQgKz0gYCoqJHtpICsgMX0uICR7cHJvZHVjdC5hc2lufSoqXFxuYDtcbiAgICAgIHJlc3VsdCArPSBg8J+TpiAke3Byb2R1Y3QudGl0bGV9XFxuYDtcbiAgICAgIHJlc3VsdCArPSBg8J+TiSAke3Byb2R1Y3Quc2FsZXNWZWxvY2l0eS5tb250aGx5fSB1bml0cy9tb250aFxcbmA7XG4gICAgICByZXN1bHQgKz0gYPCfk4UgJHtwcm9kdWN0LmludmVudG9yeU1ldHJpY3MuZGF5c09mSW52ZW50b3J5fSBkYXlzIG9mIGludmVudG9yeVxcbmA7XG4gICAgICByZXN1bHQgKz0gYOKaoO+4jyBDb25zaWRlciBwcm9tb3Rpb24gb3IgbGlxdWlkYXRpb25cXG5cXG5gO1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxuXG4gIHByaXZhdGUgZm9ybWF0U3RvY2tvdXRSaXNrcyhhbmFseXNpczogSW52ZW50b3J5QW5hbHlzaXMsIGRvbWFpbjogS2VlcGFEb21haW4pOiBzdHJpbmcge1xuICAgIGxldCByZXN1bHQgPSBgKirwn5S0IEhpZ2ggU3RvY2tvdXQgUmlzayBQcm9kdWN0cyoqXFxuXFxuYDtcbiAgICBcbiAgICBhbmFseXNpcy5zdG9ja291dFJpc2tzLmZvckVhY2goKHByb2R1Y3QsIGkpID0+IHtcbiAgICAgIHJlc3VsdCArPSBgKioke2kgKyAxfS4gJHtwcm9kdWN0LmFzaW59KipcXG5gO1xuICAgICAgcmVzdWx0ICs9IGDwn5OmICR7cHJvZHVjdC50aXRsZX1cXG5gO1xuICAgICAgcmVzdWx0ICs9IGDimqEgJHtwcm9kdWN0LnNhbGVzVmVsb2NpdHkuZGFpbHl9IHVuaXRzL2RheSB2ZWxvY2l0eVxcbmA7XG4gICAgICByZXN1bHQgKz0gYPCfk4UgJHtwcm9kdWN0LmludmVudG9yeU1ldHJpY3MuZGF5c09mSW52ZW50b3J5fSBkYXlzIGxlZnRcXG5gO1xuICAgICAgcmVzdWx0ICs9IGDwn5OLIFJlb3JkZXI6ICR7cHJvZHVjdC5pbnZlbnRvcnlNZXRyaWNzLnJlY29tbWVuZGVkT3JkZXJRdWFudGl0eX0gdW5pdHNcXG5cXG5gO1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxuXG4gIHByaXZhdGUgZm9ybWF0U2Vhc29uYWxBbmFseXNpcyhhbmFseXNpczogSW52ZW50b3J5QW5hbHlzaXMsIGRvbWFpbjogS2VlcGFEb21haW4pOiBzdHJpbmcge1xuICAgIGxldCByZXN1bHQgPSBgKirwn5eT77iPIFNlYXNvbmFsIFZlbG9jaXR5IFBhdHRlcm5zKipcXG5cXG5gO1xuICAgIFxuICAgIGFuYWx5c2lzLnNlYXNvbmFsUGF0dGVybnMuZm9yRWFjaCgocGF0dGVybiwgaSkgPT4ge1xuICAgICAgcmVzdWx0ICs9IGAqKiR7cGF0dGVybi5wZXJpb2R9KipcXG5gO1xuICAgICAgcmVzdWx0ICs9IGDwn5OKIFZlbG9jaXR5IE11bHRpcGxpZXI6ICR7cGF0dGVybi52ZWxvY2l0eU11bHRpcGxpZXJ9eFxcbmA7XG4gICAgICByZXN1bHQgKz0gYPCfkqEgJHtwYXR0ZXJuLnJlY29tbWVuZGF0aW9ufVxcblxcbmA7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG5cbiAgcHJpdmF0ZSBnZW5lcmF0ZUludmVudG9yeVJlY29tbWVuZGF0aW9ucyhwcm9kdWN0czogU2FsZXNWZWxvY2l0eURhdGFbXSwgdGFyZ2V0VHVybm92ZXI6IG51bWJlcik6IHN0cmluZ1tdIHtcbiAgICBjb25zdCByZWNvbW1lbmRhdGlvbnMgPSBbXTtcbiAgICBcbiAgICBjb25zdCBhdmVyYWdlVmVsb2NpdHkgPSBwcm9kdWN0cy5yZWR1Y2UoKHN1bSwgcCkgPT4gc3VtICsgcC5zYWxlc1ZlbG9jaXR5Lm1vbnRobHksIDApIC8gcHJvZHVjdHMubGVuZ3RoO1xuICAgIGNvbnN0IGhpZ2hSaXNrQ291bnQgPSBwcm9kdWN0cy5maWx0ZXIocCA9PiBwLmludmVudG9yeU1ldHJpY3Muc3RvY2tvdXRSaXNrID09PSAnSGlnaCcpLmxlbmd0aDtcbiAgICBjb25zdCBzbG93TW92ZXJzQ291bnQgPSBwcm9kdWN0cy5maWx0ZXIocCA9PiBwLnNhbGVzVmVsb2NpdHkubW9udGhseSA8IDEwKS5sZW5ndGg7XG4gICAgXG4gICAgaWYgKGF2ZXJhZ2VWZWxvY2l0eSA+IDI1KSB7XG4gICAgICByZWNvbW1lbmRhdGlvbnMucHVzaCgn8J+agCBTdHJvbmcgcG9ydGZvbGlvIHZlbG9jaXR5IC0gbWFpbnRhaW4gY3VycmVudCBzdHJhdGVneScpO1xuICAgIH0gZWxzZSBpZiAoYXZlcmFnZVZlbG9jaXR5IDwgMTUpIHtcbiAgICAgIHJlY29tbWVuZGF0aW9ucy5wdXNoKCfimqDvuI8gTG93IHBvcnRmb2xpbyB2ZWxvY2l0eSAtIGNvbnNpZGVyIG1vcmUgYWdncmVzc2l2ZSBwcm9tb3Rpb25zJyk7XG4gICAgfVxuICAgIFxuICAgIGlmIChoaWdoUmlza0NvdW50ID4gcHJvZHVjdHMubGVuZ3RoICogMC4yKSB7XG4gICAgICByZWNvbW1lbmRhdGlvbnMucHVzaCgn8J+UtCBIaWdoIHN0b2Nrb3V0IGV4cG9zdXJlIC0gaW1wcm92ZSByZW9yZGVyIHBvaW50IG1hbmFnZW1lbnQnKTtcbiAgICB9XG4gICAgXG4gICAgaWYgKHNsb3dNb3ZlcnNDb3VudCA+IHByb2R1Y3RzLmxlbmd0aCAqIDAuMykge1xuICAgICAgcmVjb21tZW5kYXRpb25zLnB1c2goJ/CfkIwgVG9vIG1hbnkgc2xvdyBtb3ZlcnMgLSBldmFsdWF0ZSBwcm9kdWN0IG1peCBhbmQgY29uc2lkZXIgbGlxdWlkYXRpb24nKTtcbiAgICB9XG4gICAgXG4gICAgcmVjb21tZW5kYXRpb25zLnB1c2goJ/Cfk4ogTW9uaXRvciBkYWlseSBmb3IgdmVsb2NpdHkgY2hhbmdlcyBhbmQgYWRqdXN0IHJlb3JkZXIgcG9pbnRzJyk7XG4gICAgcmVjb21tZW5kYXRpb25zLnB1c2goJ/Cfjq8gQWltIGZvciAxNS00NSBkYXkgaW52ZW50b3J5IGxldmVscyBmb3Igb3B0aW1hbCBjYXNoIGZsb3cnKTtcbiAgICByZWNvbW1lbmRhdGlvbnMucHVzaCgn8J+TiCBGb2N1cyBtYXJrZXRpbmcgc3BlbmQgb24gcHJvZHVjdHMgd2l0aCBhY2NlbGVyYXRpbmcgdHJlbmRzJyk7XG4gICAgXG4gICAgcmV0dXJuIHJlY29tbWVuZGF0aW9ucztcbiAgfVxuXG4gIGFzeW5jIGdldFRva2VuU3RhdHVzKHBhcmFtczogei5pbmZlcjx0eXBlb2YgVG9rZW5TdGF0dXNTY2hlbWE+KTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgdG9rZW5zTGVmdCA9IGF3YWl0IHRoaXMuY2xpZW50LmdldFRva2Vuc0xlZnQoKTtcbiAgICAgIFxuICAgICAgbGV0IHJlc3VsdCA9IGAqKvCfqpkgS2VlcGEgQVBJIFRva2VuIFN0YXR1cyoqXFxuXFxuYDtcbiAgICAgIHJlc3VsdCArPSBg8J+SsCAqKlRva2VucyBSZW1haW5pbmcqKjogJHt0b2tlbnNMZWZ0fVxcblxcbmA7XG4gICAgICBcbiAgICAgIGlmICh0b2tlbnNMZWZ0IDw9IDApIHtcbiAgICAgICAgcmVzdWx0ICs9IGDinYwgKipTdGF0dXMqKjogRVhIQVVTVEVEIC0gQWxsIHRvb2xzIHdpbGwgZmFpbCB1bnRpbCB0b2tlbnMgcmVmcmVzaFxcbmA7XG4gICAgICAgIHJlc3VsdCArPSBg4pqg77iPICoqSW1wYWN0Kio6IFNlYXJjaGVzIHdpbGwgcmV0dXJuIFwiTm8gcHJvZHVjdHMgZm91bmRcIiBpbnN0ZWFkIG9mIHJlYWwgZGF0YVxcblxcbmA7XG4gICAgICAgIHJlc3VsdCArPSBgKirwn5SnIFNvbHV0aW9uczoqKlxcbmA7XG4gICAgICAgIHJlc3VsdCArPSBg4oCiIFdhaXQgZm9yIGRhaWx5L21vbnRobHkgdG9rZW4gcmVmcmVzaFxcbmA7XG4gICAgICAgIHJlc3VsdCArPSBg4oCiIFVwZ3JhZGUgeW91ciBLZWVwYSBwbGFuIGZvciBtb3JlIHRva2Vuc1xcbmA7XG4gICAgICAgIHJlc3VsdCArPSBg4oCiIENoZWNrIHVzYWdlIGF0IGh0dHBzOi8va2VlcGEuY29tLyMhYXBpXFxuYDtcbiAgICAgIH0gZWxzZSBpZiAodG9rZW5zTGVmdCA8PSA1KSB7XG4gICAgICAgIHJlc3VsdCArPSBg4pqg77iPICoqU3RhdHVzKio6IExPVyAtIFVzZSBjYXJlZnVsbHkgdG8gYXZvaWQgZXhoYXVzdGlvblxcbmA7XG4gICAgICAgIHJlc3VsdCArPSBg8J+SoSAqKlJlY29tbWVuZGF0aW9uKio6IENvbnNlcnZlIHRva2VucyBmb3IgY3JpdGljYWwgcXVlcmllc1xcblxcbmA7XG4gICAgICAgIHJlc3VsdCArPSBgKipUb2tlbiBVc2FnZSBHdWlkZWxpbmVzOioqXFxuYDtcbiAgICAgICAgcmVzdWx0ICs9IGDigKIgUHJvZHVjdCBMb29rdXA6IH4xIHRva2VuXFxuYDtcbiAgICAgICAgcmVzdWx0ICs9IGDigKIgQ2F0ZWdvcnkgQW5hbHlzaXM6IH41LTE1IHRva2Vuc1xcbmA7XG4gICAgICAgIHJlc3VsdCArPSBg4oCiIERlYWwgRGlzY292ZXJ5OiB+My04IHRva2Vuc1xcbmA7XG4gICAgICB9IGVsc2UgaWYgKHRva2Vuc0xlZnQgPD0gMjUpIHtcbiAgICAgICAgcmVzdWx0ICs9IGDwn5+hICoqU3RhdHVzKio6IE1PREVSQVRFIC0gTW9uaXRvciB1c2FnZVxcbmA7XG4gICAgICAgIHJlc3VsdCArPSBg8J+SoSAqKlJlY29tbWVuZGF0aW9uKio6IFBsYW4geW91ciBxdWVyaWVzIGVmZmljaWVudGx5XFxuYDtcbiAgICAgIH0gZWxzZSBpZiAodG9rZW5zTGVmdCA8PSAxMDApIHtcbiAgICAgICAgcmVzdWx0ICs9IGDwn5+iICoqU3RhdHVzKio6IEdPT0QgLSBBZGVxdWF0ZSBmb3IgcmVndWxhciB1c2FnZVxcbmA7XG4gICAgICAgIHJlc3VsdCArPSBg8J+SoSAqKlJlY29tbWVuZGF0aW9uKio6IE5vcm1hbCB1c2FnZSwgbW9uaXRvciBkYWlseVxcbmA7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXN1bHQgKz0gYOKchSAqKlN0YXR1cyoqOiBFWENFTExFTlQgLSBQbGVudHkgb2YgdG9rZW5zIGF2YWlsYWJsZVxcbmA7XG4gICAgICAgIHJlc3VsdCArPSBg8J+SoSAqKlJlY29tbWVuZGF0aW9uKio6IFVzZSBhZHZhbmNlZCBhbmFseXRpY3MgZnJlZWx5XFxuYDtcbiAgICAgIH1cbiAgICAgIFxuICAgICAgcmVzdWx0ICs9IGBcXG4qKvCfk4ogQ2hlY2sgZGV0YWlsZWQgdXNhZ2UqKjogaHR0cHM6Ly9rZWVwYS5jb20vIyFhcGlcXG5gO1xuICAgICAgcmVzdWx0ICs9IGAqKuKPsCBUb2tlbnMgcmVmcmVzaCoqOiBBY2NvcmRpbmcgdG8geW91ciBLZWVwYSBzdWJzY3JpcHRpb24gcGxhblxcbmA7XG4gICAgICBcbiAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHJldHVybiBgRXJyb3IgY2hlY2tpbmcgdG9rZW4gc3RhdHVzOiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InfWA7XG4gICAgfVxuICB9XG59Il19