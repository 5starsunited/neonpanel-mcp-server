"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.KeepaClient = void 0;
const axios_1 = __importDefault(require("axios"));
const types_1 = require("./types");
class KeepaClient {
    client;
    apiKey;
    baseUrl;
    rateLimitDelay;
    lastRequestTime = 0;
    constructor(config) {
        this.apiKey = config.apiKey;
        this.baseUrl = config.baseUrl || 'https://api.keepa.com';
        this.rateLimitDelay = config.rateLimitDelay || 1000;
        this.client = axios_1.default.create({
            baseURL: this.baseUrl,
            timeout: config.timeout || 30000,
            headers: {
                'User-Agent': 'Keepa-MCP-Server/1.0.0',
                'Accept': 'application/json',
            },
        });
        this.client.interceptors.request.use(this.requestInterceptor.bind(this));
        this.client.interceptors.response.use(this.responseInterceptor.bind(this), this.errorInterceptor.bind(this));
    }
    async requestInterceptor(config) {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < this.rateLimitDelay) {
            await new Promise(resolve => setTimeout(resolve, this.rateLimitDelay - timeSinceLastRequest));
        }
        this.lastRequestTime = Date.now();
        return config;
    }
    responseInterceptor(response) {
        return response;
    }
    errorInterceptor(error) {
        if (error.response?.data) {
            const { statusCode, error: errorMessage, tokensLeft } = error.response.data;
            // Enhanced token exhaustion detection
            if (tokensLeft !== undefined && tokensLeft <= 0) {
                throw new types_1.KeepaError(`⚠️ KEEPA TOKEN EXHAUSTION: You have ${tokensLeft} tokens remaining. ` +
                    `Please wait for tokens to refresh or upgrade your Keepa plan. ` +
                    `Check your token status at https://keepa.com/#!api`, statusCode, tokensLeft);
            }
            // Low token warning  
            if (tokensLeft !== undefined && tokensLeft < 5) {
                // console.warn(`🟡 LOW TOKENS WARNING: Only ${tokensLeft} tokens remaining. Consider upgrading your Keepa plan.`);
            }
            const message = typeof errorMessage === 'string' ? errorMessage :
                typeof errorMessage === 'object' ? JSON.stringify(errorMessage) :
                    'API request failed';
            throw new types_1.KeepaError(message, statusCode, tokensLeft);
        }
        const message = typeof error === 'string' ? error :
            error.message ? error.message :
                typeof error === 'object' ? JSON.stringify(error) :
                    'Network error';
        throw new types_1.KeepaError(message);
    }
    async makeRequest(endpoint, params = {}) {
        const response = await this.client.get(endpoint, {
            params: {
                key: this.apiKey,
                ...params,
            },
        });
        return response.data;
    }
    async getProduct(params) {
        if (!params.asin && !params.asins && !params.code) {
            throw new types_1.KeepaError('Either asin, asins, or code parameter is required');
        }
        const queryParams = { ...params };
        if (params.asins) {
            queryParams.asin = params.asins.join(',');
            delete queryParams.asins;
        }
        // Enable statistics by default for sales velocity and inventory analytics
        if (queryParams.stats === undefined) {
            queryParams.stats = 1; // Free analytics: sales velocity, buy box, inventory data
        }
        const response = await this.makeRequest('/product', queryParams);
        return response.products || [];
    }
    async getProductByAsin(asin, domain = types_1.KeepaDomain.US, options = {}) {
        const products = await this.getProduct({
            asin,
            domain,
            ...options
        });
        return products[0] || null;
    }
    async getProductsBatch(asins, domain = types_1.KeepaDomain.US, options = {}) {
        const batchSize = 100;
        const results = [];
        // Enable statistics by default for batch operations
        const optionsWithStats = { stats: 1, ...options };
        for (let i = 0; i < asins.length; i += batchSize) {
            const batch = asins.slice(i, i + batchSize);
            const products = await this.getProduct({
                asins: batch,
                domain,
                ...optionsWithStats
            });
            results.push(...products);
        }
        return results;
    }
    async getDeals(params) {
        const response = await this.makeRequest('/deal', params);
        return response.deals || [];
    }
    // NEW: Enhanced Deal Discovery with comprehensive filtering and analysis
    async discoverDeals(params) {
        try {
            const dealParams = {
                domainId: params.domain || 1,
                page: params.page || 0,
                perPage: Math.min(params.perPage || 25, 50)
            };
            // Price filters
            if (params.minPrice)
                dealParams.minPrice = params.minPrice;
            if (params.maxPrice)
                dealParams.maxPrice = params.maxPrice;
            // Discount filters
            if (params.minDiscount)
                dealParams.minDiscount = params.minDiscount;
            // Category filter
            if (params.categoryId)
                dealParams.categoryId = params.categoryId;
            // Rating filter  
            if (params.minRating)
                dealParams.minRating = params.minRating;
            // Deal type filters
            if (params.isPrime)
                dealParams.isPrime = params.isPrime;
            // Sort options
            const sortTypes = {
                'dealScore': 0,
                'price': 1,
                'discount': 2,
                'rating': 3,
                'salesRank': 4
            };
            dealParams.sortType = sortTypes[params.sortBy || 'dealScore'] || 0;
            const deals = await this.getDeals(dealParams);
            // Enhanced deal analysis with Deal object insights
            return deals.map((deal) => {
                // Safely extract deal metrics
                const discountPercent = this.extractDiscountPercent(deal.deltaPercent);
                const priceChange = this.extractPriceChange(deal.delta);
                // Determine deal urgency based on lightning deal timing  
                const isUrgent = deal.isLightningDeal && deal.lightningEnd ?
                    (Date.now() / 60000 - 21564000) < deal.lightningEnd : false;
                // Enhanced deal scoring
                let enhancedScore = deal.dealScore || 0;
                if (deal.isPrimeExclusive)
                    enhancedScore += 10;
                if (deal.isLightningDeal)
                    enhancedScore += 15;
                if (discountPercent > 50)
                    enhancedScore += 20;
                return {
                    ...deal,
                    // Enhanced analysis
                    discountPercent: discountPercent,
                    priceChange: priceChange,
                    enhancedDealScore: enhancedScore,
                    urgency: isUrgent ? 'HIGH' : deal.isLightningDeal ? 'MEDIUM' : 'LOW',
                    profitPotential: this.calculateProfitPotential(deal),
                    competitionLevel: this.assessDealCompetition(deal),
                    // Deal classification
                    dealType: deal.isLightningDeal ? 'Lightning' :
                        deal.coupon ? 'Coupon' :
                            deal.promotion ? 'Promotion' : 'Regular',
                    // Time sensitivity  
                    timeRemaining: deal.lightningEnd ?
                        Math.max(0, deal.lightningEnd - (Date.now() / 60000 - 21564000)) : null,
                    // Market insights
                    salesTrend: deal.salesRankReference && deal.salesRank ?
                        (deal.salesRankReference > deal.salesRank ? 'Improving' : 'Declining') : 'Stable'
                };
            })
                .filter((deal) => {
                // Apply additional filters
                if (params.minDealScore && deal.enhancedDealScore < params.minDealScore)
                    return false;
                if (params.isLightningDeal && !deal.isLightningDeal)
                    return false;
                if (params.maxDiscount && deal.discountPercent > params.maxDiscount)
                    return false;
                return true;
            })
                .sort((a, b) => {
                // Enhanced sorting with safe field access
                const field = params.sortBy || 'dealScore';
                const order = params.sortOrder === 'asc' ? 1 : -1;
                let aVal = field === 'dealScore' ? a.enhancedDealScore : (a[field] || 0);
                let bVal = field === 'dealScore' ? b.enhancedDealScore : (b[field] || 0);
                return (aVal - bVal) * order;
            });
        }
        catch (error) {
            console.warn('Deal discovery failed:', error);
            return [];
        }
    }
    // Helper methods for deal analysis
    extractDiscountPercent(deltaPercent) {
        if (!deltaPercent)
            return 0;
        if (typeof deltaPercent === 'number')
            return Math.abs(deltaPercent);
        if (Array.isArray(deltaPercent) && deltaPercent.length > 0) {
            const firstValue = deltaPercent[0];
            if (Array.isArray(firstValue) && firstValue.length > 0) {
                return Math.abs(firstValue[0]);
            }
            return Math.abs(firstValue);
        }
        return 0;
    }
    extractPriceChange(delta) {
        if (!delta)
            return 0;
        if (typeof delta === 'number')
            return Math.abs(delta);
        if (Array.isArray(delta) && delta.length > 0) {
            const firstValue = delta[0];
            if (Array.isArray(firstValue) && firstValue.length > 0) {
                return Math.abs(firstValue[0]);
            }
            return Math.abs(firstValue);
        }
        return 0;
    }
    calculateProfitPotential(deal) {
        const discount = this.extractDiscountPercent(deal.deltaPercent);
        const price = deal.price || 0;
        const rank = deal.salesRank || 999999;
        // Simple profit potential scoring
        let score = 0;
        if (discount > 30)
            score += 30;
        if (discount > 50)
            score += 20;
        if (price > 2000 && price < 10000)
            score += 20; // Sweet spot pricing
        if (rank < 10000)
            score += 20; // Good sales rank
        if (deal.isPrimeExclusive)
            score += 10;
        return score > 60 ? 'HIGH' : score > 30 ? 'MEDIUM' : 'LOW';
    }
    assessDealCompetition(deal) {
        // Based on category and sales rank - simplified assessment
        const rank = deal.salesRank || 999999;
        const hasMultipleSellers = true; // Would need marketplace data for accurate assessment
        if (rank < 1000)
            return 'HIGH';
        if (rank < 10000)
            return 'MEDIUM';
        return 'LOW';
    }
    async getSeller(params) {
        const response = await this.makeRequest('/seller', params);
        return response.sellers || [];
    }
    // NEW: Category Analysis for Market Intelligence
    async analyzeCategory(params) {
        try {
            // Get category data using enhanced product finder
            const searchParams = {
                categoryId: params.categoryId,
                domain: params.domain || 1,
                perPage: Math.min(params.sampleSize || 50, 50) // Larger sample for analysis
            };
            // Apply analysis-specific filters
            if (params.minRating) {
                searchParams.minRating = params.minRating;
            }
            // Price range filters (in cents)
            if (params.priceRange) {
                const priceRanges = {
                    'budget': { min: 0, max: 2500 },
                    'mid': { min: 2500, max: 7500 },
                    'premium': { min: 7500, max: 20000 },
                    'luxury': { min: 20000, max: 999999 } // Over $200
                };
                const range = priceRanges[params.priceRange];
                searchParams.minPrice = range.min;
                searchParams.maxPrice = range.max;
            }
            console.log(`Analyzing category ${params.categoryId} with ${params.analysisType || 'overview'} analysis...`);
            const products = await this.searchProducts(searchParams);
            if (products.length === 0) {
                return {
                    categoryId: params.categoryId,
                    analysisType: params.analysisType || 'overview',
                    error: 'No products found in category',
                    totalProducts: 0
                };
            }
            // Perform comprehensive market analysis
            const analysis = this.performCategoryAnalysis(products, params);
            return {
                categoryId: params.categoryId,
                categoryName: `Category ${params.categoryId}`,
                analysisType: params.analysisType || 'overview',
                sampleSize: products.length,
                ...analysis
            };
        }
        catch (error) {
            console.warn('Category analysis failed:', error);
            return {
                categoryId: params.categoryId,
                error: error?.message || 'Analysis failed',
                totalProducts: 0
            };
        }
    }
    // Comprehensive market analysis engine
    performCategoryAnalysis(products, params) {
        const validProducts = products.filter(p => p.price > 0);
        const prices = validProducts.map(p => p.price).filter(p => p > 0);
        const ratings = validProducts.filter(p => p.stats?.current[16]).map(p => p.stats.current[16] / 10);
        // Price analysis
        const priceStats = this.calculatePriceStatistics(prices);
        // Brand analysis
        const brandData = this.analyzeBrands(validProducts);
        // Competition analysis
        const competitionData = this.analyzeCompetition(validProducts);
        // Performance analysis
        const performanceData = this.analyzePerformance(validProducts);
        // Market insights based on analysis type
        const insights = this.generateMarketInsights(validProducts, params.analysisType);
        return {
            totalProducts: validProducts.length,
            priceAnalysis: priceStats,
            brandAnalysis: brandData,
            competitionAnalysis: competitionData,
            performanceAnalysis: performanceData,
            marketInsights: insights,
            opportunityScore: this.calculateOpportunityScore(validProducts),
            recommendations: this.generateRecommendations(validProducts, params)
        };
    }
    calculatePriceStatistics(prices) {
        if (prices.length === 0)
            return { error: 'No valid prices' };
        const sorted = prices.sort((a, b) => a - b);
        const avg = prices.reduce((sum, p) => sum + p, 0) / prices.length;
        return {
            averagePrice: avg,
            medianPrice: sorted[Math.floor(sorted.length / 2)],
            minPrice: sorted[0],
            maxPrice: sorted[sorted.length - 1],
            priceRange: { min: sorted[0], max: sorted[sorted.length - 1] },
            priceDistribution: this.categorizePrice(prices)
        };
    }
    categorizePrice(prices) {
        const ranges = [
            { label: 'Budget', min: 0, max: 2500, count: 0 },
            { label: 'Mid-range', min: 2500, max: 7500, count: 0 },
            { label: 'Premium', min: 7500, max: 20000, count: 0 },
            { label: 'Luxury', min: 20000, max: 999999, count: 0 }
        ];
        prices.forEach(price => {
            const range = ranges.find(r => price >= r.min && price < r.max);
            if (range)
                range.count++;
        });
        return ranges.map(r => ({
            range: r.label,
            count: r.count,
            percentage: ((r.count / prices.length) * 100).toFixed(1)
        }));
    }
    analyzeBrands(products) {
        const brandCounts = {};
        products.forEach(p => {
            const brand = p.brand || 'Unknown';
            brandCounts[brand] = (brandCounts[brand] || 0) + 1;
        });
        const topBrands = Object.entries(brandCounts)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
            .map(([brand, count]) => ({
            brand,
            productCount: count,
            marketShare: ((count / products.length) * 100).toFixed(1)
        }));
        return {
            totalBrands: Object.keys(brandCounts).length,
            topBrands,
            brandConcentration: topBrands.slice(0, 3).reduce((sum, b) => sum + parseFloat(b.marketShare), 0).toFixed(1)
        };
    }
    analyzeCompetition(products) {
        const validRanks = products.filter(p => p.stats?.current[3]).map(p => p.stats.current[3]);
        const avgRank = validRanks.length > 0 ? validRanks.reduce((sum, r) => sum + r, 0) / validRanks.length : 0;
        return {
            competitionLevel: avgRank < 10000 ? 'High' : avgRank < 50000 ? 'Medium' : 'Low',
            averageSalesRank: avgRank,
            marketSaturation: products.length > 40 ? 'High' : products.length > 20 ? 'Medium' : 'Low'
        };
    }
    analyzePerformance(products) {
        const ratingsData = products.filter(p => p.stats?.current[16]).map(p => p.stats.current[16] / 10);
        const avgRating = ratingsData.length > 0 ? ratingsData.reduce((sum, r) => sum + r, 0) / ratingsData.length : 0;
        return {
            averageRating: avgRating,
            totalRatedProducts: ratingsData.length,
            highRatedProducts: ratingsData.filter(r => r >= 4.0).length,
            qualityLevel: avgRating >= 4.2 ? 'Excellent' : avgRating >= 3.8 ? 'Good' : avgRating >= 3.0 ? 'Fair' : 'Poor'
        };
    }
    generateMarketInsights(products, analysisType) {
        const insights = [];
        const validProducts = products.filter(p => p.price > 0 && p.stats);
        if (validProducts.length === 0) {
            return ['Insufficient data for market insights'];
        }
        // Price insights
        const prices = validProducts.map(p => p.price);
        const avgPrice = prices.reduce((sum, p) => sum + p, 0) / prices.length;
        if (avgPrice < 2500) {
            insights.push('Budget-friendly category with high volume potential');
        }
        else if (avgPrice > 10000) {
            insights.push('Premium category with higher profit margins');
        }
        // Competition insights
        const ranks = validProducts.filter(p => p.stats.current[3]).map(p => p.stats.current[3]);
        const avgRank = ranks.length > 0 ? ranks.reduce((sum, r) => sum + r, 0) / ranks.length : 999999;
        if (avgRank < 10000) {
            insights.push('Highly competitive market - established players dominate');
        }
        else if (avgRank > 100000) {
            insights.push('Less competitive niche with growth opportunities');
        }
        // Product quality insights
        const ratings = validProducts.filter(p => p.stats.current[16]).map(p => p.stats.current[16] / 10);
        const avgRating = ratings.length > 0 ? ratings.reduce((sum, r) => sum + r, 0) / ratings.length : 0;
        if (avgRating >= 4.2) {
            insights.push('High-quality category - customer satisfaction is key');
        }
        else if (avgRating < 3.5) {
            insights.push('Quality improvement opportunity - many products underperform');
        }
        return insights;
    }
    calculateOpportunityScore(products) {
        let score = 50; // Base score
        const validProducts = products.filter(p => p.price > 0 && p.stats);
        if (validProducts.length === 0)
            return 0;
        // Competition factor
        const ranks = validProducts.filter(p => p.stats.current[3]).map(p => p.stats.current[3]);
        const avgRank = ranks.length > 0 ? ranks.reduce((sum, r) => sum + r, 0) / ranks.length : 999999;
        if (avgRank > 50000)
            score += 20; // Less competition
        if (avgRank > 100000)
            score += 10; // Even less competition
        // Quality factor
        const ratings = validProducts.filter(p => p.stats.current[16]).map(p => p.stats.current[16] / 10);
        const avgRating = ratings.length > 0 ? ratings.reduce((sum, r) => sum + r, 0) / ratings.length : 0;
        if (avgRating < 3.8)
            score += 15; // Room for improvement
        // Price factor
        const prices = validProducts.map(p => p.price);
        const avgPrice = prices.reduce((sum, p) => sum + p, 0) / prices.length;
        if (avgPrice > 2000 && avgPrice < 15000)
            score += 10; // Sweet spot pricing
        return Math.min(100, Math.max(0, score));
    }
    generateRecommendations(products, params) {
        const recommendations = [];
        const validProducts = products.filter(p => p.price > 0 && p.stats);
        if (validProducts.length === 0) {
            return ['Need more product data to generate recommendations'];
        }
        // Price recommendations
        const prices = validProducts.map(p => p.price);
        const avgPrice = prices.reduce((sum, p) => sum + p, 0) / prices.length;
        if (avgPrice < 2500) {
            recommendations.push('Consider volume-based strategies for this budget category');
        }
        else if (avgPrice > 10000) {
            recommendations.push('Focus on quality and premium positioning');
        }
        // Competition recommendations
        const ranks = validProducts.filter(p => p.stats.current[3]).map(p => p.stats.current[3]);
        const avgRank = ranks.length > 0 ? ranks.reduce((sum, r) => sum + r, 0) / ranks.length : 999999;
        if (avgRank < 10000) {
            recommendations.push('Highly competitive - differentiation and branding crucial');
        }
        else if (avgRank > 100000) {
            recommendations.push('Opportunity for market entry with good products');
        }
        // Quality recommendations
        const ratings = validProducts.filter(p => p.stats.current[16]).map(p => p.stats.current[16] / 10);
        const avgRating = ratings.length > 0 ? ratings.reduce((sum, r) => sum + r, 0) / ratings.length : 0;
        if (avgRating < 3.8) {
            recommendations.push('Quality improvement opportunity exists');
        }
        return recommendations;
    }
    async getBestSellers(params) {
        const response = await this.makeRequest('/bestsellers', params);
        return response.bestSellersList || [];
    }
    // NEW: Inventory Analysis Engine - Portfolio Management & Risk Assessment
    async analyzeInventory(params) {
        try {
            // Get sales velocity data for inventory analysis
            const velocityData = await this.analyzeSalesVelocity({
                categoryId: params.categoryId,
                asins: params.asins,
                domain: params.domain || 1,
                timeframe: params.timeframe || 'month'
            });
            // Analyze inventory metrics
            const analysis = this.performInventoryAnalysis(velocityData, params);
            return {
                analysisType: params.analysisType || 'overview',
                totalProducts: velocityData.length,
                averageTurnoverRate: this.calculateAverageTurnover(velocityData),
                fastMovers: velocityData.filter(p => p.salesVelocity.monthly >= 30),
                slowMovers: velocityData.filter(p => p.salesVelocity.monthly < 10),
                stockoutRisks: velocityData.filter(p => p.inventoryMetrics.stockoutRisk === 'High'),
                seasonalPatterns: this.analyzeSeasonalPatterns(velocityData),
                recommendations: this.generateInventoryRecommendations(velocityData, params.targetTurnoverRate || 12),
                ...analysis
            };
        }
        catch (error) {
            console.warn('Inventory analysis failed:', error);
            return {
                analysisType: params.analysisType || 'overview',
                error: 'Failed to analyze inventory',
                totalProducts: 0
            };
        }
    }
    // Comprehensive inventory analysis engine
    performInventoryAnalysis(velocityData, params) {
        const totalProducts = velocityData.length;
        if (totalProducts === 0)
            return { recommendations: ['No products to analyze'] };
        // Performance metrics
        const avgVelocity = velocityData.reduce((sum, p) => sum + p.salesVelocity.monthly, 0) / totalProducts;
        const avgTurnover = this.calculateAverageTurnover(velocityData);
        // Risk assessment
        const highRiskCount = velocityData.filter(p => p.inventoryMetrics.stockoutRisk === 'High').length;
        const slowMoversCount = velocityData.filter(p => p.salesVelocity.monthly < 10).length;
        const fastMoversCount = velocityData.filter(p => p.salesVelocity.monthly >= 30).length;
        // Cash flow analysis
        const totalRevenue = velocityData.reduce((sum, p) => sum + p.profitability.revenueVelocity, 0);
        const avgDaysInventory = velocityData.reduce((sum, p) => sum + p.inventoryMetrics.daysOfInventory, 0) / totalProducts;
        return {
            performanceMetrics: {
                averageVelocity: Math.round(avgVelocity * 10) / 10,
                averageTurnoverRate: avgTurnover,
                totalRevenue: Math.round(totalRevenue * 100) / 100,
                averageDaysInventory: Math.round(avgDaysInventory)
            },
            riskAssessment: {
                highRiskProducts: highRiskCount,
                riskPercentage: Math.round((highRiskCount / totalProducts) * 100),
                slowMoversRatio: Math.round((slowMoversCount / totalProducts) * 100),
                fastMoversRatio: Math.round((fastMoversCount / totalProducts) * 100)
            },
            cashFlowMetrics: {
                inventoryTurns: avgTurnover,
                avgDaysToSell: avgDaysInventory,
                portfolioHealth: this.assessPortfolioHealth(velocityData)
            }
        };
    }
    calculateAverageTurnover(velocityData) {
        if (velocityData.length === 0)
            return 0;
        const totalTurnover = velocityData.reduce((sum, p) => sum + p.inventoryMetrics.turnoverRate, 0);
        return Math.round((totalTurnover / velocityData.length) * 10) / 10;
    }
    analyzeSeasonalPatterns(velocityData) {
        // Seasonal analysis patterns
        const patterns = [
            {
                period: 'Q4 Holiday Season (Oct-Dec)',
                velocityMultiplier: 2.8,
                recommendation: 'Increase inventory 60-90 days before Black Friday'
            },
            {
                period: 'Back-to-School (Jul-Aug)',
                velocityMultiplier: 1.7,
                recommendation: 'Stock seasonal products and office supplies'
            },
            {
                period: 'Summer Peak (May-Jul)',
                velocityMultiplier: 1.4,
                recommendation: 'Monitor outdoor and recreational products'
            },
            {
                period: 'Post-Holiday Slowdown (Jan-Feb)',
                velocityMultiplier: 0.6,
                recommendation: 'Reduce inventory and focus on clearance'
            }
        ];
        return patterns;
    }
    generateInventoryRecommendations(velocityData, targetTurnover) {
        const recommendations = [];
        if (velocityData.length === 0) {
            return ['No products to analyze - consider expanding product portfolio'];
        }
        const avgVelocity = velocityData.reduce((sum, p) => sum + p.salesVelocity.monthly, 0) / velocityData.length;
        const highRiskCount = velocityData.filter(p => p.inventoryMetrics.stockoutRisk === 'High').length;
        const slowMoversCount = velocityData.filter(p => p.salesVelocity.monthly < 10).length;
        const fastMoversCount = velocityData.filter(p => p.salesVelocity.monthly >= 30).length;
        // Performance recommendations
        if (avgVelocity > 25) {
            recommendations.push('🚀 Strong portfolio velocity - maintain current sourcing strategy');
        }
        else if (avgVelocity < 15) {
            recommendations.push('⚠️ Low portfolio velocity - consider more aggressive pricing and promotion');
        }
        else {
            recommendations.push('➡️ Moderate velocity - optimize product mix for better performance');
        }
        // Risk management recommendations  
        if (highRiskCount > velocityData.length * 0.2) {
            recommendations.push('🔴 High stockout risk exposure - implement automated reorder points');
        }
        else if (highRiskCount > 0) {
            recommendations.push('🟡 Monitor stockout risks - set up velocity alerts for fast movers');
        }
        // Product mix recommendations
        if (slowMoversCount > velocityData.length * 0.4) {
            recommendations.push('🐌 Too many slow movers - implement liquidation strategy for bottom 20%');
        }
        if (fastMoversCount < velocityData.length * 0.2) {
            recommendations.push('📈 Need more fast movers - research trending products in successful categories');
        }
        // Cash flow recommendations
        const avgDaysInventory = velocityData.reduce((sum, p) => sum + p.inventoryMetrics.daysOfInventory, 0) / velocityData.length;
        if (avgDaysInventory > 45) {
            recommendations.push('💰 High inventory levels - optimize reorder quantities to improve cash flow');
        }
        else if (avgDaysInventory < 15) {
            recommendations.push('⚡ Low inventory levels - consider increasing safety stock to avoid stockouts');
        }
        // Operational recommendations
        recommendations.push('📊 Monitor velocity weekly and adjust reorder points based on trend changes');
        recommendations.push('🎯 Target 20-35 day inventory levels for optimal cash flow balance');
        recommendations.push('📈 Focus marketing budget on products with accelerating velocity trends');
        return recommendations;
    }
    assessPortfolioHealth(velocityData) {
        const fastMovers = velocityData.filter(p => p.salesVelocity.monthly >= 30).length;
        const slowMovers = velocityData.filter(p => p.salesVelocity.monthly < 10).length;
        const totalProducts = velocityData.length;
        const fastRatio = fastMovers / totalProducts;
        const slowRatio = slowMovers / totalProducts;
        if (fastRatio > 0.3 && slowRatio < 0.3) {
            return 'Excellent - High velocity, low risk portfolio';
        }
        else if (fastRatio > 0.2 && slowRatio < 0.4) {
            return 'Good - Balanced velocity with manageable risk';
        }
        else if (slowRatio > 0.5) {
            return 'Poor - Too many slow movers impacting cash flow';
        }
        else {
            return 'Fair - Room for improvement in velocity optimization';
        }
    }
    async searchProducts(params) {
        // Enhanced Product Finder with complete parameter set from documentation
        try {
            const selection = {};
            // Core filters with category validation
            if (params.categoryId) {
                const categoryName = (0, types_1.getCategoryName)(params.categoryId);
                if (!categoryName) {
                    // console.warn(`⚠️ CATEGORY WARNING: Category ID ${params.categoryId} not found in verified categories. This may cause empty results.`);
                    const suggestedCategories = Object.entries(types_1.VERIFIED_AMAZON_CATEGORIES)
                        .slice(0, 5)
                        .map(([name, id]) => `${name} (${id})`)
                        .join(', ');
                    // console.warn(`💡 SUGGESTED CATEGORIES: ${suggestedCategories}`);
                }
                else {
                    // console.log(`✅ Using verified category: ${categoryName} (${params.categoryId})`);
                }
                // FIXED: Use rootCategory array format as per API syntax
                selection.rootCategory = [params.categoryId.toString()];
            }
            // Price filters (in cents)
            if (params.minPrice || params.maxPrice) {
                selection.current_AMAZON = {};
                if (params.minPrice)
                    selection.current_AMAZON.gte = params.minPrice;
                if (params.maxPrice)
                    selection.current_AMAZON.lte = params.maxPrice;
            }
            // FIXED: Shipping cost filters using BUY_BOX_SHIPPING
            if (params.minShipping) {
                selection.current_BUY_BOX_SHIPPING_gte = params.minShipping;
            }
            if (params.maxShipping) {
                selection.current_BUY_BOX_SHIPPING_lte = params.maxShipping;
            }
            // FIXED: Rating filters (Keepa uses 10x scale: 4.5 stars = 45)
            if (params.minRating) {
                selection.current_RATING_gte = Math.floor(params.minRating * 10);
            }
            if (params.maxRating) {
                selection.current_RATING_lte = Math.floor(params.maxRating * 10);
            }
            // FIXED: Sales velocity filters (estimated monthly sales)
            if (params.minMonthlySales) {
                selection.monthlySold_gte = params.minMonthlySales;
            }
            if (params.maxMonthlySales) {
                selection.monthlySold_lte = params.maxMonthlySales;
            }
            // FIXED: Competition filters (90-day average seller count)
            if (params.minSellerCount) {
                selection.avg90_COUNT_NEW_gte = params.minSellerCount;
            }
            if (params.maxSellerCount) {
                selection.avg90_COUNT_NEW_lte = params.maxSellerCount;
            }
            // NEW: Review count filter
            if (params.minReviewCount || params.hasReviews === true) {
                selection.current_COUNT_REVIEWS = {};
                if (params.minReviewCount) {
                    selection.current_COUNT_REVIEWS.gte = params.minReviewCount;
                }
                else if (params.hasReviews === true) {
                    selection.current_COUNT_REVIEWS.gte = 1;
                }
            }
            // NEW: Prime eligibility filter
            if (params.isPrime === true) {
                selection.isPrime = true;
            }
            // NEW: Sales rank filters (lower rank = better selling)
            if (params.minSalesRank || params.maxSalesRank) {
                selection.current_SALES_RANK = {};
                if (params.minSalesRank)
                    selection.current_SALES_RANK.gte = params.minSalesRank;
                if (params.maxSalesRank)
                    selection.current_SALES_RANK.lte = params.maxSalesRank;
            }
            // FIXED: Add productType array (standard products = "0")
            selection.productType = ["0"];
            // NEW: Add lastRatingUpdate filter for fresh data
            // This ensures products have recent rating updates (data freshness)
            // Value appears to be in Keepa time format (days since epoch?)
            if (params.includeRecentRatings !== false) {
                // Use a reasonable default for recent rating updates
                selection.lastRatingUpdate_gte = 7547800; // From API example
            }
            // FIXED: Add sort parameter in correct format
            if (params.sortBy) {
                const sortOrder = params.sortOrder || 'desc';
                selection.sort = [[params.sortBy, sortOrder]];
            }
            else {
                // Default sort by monthly sales descending
                selection.sort = [["monthlySold", "desc"]];
            }
            // Debug log for troubleshooting (uncomment when debugging)
            // console.log('🔍 Selection object:', JSON.stringify(selection, null, 2));
            // Get ASINs from query endpoint
            const queryResponse = await this.makeRequest('/query', {
                domain: params.domain || 1,
                selection: JSON.stringify(selection),
                page: params.page || 0,
                perPage: Math.min(params.perPage || 25, 50) // Keepa limit is 50
            });
            if (queryResponse.asinList && queryResponse.asinList.length > 0) {
                // Get detailed product data for the ASINs
                const detailedProducts = await this.getProductsBatch(queryResponse.asinList, params.domain || 1, {
                    rating: true,
                    offers: 20,
                    stats: 1 // CRITICAL: Include statistics data for seller counts
                });
                return detailedProducts.map(product => ({
                    ...product,
                    searchScore: queryResponse.totalResults,
                    isFromQuery: true
                }));
            }
        }
        catch (error) {
            console.warn('Query endpoint failed, falling back to best sellers:', error);
            // Fallback to best sellers approach if query fails
            if (params.categoryId) {
                try {
                    const bestSellers = await this.getBestSellers({
                        domain: params.domain || 1,
                        category: params.categoryId,
                        page: params.page || 0
                    });
                    if (bestSellers.length > 0) {
                        const asinList = bestSellers.slice(0, params.perPage || 25).map(bs => bs.asin);
                        const detailedProducts = await this.getProductsBatch(asinList, params.domain || 1, {
                            rating: true,
                            offers: 20,
                            stats: 1 // CRITICAL: Include statistics data for seller counts
                        });
                        return detailedProducts.map((product, index) => {
                            const bestSeller = bestSellers[index];
                            return {
                                ...product,
                                monthlySold: Math.max(100, Math.floor(2000 - (bestSeller.salesRank / 100))),
                                bestSellerRank: bestSeller.salesRank,
                                isFromBestSellers: true
                            };
                        });
                    }
                }
                catch (fallbackError) {
                    console.warn('Best sellers fallback also failed:', fallbackError);
                }
            }
        }
        return [];
    }
    async getTokensLeft() {
        const response = await this.makeRequest('/token');
        return response.tokensLeft;
    }
    // NEW: Sales Velocity Analysis using Statistics Object (FREE analytics)
    async analyzeSalesVelocity(params) {
        let products = [];
        if (params.asin || params.asins) {
            // Analyze specific products
            const asins = params.asins || [params.asin];
            products = await this.getProductsBatch(asins, params.domain || 1, {
                stats: 1,
                rating: true
            });
        }
        else if (params.categoryId) {
            // Find products in category and analyze velocity
            const searchResults = await this.searchProducts({
                categoryId: params.categoryId,
                domain: params.domain || 1,
                perPage: 25
            });
            products = searchResults;
        }
        return products.map(product => {
            const stats = product.stats;
            if (!stats)
                return null;
            // Calculate sales velocity from Statistics object
            const currentSalesRank = stats.current[3]; // Sales rank data type
            const avgSalesRank = stats.avg[3];
            // Estimate daily sales based on sales rank (industry formula)
            const estimatedDailySales = currentSalesRank > 0 ?
                Math.max(1, Math.floor(1000000 / Math.sqrt(currentSalesRank))) : 0;
            const weeklySales = estimatedDailySales * 7;
            const monthlySales = estimatedDailySales * 30;
            // Calculate inventory metrics
            const buyBoxPrice = stats.buyBoxPrice || 0;
            const outOfStockPercentage = stats.outOfStockPercentage30 || 0;
            const turnoverRate = outOfStockPercentage < 50 ?
                Math.max(1, 12 - (outOfStockPercentage / 10)) : 1;
            return {
                asin: product.asin,
                title: product.title,
                brand: product.brand,
                price: buyBoxPrice,
                salesVelocity: {
                    daily: estimatedDailySales,
                    weekly: weeklySales,
                    monthly: monthlySales,
                    trend: avgSalesRank > currentSalesRank ? 'Accelerating' :
                        avgSalesRank < currentSalesRank ? 'Declining' : 'Stable',
                    changePercent: avgSalesRank > 0 ?
                        Math.round(((avgSalesRank - currentSalesRank) / avgSalesRank) * 100) : 0
                },
                inventoryMetrics: {
                    turnoverRate: turnoverRate,
                    daysOfInventory: Math.ceil(30 / Math.max(1, estimatedDailySales)),
                    stockoutRisk: outOfStockPercentage > 30 ? 'High' :
                        outOfStockPercentage > 15 ? 'Medium' : 'Low',
                    recommendedOrderQuantity: Math.ceil(estimatedDailySales * 30)
                },
                marketMetrics: {
                    rating: stats.current[16] ? stats.current[16] / 10 : 0,
                    salesRank: currentSalesRank,
                    competition: 'Medium',
                    seasonality: 'Medium' // Will enhance with historical analysis
                },
                profitability: {
                    revenueVelocity: estimatedDailySales * (buyBoxPrice / 100),
                    estimatedMargin: 0.25,
                    profitVelocity: estimatedDailySales * (buyBoxPrice / 100) * 0.25
                }
            };
        }).filter(item => {
            if (!item)
                return false;
            if (params.minVelocity && item.salesVelocity.daily < params.minVelocity)
                return false;
            return true;
        });
    }
    parseCSVData(csvData, dataType) {
        if (!csvData[dataType]) {
            return [];
        }
        const data = csvData[dataType];
        const result = [];
        for (let i = 0; i < data.length; i += 2) {
            if (i + 1 < data.length) {
                const timestamp = this.keepaTimeToUnixTime(data[i]);
                const value = data[i + 1];
                result.push({ timestamp, value });
            }
        }
        return result;
    }
    keepaTimeToUnixTime(keepaTime) {
        return (keepaTime + 21564000) * 60000;
    }
    unixTimeToKeepaTime(unixTime) {
        return Math.floor(unixTime / 60000) - 21564000;
    }
    formatPrice(price, domain = types_1.KeepaDomain.US) {
        if (price === -1)
            return 'N/A';
        const currencies = {
            [types_1.KeepaDomain.US]: '$',
            [types_1.KeepaDomain.UK]: '£',
            [types_1.KeepaDomain.DE]: '€',
            [types_1.KeepaDomain.FR]: '€',
            [types_1.KeepaDomain.JP]: '¥',
            [types_1.KeepaDomain.CA]: 'C$',
            [types_1.KeepaDomain.CN]: '¥',
            [types_1.KeepaDomain.IT]: '€',
            [types_1.KeepaDomain.ES]: '€',
            [types_1.KeepaDomain.IN]: '₹',
            [types_1.KeepaDomain.MX]: '$'
        };
        const currency = currencies[domain] || '$';
        const formattedPrice = (price / 100).toFixed(2);
        return `${currency}${formattedPrice}`;
    }
    getDomainName(domain) {
        const domains = {
            [types_1.KeepaDomain.US]: 'amazon.com',
            [types_1.KeepaDomain.UK]: 'amazon.co.uk',
            [types_1.KeepaDomain.DE]: 'amazon.de',
            [types_1.KeepaDomain.FR]: 'amazon.fr',
            [types_1.KeepaDomain.JP]: 'amazon.co.jp',
            [types_1.KeepaDomain.CA]: 'amazon.ca',
            [types_1.KeepaDomain.CN]: 'amazon.cn',
            [types_1.KeepaDomain.IT]: 'amazon.it',
            [types_1.KeepaDomain.ES]: 'amazon.es',
            [types_1.KeepaDomain.IN]: 'amazon.in',
            [types_1.KeepaDomain.MX]: 'amazon.com.mx'
        };
        return domains[domain] || 'amazon.com';
    }
    /**
     * Get seller count for a product based on specified timeframe
     * @param product - Keepa product object with stats
     * @param timeframe - Timeframe to use for seller count
     * @returns Seller count and timeframe description
     */
    getSellerCount(product, timeframe = '90day') {
        if (!product?.stats) {
            return { count: 1, description: '90-day average (no stats available)' };
        }
        const { stats } = product;
        const COUNT_NEW_INDEX = 11; // DataType.COUNT_NEW
        switch (timeframe) {
            case 'current':
                return {
                    count: stats.current?.[COUNT_NEW_INDEX] ?? 1,
                    description: 'current'
                };
            case '30day':
                return {
                    count: stats.avg30?.[COUNT_NEW_INDEX] ?? 1,
                    description: '30-day average'
                };
            case '90day':
                return {
                    count: stats.avg90?.[COUNT_NEW_INDEX] ?? 1,
                    description: '90-day average'
                };
            case '180day':
                return {
                    count: stats.avg180?.[COUNT_NEW_INDEX] ?? 1,
                    description: '180-day average'
                };
            case '365day':
                return {
                    count: stats.avg365?.[COUNT_NEW_INDEX] ?? 1,
                    description: '365-day average'
                };
            default:
                // Default to 90-day if invalid timeframe
                return {
                    count: stats.avg90?.[COUNT_NEW_INDEX] ?? 1,
                    description: '90-day average (default)'
                };
        }
    }
}
exports.KeepaClient = KeepaClient;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoia2VlcGEtY2xpZW50LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsia2VlcGEtY2xpZW50LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7OztBQUFBLGtEQUF5RTtBQUN6RSxtQ0FnQmlCO0FBRWpCLE1BQWEsV0FBVztJQUNkLE1BQU0sQ0FBZ0I7SUFDdEIsTUFBTSxDQUFTO0lBQ2YsT0FBTyxDQUFTO0lBQ2hCLGNBQWMsQ0FBUztJQUN2QixlQUFlLEdBQVcsQ0FBQyxDQUFDO0lBRXBDLFlBQVksTUFBbUI7UUFDN0IsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDO1FBQzVCLElBQUksQ0FBQyxPQUFPLEdBQUcsTUFBTSxDQUFDLE9BQU8sSUFBSSx1QkFBdUIsQ0FBQztRQUN6RCxJQUFJLENBQUMsY0FBYyxHQUFHLE1BQU0sQ0FBQyxjQUFjLElBQUksSUFBSSxDQUFDO1FBRXBELElBQUksQ0FBQyxNQUFNLEdBQUcsZUFBSyxDQUFDLE1BQU0sQ0FBQztZQUN6QixPQUFPLEVBQUUsSUFBSSxDQUFDLE9BQU87WUFDckIsT0FBTyxFQUFFLE1BQU0sQ0FBQyxPQUFPLElBQUksS0FBSztZQUNoQyxPQUFPLEVBQUU7Z0JBQ1AsWUFBWSxFQUFFLHdCQUF3QjtnQkFDdEMsUUFBUSxFQUFFLGtCQUFrQjthQUM3QjtTQUNGLENBQUMsQ0FBQztRQUVILElBQUksQ0FBQyxNQUFNLENBQUMsWUFBWSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLGtCQUFrQixDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO1FBQ3pFLElBQUksQ0FBQyxNQUFNLENBQUMsWUFBWSxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQ25DLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEVBQ25DLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQ2pDLENBQUM7SUFDSixDQUFDO0lBRU8sS0FBSyxDQUFDLGtCQUFrQixDQUFDLE1BQWtDO1FBQ2pFLE1BQU0sR0FBRyxHQUFHLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQztRQUN2QixNQUFNLG9CQUFvQixHQUFHLEdBQUcsR0FBRyxJQUFJLENBQUMsZUFBZSxDQUFDO1FBRXhELElBQUksb0JBQW9CLEdBQUcsSUFBSSxDQUFDLGNBQWMsRUFBRTtZQUM5QyxNQUFNLElBQUksT0FBTyxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQzFCLFVBQVUsQ0FBQyxPQUFPLEVBQUUsSUFBSSxDQUFDLGNBQWMsR0FBRyxvQkFBb0IsQ0FBQyxDQUNoRSxDQUFDO1NBQ0g7UUFFRCxJQUFJLENBQUMsZUFBZSxHQUFHLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQztRQUNsQyxPQUFPLE1BQU0sQ0FBQztJQUNoQixDQUFDO0lBRU8sbUJBQW1CLENBQUMsUUFBYTtRQUN2QyxPQUFPLFFBQVEsQ0FBQztJQUNsQixDQUFDO0lBRU8sZ0JBQWdCLENBQUMsS0FBVTtRQUNqQyxJQUFJLEtBQUssQ0FBQyxRQUFRLEVBQUUsSUFBSSxFQUFFO1lBQ3hCLE1BQU0sRUFBRSxVQUFVLEVBQUUsS0FBSyxFQUFFLFlBQVksRUFBRSxVQUFVLEVBQUUsR0FBRyxLQUFLLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQztZQUU1RSxzQ0FBc0M7WUFDdEMsSUFBSSxVQUFVLEtBQUssU0FBUyxJQUFJLFVBQVUsSUFBSSxDQUFDLEVBQUU7Z0JBQy9DLE1BQU0sSUFBSSxrQkFBVSxDQUNsQix1Q0FBdUMsVUFBVSxxQkFBcUI7b0JBQ3RFLGdFQUFnRTtvQkFDaEUsb0RBQW9ELEVBQ3BELFVBQVUsRUFDVixVQUFVLENBQ1gsQ0FBQzthQUNIO1lBRUQsc0JBQXNCO1lBQ3RCLElBQUksVUFBVSxLQUFLLFNBQVMsSUFBSSxVQUFVLEdBQUcsQ0FBQyxFQUFFO2dCQUM5QyxtSEFBbUg7YUFDcEg7WUFFRCxNQUFNLE9BQU8sR0FBRyxPQUFPLFlBQVksS0FBSyxRQUFRLENBQUMsQ0FBQyxDQUFDLFlBQVksQ0FBQyxDQUFDO2dCQUNsRCxPQUFPLFlBQVksS0FBSyxRQUFRLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQztvQkFDakUsb0JBQW9CLENBQUM7WUFDcEMsTUFBTSxJQUFJLGtCQUFVLENBQ2xCLE9BQU8sRUFDUCxVQUFVLEVBQ1YsVUFBVSxDQUNYLENBQUM7U0FDSDtRQUNELE1BQU0sT0FBTyxHQUFHLE9BQU8sS0FBSyxLQUFLLFFBQVEsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUM7WUFDbkMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDO2dCQUMvQixPQUFPLEtBQUssS0FBSyxRQUFRLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQztvQkFDbkQsZUFBZSxDQUFDO1FBQ2hDLE1BQU0sSUFBSSxrQkFBVSxDQUFDLE9BQU8sQ0FBQyxDQUFDO0lBQ2hDLENBQUM7SUFFTyxLQUFLLENBQUMsV0FBVyxDQUN2QixRQUFnQixFQUNoQixTQUE4QixFQUFFO1FBRWhDLE1BQU0sUUFBUSxHQUFHLE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsUUFBUSxFQUFFO1lBQy9DLE1BQU0sRUFBRTtnQkFDTixHQUFHLEVBQUUsSUFBSSxDQUFDLE1BQU07Z0JBQ2hCLEdBQUcsTUFBTTthQUNWO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsT0FBTyxRQUFRLENBQUMsSUFBSSxDQUFDO0lBQ3ZCLENBQUM7SUFFRCxLQUFLLENBQUMsVUFBVSxDQUFDLE1BQTBCO1FBQ3pDLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUU7WUFDakQsTUFBTSxJQUFJLGtCQUFVLENBQUMsbURBQW1ELENBQUMsQ0FBQztTQUMzRTtRQUVELE1BQU0sV0FBVyxHQUF3QixFQUFFLEdBQUcsTUFBTSxFQUFFLENBQUM7UUFFdkQsSUFBSSxNQUFNLENBQUMsS0FBSyxFQUFFO1lBQ2hCLFdBQVcsQ0FBQyxJQUFJLEdBQUcsTUFBTSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUM7WUFDMUMsT0FBTyxXQUFXLENBQUMsS0FBSyxDQUFDO1NBQzFCO1FBRUQsMEVBQTBFO1FBQzFFLElBQUksV0FBVyxDQUFDLEtBQUssS0FBSyxTQUFTLEVBQUU7WUFDbkMsV0FBVyxDQUFDLEtBQUssR0FBRyxDQUFDLENBQUMsQ0FBQywwREFBMEQ7U0FDbEY7UUFFRCxNQUFNLFFBQVEsR0FBRyxNQUFNLElBQUksQ0FBQyxXQUFXLENBQStCLFVBQVUsRUFBRSxXQUFXLENBQUMsQ0FBQztRQUMvRixPQUFRLFFBQWdCLENBQUMsUUFBUSxJQUFJLEVBQUUsQ0FBQztJQUMxQyxDQUFDO0lBRUQsS0FBSyxDQUFDLGdCQUFnQixDQUFDLElBQVksRUFBRSxTQUFzQixtQkFBVyxDQUFDLEVBQUUsRUFBRSxVQUF1QyxFQUFFO1FBQ2xILE1BQU0sUUFBUSxHQUFHLE1BQU0sSUFBSSxDQUFDLFVBQVUsQ0FBQztZQUNyQyxJQUFJO1lBQ0osTUFBTTtZQUNOLEdBQUcsT0FBTztTQUNYLENBQUMsQ0FBQztRQUNILE9BQU8sUUFBUSxDQUFDLENBQUMsQ0FBQyxJQUFJLElBQUksQ0FBQztJQUM3QixDQUFDO0lBRUQsS0FBSyxDQUFDLGdCQUFnQixDQUFDLEtBQWUsRUFBRSxTQUFzQixtQkFBVyxDQUFDLEVBQUUsRUFBRSxVQUF1QyxFQUFFO1FBQ3JILE1BQU0sU0FBUyxHQUFHLEdBQUcsQ0FBQztRQUN0QixNQUFNLE9BQU8sR0FBbUIsRUFBRSxDQUFDO1FBRW5DLG9EQUFvRDtRQUNwRCxNQUFNLGdCQUFnQixHQUFHLEVBQUUsS0FBSyxFQUFFLENBQUMsRUFBRSxHQUFHLE9BQU8sRUFBRSxDQUFDO1FBRWxELEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxLQUFLLENBQUMsTUFBTSxFQUFFLENBQUMsSUFBSSxTQUFTLEVBQUU7WUFDaEQsTUFBTSxLQUFLLEdBQUcsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsQ0FBQyxHQUFHLFNBQVMsQ0FBQyxDQUFDO1lBQzVDLE1BQU0sUUFBUSxHQUFHLE1BQU0sSUFBSSxDQUFDLFVBQVUsQ0FBQztnQkFDckMsS0FBSyxFQUFFLEtBQUs7Z0JBQ1osTUFBTTtnQkFDTixHQUFHLGdCQUFnQjthQUNwQixDQUFDLENBQUM7WUFDSCxPQUFPLENBQUMsSUFBSSxDQUFDLEdBQUcsUUFBUSxDQUFDLENBQUM7U0FDM0I7UUFFRCxPQUFPLE9BQU8sQ0FBQztJQUNqQixDQUFDO0lBRUQsS0FBSyxDQUFDLFFBQVEsQ0FBQyxNQUF1QjtRQUNwQyxNQUFNLFFBQVEsR0FBRyxNQUFNLElBQUksQ0FBQyxXQUFXLENBQXlCLE9BQU8sRUFBRSxNQUFNLENBQUMsQ0FBQztRQUNqRixPQUFRLFFBQWdCLENBQUMsS0FBSyxJQUFJLEVBQUUsQ0FBQztJQUN2QyxDQUFDO0lBRUQseUVBQXlFO0lBQ3pFLEtBQUssQ0FBQyxhQUFhLENBQUMsTUFnQm5CO1FBQ0MsSUFBSTtZQUNGLE1BQU0sVUFBVSxHQUFRO2dCQUN0QixRQUFRLEVBQUUsTUFBTSxDQUFDLE1BQU0sSUFBSSxDQUFDO2dCQUM1QixJQUFJLEVBQUUsTUFBTSxDQUFDLElBQUksSUFBSSxDQUFDO2dCQUN0QixPQUFPLEVBQUUsSUFBSSxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsT0FBTyxJQUFJLEVBQUUsRUFBRSxFQUFFLENBQUM7YUFDNUMsQ0FBQztZQUVGLGdCQUFnQjtZQUNoQixJQUFJLE1BQU0sQ0FBQyxRQUFRO2dCQUFFLFVBQVUsQ0FBQyxRQUFRLEdBQUcsTUFBTSxDQUFDLFFBQVEsQ0FBQztZQUMzRCxJQUFJLE1BQU0sQ0FBQyxRQUFRO2dCQUFFLFVBQVUsQ0FBQyxRQUFRLEdBQUcsTUFBTSxDQUFDLFFBQVEsQ0FBQztZQUUzRCxtQkFBbUI7WUFDbkIsSUFBSSxNQUFNLENBQUMsV0FBVztnQkFBRSxVQUFVLENBQUMsV0FBVyxHQUFHLE1BQU0sQ0FBQyxXQUFXLENBQUM7WUFFcEUsa0JBQWtCO1lBQ2xCLElBQUksTUFBTSxDQUFDLFVBQVU7Z0JBQUUsVUFBVSxDQUFDLFVBQVUsR0FBRyxNQUFNLENBQUMsVUFBVSxDQUFDO1lBRWpFLGtCQUFrQjtZQUNsQixJQUFJLE1BQU0sQ0FBQyxTQUFTO2dCQUFFLFVBQVUsQ0FBQyxTQUFTLEdBQUcsTUFBTSxDQUFDLFNBQVMsQ0FBQztZQUU5RCxvQkFBb0I7WUFDcEIsSUFBSSxNQUFNLENBQUMsT0FBTztnQkFBRSxVQUFVLENBQUMsT0FBTyxHQUFHLE1BQU0sQ0FBQyxPQUFPLENBQUM7WUFFeEQsZUFBZTtZQUNmLE1BQU0sU0FBUyxHQUFHO2dCQUNoQixXQUFXLEVBQUUsQ0FBQztnQkFDZCxPQUFPLEVBQUUsQ0FBQztnQkFDVixVQUFVLEVBQUUsQ0FBQztnQkFDYixRQUFRLEVBQUUsQ0FBQztnQkFDWCxXQUFXLEVBQUUsQ0FBQzthQUNmLENBQUM7WUFDRixVQUFVLENBQUMsUUFBUSxHQUFHLFNBQVMsQ0FBQyxNQUFNLENBQUMsTUFBTSxJQUFJLFdBQVcsQ0FBQyxJQUFJLENBQUMsQ0FBQztZQUVuRSxNQUFNLEtBQUssR0FBRyxNQUFNLElBQUksQ0FBQyxRQUFRLENBQUMsVUFBVSxDQUFDLENBQUM7WUFFOUMsbURBQW1EO1lBQ25ELE9BQU8sS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQVMsRUFBRSxFQUFFO2dCQUM3Qiw4QkFBOEI7Z0JBQzlCLE1BQU0sZUFBZSxHQUFHLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUM7Z0JBQ3ZFLE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUM7Z0JBRXhELDBEQUEwRDtnQkFDMUQsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLGVBQWUsSUFBSSxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUM7b0JBQzFELENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxHQUFHLEtBQUssR0FBRyxRQUFRLENBQUMsR0FBRyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUM7Z0JBRTlELHdCQUF3QjtnQkFDeEIsSUFBSSxhQUFhLEdBQUcsSUFBSSxDQUFDLFNBQVMsSUFBSSxDQUFDLENBQUM7Z0JBQ3hDLElBQUksSUFBSSxDQUFDLGdCQUFnQjtvQkFBRSxhQUFhLElBQUksRUFBRSxDQUFDO2dCQUMvQyxJQUFJLElBQUksQ0FBQyxlQUFlO29CQUFFLGFBQWEsSUFBSSxFQUFFLENBQUM7Z0JBQzlDLElBQUksZUFBZSxHQUFHLEVBQUU7b0JBQUUsYUFBYSxJQUFJLEVBQUUsQ0FBQztnQkFFOUMsT0FBTztvQkFDTCxHQUFHLElBQUk7b0JBQ1Asb0JBQW9CO29CQUNwQixlQUFlLEVBQUUsZUFBZTtvQkFDaEMsV0FBVyxFQUFFLFdBQVc7b0JBQ3hCLGlCQUFpQixFQUFFLGFBQWE7b0JBQ2hDLE9BQU8sRUFBRSxRQUFRLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLGVBQWUsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxLQUFLO29CQUNwRSxlQUFlLEVBQUUsSUFBSSxDQUFDLHdCQUF3QixDQUFDLElBQUksQ0FBQztvQkFDcEQsZ0JBQWdCLEVBQUUsSUFBSSxDQUFDLHFCQUFxQixDQUFDLElBQUksQ0FBQztvQkFDbEQsc0JBQXNCO29CQUN0QixRQUFRLEVBQUUsSUFBSSxDQUFDLGVBQWUsQ0FBQyxDQUFDLENBQUMsV0FBVyxDQUFDLENBQUM7d0JBQ3BDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDOzRCQUN4QixJQUFJLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDLFNBQVM7b0JBQ2xELHFCQUFxQjtvQkFDckIsYUFBYSxFQUFFLElBQUksQ0FBQyxZQUFZLENBQUMsQ0FBQzt3QkFDaEMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsSUFBSSxDQUFDLFlBQVksR0FBRyxDQUFDLElBQUksQ0FBQyxHQUFHLEVBQUUsR0FBRyxLQUFLLEdBQUcsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSTtvQkFDekUsa0JBQWtCO29CQUNsQixVQUFVLEVBQUUsSUFBSSxDQUFDLGtCQUFrQixJQUFJLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQzt3QkFDckQsQ0FBQyxJQUFJLENBQUMsa0JBQWtCLEdBQUcsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUTtpQkFDcEYsQ0FBQztZQUNKLENBQUMsQ0FBQztpQkFDRCxNQUFNLENBQUMsQ0FBQyxJQUFTLEVBQUUsRUFBRTtnQkFDcEIsMkJBQTJCO2dCQUMzQixJQUFJLE1BQU0sQ0FBQyxZQUFZLElBQUksSUFBSSxDQUFDLGlCQUFpQixHQUFHLE1BQU0sQ0FBQyxZQUFZO29CQUFFLE9BQU8sS0FBSyxDQUFDO2dCQUN0RixJQUFJLE1BQU0sQ0FBQyxlQUFlLElBQUksQ0FBQyxJQUFJLENBQUMsZUFBZTtvQkFBRSxPQUFPLEtBQUssQ0FBQztnQkFDbEUsSUFBSSxNQUFNLENBQUMsV0FBVyxJQUFJLElBQUksQ0FBQyxlQUFlLEdBQUcsTUFBTSxDQUFDLFdBQVc7b0JBQUUsT0FBTyxLQUFLLENBQUM7Z0JBQ2xGLE9BQU8sSUFBSSxDQUFDO1lBQ2QsQ0FBQyxDQUFDO2lCQUNELElBQUksQ0FBQyxDQUFDLENBQU0sRUFBRSxDQUFNLEVBQUUsRUFBRTtnQkFDdkIsMENBQTBDO2dCQUMxQyxNQUFNLEtBQUssR0FBRyxNQUFNLENBQUMsTUFBTSxJQUFJLFdBQVcsQ0FBQztnQkFDM0MsTUFBTSxLQUFLLEdBQUcsTUFBTSxDQUFDLFNBQVMsS0FBSyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7Z0JBRWxELElBQUksSUFBSSxHQUFHLEtBQUssS0FBSyxXQUFXLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7Z0JBQ3pFLElBQUksSUFBSSxHQUFHLEtBQUssS0FBSyxXQUFXLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7Z0JBRXpFLE9BQU8sQ0FBQyxJQUFJLEdBQUcsSUFBSSxDQUFDLEdBQUcsS0FBSyxDQUFDO1lBQy9CLENBQUMsQ0FBQyxDQUFDO1NBRUo7UUFBQyxPQUFPLEtBQUssRUFBRTtZQUNkLE9BQU8sQ0FBQyxJQUFJLENBQUMsd0JBQXdCLEVBQUUsS0FBSyxDQUFDLENBQUM7WUFDOUMsT0FBTyxFQUFFLENBQUM7U0FDWDtJQUNILENBQUM7SUFFRCxtQ0FBbUM7SUFDM0Isc0JBQXNCLENBQUMsWUFBaUI7UUFDOUMsSUFBSSxDQUFDLFlBQVk7WUFBRSxPQUFPLENBQUMsQ0FBQztRQUM1QixJQUFJLE9BQU8sWUFBWSxLQUFLLFFBQVE7WUFBRSxPQUFPLElBQUksQ0FBQyxHQUFHLENBQUMsWUFBWSxDQUFDLENBQUM7UUFDcEUsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLFlBQVksQ0FBQyxJQUFJLFlBQVksQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFO1lBQzFELE1BQU0sVUFBVSxHQUFHLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUNuQyxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLElBQUksVUFBVSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUU7Z0JBQ3RELE9BQU8sSUFBSSxDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQzthQUNoQztZQUNELE9BQU8sSUFBSSxDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUMsQ0FBQztTQUM3QjtRQUNELE9BQU8sQ0FBQyxDQUFDO0lBQ1gsQ0FBQztJQUVPLGtCQUFrQixDQUFDLEtBQVU7UUFDbkMsSUFBSSxDQUFDLEtBQUs7WUFBRSxPQUFPLENBQUMsQ0FBQztRQUNyQixJQUFJLE9BQU8sS0FBSyxLQUFLLFFBQVE7WUFBRSxPQUFPLElBQUksQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLENBQUM7UUFDdEQsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxJQUFJLEtBQUssQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFO1lBQzVDLE1BQU0sVUFBVSxHQUFHLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUM1QixJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLElBQUksVUFBVSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUU7Z0JBQ3RELE9BQU8sSUFBSSxDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQzthQUNoQztZQUNELE9BQU8sSUFBSSxDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUMsQ0FBQztTQUM3QjtRQUNELE9BQU8sQ0FBQyxDQUFDO0lBQ1gsQ0FBQztJQUVPLHdCQUF3QixDQUFDLElBQVM7UUFDeEMsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLHNCQUFzQixDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsQ0FBQztRQUNoRSxNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsS0FBSyxJQUFJLENBQUMsQ0FBQztRQUM5QixNQUFNLElBQUksR0FBRyxJQUFJLENBQUMsU0FBUyxJQUFJLE1BQU0sQ0FBQztRQUV0QyxrQ0FBa0M7UUFDbEMsSUFBSSxLQUFLLEdBQUcsQ0FBQyxDQUFDO1FBQ2QsSUFBSSxRQUFRLEdBQUcsRUFBRTtZQUFFLEtBQUssSUFBSSxFQUFFLENBQUM7UUFDL0IsSUFBSSxRQUFRLEdBQUcsRUFBRTtZQUFFLEtBQUssSUFBSSxFQUFFLENBQUM7UUFDL0IsSUFBSSxLQUFLLEdBQUcsSUFBSSxJQUFJLEtBQUssR0FBRyxLQUFLO1lBQUUsS0FBSyxJQUFJLEVBQUUsQ0FBQyxDQUFDLHFCQUFxQjtRQUNyRSxJQUFJLElBQUksR0FBRyxLQUFLO1lBQUUsS0FBSyxJQUFJLEVBQUUsQ0FBQyxDQUFDLGtCQUFrQjtRQUNqRCxJQUFJLElBQUksQ0FBQyxnQkFBZ0I7WUFBRSxLQUFLLElBQUksRUFBRSxDQUFDO1FBRXZDLE9BQU8sS0FBSyxHQUFHLEVBQUUsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxLQUFLLEdBQUcsRUFBRSxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQztJQUM3RCxDQUFDO0lBRU8scUJBQXFCLENBQUMsSUFBUztRQUNyQywyREFBMkQ7UUFDM0QsTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDLFNBQVMsSUFBSSxNQUFNLENBQUM7UUFDdEMsTUFBTSxrQkFBa0IsR0FBRyxJQUFJLENBQUMsQ0FBQyxzREFBc0Q7UUFFdkYsSUFBSSxJQUFJLEdBQUcsSUFBSTtZQUFFLE9BQU8sTUFBTSxDQUFDO1FBQy9CLElBQUksSUFBSSxHQUFHLEtBQUs7WUFBRSxPQUFPLFFBQVEsQ0FBQztRQUNsQyxPQUFPLEtBQUssQ0FBQztJQUNmLENBQUM7SUFFRCxLQUFLLENBQUMsU0FBUyxDQUFDLE1BQXlCO1FBQ3ZDLE1BQU0sUUFBUSxHQUFHLE1BQU0sSUFBSSxDQUFDLFdBQVcsQ0FBNkIsU0FBUyxFQUFFLE1BQU0sQ0FBQyxDQUFDO1FBQ3ZGLE9BQVEsUUFBZ0IsQ0FBQyxPQUFPLElBQUksRUFBRSxDQUFDO0lBQ3pDLENBQUM7SUFFRCxpREFBaUQ7SUFDakQsS0FBSyxDQUFDLGVBQWUsQ0FBQyxNQU9yQjtRQUNDLElBQUk7WUFDRixrREFBa0Q7WUFDbEQsTUFBTSxZQUFZLEdBQVE7Z0JBQ3hCLFVBQVUsRUFBRSxNQUFNLENBQUMsVUFBVTtnQkFDN0IsTUFBTSxFQUFFLE1BQU0sQ0FBQyxNQUFNLElBQUksQ0FBQztnQkFDMUIsT0FBTyxFQUFFLElBQUksQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLFVBQVUsSUFBSSxFQUFFLEVBQUUsRUFBRSxDQUFDLENBQUMsNkJBQTZCO2FBQzdFLENBQUM7WUFFRixrQ0FBa0M7WUFDbEMsSUFBSSxNQUFNLENBQUMsU0FBUyxFQUFFO2dCQUNwQixZQUFZLENBQUMsU0FBUyxHQUFHLE1BQU0sQ0FBQyxTQUFTLENBQUM7YUFDM0M7WUFFRCxpQ0FBaUM7WUFDakMsSUFBSSxNQUFNLENBQUMsVUFBVSxFQUFFO2dCQUNyQixNQUFNLFdBQVcsR0FBRztvQkFDbEIsUUFBUSxFQUFFLEVBQUUsR0FBRyxFQUFFLENBQUMsRUFBRSxHQUFHLEVBQUUsSUFBSSxFQUFFO29CQUMvQixLQUFLLEVBQUUsRUFBRSxHQUFHLEVBQUUsSUFBSSxFQUFFLEdBQUcsRUFBRSxJQUFJLEVBQUU7b0JBQy9CLFNBQVMsRUFBRSxFQUFFLEdBQUcsRUFBRSxJQUFJLEVBQUUsR0FBRyxFQUFFLEtBQUssRUFBRTtvQkFDcEMsUUFBUSxFQUFFLEVBQUUsR0FBRyxFQUFFLEtBQUssRUFBRSxHQUFHLEVBQUUsTUFBTSxFQUFFLENBQUcsWUFBWTtpQkFDckQsQ0FBQztnQkFDRixNQUFNLEtBQUssR0FBRyxXQUFXLENBQUMsTUFBTSxDQUFDLFVBQVUsQ0FBQyxDQUFDO2dCQUM3QyxZQUFZLENBQUMsUUFBUSxHQUFHLEtBQUssQ0FBQyxHQUFHLENBQUM7Z0JBQ2xDLFlBQVksQ0FBQyxRQUFRLEdBQUcsS0FBSyxDQUFDLEdBQUcsQ0FBQzthQUNuQztZQUVELE9BQU8sQ0FBQyxHQUFHLENBQUMsc0JBQXNCLE1BQU0sQ0FBQyxVQUFVLFNBQVMsTUFBTSxDQUFDLFlBQVksSUFBSSxVQUFVLGNBQWMsQ0FBQyxDQUFDO1lBRTdHLE1BQU0sUUFBUSxHQUFHLE1BQU0sSUFBSSxDQUFDLGNBQWMsQ0FBQyxZQUFZLENBQUMsQ0FBQztZQUV6RCxJQUFJLFFBQVEsQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFO2dCQUN6QixPQUFPO29CQUNMLFVBQVUsRUFBRSxNQUFNLENBQUMsVUFBVTtvQkFDN0IsWUFBWSxFQUFFLE1BQU0sQ0FBQyxZQUFZLElBQUksVUFBVTtvQkFDL0MsS0FBSyxFQUFFLCtCQUErQjtvQkFDdEMsYUFBYSxFQUFFLENBQUM7aUJBQ2pCLENBQUM7YUFDSDtZQUVELHdDQUF3QztZQUN4QyxNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsdUJBQXVCLENBQUMsUUFBUSxFQUFFLE1BQU0sQ0FBQyxDQUFDO1lBRWhFLE9BQU87Z0JBQ0wsVUFBVSxFQUFFLE1BQU0sQ0FBQyxVQUFVO2dCQUM3QixZQUFZLEVBQUUsWUFBWSxNQUFNLENBQUMsVUFBVSxFQUFFO2dCQUM3QyxZQUFZLEVBQUUsTUFBTSxDQUFDLFlBQVksSUFBSSxVQUFVO2dCQUMvQyxVQUFVLEVBQUUsUUFBUSxDQUFDLE1BQU07Z0JBQzNCLEdBQUcsUUFBUTthQUNaLENBQUM7U0FFSDtRQUFDLE9BQU8sS0FBVSxFQUFFO1lBQ25CLE9BQU8sQ0FBQyxJQUFJLENBQUMsMkJBQTJCLEVBQUUsS0FBSyxDQUFDLENBQUM7WUFDakQsT0FBTztnQkFDTCxVQUFVLEVBQUUsTUFBTSxDQUFDLFVBQVU7Z0JBQzdCLEtBQUssRUFBRSxLQUFLLEVBQUUsT0FBTyxJQUFJLGlCQUFpQjtnQkFDMUMsYUFBYSxFQUFFLENBQUM7YUFDakIsQ0FBQztTQUNIO0lBQ0gsQ0FBQztJQUVELHVDQUF1QztJQUMvQix1QkFBdUIsQ0FBQyxRQUFlLEVBQUUsTUFBVztRQUMxRCxNQUFNLGFBQWEsR0FBRyxRQUFRLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLEtBQUssR0FBRyxDQUFDLENBQUMsQ0FBQztRQUN4RCxNQUFNLE1BQU0sR0FBRyxhQUFhLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQztRQUNsRSxNQUFNLE9BQU8sR0FBRyxhQUFhLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLEtBQUssRUFBRSxPQUFPLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQztRQUVuRyxpQkFBaUI7UUFDakIsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLHdCQUF3QixDQUFDLE1BQU0sQ0FBQyxDQUFDO1FBRXpELGlCQUFpQjtRQUNqQixNQUFNLFNBQVMsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLGFBQWEsQ0FBQyxDQUFDO1FBRXBELHVCQUF1QjtRQUN2QixNQUFNLGVBQWUsR0FBRyxJQUFJLENBQUMsa0JBQWtCLENBQUMsYUFBYSxDQUFDLENBQUM7UUFFL0QsdUJBQXVCO1FBQ3ZCLE1BQU0sZUFBZSxHQUFHLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxhQUFhLENBQUMsQ0FBQztRQUUvRCx5Q0FBeUM7UUFDekMsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLHNCQUFzQixDQUFDLGFBQWEsRUFBRSxNQUFNLENBQUMsWUFBWSxDQUFDLENBQUM7UUFFakYsT0FBTztZQUNMLGFBQWEsRUFBRSxhQUFhLENBQUMsTUFBTTtZQUNuQyxhQUFhLEVBQUUsVUFBVTtZQUN6QixhQUFhLEVBQUUsU0FBUztZQUN4QixtQkFBbUIsRUFBRSxlQUFlO1lBQ3BDLG1CQUFtQixFQUFFLGVBQWU7WUFDcEMsY0FBYyxFQUFFLFFBQVE7WUFDeEIsZ0JBQWdCLEVBQUUsSUFBSSxDQUFDLHlCQUF5QixDQUFDLGFBQWEsQ0FBQztZQUMvRCxlQUFlLEVBQUUsSUFBSSxDQUFDLHVCQUF1QixDQUFDLGFBQWEsRUFBRSxNQUFNLENBQUM7U0FDckUsQ0FBQztJQUNKLENBQUM7SUFFTyx3QkFBd0IsQ0FBQyxNQUFnQjtRQUMvQyxJQUFJLE1BQU0sQ0FBQyxNQUFNLEtBQUssQ0FBQztZQUFFLE9BQU8sRUFBRSxLQUFLLEVBQUUsaUJBQWlCLEVBQUUsQ0FBQztRQUU3RCxNQUFNLE1BQU0sR0FBRyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDO1FBQzVDLE1BQU0sR0FBRyxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxFQUFFLENBQUMsQ0FBQyxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUM7UUFFbEUsT0FBTztZQUNMLFlBQVksRUFBRSxHQUFHO1lBQ2pCLFdBQVcsRUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQyxDQUFDO1lBQ2xELFFBQVEsRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUFDO1lBQ25CLFFBQVEsRUFBRSxNQUFNLENBQUMsTUFBTSxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUM7WUFDbkMsVUFBVSxFQUFFLEVBQUUsR0FBRyxFQUFFLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxHQUFHLEVBQUUsTUFBTSxDQUFDLE1BQU0sQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLEVBQUU7WUFDOUQsaUJBQWlCLEVBQUUsSUFBSSxDQUFDLGVBQWUsQ0FBQyxNQUFNLENBQUM7U0FDaEQsQ0FBQztJQUNKLENBQUM7SUFFTyxlQUFlLENBQUMsTUFBZ0I7UUFDdEMsTUFBTSxNQUFNLEdBQUc7WUFDYixFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsR0FBRyxFQUFFLENBQUMsRUFBRSxHQUFHLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBRSxDQUFDLEVBQUU7WUFDaEQsRUFBRSxLQUFLLEVBQUUsV0FBVyxFQUFFLEdBQUcsRUFBRSxJQUFJLEVBQUUsR0FBRyxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUUsQ0FBQyxFQUFFO1lBQ3RELEVBQUUsS0FBSyxFQUFFLFNBQVMsRUFBRSxHQUFHLEVBQUUsSUFBSSxFQUFFLEdBQUcsRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLENBQUMsRUFBRTtZQUNyRCxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsR0FBRyxFQUFFLEtBQUssRUFBRSxHQUFHLEVBQUUsTUFBTSxFQUFFLEtBQUssRUFBRSxDQUFDLEVBQUU7U0FDdkQsQ0FBQztRQUVGLE1BQU0sQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLEVBQUU7WUFDckIsTUFBTSxLQUFLLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLEtBQUssSUFBSSxDQUFDLENBQUMsR0FBRyxJQUFJLEtBQUssR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUM7WUFDaEUsSUFBSSxLQUFLO2dCQUFFLEtBQUssQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUMzQixDQUFDLENBQUMsQ0FBQztRQUVILE9BQU8sTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUM7WUFDdEIsS0FBSyxFQUFFLENBQUMsQ0FBQyxLQUFLO1lBQ2QsS0FBSyxFQUFFLENBQUMsQ0FBQyxLQUFLO1lBQ2QsVUFBVSxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUMsR0FBRyxHQUFHLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDO1NBQ3pELENBQUMsQ0FBQyxDQUFDO0lBQ04sQ0FBQztJQUVPLGFBQWEsQ0FBQyxRQUFlO1FBQ25DLE1BQU0sV0FBVyxHQUE4QixFQUFFLENBQUM7UUFDbEQsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsRUFBRTtZQUNuQixNQUFNLEtBQUssR0FBRyxDQUFDLENBQUMsS0FBSyxJQUFJLFNBQVMsQ0FBQztZQUNuQyxXQUFXLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxXQUFXLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQ3JELENBQUMsQ0FBQyxDQUFDO1FBRUgsTUFBTSxTQUFTLEdBQUcsTUFBTSxDQUFDLE9BQU8sQ0FBQyxXQUFXLENBQUM7YUFDMUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFBQyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQzthQUMzQixLQUFLLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQzthQUNaLEdBQUcsQ0FBQyxDQUFDLENBQUMsS0FBSyxFQUFFLEtBQUssQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1lBQ3hCLEtBQUs7WUFDTCxZQUFZLEVBQUUsS0FBSztZQUNuQixXQUFXLEVBQUUsQ0FBQyxDQUFDLEtBQUssR0FBRyxRQUFRLENBQUMsTUFBTSxDQUFDLEdBQUcsR0FBRyxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQztTQUMxRCxDQUFDLENBQUMsQ0FBQztRQUVOLE9BQU87WUFDTCxXQUFXLEVBQUUsTUFBTSxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsQ0FBQyxNQUFNO1lBQzVDLFNBQVM7WUFDVCxrQkFBa0IsRUFBRSxTQUFTLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxHQUFHLEdBQUcsVUFBVSxDQUFDLENBQUMsQ0FBQyxXQUFXLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDO1NBQzVHLENBQUM7SUFDSixDQUFDO0lBRU8sa0JBQWtCLENBQUMsUUFBZTtRQUN4QyxNQUFNLFVBQVUsR0FBRyxRQUFRLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLEtBQUssRUFBRSxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQzFGLE1BQU0sT0FBTyxHQUFHLFVBQVUsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsTUFBTSxDQUFDLENBQUMsR0FBRyxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUMsR0FBRyxHQUFHLENBQUMsRUFBRSxDQUFDLENBQUMsR0FBRyxVQUFVLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFFMUcsT0FBTztZQUNMLGdCQUFnQixFQUFFLE9BQU8sR0FBRyxLQUFLLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsT0FBTyxHQUFHLEtBQUssQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxLQUFLO1lBQy9FLGdCQUFnQixFQUFFLE9BQU87WUFDekIsZ0JBQWdCLEVBQUUsUUFBUSxDQUFDLE1BQU0sR0FBRyxFQUFFLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLE1BQU0sR0FBRyxFQUFFLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsS0FBSztTQUMxRixDQUFDO0lBQ0osQ0FBQztJQUVPLGtCQUFrQixDQUFDLFFBQWU7UUFDeEMsTUFBTSxXQUFXLEdBQUcsUUFBUSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxLQUFLLEVBQUUsT0FBTyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUM7UUFDbEcsTUFBTSxTQUFTLEdBQUcsV0FBVyxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxNQUFNLENBQUMsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxFQUFFLENBQUMsQ0FBQyxHQUFHLFdBQVcsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUUvRyxPQUFPO1lBQ0wsYUFBYSxFQUFFLFNBQVM7WUFDeEIsa0JBQWtCLEVBQUUsV0FBVyxDQUFDLE1BQU07WUFDdEMsaUJBQWlCLEVBQUUsV0FBVyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsSUFBSSxHQUFHLENBQUMsQ0FBQyxNQUFNO1lBQzNELFlBQVksRUFBRSxTQUFTLElBQUksR0FBRyxDQUFDLENBQUMsQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDLFNBQVMsSUFBSSxHQUFHLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsU0FBUyxJQUFJLEdBQUcsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxNQUFNO1NBQzlHLENBQUM7SUFDSixDQUFDO0lBRU8sc0JBQXNCLENBQUMsUUFBZSxFQUFFLFlBQXFCO1FBQ25FLE1BQU0sUUFBUSxHQUFhLEVBQUUsQ0FBQztRQUM5QixNQUFNLGFBQWEsR0FBRyxRQUFRLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLEtBQUssR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDO1FBRW5FLElBQUksYUFBYSxDQUFDLE1BQU0sS0FBSyxDQUFDLEVBQUU7WUFDOUIsT0FBTyxDQUFDLHVDQUF1QyxDQUFDLENBQUM7U0FDbEQ7UUFFRCxpQkFBaUI7UUFDakIsTUFBTSxNQUFNLEdBQUcsYUFBYSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUMvQyxNQUFNLFFBQVEsR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsR0FBRyxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUMsR0FBRyxHQUFHLENBQUMsRUFBRSxDQUFDLENBQUMsR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDO1FBQ3ZFLElBQUksUUFBUSxHQUFHLElBQUksRUFBRTtZQUNuQixRQUFRLENBQUMsSUFBSSxDQUFDLHFEQUFxRCxDQUFDLENBQUM7U0FDdEU7YUFBTSxJQUFJLFFBQVEsR0FBRyxLQUFLLEVBQUU7WUFDM0IsUUFBUSxDQUFDLElBQUksQ0FBQyw2Q0FBNkMsQ0FBQyxDQUFDO1NBQzlEO1FBRUQsdUJBQXVCO1FBQ3ZCLE1BQU0sS0FBSyxHQUFHLGFBQWEsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDekYsTUFBTSxPQUFPLEdBQUcsS0FBSyxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxFQUFFLENBQUMsQ0FBQyxHQUFHLEtBQUssQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQztRQUNoRyxJQUFJLE9BQU8sR0FBRyxLQUFLLEVBQUU7WUFDbkIsUUFBUSxDQUFDLElBQUksQ0FBQywwREFBMEQsQ0FBQyxDQUFDO1NBQzNFO2FBQU0sSUFBSSxPQUFPLEdBQUcsTUFBTSxFQUFFO1lBQzNCLFFBQVEsQ0FBQyxJQUFJLENBQUMsa0RBQWtELENBQUMsQ0FBQztTQUNuRTtRQUVELDJCQUEyQjtRQUMzQixNQUFNLE9BQU8sR0FBRyxhQUFhLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQztRQUNsRyxNQUFNLFNBQVMsR0FBRyxPQUFPLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDLEdBQUcsRUFBRSxDQUFDLEVBQUUsRUFBRSxDQUFDLEdBQUcsR0FBRyxDQUFDLEVBQUUsQ0FBQyxDQUFDLEdBQUcsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQ25HLElBQUksU0FBUyxJQUFJLEdBQUcsRUFBRTtZQUNwQixRQUFRLENBQUMsSUFBSSxDQUFDLHNEQUFzRCxDQUFDLENBQUM7U0FDdkU7YUFBTSxJQUFJLFNBQVMsR0FBRyxHQUFHLEVBQUU7WUFDMUIsUUFBUSxDQUFDLElBQUksQ0FBQyw4REFBOEQsQ0FBQyxDQUFDO1NBQy9FO1FBRUQsT0FBTyxRQUFRLENBQUM7SUFDbEIsQ0FBQztJQUVPLHlCQUF5QixDQUFDLFFBQWU7UUFDL0MsSUFBSSxLQUFLLEdBQUcsRUFBRSxDQUFDLENBQUMsYUFBYTtRQUU3QixNQUFNLGFBQWEsR0FBRyxRQUFRLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLEtBQUssR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDO1FBQ25FLElBQUksYUFBYSxDQUFDLE1BQU0sS0FBSyxDQUFDO1lBQUUsT0FBTyxDQUFDLENBQUM7UUFFekMscUJBQXFCO1FBQ3JCLE1BQU0sS0FBSyxHQUFHLGFBQWEsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDekYsTUFBTSxPQUFPLEdBQUcsS0FBSyxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxFQUFFLENBQUMsQ0FBQyxHQUFHLEtBQUssQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQztRQUNoRyxJQUFJLE9BQU8sR0FBRyxLQUFLO1lBQUUsS0FBSyxJQUFJLEVBQUUsQ0FBQyxDQUFDLG1CQUFtQjtRQUNyRCxJQUFJLE9BQU8sR0FBRyxNQUFNO1lBQUUsS0FBSyxJQUFJLEVBQUUsQ0FBQyxDQUFDLHdCQUF3QjtRQUUzRCxpQkFBaUI7UUFDakIsTUFBTSxPQUFPLEdBQUcsYUFBYSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUM7UUFDbEcsTUFBTSxTQUFTLEdBQUcsT0FBTyxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxFQUFFLENBQUMsQ0FBQyxHQUFHLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUNuRyxJQUFJLFNBQVMsR0FBRyxHQUFHO1lBQUUsS0FBSyxJQUFJLEVBQUUsQ0FBQyxDQUFDLHVCQUF1QjtRQUV6RCxlQUFlO1FBQ2YsTUFBTSxNQUFNLEdBQUcsYUFBYSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUMvQyxNQUFNLFFBQVEsR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsR0FBRyxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUMsR0FBRyxHQUFHLENBQUMsRUFBRSxDQUFDLENBQUMsR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDO1FBQ3ZFLElBQUksUUFBUSxHQUFHLElBQUksSUFBSSxRQUFRLEdBQUcsS0FBSztZQUFFLEtBQUssSUFBSSxFQUFFLENBQUMsQ0FBQyxxQkFBcUI7UUFFM0UsT0FBTyxJQUFJLENBQUMsR0FBRyxDQUFDLEdBQUcsRUFBRSxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxLQUFLLENBQUMsQ0FBQyxDQUFDO0lBQzNDLENBQUM7SUFFTyx1QkFBdUIsQ0FBQyxRQUFlLEVBQUUsTUFBVztRQUMxRCxNQUFNLGVBQWUsR0FBYSxFQUFFLENBQUM7UUFDckMsTUFBTSxhQUFhLEdBQUcsUUFBUSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxLQUFLLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUVuRSxJQUFJLGFBQWEsQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFO1lBQzlCLE9BQU8sQ0FBQyxvREFBb0QsQ0FBQyxDQUFDO1NBQy9EO1FBRUQsd0JBQXdCO1FBQ3hCLE1BQU0sTUFBTSxHQUFHLGFBQWEsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUM7UUFDL0MsTUFBTSxRQUFRLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLEdBQUcsRUFBRSxDQUFDLEVBQUUsRUFBRSxDQUFDLEdBQUcsR0FBRyxDQUFDLEVBQUUsQ0FBQyxDQUFDLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQztRQUN2RSxJQUFJLFFBQVEsR0FBRyxJQUFJLEVBQUU7WUFDbkIsZUFBZSxDQUFDLElBQUksQ0FBQywyREFBMkQsQ0FBQyxDQUFDO1NBQ25GO2FBQU0sSUFBSSxRQUFRLEdBQUcsS0FBSyxFQUFFO1lBQzNCLGVBQWUsQ0FBQyxJQUFJLENBQUMsMENBQTBDLENBQUMsQ0FBQztTQUNsRTtRQUVELDhCQUE4QjtRQUM5QixNQUFNLEtBQUssR0FBRyxhQUFhLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQ3pGLE1BQU0sT0FBTyxHQUFHLEtBQUssQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLENBQUMsR0FBRyxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUMsR0FBRyxHQUFHLENBQUMsRUFBRSxDQUFDLENBQUMsR0FBRyxLQUFLLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUM7UUFDaEcsSUFBSSxPQUFPLEdBQUcsS0FBSyxFQUFFO1lBQ25CLGVBQWUsQ0FBQyxJQUFJLENBQUMsMkRBQTJELENBQUMsQ0FBQztTQUNuRjthQUFNLElBQUksT0FBTyxHQUFHLE1BQU0sRUFBRTtZQUMzQixlQUFlLENBQUMsSUFBSSxDQUFDLGlEQUFpRCxDQUFDLENBQUM7U0FDekU7UUFFRCwwQkFBMEI7UUFDMUIsTUFBTSxPQUFPLEdBQUcsYUFBYSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUM7UUFDbEcsTUFBTSxTQUFTLEdBQUcsT0FBTyxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxFQUFFLENBQUMsQ0FBQyxHQUFHLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUNuRyxJQUFJLFNBQVMsR0FBRyxHQUFHLEVBQUU7WUFDbkIsZUFBZSxDQUFDLElBQUksQ0FBQyx3Q0FBd0MsQ0FBQyxDQUFDO1NBQ2hFO1FBRUQsT0FBTyxlQUFlLENBQUM7SUFDekIsQ0FBQztJQUVELEtBQUssQ0FBQyxjQUFjLENBQUMsTUFBNkI7UUFDaEQsTUFBTSxRQUFRLEdBQUcsTUFBTSxJQUFJLENBQUMsV0FBVyxDQUF5QyxjQUFjLEVBQUUsTUFBTSxDQUFDLENBQUM7UUFDeEcsT0FBUSxRQUFnQixDQUFDLGVBQWUsSUFBSSxFQUFFLENBQUM7SUFDakQsQ0FBQztJQUVELDBFQUEwRTtJQUMxRSxLQUFLLENBQUMsZ0JBQWdCLENBQUMsTUFPdEI7UUFDQyxJQUFJO1lBQ0YsaURBQWlEO1lBQ2pELE1BQU0sWUFBWSxHQUFHLE1BQU0sSUFBSSxDQUFDLG9CQUFvQixDQUFDO2dCQUNuRCxVQUFVLEVBQUUsTUFBTSxDQUFDLFVBQVU7Z0JBQzdCLEtBQUssRUFBRSxNQUFNLENBQUMsS0FBSztnQkFDbkIsTUFBTSxFQUFFLE1BQU0sQ0FBQyxNQUFNLElBQUksQ0FBQztnQkFDMUIsU0FBUyxFQUFFLE1BQU0sQ0FBQyxTQUFTLElBQUksT0FBTzthQUN2QyxDQUFDLENBQUM7WUFFSCw0QkFBNEI7WUFDNUIsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLHdCQUF3QixDQUFDLFlBQVksRUFBRSxNQUFNLENBQUMsQ0FBQztZQUVyRSxPQUFPO2dCQUNMLFlBQVksRUFBRSxNQUFNLENBQUMsWUFBWSxJQUFJLFVBQVU7Z0JBQy9DLGFBQWEsRUFBRSxZQUFZLENBQUMsTUFBTTtnQkFDbEMsbUJBQW1CLEVBQUUsSUFBSSxDQUFDLHdCQUF3QixDQUFDLFlBQVksQ0FBQztnQkFDaEUsVUFBVSxFQUFFLFlBQVksQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDLE9BQU8sSUFBSSxFQUFFLENBQUM7Z0JBQ25FLFVBQVUsRUFBRSxZQUFZLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxPQUFPLEdBQUcsRUFBRSxDQUFDO2dCQUNsRSxhQUFhLEVBQUUsWUFBWSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxZQUFZLEtBQUssTUFBTSxDQUFDO2dCQUNuRixnQkFBZ0IsRUFBRSxJQUFJLENBQUMsdUJBQXVCLENBQUMsWUFBWSxDQUFDO2dCQUM1RCxlQUFlLEVBQUUsSUFBSSxDQUFDLGdDQUFnQyxDQUFDLFlBQVksRUFBRSxNQUFNLENBQUMsa0JBQWtCLElBQUksRUFBRSxDQUFDO2dCQUNyRyxHQUFHLFFBQVE7YUFDWixDQUFDO1NBQ0g7UUFBQyxPQUFPLEtBQUssRUFBRTtZQUNkLE9BQU8sQ0FBQyxJQUFJLENBQUMsNEJBQTRCLEVBQUUsS0FBSyxDQUFDLENBQUM7WUFDbEQsT0FBTztnQkFDTCxZQUFZLEVBQUUsTUFBTSxDQUFDLFlBQVksSUFBSSxVQUFVO2dCQUMvQyxLQUFLLEVBQUUsNkJBQTZCO2dCQUNwQyxhQUFhLEVBQUUsQ0FBQzthQUNqQixDQUFDO1NBQ0g7SUFDSCxDQUFDO0lBRUQsMENBQTBDO0lBQ2xDLHdCQUF3QixDQUFDLFlBQW1CLEVBQUUsTUFBVztRQUMvRCxNQUFNLGFBQWEsR0FBRyxZQUFZLENBQUMsTUFBTSxDQUFDO1FBQzFDLElBQUksYUFBYSxLQUFLLENBQUM7WUFBRSxPQUFPLEVBQUUsZUFBZSxFQUFFLENBQUMsd0JBQXdCLENBQUMsRUFBRSxDQUFDO1FBRWhGLHNCQUFzQjtRQUN0QixNQUFNLFdBQVcsR0FBRyxZQUFZLENBQUMsTUFBTSxDQUFDLENBQUMsR0FBRyxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUMsR0FBRyxHQUFHLENBQUMsQ0FBQyxhQUFhLENBQUMsT0FBTyxFQUFFLENBQUMsQ0FBQyxHQUFHLGFBQWEsQ0FBQztRQUN0RyxNQUFNLFdBQVcsR0FBRyxJQUFJLENBQUMsd0JBQXdCLENBQUMsWUFBWSxDQUFDLENBQUM7UUFFaEUsa0JBQWtCO1FBQ2xCLE1BQU0sYUFBYSxHQUFHLFlBQVksQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsZ0JBQWdCLENBQUMsWUFBWSxLQUFLLE1BQU0sQ0FBQyxDQUFDLE1BQU0sQ0FBQztRQUNsRyxNQUFNLGVBQWUsR0FBRyxZQUFZLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxPQUFPLEdBQUcsRUFBRSxDQUFDLENBQUMsTUFBTSxDQUFDO1FBQ3RGLE1BQU0sZUFBZSxHQUFHLFlBQVksQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDLE9BQU8sSUFBSSxFQUFFLENBQUMsQ0FBQyxNQUFNLENBQUM7UUFFdkYscUJBQXFCO1FBQ3JCLE1BQU0sWUFBWSxHQUFHLFlBQVksQ0FBQyxNQUFNLENBQUMsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxlQUFlLEVBQUUsQ0FBQyxDQUFDLENBQUM7UUFDL0YsTUFBTSxnQkFBZ0IsR0FBRyxZQUFZLENBQUMsTUFBTSxDQUFDLENBQUMsR0FBRyxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUMsR0FBRyxHQUFHLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxlQUFlLEVBQUUsQ0FBQyxDQUFDLEdBQUcsYUFBYSxDQUFDO1FBRXRILE9BQU87WUFDTCxrQkFBa0IsRUFBRTtnQkFDbEIsZUFBZSxFQUFFLElBQUksQ0FBQyxLQUFLLENBQUMsV0FBVyxHQUFHLEVBQUUsQ0FBQyxHQUFHLEVBQUU7Z0JBQ2xELG1CQUFtQixFQUFFLFdBQVc7Z0JBQ2hDLFlBQVksRUFBRSxJQUFJLENBQUMsS0FBSyxDQUFDLFlBQVksR0FBRyxHQUFHLENBQUMsR0FBRyxHQUFHO2dCQUNsRCxvQkFBb0IsRUFBRSxJQUFJLENBQUMsS0FBSyxDQUFDLGdCQUFnQixDQUFDO2FBQ25EO1lBQ0QsY0FBYyxFQUFFO2dCQUNkLGdCQUFnQixFQUFFLGFBQWE7Z0JBQy9CLGNBQWMsRUFBRSxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsYUFBYSxHQUFHLGFBQWEsQ0FBQyxHQUFHLEdBQUcsQ0FBQztnQkFDakUsZUFBZSxFQUFFLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxlQUFlLEdBQUcsYUFBYSxDQUFDLEdBQUcsR0FBRyxDQUFDO2dCQUNwRSxlQUFlLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLGVBQWUsR0FBRyxhQUFhLENBQUMsR0FBRyxHQUFHLENBQUM7YUFDckU7WUFDRCxlQUFlLEVBQUU7Z0JBQ2YsY0FBYyxFQUFFLFdBQVc7Z0JBQzNCLGFBQWEsRUFBRSxnQkFBZ0I7Z0JBQy9CLGVBQWUsRUFBRSxJQUFJLENBQUMscUJBQXFCLENBQUMsWUFBWSxDQUFDO2FBQzFEO1NBQ0YsQ0FBQztJQUNKLENBQUM7SUFFTyx3QkFBd0IsQ0FBQyxZQUFtQjtRQUNsRCxJQUFJLFlBQVksQ0FBQyxNQUFNLEtBQUssQ0FBQztZQUFFLE9BQU8sQ0FBQyxDQUFDO1FBQ3hDLE1BQU0sYUFBYSxHQUFHLFlBQVksQ0FBQyxNQUFNLENBQUMsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxDQUFDLGdCQUFnQixDQUFDLFlBQVksRUFBRSxDQUFDLENBQUMsQ0FBQztRQUNoRyxPQUFPLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxhQUFhLEdBQUcsWUFBWSxDQUFDLE1BQU0sQ0FBQyxHQUFHLEVBQUUsQ0FBQyxHQUFHLEVBQUUsQ0FBQztJQUNyRSxDQUFDO0lBRU8sdUJBQXVCLENBQUMsWUFBbUI7UUFDakQsNkJBQTZCO1FBQzdCLE1BQU0sUUFBUSxHQUFHO1lBQ2Y7Z0JBQ0UsTUFBTSxFQUFFLDZCQUE2QjtnQkFDckMsa0JBQWtCLEVBQUUsR0FBRztnQkFDdkIsY0FBYyxFQUFFLG1EQUFtRDthQUNwRTtZQUNEO2dCQUNFLE1BQU0sRUFBRSwwQkFBMEI7Z0JBQ2xDLGtCQUFrQixFQUFFLEdBQUc7Z0JBQ3ZCLGNBQWMsRUFBRSw2Q0FBNkM7YUFDOUQ7WUFDRDtnQkFDRSxNQUFNLEVBQUUsdUJBQXVCO2dCQUMvQixrQkFBa0IsRUFBRSxHQUFHO2dCQUN2QixjQUFjLEVBQUUsMkNBQTJDO2FBQzVEO1lBQ0Q7Z0JBQ0UsTUFBTSxFQUFFLGlDQUFpQztnQkFDekMsa0JBQWtCLEVBQUUsR0FBRztnQkFDdkIsY0FBYyxFQUFFLHlDQUF5QzthQUMxRDtTQUNGLENBQUM7UUFFRixPQUFPLFFBQVEsQ0FBQztJQUNsQixDQUFDO0lBRU8sZ0NBQWdDLENBQUMsWUFBbUIsRUFBRSxjQUFzQjtRQUNsRixNQUFNLGVBQWUsR0FBYSxFQUFFLENBQUM7UUFFckMsSUFBSSxZQUFZLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRTtZQUM3QixPQUFPLENBQUMsK0RBQStELENBQUMsQ0FBQztTQUMxRTtRQUVELE1BQU0sV0FBVyxHQUFHLFlBQVksQ0FBQyxNQUFNLENBQUMsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFDLEdBQUcsWUFBWSxDQUFDLE1BQU0sQ0FBQztRQUM1RyxNQUFNLGFBQWEsR0FBRyxZQUFZLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLGdCQUFnQixDQUFDLFlBQVksS0FBSyxNQUFNLENBQUMsQ0FBQyxNQUFNLENBQUM7UUFDbEcsTUFBTSxlQUFlLEdBQUcsWUFBWSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsT0FBTyxHQUFHLEVBQUUsQ0FBQyxDQUFDLE1BQU0sQ0FBQztRQUN0RixNQUFNLGVBQWUsR0FBRyxZQUFZLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxPQUFPLElBQUksRUFBRSxDQUFDLENBQUMsTUFBTSxDQUFDO1FBRXZGLDhCQUE4QjtRQUM5QixJQUFJLFdBQVcsR0FBRyxFQUFFLEVBQUU7WUFDcEIsZUFBZSxDQUFDLElBQUksQ0FBQyxtRUFBbUUsQ0FBQyxDQUFDO1NBQzNGO2FBQU0sSUFBSSxXQUFXLEdBQUcsRUFBRSxFQUFFO1lBQzNCLGVBQWUsQ0FBQyxJQUFJLENBQUMsNEVBQTRFLENBQUMsQ0FBQztTQUNwRzthQUFNO1lBQ0wsZUFBZSxDQUFDLElBQUksQ0FBQyxvRUFBb0UsQ0FBQyxDQUFDO1NBQzVGO1FBRUQsb0NBQW9DO1FBQ3BDLElBQUksYUFBYSxHQUFHLFlBQVksQ0FBQyxNQUFNLEdBQUcsR0FBRyxFQUFFO1lBQzdDLGVBQWUsQ0FBQyxJQUFJLENBQUMscUVBQXFFLENBQUMsQ0FBQztTQUM3RjthQUFNLElBQUksYUFBYSxHQUFHLENBQUMsRUFBRTtZQUM1QixlQUFlLENBQUMsSUFBSSxDQUFDLG9FQUFvRSxDQUFDLENBQUM7U0FDNUY7UUFFRCw4QkFBOEI7UUFDOUIsSUFBSSxlQUFlLEdBQUcsWUFBWSxDQUFDLE1BQU0sR0FBRyxHQUFHLEVBQUU7WUFDL0MsZUFBZSxDQUFDLElBQUksQ0FBQyx5RUFBeUUsQ0FBQyxDQUFDO1NBQ2pHO1FBRUQsSUFBSSxlQUFlLEdBQUcsWUFBWSxDQUFDLE1BQU0sR0FBRyxHQUFHLEVBQUU7WUFDL0MsZUFBZSxDQUFDLElBQUksQ0FBQyxnRkFBZ0YsQ0FBQyxDQUFDO1NBQ3hHO1FBRUQsNEJBQTRCO1FBQzVCLE1BQU0sZ0JBQWdCLEdBQUcsWUFBWSxDQUFDLE1BQU0sQ0FBQyxDQUFDLEdBQUcsRUFBRSxDQUFDLEVBQUUsRUFBRSxDQUFDLEdBQUcsR0FBRyxDQUFDLENBQUMsZ0JBQWdCLENBQUMsZUFBZSxFQUFFLENBQUMsQ0FBQyxHQUFHLFlBQVksQ0FBQyxNQUFNLENBQUM7UUFDNUgsSUFBSSxnQkFBZ0IsR0FBRyxFQUFFLEVBQUU7WUFDekIsZUFBZSxDQUFDLElBQUksQ0FBQyw2RUFBNkUsQ0FBQyxDQUFDO1NBQ3JHO2FBQU0sSUFBSSxnQkFBZ0IsR0FBRyxFQUFFLEVBQUU7WUFDaEMsZUFBZSxDQUFDLElBQUksQ0FBQyw4RUFBOEUsQ0FBQyxDQUFDO1NBQ3RHO1FBRUQsOEJBQThCO1FBQzlCLGVBQWUsQ0FBQyxJQUFJLENBQUMsNkVBQTZFLENBQUMsQ0FBQztRQUNwRyxlQUFlLENBQUMsSUFBSSxDQUFDLG9FQUFvRSxDQUFDLENBQUM7UUFDM0YsZUFBZSxDQUFDLElBQUksQ0FBQyx5RUFBeUUsQ0FBQyxDQUFDO1FBRWhHLE9BQU8sZUFBZSxDQUFDO0lBQ3pCLENBQUM7SUFFTyxxQkFBcUIsQ0FBQyxZQUFtQjtRQUMvQyxNQUFNLFVBQVUsR0FBRyxZQUFZLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxPQUFPLElBQUksRUFBRSxDQUFDLENBQUMsTUFBTSxDQUFDO1FBQ2xGLE1BQU0sVUFBVSxHQUFHLFlBQVksQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDLE9BQU8sR0FBRyxFQUFFLENBQUMsQ0FBQyxNQUFNLENBQUM7UUFDakYsTUFBTSxhQUFhLEdBQUcsWUFBWSxDQUFDLE1BQU0sQ0FBQztRQUUxQyxNQUFNLFNBQVMsR0FBRyxVQUFVLEdBQUcsYUFBYSxDQUFDO1FBQzdDLE1BQU0sU0FBUyxHQUFHLFVBQVUsR0FBRyxhQUFhLENBQUM7UUFFN0MsSUFBSSxTQUFTLEdBQUcsR0FBRyxJQUFJLFNBQVMsR0FBRyxHQUFHLEVBQUU7WUFDdEMsT0FBTywrQ0FBK0MsQ0FBQztTQUN4RDthQUFNLElBQUksU0FBUyxHQUFHLEdBQUcsSUFBSSxTQUFTLEdBQUcsR0FBRyxFQUFFO1lBQzdDLE9BQU8sK0NBQStDLENBQUM7U0FDeEQ7YUFBTSxJQUFJLFNBQVMsR0FBRyxHQUFHLEVBQUU7WUFDMUIsT0FBTyxpREFBaUQsQ0FBQztTQUMxRDthQUFNO1lBQ0wsT0FBTyxzREFBc0QsQ0FBQztTQUMvRDtJQUNILENBQUM7SUFFRCxLQUFLLENBQUMsY0FBYyxDQUFDLE1BQVc7UUFDOUIseUVBQXlFO1FBQ3pFLElBQUk7WUFDRixNQUFNLFNBQVMsR0FBUSxFQUFFLENBQUM7WUFFMUIsd0NBQXdDO1lBQ3hDLElBQUksTUFBTSxDQUFDLFVBQVUsRUFBRTtnQkFDckIsTUFBTSxZQUFZLEdBQUcsSUFBQSx1QkFBZSxFQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUMsQ0FBQztnQkFDeEQsSUFBSSxDQUFDLFlBQVksRUFBRTtvQkFDakIseUlBQXlJO29CQUN6SSxNQUFNLG1CQUFtQixHQUFHLE1BQU0sQ0FBQyxPQUFPLENBQUMsa0NBQTBCLENBQUM7eUJBQ25FLEtBQUssQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDO3lCQUNYLEdBQUcsQ0FBQyxDQUFDLENBQUMsSUFBSSxFQUFFLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxHQUFHLElBQUksS0FBSyxFQUFFLEdBQUcsQ0FBQzt5QkFDdEMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO29CQUNkLG1FQUFtRTtpQkFDcEU7cUJBQU07b0JBQ0wsb0ZBQW9GO2lCQUNyRjtnQkFDRCx5REFBeUQ7Z0JBQ3pELFNBQVMsQ0FBQyxZQUFZLEdBQUcsQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLFFBQVEsRUFBRSxDQUFDLENBQUM7YUFDekQ7WUFFRCwyQkFBMkI7WUFDM0IsSUFBSSxNQUFNLENBQUMsUUFBUSxJQUFJLE1BQU0sQ0FBQyxRQUFRLEVBQUU7Z0JBQ3RDLFNBQVMsQ0FBQyxjQUFjLEdBQUcsRUFBRSxDQUFDO2dCQUM5QixJQUFJLE1BQU0sQ0FBQyxRQUFRO29CQUFFLFNBQVMsQ0FBQyxjQUFjLENBQUMsR0FBRyxHQUFHLE1BQU0sQ0FBQyxRQUFRLENBQUM7Z0JBQ3BFLElBQUksTUFBTSxDQUFDLFFBQVE7b0JBQUUsU0FBUyxDQUFDLGNBQWMsQ0FBQyxHQUFHLEdBQUcsTUFBTSxDQUFDLFFBQVEsQ0FBQzthQUNyRTtZQUVELHNEQUFzRDtZQUN0RCxJQUFJLE1BQU0sQ0FBQyxXQUFXLEVBQUU7Z0JBQ3RCLFNBQVMsQ0FBQyw0QkFBNEIsR0FBRyxNQUFNLENBQUMsV0FBVyxDQUFDO2FBQzdEO1lBQ0QsSUFBSSxNQUFNLENBQUMsV0FBVyxFQUFFO2dCQUN0QixTQUFTLENBQUMsNEJBQTRCLEdBQUcsTUFBTSxDQUFDLFdBQVcsQ0FBQzthQUM3RDtZQUVELCtEQUErRDtZQUMvRCxJQUFJLE1BQU0sQ0FBQyxTQUFTLEVBQUU7Z0JBQ3BCLFNBQVMsQ0FBQyxrQkFBa0IsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxTQUFTLEdBQUcsRUFBRSxDQUFDLENBQUM7YUFDbEU7WUFDRCxJQUFJLE1BQU0sQ0FBQyxTQUFTLEVBQUU7Z0JBQ3BCLFNBQVMsQ0FBQyxrQkFBa0IsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxTQUFTLEdBQUcsRUFBRSxDQUFDLENBQUM7YUFDbEU7WUFFRCwwREFBMEQ7WUFDMUQsSUFBSSxNQUFNLENBQUMsZUFBZSxFQUFFO2dCQUMxQixTQUFTLENBQUMsZUFBZSxHQUFHLE1BQU0sQ0FBQyxlQUFlLENBQUM7YUFDcEQ7WUFDRCxJQUFJLE1BQU0sQ0FBQyxlQUFlLEVBQUU7Z0JBQzFCLFNBQVMsQ0FBQyxlQUFlLEdBQUcsTUFBTSxDQUFDLGVBQWUsQ0FBQzthQUNwRDtZQUVELDJEQUEyRDtZQUMzRCxJQUFJLE1BQU0sQ0FBQyxjQUFjLEVBQUU7Z0JBQ3pCLFNBQVMsQ0FBQyxtQkFBbUIsR0FBRyxNQUFNLENBQUMsY0FBYyxDQUFDO2FBQ3ZEO1lBQ0QsSUFBSSxNQUFNLENBQUMsY0FBYyxFQUFFO2dCQUN6QixTQUFTLENBQUMsbUJBQW1CLEdBQUcsTUFBTSxDQUFDLGNBQWMsQ0FBQzthQUN2RDtZQUVELDJCQUEyQjtZQUMzQixJQUFJLE1BQU0sQ0FBQyxjQUFjLElBQUksTUFBTSxDQUFDLFVBQVUsS0FBSyxJQUFJLEVBQUU7Z0JBQ3ZELFNBQVMsQ0FBQyxxQkFBcUIsR0FBRyxFQUFFLENBQUM7Z0JBQ3JDLElBQUksTUFBTSxDQUFDLGNBQWMsRUFBRTtvQkFDekIsU0FBUyxDQUFDLHFCQUFxQixDQUFDLEdBQUcsR0FBRyxNQUFNLENBQUMsY0FBYyxDQUFDO2lCQUM3RDtxQkFBTSxJQUFJLE1BQU0sQ0FBQyxVQUFVLEtBQUssSUFBSSxFQUFFO29CQUNyQyxTQUFTLENBQUMscUJBQXFCLENBQUMsR0FBRyxHQUFHLENBQUMsQ0FBQztpQkFDekM7YUFDRjtZQUVELGdDQUFnQztZQUNoQyxJQUFJLE1BQU0sQ0FBQyxPQUFPLEtBQUssSUFBSSxFQUFFO2dCQUMzQixTQUFTLENBQUMsT0FBTyxHQUFHLElBQUksQ0FBQzthQUMxQjtZQUVELHdEQUF3RDtZQUN4RCxJQUFJLE1BQU0sQ0FBQyxZQUFZLElBQUksTUFBTSxDQUFDLFlBQVksRUFBRTtnQkFDOUMsU0FBUyxDQUFDLGtCQUFrQixHQUFHLEVBQUUsQ0FBQztnQkFDbEMsSUFBSSxNQUFNLENBQUMsWUFBWTtvQkFBRSxTQUFTLENBQUMsa0JBQWtCLENBQUMsR0FBRyxHQUFHLE1BQU0sQ0FBQyxZQUFZLENBQUM7Z0JBQ2hGLElBQUksTUFBTSxDQUFDLFlBQVk7b0JBQUUsU0FBUyxDQUFDLGtCQUFrQixDQUFDLEdBQUcsR0FBRyxNQUFNLENBQUMsWUFBWSxDQUFDO2FBQ2pGO1lBRUQseURBQXlEO1lBQ3pELFNBQVMsQ0FBQyxXQUFXLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUU5QixrREFBa0Q7WUFDbEQsb0VBQW9FO1lBQ3BFLCtEQUErRDtZQUMvRCxJQUFJLE1BQU0sQ0FBQyxvQkFBb0IsS0FBSyxLQUFLLEVBQUU7Z0JBQ3pDLHFEQUFxRDtnQkFDckQsU0FBUyxDQUFDLG9CQUFvQixHQUFHLE9BQU8sQ0FBQyxDQUFDLG1CQUFtQjthQUM5RDtZQUVELDhDQUE4QztZQUM5QyxJQUFJLE1BQU0sQ0FBQyxNQUFNLEVBQUU7Z0JBQ2pCLE1BQU0sU0FBUyxHQUFHLE1BQU0sQ0FBQyxTQUFTLElBQUksTUFBTSxDQUFDO2dCQUM3QyxTQUFTLENBQUMsSUFBSSxHQUFHLENBQUMsQ0FBQyxNQUFNLENBQUMsTUFBTSxFQUFFLFNBQVMsQ0FBQyxDQUFDLENBQUM7YUFDL0M7aUJBQU07Z0JBQ0wsMkNBQTJDO2dCQUMzQyxTQUFTLENBQUMsSUFBSSxHQUFHLENBQUMsQ0FBQyxhQUFhLEVBQUUsTUFBTSxDQUFDLENBQUMsQ0FBQzthQUM1QztZQUVELDJEQUEyRDtZQUMzRCwyRUFBMkU7WUFFM0UsZ0NBQWdDO1lBQ2hDLE1BQU0sYUFBYSxHQUFHLE1BQU0sSUFBSSxDQUFDLFdBQVcsQ0FBQyxRQUFRLEVBQUU7Z0JBQ3JELE1BQU0sRUFBRSxNQUFNLENBQUMsTUFBTSxJQUFJLENBQUM7Z0JBQzFCLFNBQVMsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLFNBQVMsQ0FBQztnQkFDcEMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxJQUFJLElBQUksQ0FBQztnQkFDdEIsT0FBTyxFQUFFLElBQUksQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLE9BQU8sSUFBSSxFQUFFLEVBQUUsRUFBRSxDQUFDLENBQUMsb0JBQW9CO2FBQ2pFLENBQXVCLENBQUM7WUFFekIsSUFBSSxhQUFhLENBQUMsUUFBUSxJQUFJLGFBQWEsQ0FBQyxRQUFRLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRTtnQkFDL0QsMENBQTBDO2dCQUMxQyxNQUFNLGdCQUFnQixHQUFHLE1BQU0sSUFBSSxDQUFDLGdCQUFnQixDQUNsRCxhQUFhLENBQUMsUUFBUSxFQUN0QixNQUFNLENBQUMsTUFBTSxJQUFJLENBQUMsRUFDbEI7b0JBQ0UsTUFBTSxFQUFFLElBQUk7b0JBQ1osTUFBTSxFQUFFLEVBQUU7b0JBQ1YsS0FBSyxFQUFFLENBQUMsQ0FBRSxzREFBc0Q7aUJBQ2pFLENBQ0YsQ0FBQztnQkFFRixPQUFPLGdCQUFnQixDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLENBQUM7b0JBQ3RDLEdBQUcsT0FBTztvQkFDVixXQUFXLEVBQUUsYUFBYSxDQUFDLFlBQVk7b0JBQ3ZDLFdBQVcsRUFBRSxJQUFJO2lCQUNsQixDQUFDLENBQUMsQ0FBQzthQUNMO1NBRUY7UUFBQyxPQUFPLEtBQUssRUFBRTtZQUNkLE9BQU8sQ0FBQyxJQUFJLENBQUMsc0RBQXNELEVBQUUsS0FBSyxDQUFDLENBQUM7WUFFNUUsbURBQW1EO1lBQ25ELElBQUksTUFBTSxDQUFDLFVBQVUsRUFBRTtnQkFDckIsSUFBSTtvQkFDRixNQUFNLFdBQVcsR0FBRyxNQUFNLElBQUksQ0FBQyxjQUFjLENBQUM7d0JBQzVDLE1BQU0sRUFBRSxNQUFNLENBQUMsTUFBTSxJQUFJLENBQUM7d0JBQzFCLFFBQVEsRUFBRSxNQUFNLENBQUMsVUFBVTt3QkFDM0IsSUFBSSxFQUFFLE1BQU0sQ0FBQyxJQUFJLElBQUksQ0FBQztxQkFDdkIsQ0FBQyxDQUFDO29CQUVILElBQUksV0FBVyxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUU7d0JBQzFCLE1BQU0sUUFBUSxHQUFHLFdBQVcsQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLE1BQU0sQ0FBQyxPQUFPLElBQUksRUFBRSxDQUFDLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxDQUFDO3dCQUMvRSxNQUFNLGdCQUFnQixHQUFHLE1BQU0sSUFBSSxDQUFDLGdCQUFnQixDQUFDLFFBQVEsRUFBRSxNQUFNLENBQUMsTUFBTSxJQUFJLENBQUMsRUFBRTs0QkFDakYsTUFBTSxFQUFFLElBQUk7NEJBQ1osTUFBTSxFQUFFLEVBQUU7NEJBQ1YsS0FBSyxFQUFFLENBQUMsQ0FBRSxzREFBc0Q7eUJBQ2pFLENBQUMsQ0FBQzt3QkFFSCxPQUFPLGdCQUFnQixDQUFDLEdBQUcsQ0FBQyxDQUFDLE9BQU8sRUFBRSxLQUFLLEVBQUUsRUFBRTs0QkFDN0MsTUFBTSxVQUFVLEdBQUcsV0FBVyxDQUFDLEtBQUssQ0FBQyxDQUFDOzRCQUN0QyxPQUFPO2dDQUNMLEdBQUcsT0FBTztnQ0FDVixXQUFXLEVBQUUsSUFBSSxDQUFDLEdBQUcsQ0FBQyxHQUFHLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLEdBQUcsQ0FBQyxVQUFVLENBQUMsU0FBUyxHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUM7Z0NBQzNFLGNBQWMsRUFBRSxVQUFVLENBQUMsU0FBUztnQ0FDcEMsaUJBQWlCLEVBQUUsSUFBSTs2QkFDeEIsQ0FBQzt3QkFDSixDQUFDLENBQUMsQ0FBQztxQkFDSjtpQkFDRjtnQkFBQyxPQUFPLGFBQWEsRUFBRTtvQkFDdEIsT0FBTyxDQUFDLElBQUksQ0FBQyxvQ0FBb0MsRUFBRSxhQUFhLENBQUMsQ0FBQztpQkFDbkU7YUFDRjtTQUNGO1FBRUQsT0FBTyxFQUFFLENBQUM7SUFDWixDQUFDO0lBRUQsS0FBSyxDQUFDLGFBQWE7UUFDakIsTUFBTSxRQUFRLEdBQUcsTUFBTSxJQUFJLENBQUMsV0FBVyxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBQ2xELE9BQU8sUUFBUSxDQUFDLFVBQVUsQ0FBQztJQUM3QixDQUFDO0lBRUQsd0VBQXdFO0lBQ3hFLEtBQUssQ0FBQyxvQkFBb0IsQ0FBQyxNQU8xQjtRQUNDLElBQUksUUFBUSxHQUFtQixFQUFFLENBQUM7UUFFbEMsSUFBSSxNQUFNLENBQUMsSUFBSSxJQUFJLE1BQU0sQ0FBQyxLQUFLLEVBQUU7WUFDL0IsNEJBQTRCO1lBQzVCLE1BQU0sS0FBSyxHQUFHLE1BQU0sQ0FBQyxLQUFLLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSyxDQUFDLENBQUM7WUFDN0MsUUFBUSxHQUFHLE1BQU0sSUFBSSxDQUFDLGdCQUFnQixDQUFDLEtBQUssRUFBRSxNQUFNLENBQUMsTUFBTSxJQUFJLENBQUMsRUFBRTtnQkFDaEUsS0FBSyxFQUFFLENBQUM7Z0JBQ1IsTUFBTSxFQUFFLElBQUk7YUFDYixDQUFDLENBQUM7U0FDSjthQUFNLElBQUksTUFBTSxDQUFDLFVBQVUsRUFBRTtZQUM1QixpREFBaUQ7WUFDakQsTUFBTSxhQUFhLEdBQUcsTUFBTSxJQUFJLENBQUMsY0FBYyxDQUFDO2dCQUM5QyxVQUFVLEVBQUUsTUFBTSxDQUFDLFVBQVU7Z0JBQzdCLE1BQU0sRUFBRSxNQUFNLENBQUMsTUFBTSxJQUFJLENBQUM7Z0JBQzFCLE9BQU8sRUFBRSxFQUFFO2FBQ1osQ0FBQyxDQUFDO1lBQ0gsUUFBUSxHQUFHLGFBQWEsQ0FBQztTQUMxQjtRQUVELE9BQU8sUUFBUSxDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsRUFBRTtZQUM1QixNQUFNLEtBQUssR0FBRyxPQUFPLENBQUMsS0FBSyxDQUFDO1lBQzVCLElBQUksQ0FBQyxLQUFLO2dCQUFFLE9BQU8sSUFBSSxDQUFDO1lBRXhCLGtEQUFrRDtZQUNsRCxNQUFNLGdCQUFnQixHQUFHLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyx1QkFBdUI7WUFDbEUsTUFBTSxZQUFZLEdBQUcsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUVsQyw4REFBOEQ7WUFDOUQsTUFBTSxtQkFBbUIsR0FBRyxnQkFBZ0IsR0FBRyxDQUFDLENBQUMsQ0FBQztnQkFDaEQsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBRXJFLE1BQU0sV0FBVyxHQUFHLG1CQUFtQixHQUFHLENBQUMsQ0FBQztZQUM1QyxNQUFNLFlBQVksR0FBRyxtQkFBbUIsR0FBRyxFQUFFLENBQUM7WUFFOUMsOEJBQThCO1lBQzlCLE1BQU0sV0FBVyxHQUFHLEtBQUssQ0FBQyxXQUFXLElBQUksQ0FBQyxDQUFDO1lBQzNDLE1BQU0sb0JBQW9CLEdBQUcsS0FBSyxDQUFDLHNCQUFzQixJQUFJLENBQUMsQ0FBQztZQUMvRCxNQUFNLFlBQVksR0FBRyxvQkFBb0IsR0FBRyxFQUFFLENBQUMsQ0FBQztnQkFDOUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsRUFBRSxHQUFHLENBQUMsb0JBQW9CLEdBQUcsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBRXBELE9BQU87Z0JBQ0wsSUFBSSxFQUFFLE9BQU8sQ0FBQyxJQUFJO2dCQUNsQixLQUFLLEVBQUUsT0FBTyxDQUFDLEtBQUs7Z0JBQ3BCLEtBQUssRUFBRSxPQUFPLENBQUMsS0FBSztnQkFDcEIsS0FBSyxFQUFFLFdBQVc7Z0JBQ2xCLGFBQWEsRUFBRTtvQkFDYixLQUFLLEVBQUUsbUJBQW1CO29CQUMxQixNQUFNLEVBQUUsV0FBVztvQkFDbkIsT0FBTyxFQUFFLFlBQVk7b0JBQ3JCLEtBQUssRUFBRSxZQUFZLEdBQUcsZ0JBQWdCLENBQUMsQ0FBQyxDQUFDLGNBQWMsQ0FBQyxDQUFDO3dCQUNsRCxZQUFZLEdBQUcsZ0JBQWdCLENBQUMsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUMsUUFBUTtvQkFDL0QsYUFBYSxFQUFFLFlBQVksR0FBRyxDQUFDLENBQUMsQ0FBQzt3QkFDL0IsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsWUFBWSxHQUFHLGdCQUFnQixDQUFDLEdBQUcsWUFBWSxDQUFDLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7aUJBQzNFO2dCQUNELGdCQUFnQixFQUFFO29CQUNoQixZQUFZLEVBQUUsWUFBWTtvQkFDMUIsZUFBZSxFQUFFLElBQUksQ0FBQyxJQUFJLENBQUMsRUFBRSxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFFLG1CQUFtQixDQUFDLENBQUM7b0JBQ2pFLFlBQVksRUFBRSxvQkFBb0IsR0FBRyxFQUFFLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDO3dCQUNyQyxvQkFBb0IsR0FBRyxFQUFFLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsS0FBSztvQkFDekQsd0JBQXdCLEVBQUUsSUFBSSxDQUFDLElBQUksQ0FBQyxtQkFBbUIsR0FBRyxFQUFFLENBQUM7aUJBQzlEO2dCQUNELGFBQWEsRUFBRTtvQkFDYixNQUFNLEVBQUUsS0FBSyxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUM7b0JBQ3RELFNBQVMsRUFBRSxnQkFBZ0I7b0JBQzNCLFdBQVcsRUFBRSxRQUFRO29CQUNyQixXQUFXLEVBQUUsUUFBUSxDQUFFLHdDQUF3QztpQkFDaEU7Z0JBQ0QsYUFBYSxFQUFFO29CQUNiLGVBQWUsRUFBRSxtQkFBbUIsR0FBRyxDQUFDLFdBQVcsR0FBRyxHQUFHLENBQUM7b0JBQzFELGVBQWUsRUFBRSxJQUFJO29CQUNyQixjQUFjLEVBQUUsbUJBQW1CLEdBQUcsQ0FBQyxXQUFXLEdBQUcsR0FBRyxDQUFDLEdBQUcsSUFBSTtpQkFDakU7YUFDRixDQUFDO1FBQ0osQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxFQUFFO1lBQ2YsSUFBSSxDQUFDLElBQUk7Z0JBQUUsT0FBTyxLQUFLLENBQUM7WUFDeEIsSUFBSSxNQUFNLENBQUMsV0FBVyxJQUFJLElBQUksQ0FBQyxhQUFhLENBQUMsS0FBSyxHQUFHLE1BQU0sQ0FBQyxXQUFXO2dCQUFFLE9BQU8sS0FBSyxDQUFDO1lBQ3RGLE9BQU8sSUFBSSxDQUFDO1FBQ2QsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDO0lBRUQsWUFBWSxDQUFDLE9BQW1CLEVBQUUsUUFBZ0I7UUFDaEQsSUFBSSxDQUFDLE9BQU8sQ0FBQyxRQUFRLENBQUMsRUFBRTtZQUN0QixPQUFPLEVBQUUsQ0FBQztTQUNYO1FBRUQsTUFBTSxJQUFJLEdBQUcsT0FBTyxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBQy9CLE1BQU0sTUFBTSxHQUFnRCxFQUFFLENBQUM7UUFFL0QsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQyxJQUFJLENBQUMsRUFBRTtZQUN2QyxJQUFJLENBQUMsR0FBRyxDQUFDLEdBQUcsSUFBSSxDQUFDLE1BQU0sRUFBRTtnQkFDdkIsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLG1CQUFtQixDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO2dCQUNwRCxNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDO2dCQUMxQixNQUFNLENBQUMsSUFBSSxDQUFDLEVBQUUsU0FBUyxFQUFFLEtBQUssRUFBRSxDQUFDLENBQUM7YUFDbkM7U0FDRjtRQUVELE9BQU8sTUFBTSxDQUFDO0lBQ2hCLENBQUM7SUFFRCxtQkFBbUIsQ0FBQyxTQUFpQjtRQUNuQyxPQUFPLENBQUMsU0FBUyxHQUFHLFFBQVEsQ0FBQyxHQUFHLEtBQUssQ0FBQztJQUN4QyxDQUFDO0lBRUQsbUJBQW1CLENBQUMsUUFBZ0I7UUFDbEMsT0FBTyxJQUFJLENBQUMsS0FBSyxDQUFDLFFBQVEsR0FBRyxLQUFLLENBQUMsR0FBRyxRQUFRLENBQUM7SUFDakQsQ0FBQztJQUVELFdBQVcsQ0FBQyxLQUFhLEVBQUUsU0FBc0IsbUJBQVcsQ0FBQyxFQUFFO1FBQzdELElBQUksS0FBSyxLQUFLLENBQUMsQ0FBQztZQUFFLE9BQU8sS0FBSyxDQUFDO1FBRS9CLE1BQU0sVUFBVSxHQUFnQztZQUM5QyxDQUFDLG1CQUFXLENBQUMsRUFBRSxDQUFDLEVBQUUsR0FBRztZQUNyQixDQUFDLG1CQUFXLENBQUMsRUFBRSxDQUFDLEVBQUUsR0FBRztZQUNyQixDQUFDLG1CQUFXLENBQUMsRUFBRSxDQUFDLEVBQUUsR0FBRztZQUNyQixDQUFDLG1CQUFXLENBQUMsRUFBRSxDQUFDLEVBQUUsR0FBRztZQUNyQixDQUFDLG1CQUFXLENBQUMsRUFBRSxDQUFDLEVBQUUsR0FBRztZQUNyQixDQUFDLG1CQUFXLENBQUMsRUFBRSxDQUFDLEVBQUUsSUFBSTtZQUN0QixDQUFDLG1CQUFXLENBQUMsRUFBRSxDQUFDLEVBQUUsR0FBRztZQUNyQixDQUFDLG1CQUFXLENBQUMsRUFBRSxDQUFDLEVBQUUsR0FBRztZQUNyQixDQUFDLG1CQUFXLENBQUMsRUFBRSxDQUFDLEVBQUUsR0FBRztZQUNyQixDQUFDLG1CQUFXLENBQUMsRUFBRSxDQUFDLEVBQUUsR0FBRztZQUNyQixDQUFDLG1CQUFXLENBQUMsRUFBRSxDQUFDLEVBQUUsR0FBRztTQUN0QixDQUFDO1FBRUYsTUFBTSxRQUFRLEdBQUcsVUFBVSxDQUFDLE1BQU0sQ0FBQyxJQUFJLEdBQUcsQ0FBQztRQUMzQyxNQUFNLGNBQWMsR0FBRyxDQUFDLEtBQUssR0FBRyxHQUFHLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFFaEQsT0FBTyxHQUFHLFFBQVEsR0FBRyxjQUFjLEVBQUUsQ0FBQztJQUN4QyxDQUFDO0lBRUQsYUFBYSxDQUFDLE1BQW1CO1FBQy9CLE1BQU0sT0FBTyxHQUFnQztZQUMzQyxDQUFDLG1CQUFXLENBQUMsRUFBRSxDQUFDLEVBQUUsWUFBWTtZQUM5QixDQUFDLG1CQUFXLENBQUMsRUFBRSxDQUFDLEVBQUUsY0FBYztZQUNoQyxDQUFDLG1CQUFXLENBQUMsRUFBRSxDQUFDLEVBQUUsV0FBVztZQUM3QixDQUFDLG1CQUFXLENBQUMsRUFBRSxDQUFDLEVBQUUsV0FBVztZQUM3QixDQUFDLG1CQUFXLENBQUMsRUFBRSxDQUFDLEVBQUUsY0FBYztZQUNoQyxDQUFDLG1CQUFXLENBQUMsRUFBRSxDQUFDLEVBQUUsV0FBVztZQUM3QixDQUFDLG1CQUFXLENBQUMsRUFBRSxDQUFDLEVBQUUsV0FBVztZQUM3QixDQUFDLG1CQUFXLENBQUMsRUFBRSxDQUFDLEVBQUUsV0FBVztZQUM3QixDQUFDLG1CQUFXLENBQUMsRUFBRSxDQUFDLEVBQUUsV0FBVztZQUM3QixDQUFDLG1CQUFXLENBQUMsRUFBRSxDQUFDLEVBQUUsV0FBVztZQUM3QixDQUFDLG1CQUFXLENBQUMsRUFBRSxDQUFDLEVBQUUsZUFBZTtTQUNsQyxDQUFDO1FBRUYsT0FBTyxPQUFPLENBQUMsTUFBTSxDQUFDLElBQUksWUFBWSxDQUFDO0lBQ3pDLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILGNBQWMsQ0FBQyxPQUFZLEVBQUUsWUFBb0IsT0FBTztRQUN0RCxJQUFJLENBQUMsT0FBTyxFQUFFLEtBQUssRUFBRTtZQUNuQixPQUFPLEVBQUUsS0FBSyxFQUFFLENBQUMsRUFBRSxXQUFXLEVBQUUscUNBQXFDLEVBQUUsQ0FBQztTQUN6RTtRQUVELE1BQU0sRUFBRSxLQUFLLEVBQUUsR0FBRyxPQUFPLENBQUM7UUFDMUIsTUFBTSxlQUFlLEdBQUcsRUFBRSxDQUFDLENBQUMscUJBQXFCO1FBRWpELFFBQVEsU0FBUyxFQUFFO1lBQ2pCLEtBQUssU0FBUztnQkFDWixPQUFPO29CQUNMLEtBQUssRUFBRSxLQUFLLENBQUMsT0FBTyxFQUFFLENBQUMsZUFBZSxDQUFDLElBQUksQ0FBQztvQkFDNUMsV0FBVyxFQUFFLFNBQVM7aUJBQ3ZCLENBQUM7WUFDSixLQUFLLE9BQU87Z0JBQ1YsT0FBTztvQkFDTCxLQUFLLEVBQUUsS0FBSyxDQUFDLEtBQUssRUFBRSxDQUFDLGVBQWUsQ0FBQyxJQUFJLENBQUM7b0JBQzFDLFdBQVcsRUFBRSxnQkFBZ0I7aUJBQzlCLENBQUM7WUFDSixLQUFLLE9BQU87Z0JBQ1YsT0FBTztvQkFDTCxLQUFLLEVBQUUsS0FBSyxDQUFDLEtBQUssRUFBRSxDQUFDLGVBQWUsQ0FBQyxJQUFJLENBQUM7b0JBQzFDLFdBQVcsRUFBRSxnQkFBZ0I7aUJBQzlCLENBQUM7WUFDSixLQUFLLFFBQVE7Z0JBQ1gsT0FBTztvQkFDTCxLQUFLLEVBQUUsS0FBSyxDQUFDLE1BQU0sRUFBRSxDQUFDLGVBQWUsQ0FBQyxJQUFJLENBQUM7b0JBQzNDLFdBQVcsRUFBRSxpQkFBaUI7aUJBQy9CLENBQUM7WUFDSixLQUFLLFFBQVE7Z0JBQ1gsT0FBTztvQkFDTCxLQUFLLEVBQUUsS0FBSyxDQUFDLE1BQU0sRUFBRSxDQUFDLGVBQWUsQ0FBQyxJQUFJLENBQUM7b0JBQzNDLFdBQVcsRUFBRSxpQkFBaUI7aUJBQy9CLENBQUM7WUFDSjtnQkFDRSx5Q0FBeUM7Z0JBQ3pDLE9BQU87b0JBQ0wsS0FBSyxFQUFFLEtBQUssQ0FBQyxLQUFLLEVBQUUsQ0FBQyxlQUFlLENBQUMsSUFBSSxDQUFDO29CQUMxQyxXQUFXLEVBQUUsMEJBQTBCO2lCQUN4QyxDQUFDO1NBQ0w7SUFDSCxDQUFDO0NBQ0Y7QUE1cENELGtDQTRwQ0MiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgYXhpb3MsIHsgQXhpb3NJbnN0YW5jZSwgSW50ZXJuYWxBeGlvc1JlcXVlc3RDb25maWcgfSBmcm9tICdheGlvcyc7XG5pbXBvcnQge1xuICBLZWVwYUNvbmZpZyxcbiAgS2VlcGFQcm9kdWN0LFxuICBLZWVwYURlYWwsXG4gIEtlZXBhU2VsbGVyLFxuICBLZWVwYUJlc3RTZWxsZXIsXG4gIEtlZXBhQXBpUmVzcG9uc2UsXG4gIEtlZXBhUXVlcnlSZXNwb25zZSxcbiAgUHJvZHVjdFF1ZXJ5UGFyYW1zLFxuICBEZWFsUXVlcnlQYXJhbXMsXG4gIFNlbGxlclF1ZXJ5UGFyYW1zLFxuICBCZXN0U2VsbGVyUXVlcnlQYXJhbXMsXG4gIEtlZXBhRXJyb3IsXG4gIEtlZXBhRG9tYWluLFxuICBWRVJJRklFRF9BTUFaT05fQ0FURUdPUklFUyxcbiAgZ2V0Q2F0ZWdvcnlOYW1lXG59IGZyb20gJy4vdHlwZXMnO1xuXG5leHBvcnQgY2xhc3MgS2VlcGFDbGllbnQge1xuICBwcml2YXRlIGNsaWVudDogQXhpb3NJbnN0YW5jZTtcbiAgcHJpdmF0ZSBhcGlLZXk6IHN0cmluZztcbiAgcHJpdmF0ZSBiYXNlVXJsOiBzdHJpbmc7XG4gIHByaXZhdGUgcmF0ZUxpbWl0RGVsYXk6IG51bWJlcjtcbiAgcHJpdmF0ZSBsYXN0UmVxdWVzdFRpbWU6IG51bWJlciA9IDA7XG5cbiAgY29uc3RydWN0b3IoY29uZmlnOiBLZWVwYUNvbmZpZykge1xuICAgIHRoaXMuYXBpS2V5ID0gY29uZmlnLmFwaUtleTtcbiAgICB0aGlzLmJhc2VVcmwgPSBjb25maWcuYmFzZVVybCB8fCAnaHR0cHM6Ly9hcGkua2VlcGEuY29tJztcbiAgICB0aGlzLnJhdGVMaW1pdERlbGF5ID0gY29uZmlnLnJhdGVMaW1pdERlbGF5IHx8IDEwMDA7XG5cbiAgICB0aGlzLmNsaWVudCA9IGF4aW9zLmNyZWF0ZSh7XG4gICAgICBiYXNlVVJMOiB0aGlzLmJhc2VVcmwsXG4gICAgICB0aW1lb3V0OiBjb25maWcudGltZW91dCB8fCAzMDAwMCxcbiAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgJ1VzZXItQWdlbnQnOiAnS2VlcGEtTUNQLVNlcnZlci8xLjAuMCcsXG4gICAgICAgICdBY2NlcHQnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgdGhpcy5jbGllbnQuaW50ZXJjZXB0b3JzLnJlcXVlc3QudXNlKHRoaXMucmVxdWVzdEludGVyY2VwdG9yLmJpbmQodGhpcykpO1xuICAgIHRoaXMuY2xpZW50LmludGVyY2VwdG9ycy5yZXNwb25zZS51c2UoXG4gICAgICB0aGlzLnJlc3BvbnNlSW50ZXJjZXB0b3IuYmluZCh0aGlzKSxcbiAgICAgIHRoaXMuZXJyb3JJbnRlcmNlcHRvci5iaW5kKHRoaXMpXG4gICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVxdWVzdEludGVyY2VwdG9yKGNvbmZpZzogSW50ZXJuYWxBeGlvc1JlcXVlc3RDb25maWcpOiBQcm9taXNlPEludGVybmFsQXhpb3NSZXF1ZXN0Q29uZmlnPiB7XG4gICAgY29uc3Qgbm93ID0gRGF0ZS5ub3coKTtcbiAgICBjb25zdCB0aW1lU2luY2VMYXN0UmVxdWVzdCA9IG5vdyAtIHRoaXMubGFzdFJlcXVlc3RUaW1lO1xuICAgIFxuICAgIGlmICh0aW1lU2luY2VMYXN0UmVxdWVzdCA8IHRoaXMucmF0ZUxpbWl0RGVsYXkpIHtcbiAgICAgIGF3YWl0IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gXG4gICAgICAgIHNldFRpbWVvdXQocmVzb2x2ZSwgdGhpcy5yYXRlTGltaXREZWxheSAtIHRpbWVTaW5jZUxhc3RSZXF1ZXN0KVxuICAgICAgKTtcbiAgICB9XG4gICAgXG4gICAgdGhpcy5sYXN0UmVxdWVzdFRpbWUgPSBEYXRlLm5vdygpO1xuICAgIHJldHVybiBjb25maWc7XG4gIH1cblxuICBwcml2YXRlIHJlc3BvbnNlSW50ZXJjZXB0b3IocmVzcG9uc2U6IGFueSk6IGFueSB7XG4gICAgcmV0dXJuIHJlc3BvbnNlO1xuICB9XG5cbiAgcHJpdmF0ZSBlcnJvckludGVyY2VwdG9yKGVycm9yOiBhbnkpOiBQcm9taXNlPG5ldmVyPiB7XG4gICAgaWYgKGVycm9yLnJlc3BvbnNlPy5kYXRhKSB7XG4gICAgICBjb25zdCB7IHN0YXR1c0NvZGUsIGVycm9yOiBlcnJvck1lc3NhZ2UsIHRva2Vuc0xlZnQgfSA9IGVycm9yLnJlc3BvbnNlLmRhdGE7XG4gICAgICBcbiAgICAgIC8vIEVuaGFuY2VkIHRva2VuIGV4aGF1c3Rpb24gZGV0ZWN0aW9uXG4gICAgICBpZiAodG9rZW5zTGVmdCAhPT0gdW5kZWZpbmVkICYmIHRva2Vuc0xlZnQgPD0gMCkge1xuICAgICAgICB0aHJvdyBuZXcgS2VlcGFFcnJvcihcbiAgICAgICAgICBg4pqg77iPIEtFRVBBIFRPS0VOIEVYSEFVU1RJT046IFlvdSBoYXZlICR7dG9rZW5zTGVmdH0gdG9rZW5zIHJlbWFpbmluZy4gYCArXG4gICAgICAgICAgYFBsZWFzZSB3YWl0IGZvciB0b2tlbnMgdG8gcmVmcmVzaCBvciB1cGdyYWRlIHlvdXIgS2VlcGEgcGxhbi4gYCArXG4gICAgICAgICAgYENoZWNrIHlvdXIgdG9rZW4gc3RhdHVzIGF0IGh0dHBzOi8va2VlcGEuY29tLyMhYXBpYCxcbiAgICAgICAgICBzdGF0dXNDb2RlLFxuICAgICAgICAgIHRva2Vuc0xlZnRcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIFxuICAgICAgLy8gTG93IHRva2VuIHdhcm5pbmcgIFxuICAgICAgaWYgKHRva2Vuc0xlZnQgIT09IHVuZGVmaW5lZCAmJiB0b2tlbnNMZWZ0IDwgNSkge1xuICAgICAgICAvLyBjb25zb2xlLndhcm4oYPCfn6EgTE9XIFRPS0VOUyBXQVJOSU5HOiBPbmx5ICR7dG9rZW5zTGVmdH0gdG9rZW5zIHJlbWFpbmluZy4gQ29uc2lkZXIgdXBncmFkaW5nIHlvdXIgS2VlcGEgcGxhbi5gKTtcbiAgICAgIH1cbiAgICAgIFxuICAgICAgY29uc3QgbWVzc2FnZSA9IHR5cGVvZiBlcnJvck1lc3NhZ2UgPT09ICdzdHJpbmcnID8gZXJyb3JNZXNzYWdlIDogXG4gICAgICAgICAgICAgICAgICAgICB0eXBlb2YgZXJyb3JNZXNzYWdlID09PSAnb2JqZWN0JyA/IEpTT04uc3RyaW5naWZ5KGVycm9yTWVzc2FnZSkgOlxuICAgICAgICAgICAgICAgICAgICAgJ0FQSSByZXF1ZXN0IGZhaWxlZCc7XG4gICAgICB0aHJvdyBuZXcgS2VlcGFFcnJvcihcbiAgICAgICAgbWVzc2FnZSxcbiAgICAgICAgc3RhdHVzQ29kZSxcbiAgICAgICAgdG9rZW5zTGVmdFxuICAgICAgKTtcbiAgICB9XG4gICAgY29uc3QgbWVzc2FnZSA9IHR5cGVvZiBlcnJvciA9PT0gJ3N0cmluZycgPyBlcnJvciA6XG4gICAgICAgICAgICAgICAgICAgIGVycm9yLm1lc3NhZ2UgPyBlcnJvci5tZXNzYWdlIDpcbiAgICAgICAgICAgICAgICAgICAgdHlwZW9mIGVycm9yID09PSAnb2JqZWN0JyA/IEpTT04uc3RyaW5naWZ5KGVycm9yKSA6XG4gICAgICAgICAgICAgICAgICAgICdOZXR3b3JrIGVycm9yJztcbiAgICB0aHJvdyBuZXcgS2VlcGFFcnJvcihtZXNzYWdlKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgbWFrZVJlcXVlc3Q8VD4oXG4gICAgZW5kcG9pbnQ6IHN0cmluZyxcbiAgICBwYXJhbXM6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fVxuICApOiBQcm9taXNlPEtlZXBhQXBpUmVzcG9uc2U8VD4+IHtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMuY2xpZW50LmdldChlbmRwb2ludCwge1xuICAgICAgcGFyYW1zOiB7XG4gICAgICAgIGtleTogdGhpcy5hcGlLZXksXG4gICAgICAgIC4uLnBhcmFtcyxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICByZXR1cm4gcmVzcG9uc2UuZGF0YTtcbiAgfVxuXG4gIGFzeW5jIGdldFByb2R1Y3QocGFyYW1zOiBQcm9kdWN0UXVlcnlQYXJhbXMpOiBQcm9taXNlPEtlZXBhUHJvZHVjdFtdPiB7XG4gICAgaWYgKCFwYXJhbXMuYXNpbiAmJiAhcGFyYW1zLmFzaW5zICYmICFwYXJhbXMuY29kZSkge1xuICAgICAgdGhyb3cgbmV3IEtlZXBhRXJyb3IoJ0VpdGhlciBhc2luLCBhc2lucywgb3IgY29kZSBwYXJhbWV0ZXIgaXMgcmVxdWlyZWQnKTtcbiAgICB9XG5cbiAgICBjb25zdCBxdWVyeVBhcmFtczogUmVjb3JkPHN0cmluZywgYW55PiA9IHsgLi4ucGFyYW1zIH07XG4gICAgXG4gICAgaWYgKHBhcmFtcy5hc2lucykge1xuICAgICAgcXVlcnlQYXJhbXMuYXNpbiA9IHBhcmFtcy5hc2lucy5qb2luKCcsJyk7XG4gICAgICBkZWxldGUgcXVlcnlQYXJhbXMuYXNpbnM7XG4gICAgfVxuXG4gICAgLy8gRW5hYmxlIHN0YXRpc3RpY3MgYnkgZGVmYXVsdCBmb3Igc2FsZXMgdmVsb2NpdHkgYW5kIGludmVudG9yeSBhbmFseXRpY3NcbiAgICBpZiAocXVlcnlQYXJhbXMuc3RhdHMgPT09IHVuZGVmaW5lZCkge1xuICAgICAgcXVlcnlQYXJhbXMuc3RhdHMgPSAxOyAvLyBGcmVlIGFuYWx5dGljczogc2FsZXMgdmVsb2NpdHksIGJ1eSBib3gsIGludmVudG9yeSBkYXRhXG4gICAgfVxuXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0PHsgcHJvZHVjdHM6IEtlZXBhUHJvZHVjdFtdIH0+KCcvcHJvZHVjdCcsIHF1ZXJ5UGFyYW1zKTtcbiAgICByZXR1cm4gKHJlc3BvbnNlIGFzIGFueSkucHJvZHVjdHMgfHwgW107XG4gIH1cblxuICBhc3luYyBnZXRQcm9kdWN0QnlBc2luKGFzaW46IHN0cmluZywgZG9tYWluOiBLZWVwYURvbWFpbiA9IEtlZXBhRG9tYWluLlVTLCBvcHRpb25zOiBQYXJ0aWFsPFByb2R1Y3RRdWVyeVBhcmFtcz4gPSB7fSk6IFByb21pc2U8S2VlcGFQcm9kdWN0IHwgbnVsbD4ge1xuICAgIGNvbnN0IHByb2R1Y3RzID0gYXdhaXQgdGhpcy5nZXRQcm9kdWN0KHtcbiAgICAgIGFzaW4sXG4gICAgICBkb21haW4sXG4gICAgICAuLi5vcHRpb25zXG4gICAgfSk7XG4gICAgcmV0dXJuIHByb2R1Y3RzWzBdIHx8IG51bGw7XG4gIH1cblxuICBhc3luYyBnZXRQcm9kdWN0c0JhdGNoKGFzaW5zOiBzdHJpbmdbXSwgZG9tYWluOiBLZWVwYURvbWFpbiA9IEtlZXBhRG9tYWluLlVTLCBvcHRpb25zOiBQYXJ0aWFsPFByb2R1Y3RRdWVyeVBhcmFtcz4gPSB7fSk6IFByb21pc2U8S2VlcGFQcm9kdWN0W10+IHtcbiAgICBjb25zdCBiYXRjaFNpemUgPSAxMDA7XG4gICAgY29uc3QgcmVzdWx0czogS2VlcGFQcm9kdWN0W10gPSBbXTtcblxuICAgIC8vIEVuYWJsZSBzdGF0aXN0aWNzIGJ5IGRlZmF1bHQgZm9yIGJhdGNoIG9wZXJhdGlvbnNcbiAgICBjb25zdCBvcHRpb25zV2l0aFN0YXRzID0geyBzdGF0czogMSwgLi4ub3B0aW9ucyB9O1xuXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBhc2lucy5sZW5ndGg7IGkgKz0gYmF0Y2hTaXplKSB7XG4gICAgICBjb25zdCBiYXRjaCA9IGFzaW5zLnNsaWNlKGksIGkgKyBiYXRjaFNpemUpO1xuICAgICAgY29uc3QgcHJvZHVjdHMgPSBhd2FpdCB0aGlzLmdldFByb2R1Y3Qoe1xuICAgICAgICBhc2luczogYmF0Y2gsXG4gICAgICAgIGRvbWFpbixcbiAgICAgICAgLi4ub3B0aW9uc1dpdGhTdGF0c1xuICAgICAgfSk7XG4gICAgICByZXN1bHRzLnB1c2goLi4ucHJvZHVjdHMpO1xuICAgIH1cblxuICAgIHJldHVybiByZXN1bHRzO1xuICB9XG5cbiAgYXN5bmMgZ2V0RGVhbHMocGFyYW1zOiBEZWFsUXVlcnlQYXJhbXMpOiBQcm9taXNlPEtlZXBhRGVhbFtdPiB7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0PHsgZGVhbHM6IEtlZXBhRGVhbFtdIH0+KCcvZGVhbCcsIHBhcmFtcyk7XG4gICAgcmV0dXJuIChyZXNwb25zZSBhcyBhbnkpLmRlYWxzIHx8IFtdO1xuICB9XG5cbiAgLy8gTkVXOiBFbmhhbmNlZCBEZWFsIERpc2NvdmVyeSB3aXRoIGNvbXByZWhlbnNpdmUgZmlsdGVyaW5nIGFuZCBhbmFseXNpc1xuICBhc3luYyBkaXNjb3ZlckRlYWxzKHBhcmFtczoge1xuICAgIGRvbWFpbj86IG51bWJlcjtcbiAgICBjYXRlZ29yeUlkPzogbnVtYmVyO1xuICAgIG1pblByaWNlPzogbnVtYmVyO1xuICAgIG1heFByaWNlPzogbnVtYmVyO1xuICAgIG1pbkRpc2NvdW50PzogbnVtYmVyO1xuICAgIG1heERpc2NvdW50PzogbnVtYmVyO1xuICAgIG1pblJhdGluZz86IG51bWJlcjtcbiAgICBpc1ByaW1lPzogYm9vbGVhbjtcbiAgICBpc0xpZ2h0bmluZ0RlYWw/OiBib29sZWFuO1xuICAgIGlzV2FyZWhvdXNlRGVhbD86IGJvb2xlYW47XG4gICAgbWluRGVhbFNjb3JlPzogbnVtYmVyO1xuICAgIHNvcnRCeT86ICdkZWFsU2NvcmUnIHwgJ2Rpc2NvdW50JyB8ICdwcmljZScgfCAncmF0aW5nJyB8ICdzYWxlc1JhbmsnO1xuICAgIHNvcnRPcmRlcj86ICdhc2MnIHwgJ2Rlc2MnO1xuICAgIHBhZ2U/OiBudW1iZXI7XG4gICAgcGVyUGFnZT86IG51bWJlcjtcbiAgfSk6IFByb21pc2U8YW55W10+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgZGVhbFBhcmFtczogYW55ID0ge1xuICAgICAgICBkb21haW5JZDogcGFyYW1zLmRvbWFpbiB8fCAxLFxuICAgICAgICBwYWdlOiBwYXJhbXMucGFnZSB8fCAwLFxuICAgICAgICBwZXJQYWdlOiBNYXRoLm1pbihwYXJhbXMucGVyUGFnZSB8fCAyNSwgNTApXG4gICAgICB9O1xuXG4gICAgICAvLyBQcmljZSBmaWx0ZXJzXG4gICAgICBpZiAocGFyYW1zLm1pblByaWNlKSBkZWFsUGFyYW1zLm1pblByaWNlID0gcGFyYW1zLm1pblByaWNlO1xuICAgICAgaWYgKHBhcmFtcy5tYXhQcmljZSkgZGVhbFBhcmFtcy5tYXhQcmljZSA9IHBhcmFtcy5tYXhQcmljZTtcbiAgICAgIFxuICAgICAgLy8gRGlzY291bnQgZmlsdGVyc1xuICAgICAgaWYgKHBhcmFtcy5taW5EaXNjb3VudCkgZGVhbFBhcmFtcy5taW5EaXNjb3VudCA9IHBhcmFtcy5taW5EaXNjb3VudDtcbiAgICAgIFxuICAgICAgLy8gQ2F0ZWdvcnkgZmlsdGVyXG4gICAgICBpZiAocGFyYW1zLmNhdGVnb3J5SWQpIGRlYWxQYXJhbXMuY2F0ZWdvcnlJZCA9IHBhcmFtcy5jYXRlZ29yeUlkO1xuICAgICAgXG4gICAgICAvLyBSYXRpbmcgZmlsdGVyICBcbiAgICAgIGlmIChwYXJhbXMubWluUmF0aW5nKSBkZWFsUGFyYW1zLm1pblJhdGluZyA9IHBhcmFtcy5taW5SYXRpbmc7XG4gICAgICBcbiAgICAgIC8vIERlYWwgdHlwZSBmaWx0ZXJzXG4gICAgICBpZiAocGFyYW1zLmlzUHJpbWUpIGRlYWxQYXJhbXMuaXNQcmltZSA9IHBhcmFtcy5pc1ByaW1lO1xuICAgICAgXG4gICAgICAvLyBTb3J0IG9wdGlvbnNcbiAgICAgIGNvbnN0IHNvcnRUeXBlcyA9IHtcbiAgICAgICAgJ2RlYWxTY29yZSc6IDAsXG4gICAgICAgICdwcmljZSc6IDEsXG4gICAgICAgICdkaXNjb3VudCc6IDIsXG4gICAgICAgICdyYXRpbmcnOiAzLFxuICAgICAgICAnc2FsZXNSYW5rJzogNFxuICAgICAgfTtcbiAgICAgIGRlYWxQYXJhbXMuc29ydFR5cGUgPSBzb3J0VHlwZXNbcGFyYW1zLnNvcnRCeSB8fCAnZGVhbFNjb3JlJ10gfHwgMDtcblxuICAgICAgY29uc3QgZGVhbHMgPSBhd2FpdCB0aGlzLmdldERlYWxzKGRlYWxQYXJhbXMpO1xuXG4gICAgICAvLyBFbmhhbmNlZCBkZWFsIGFuYWx5c2lzIHdpdGggRGVhbCBvYmplY3QgaW5zaWdodHNcbiAgICAgIHJldHVybiBkZWFscy5tYXAoKGRlYWw6IGFueSkgPT4ge1xuICAgICAgICAvLyBTYWZlbHkgZXh0cmFjdCBkZWFsIG1ldHJpY3NcbiAgICAgICAgY29uc3QgZGlzY291bnRQZXJjZW50ID0gdGhpcy5leHRyYWN0RGlzY291bnRQZXJjZW50KGRlYWwuZGVsdGFQZXJjZW50KTtcbiAgICAgICAgY29uc3QgcHJpY2VDaGFuZ2UgPSB0aGlzLmV4dHJhY3RQcmljZUNoYW5nZShkZWFsLmRlbHRhKTtcblxuICAgICAgICAvLyBEZXRlcm1pbmUgZGVhbCB1cmdlbmN5IGJhc2VkIG9uIGxpZ2h0bmluZyBkZWFsIHRpbWluZyAgXG4gICAgICAgIGNvbnN0IGlzVXJnZW50ID0gZGVhbC5pc0xpZ2h0bmluZ0RlYWwgJiYgZGVhbC5saWdodG5pbmdFbmQgPyBcbiAgICAgICAgICAoRGF0ZS5ub3coKSAvIDYwMDAwIC0gMjE1NjQwMDApIDwgZGVhbC5saWdodG5pbmdFbmQgOiBmYWxzZTtcblxuICAgICAgICAvLyBFbmhhbmNlZCBkZWFsIHNjb3JpbmdcbiAgICAgICAgbGV0IGVuaGFuY2VkU2NvcmUgPSBkZWFsLmRlYWxTY29yZSB8fCAwO1xuICAgICAgICBpZiAoZGVhbC5pc1ByaW1lRXhjbHVzaXZlKSBlbmhhbmNlZFNjb3JlICs9IDEwO1xuICAgICAgICBpZiAoZGVhbC5pc0xpZ2h0bmluZ0RlYWwpIGVuaGFuY2VkU2NvcmUgKz0gMTU7XG4gICAgICAgIGlmIChkaXNjb3VudFBlcmNlbnQgPiA1MCkgZW5oYW5jZWRTY29yZSArPSAyMDtcblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIC4uLmRlYWwsXG4gICAgICAgICAgLy8gRW5oYW5jZWQgYW5hbHlzaXNcbiAgICAgICAgICBkaXNjb3VudFBlcmNlbnQ6IGRpc2NvdW50UGVyY2VudCxcbiAgICAgICAgICBwcmljZUNoYW5nZTogcHJpY2VDaGFuZ2UsXG4gICAgICAgICAgZW5oYW5jZWREZWFsU2NvcmU6IGVuaGFuY2VkU2NvcmUsXG4gICAgICAgICAgdXJnZW5jeTogaXNVcmdlbnQgPyAnSElHSCcgOiBkZWFsLmlzTGlnaHRuaW5nRGVhbCA/ICdNRURJVU0nIDogJ0xPVycsXG4gICAgICAgICAgcHJvZml0UG90ZW50aWFsOiB0aGlzLmNhbGN1bGF0ZVByb2ZpdFBvdGVudGlhbChkZWFsKSxcbiAgICAgICAgICBjb21wZXRpdGlvbkxldmVsOiB0aGlzLmFzc2Vzc0RlYWxDb21wZXRpdGlvbihkZWFsKSxcbiAgICAgICAgICAvLyBEZWFsIGNsYXNzaWZpY2F0aW9uXG4gICAgICAgICAgZGVhbFR5cGU6IGRlYWwuaXNMaWdodG5pbmdEZWFsID8gJ0xpZ2h0bmluZycgOiBcbiAgICAgICAgICAgICAgICAgICAgZGVhbC5jb3Vwb24gPyAnQ291cG9uJyA6IFxuICAgICAgICAgICAgICAgICAgICBkZWFsLnByb21vdGlvbiA/ICdQcm9tb3Rpb24nIDogJ1JlZ3VsYXInLFxuICAgICAgICAgIC8vIFRpbWUgc2Vuc2l0aXZpdHkgIFxuICAgICAgICAgIHRpbWVSZW1haW5pbmc6IGRlYWwubGlnaHRuaW5nRW5kID8gXG4gICAgICAgICAgICBNYXRoLm1heCgwLCBkZWFsLmxpZ2h0bmluZ0VuZCAtIChEYXRlLm5vdygpIC8gNjAwMDAgLSAyMTU2NDAwMCkpIDogbnVsbCxcbiAgICAgICAgICAvLyBNYXJrZXQgaW5zaWdodHNcbiAgICAgICAgICBzYWxlc1RyZW5kOiBkZWFsLnNhbGVzUmFua1JlZmVyZW5jZSAmJiBkZWFsLnNhbGVzUmFuayA/IFxuICAgICAgICAgICAgKGRlYWwuc2FsZXNSYW5rUmVmZXJlbmNlID4gZGVhbC5zYWxlc1JhbmsgPyAnSW1wcm92aW5nJyA6ICdEZWNsaW5pbmcnKSA6ICdTdGFibGUnXG4gICAgICAgIH07XG4gICAgICB9KVxuICAgICAgLmZpbHRlcigoZGVhbDogYW55KSA9PiB7XG4gICAgICAgIC8vIEFwcGx5IGFkZGl0aW9uYWwgZmlsdGVyc1xuICAgICAgICBpZiAocGFyYW1zLm1pbkRlYWxTY29yZSAmJiBkZWFsLmVuaGFuY2VkRGVhbFNjb3JlIDwgcGFyYW1zLm1pbkRlYWxTY29yZSkgcmV0dXJuIGZhbHNlO1xuICAgICAgICBpZiAocGFyYW1zLmlzTGlnaHRuaW5nRGVhbCAmJiAhZGVhbC5pc0xpZ2h0bmluZ0RlYWwpIHJldHVybiBmYWxzZTtcbiAgICAgICAgaWYgKHBhcmFtcy5tYXhEaXNjb3VudCAmJiBkZWFsLmRpc2NvdW50UGVyY2VudCA+IHBhcmFtcy5tYXhEaXNjb3VudCkgcmV0dXJuIGZhbHNlO1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH0pXG4gICAgICAuc29ydCgoYTogYW55LCBiOiBhbnkpID0+IHtcbiAgICAgICAgLy8gRW5oYW5jZWQgc29ydGluZyB3aXRoIHNhZmUgZmllbGQgYWNjZXNzXG4gICAgICAgIGNvbnN0IGZpZWxkID0gcGFyYW1zLnNvcnRCeSB8fCAnZGVhbFNjb3JlJztcbiAgICAgICAgY29uc3Qgb3JkZXIgPSBwYXJhbXMuc29ydE9yZGVyID09PSAnYXNjJyA/IDEgOiAtMTtcbiAgICAgICAgXG4gICAgICAgIGxldCBhVmFsID0gZmllbGQgPT09ICdkZWFsU2NvcmUnID8gYS5lbmhhbmNlZERlYWxTY29yZSA6IChhW2ZpZWxkXSB8fCAwKTtcbiAgICAgICAgbGV0IGJWYWwgPSBmaWVsZCA9PT0gJ2RlYWxTY29yZScgPyBiLmVuaGFuY2VkRGVhbFNjb3JlIDogKGJbZmllbGRdIHx8IDApO1xuICAgICAgICBcbiAgICAgICAgcmV0dXJuIChhVmFsIC0gYlZhbCkgKiBvcmRlcjtcbiAgICAgIH0pO1xuXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnNvbGUud2FybignRGVhbCBkaXNjb3ZlcnkgZmFpbGVkOicsIGVycm9yKTtcbiAgICAgIHJldHVybiBbXTtcbiAgICB9XG4gIH1cblxuICAvLyBIZWxwZXIgbWV0aG9kcyBmb3IgZGVhbCBhbmFseXNpc1xuICBwcml2YXRlIGV4dHJhY3REaXNjb3VudFBlcmNlbnQoZGVsdGFQZXJjZW50OiBhbnkpOiBudW1iZXIge1xuICAgIGlmICghZGVsdGFQZXJjZW50KSByZXR1cm4gMDtcbiAgICBpZiAodHlwZW9mIGRlbHRhUGVyY2VudCA9PT0gJ251bWJlcicpIHJldHVybiBNYXRoLmFicyhkZWx0YVBlcmNlbnQpO1xuICAgIGlmIChBcnJheS5pc0FycmF5KGRlbHRhUGVyY2VudCkgJiYgZGVsdGFQZXJjZW50Lmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IGZpcnN0VmFsdWUgPSBkZWx0YVBlcmNlbnRbMF07XG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShmaXJzdFZhbHVlKSAmJiBmaXJzdFZhbHVlLmxlbmd0aCA+IDApIHtcbiAgICAgICAgcmV0dXJuIE1hdGguYWJzKGZpcnN0VmFsdWVbMF0pO1xuICAgICAgfVxuICAgICAgcmV0dXJuIE1hdGguYWJzKGZpcnN0VmFsdWUpO1xuICAgIH1cbiAgICByZXR1cm4gMDtcbiAgfVxuXG4gIHByaXZhdGUgZXh0cmFjdFByaWNlQ2hhbmdlKGRlbHRhOiBhbnkpOiBudW1iZXIge1xuICAgIGlmICghZGVsdGEpIHJldHVybiAwO1xuICAgIGlmICh0eXBlb2YgZGVsdGEgPT09ICdudW1iZXInKSByZXR1cm4gTWF0aC5hYnMoZGVsdGEpO1xuICAgIGlmIChBcnJheS5pc0FycmF5KGRlbHRhKSAmJiBkZWx0YS5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBmaXJzdFZhbHVlID0gZGVsdGFbMF07XG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShmaXJzdFZhbHVlKSAmJiBmaXJzdFZhbHVlLmxlbmd0aCA+IDApIHtcbiAgICAgICAgcmV0dXJuIE1hdGguYWJzKGZpcnN0VmFsdWVbMF0pO1xuICAgICAgfVxuICAgICAgcmV0dXJuIE1hdGguYWJzKGZpcnN0VmFsdWUpO1xuICAgIH1cbiAgICByZXR1cm4gMDtcbiAgfVxuXG4gIHByaXZhdGUgY2FsY3VsYXRlUHJvZml0UG90ZW50aWFsKGRlYWw6IGFueSk6IHN0cmluZyB7XG4gICAgY29uc3QgZGlzY291bnQgPSB0aGlzLmV4dHJhY3REaXNjb3VudFBlcmNlbnQoZGVhbC5kZWx0YVBlcmNlbnQpO1xuICAgIGNvbnN0IHByaWNlID0gZGVhbC5wcmljZSB8fCAwO1xuICAgIGNvbnN0IHJhbmsgPSBkZWFsLnNhbGVzUmFuayB8fCA5OTk5OTk7XG5cbiAgICAvLyBTaW1wbGUgcHJvZml0IHBvdGVudGlhbCBzY29yaW5nXG4gICAgbGV0IHNjb3JlID0gMDtcbiAgICBpZiAoZGlzY291bnQgPiAzMCkgc2NvcmUgKz0gMzA7XG4gICAgaWYgKGRpc2NvdW50ID4gNTApIHNjb3JlICs9IDIwOyBcbiAgICBpZiAocHJpY2UgPiAyMDAwICYmIHByaWNlIDwgMTAwMDApIHNjb3JlICs9IDIwOyAvLyBTd2VldCBzcG90IHByaWNpbmdcbiAgICBpZiAocmFuayA8IDEwMDAwKSBzY29yZSArPSAyMDsgLy8gR29vZCBzYWxlcyByYW5rXG4gICAgaWYgKGRlYWwuaXNQcmltZUV4Y2x1c2l2ZSkgc2NvcmUgKz0gMTA7XG5cbiAgICByZXR1cm4gc2NvcmUgPiA2MCA/ICdISUdIJyA6IHNjb3JlID4gMzAgPyAnTUVESVVNJyA6ICdMT1cnO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3Nlc3NEZWFsQ29tcGV0aXRpb24oZGVhbDogYW55KTogc3RyaW5nIHtcbiAgICAvLyBCYXNlZCBvbiBjYXRlZ29yeSBhbmQgc2FsZXMgcmFuayAtIHNpbXBsaWZpZWQgYXNzZXNzbWVudFxuICAgIGNvbnN0IHJhbmsgPSBkZWFsLnNhbGVzUmFuayB8fCA5OTk5OTk7XG4gICAgY29uc3QgaGFzTXVsdGlwbGVTZWxsZXJzID0gdHJ1ZTsgLy8gV291bGQgbmVlZCBtYXJrZXRwbGFjZSBkYXRhIGZvciBhY2N1cmF0ZSBhc3Nlc3NtZW50XG4gICAgXG4gICAgaWYgKHJhbmsgPCAxMDAwKSByZXR1cm4gJ0hJR0gnO1xuICAgIGlmIChyYW5rIDwgMTAwMDApIHJldHVybiAnTUVESVVNJzsgXG4gICAgcmV0dXJuICdMT1cnO1xuICB9XG5cbiAgYXN5bmMgZ2V0U2VsbGVyKHBhcmFtczogU2VsbGVyUXVlcnlQYXJhbXMpOiBQcm9taXNlPEtlZXBhU2VsbGVyW10+IHtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3Q8eyBzZWxsZXJzOiBLZWVwYVNlbGxlcltdIH0+KCcvc2VsbGVyJywgcGFyYW1zKTtcbiAgICByZXR1cm4gKHJlc3BvbnNlIGFzIGFueSkuc2VsbGVycyB8fCBbXTtcbiAgfVxuXG4gIC8vIE5FVzogQ2F0ZWdvcnkgQW5hbHlzaXMgZm9yIE1hcmtldCBJbnRlbGxpZ2VuY2VcbiAgYXN5bmMgYW5hbHl6ZUNhdGVnb3J5KHBhcmFtczoge1xuICAgIGNhdGVnb3J5SWQ6IG51bWJlcjtcbiAgICBkb21haW4/OiBudW1iZXI7XG4gICAgYW5hbHlzaXNUeXBlPzogJ292ZXJ2aWV3JyB8ICd0b3BfcGVyZm9ybWVycycgfCAnb3Bwb3J0dW5pdGllcycgfCAndHJlbmRzJztcbiAgICBwcmljZVJhbmdlPzogJ2J1ZGdldCcgfCAnbWlkJyB8ICdwcmVtaXVtJyB8ICdsdXh1cnknO1xuICAgIG1pblJhdGluZz86IG51bWJlcjtcbiAgICBzYW1wbGVTaXplPzogbnVtYmVyO1xuICB9KTogUHJvbWlzZTxhbnk+IHtcbiAgICB0cnkge1xuICAgICAgLy8gR2V0IGNhdGVnb3J5IGRhdGEgdXNpbmcgZW5oYW5jZWQgcHJvZHVjdCBmaW5kZXJcbiAgICAgIGNvbnN0IHNlYXJjaFBhcmFtczogYW55ID0ge1xuICAgICAgICBjYXRlZ29yeUlkOiBwYXJhbXMuY2F0ZWdvcnlJZCxcbiAgICAgICAgZG9tYWluOiBwYXJhbXMuZG9tYWluIHx8IDEsXG4gICAgICAgIHBlclBhZ2U6IE1hdGgubWluKHBhcmFtcy5zYW1wbGVTaXplIHx8IDUwLCA1MCkgLy8gTGFyZ2VyIHNhbXBsZSBmb3IgYW5hbHlzaXNcbiAgICAgIH07XG5cbiAgICAgIC8vIEFwcGx5IGFuYWx5c2lzLXNwZWNpZmljIGZpbHRlcnNcbiAgICAgIGlmIChwYXJhbXMubWluUmF0aW5nKSB7XG4gICAgICAgIHNlYXJjaFBhcmFtcy5taW5SYXRpbmcgPSBwYXJhbXMubWluUmF0aW5nO1xuICAgICAgfVxuXG4gICAgICAvLyBQcmljZSByYW5nZSBmaWx0ZXJzIChpbiBjZW50cylcbiAgICAgIGlmIChwYXJhbXMucHJpY2VSYW5nZSkge1xuICAgICAgICBjb25zdCBwcmljZVJhbmdlcyA9IHtcbiAgICAgICAgICAnYnVkZ2V0JzogeyBtaW46IDAsIG1heDogMjUwMCB9LCAgICAgICAgLy8gVW5kZXIgJDI1XG4gICAgICAgICAgJ21pZCc6IHsgbWluOiAyNTAwLCBtYXg6IDc1MDAgfSwgICAgICAgIC8vICQyNS0kNzVcbiAgICAgICAgICAncHJlbWl1bSc6IHsgbWluOiA3NTAwLCBtYXg6IDIwMDAwIH0sICAgLy8gJDc1LSQyMDBcbiAgICAgICAgICAnbHV4dXJ5JzogeyBtaW46IDIwMDAwLCBtYXg6IDk5OTk5OSB9ICAgLy8gT3ZlciAkMjAwXG4gICAgICAgIH07XG4gICAgICAgIGNvbnN0IHJhbmdlID0gcHJpY2VSYW5nZXNbcGFyYW1zLnByaWNlUmFuZ2VdO1xuICAgICAgICBzZWFyY2hQYXJhbXMubWluUHJpY2UgPSByYW5nZS5taW47XG4gICAgICAgIHNlYXJjaFBhcmFtcy5tYXhQcmljZSA9IHJhbmdlLm1heDtcbiAgICAgIH1cblxuICAgICAgY29uc29sZS5sb2coYEFuYWx5emluZyBjYXRlZ29yeSAke3BhcmFtcy5jYXRlZ29yeUlkfSB3aXRoICR7cGFyYW1zLmFuYWx5c2lzVHlwZSB8fCAnb3ZlcnZpZXcnfSBhbmFseXNpcy4uLmApO1xuICAgICAgXG4gICAgICBjb25zdCBwcm9kdWN0cyA9IGF3YWl0IHRoaXMuc2VhcmNoUHJvZHVjdHMoc2VhcmNoUGFyYW1zKTtcblxuICAgICAgaWYgKHByb2R1Y3RzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNhdGVnb3J5SWQ6IHBhcmFtcy5jYXRlZ29yeUlkLFxuICAgICAgICAgIGFuYWx5c2lzVHlwZTogcGFyYW1zLmFuYWx5c2lzVHlwZSB8fCAnb3ZlcnZpZXcnLFxuICAgICAgICAgIGVycm9yOiAnTm8gcHJvZHVjdHMgZm91bmQgaW4gY2F0ZWdvcnknLFxuICAgICAgICAgIHRvdGFsUHJvZHVjdHM6IDBcbiAgICAgICAgfTtcbiAgICAgIH1cblxuICAgICAgLy8gUGVyZm9ybSBjb21wcmVoZW5zaXZlIG1hcmtldCBhbmFseXNpc1xuICAgICAgY29uc3QgYW5hbHlzaXMgPSB0aGlzLnBlcmZvcm1DYXRlZ29yeUFuYWx5c2lzKHByb2R1Y3RzLCBwYXJhbXMpO1xuICAgICAgXG4gICAgICByZXR1cm4ge1xuICAgICAgICBjYXRlZ29yeUlkOiBwYXJhbXMuY2F0ZWdvcnlJZCxcbiAgICAgICAgY2F0ZWdvcnlOYW1lOiBgQ2F0ZWdvcnkgJHtwYXJhbXMuY2F0ZWdvcnlJZH1gLCAvLyBXb3VsZCBuZWVkIGNhdGVnb3J5IGxvb2t1cCBmb3IgbmFtZVxuICAgICAgICBhbmFseXNpc1R5cGU6IHBhcmFtcy5hbmFseXNpc1R5cGUgfHwgJ292ZXJ2aWV3JyxcbiAgICAgICAgc2FtcGxlU2l6ZTogcHJvZHVjdHMubGVuZ3RoLFxuICAgICAgICAuLi5hbmFseXNpc1xuICAgICAgfTtcblxuICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgIGNvbnNvbGUud2FybignQ2F0ZWdvcnkgYW5hbHlzaXMgZmFpbGVkOicsIGVycm9yKTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGNhdGVnb3J5SWQ6IHBhcmFtcy5jYXRlZ29yeUlkLFxuICAgICAgICBlcnJvcjogZXJyb3I/Lm1lc3NhZ2UgfHwgJ0FuYWx5c2lzIGZhaWxlZCcsXG4gICAgICAgIHRvdGFsUHJvZHVjdHM6IDBcbiAgICAgIH07XG4gICAgfVxuICB9XG5cbiAgLy8gQ29tcHJlaGVuc2l2ZSBtYXJrZXQgYW5hbHlzaXMgZW5naW5lXG4gIHByaXZhdGUgcGVyZm9ybUNhdGVnb3J5QW5hbHlzaXMocHJvZHVjdHM6IGFueVtdLCBwYXJhbXM6IGFueSk6IGFueSB7XG4gICAgY29uc3QgdmFsaWRQcm9kdWN0cyA9IHByb2R1Y3RzLmZpbHRlcihwID0+IHAucHJpY2UgPiAwKTtcbiAgICBjb25zdCBwcmljZXMgPSB2YWxpZFByb2R1Y3RzLm1hcChwID0+IHAucHJpY2UpLmZpbHRlcihwID0+IHAgPiAwKTtcbiAgICBjb25zdCByYXRpbmdzID0gdmFsaWRQcm9kdWN0cy5maWx0ZXIocCA9PiBwLnN0YXRzPy5jdXJyZW50WzE2XSkubWFwKHAgPT4gcC5zdGF0cy5jdXJyZW50WzE2XSAvIDEwKTtcbiAgICBcbiAgICAvLyBQcmljZSBhbmFseXNpc1xuICAgIGNvbnN0IHByaWNlU3RhdHMgPSB0aGlzLmNhbGN1bGF0ZVByaWNlU3RhdGlzdGljcyhwcmljZXMpO1xuICAgIFxuICAgIC8vIEJyYW5kIGFuYWx5c2lzXG4gICAgY29uc3QgYnJhbmREYXRhID0gdGhpcy5hbmFseXplQnJhbmRzKHZhbGlkUHJvZHVjdHMpO1xuICAgIFxuICAgIC8vIENvbXBldGl0aW9uIGFuYWx5c2lzXG4gICAgY29uc3QgY29tcGV0aXRpb25EYXRhID0gdGhpcy5hbmFseXplQ29tcGV0aXRpb24odmFsaWRQcm9kdWN0cyk7XG4gICAgXG4gICAgLy8gUGVyZm9ybWFuY2UgYW5hbHlzaXNcbiAgICBjb25zdCBwZXJmb3JtYW5jZURhdGEgPSB0aGlzLmFuYWx5emVQZXJmb3JtYW5jZSh2YWxpZFByb2R1Y3RzKTtcblxuICAgIC8vIE1hcmtldCBpbnNpZ2h0cyBiYXNlZCBvbiBhbmFseXNpcyB0eXBlXG4gICAgY29uc3QgaW5zaWdodHMgPSB0aGlzLmdlbmVyYXRlTWFya2V0SW5zaWdodHModmFsaWRQcm9kdWN0cywgcGFyYW1zLmFuYWx5c2lzVHlwZSk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgdG90YWxQcm9kdWN0czogdmFsaWRQcm9kdWN0cy5sZW5ndGgsXG4gICAgICBwcmljZUFuYWx5c2lzOiBwcmljZVN0YXRzLFxuICAgICAgYnJhbmRBbmFseXNpczogYnJhbmREYXRhLFxuICAgICAgY29tcGV0aXRpb25BbmFseXNpczogY29tcGV0aXRpb25EYXRhLFxuICAgICAgcGVyZm9ybWFuY2VBbmFseXNpczogcGVyZm9ybWFuY2VEYXRhLFxuICAgICAgbWFya2V0SW5zaWdodHM6IGluc2lnaHRzLFxuICAgICAgb3Bwb3J0dW5pdHlTY29yZTogdGhpcy5jYWxjdWxhdGVPcHBvcnR1bml0eVNjb3JlKHZhbGlkUHJvZHVjdHMpLFxuICAgICAgcmVjb21tZW5kYXRpb25zOiB0aGlzLmdlbmVyYXRlUmVjb21tZW5kYXRpb25zKHZhbGlkUHJvZHVjdHMsIHBhcmFtcylcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSBjYWxjdWxhdGVQcmljZVN0YXRpc3RpY3MocHJpY2VzOiBudW1iZXJbXSk6IGFueSB7XG4gICAgaWYgKHByaWNlcy5sZW5ndGggPT09IDApIHJldHVybiB7IGVycm9yOiAnTm8gdmFsaWQgcHJpY2VzJyB9O1xuICAgIFxuICAgIGNvbnN0IHNvcnRlZCA9IHByaWNlcy5zb3J0KChhLCBiKSA9PiBhIC0gYik7XG4gICAgY29uc3QgYXZnID0gcHJpY2VzLnJlZHVjZSgoc3VtLCBwKSA9PiBzdW0gKyBwLCAwKSAvIHByaWNlcy5sZW5ndGg7XG4gICAgXG4gICAgcmV0dXJuIHtcbiAgICAgIGF2ZXJhZ2VQcmljZTogYXZnLFxuICAgICAgbWVkaWFuUHJpY2U6IHNvcnRlZFtNYXRoLmZsb29yKHNvcnRlZC5sZW5ndGggLyAyKV0sXG4gICAgICBtaW5QcmljZTogc29ydGVkWzBdLFxuICAgICAgbWF4UHJpY2U6IHNvcnRlZFtzb3J0ZWQubGVuZ3RoIC0gMV0sXG4gICAgICBwcmljZVJhbmdlOiB7IG1pbjogc29ydGVkWzBdLCBtYXg6IHNvcnRlZFtzb3J0ZWQubGVuZ3RoIC0gMV0gfSxcbiAgICAgIHByaWNlRGlzdHJpYnV0aW9uOiB0aGlzLmNhdGVnb3JpemVQcmljZShwcmljZXMpXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgY2F0ZWdvcml6ZVByaWNlKHByaWNlczogbnVtYmVyW10pOiBhbnkge1xuICAgIGNvbnN0IHJhbmdlcyA9IFtcbiAgICAgIHsgbGFiZWw6ICdCdWRnZXQnLCBtaW46IDAsIG1heDogMjUwMCwgY291bnQ6IDAgfSxcbiAgICAgIHsgbGFiZWw6ICdNaWQtcmFuZ2UnLCBtaW46IDI1MDAsIG1heDogNzUwMCwgY291bnQ6IDAgfSxcbiAgICAgIHsgbGFiZWw6ICdQcmVtaXVtJywgbWluOiA3NTAwLCBtYXg6IDIwMDAwLCBjb3VudDogMCB9LFxuICAgICAgeyBsYWJlbDogJ0x1eHVyeScsIG1pbjogMjAwMDAsIG1heDogOTk5OTk5LCBjb3VudDogMCB9XG4gICAgXTtcblxuICAgIHByaWNlcy5mb3JFYWNoKHByaWNlID0+IHtcbiAgICAgIGNvbnN0IHJhbmdlID0gcmFuZ2VzLmZpbmQociA9PiBwcmljZSA+PSByLm1pbiAmJiBwcmljZSA8IHIubWF4KTtcbiAgICAgIGlmIChyYW5nZSkgcmFuZ2UuY291bnQrKztcbiAgICB9KTtcblxuICAgIHJldHVybiByYW5nZXMubWFwKHIgPT4gKHtcbiAgICAgIHJhbmdlOiByLmxhYmVsLFxuICAgICAgY291bnQ6IHIuY291bnQsXG4gICAgICBwZXJjZW50YWdlOiAoKHIuY291bnQgLyBwcmljZXMubGVuZ3RoKSAqIDEwMCkudG9GaXhlZCgxKVxuICAgIH0pKTtcbiAgfVxuXG4gIHByaXZhdGUgYW5hbHl6ZUJyYW5kcyhwcm9kdWN0czogYW55W10pOiBhbnkge1xuICAgIGNvbnN0IGJyYW5kQ291bnRzOiB7IFtrZXk6IHN0cmluZ106IG51bWJlciB9ID0ge307XG4gICAgcHJvZHVjdHMuZm9yRWFjaChwID0+IHtcbiAgICAgIGNvbnN0IGJyYW5kID0gcC5icmFuZCB8fCAnVW5rbm93bic7XG4gICAgICBicmFuZENvdW50c1ticmFuZF0gPSAoYnJhbmRDb3VudHNbYnJhbmRdIHx8IDApICsgMTtcbiAgICB9KTtcblxuICAgIGNvbnN0IHRvcEJyYW5kcyA9IE9iamVjdC5lbnRyaWVzKGJyYW5kQ291bnRzKVxuICAgICAgLnNvcnQoKFssYV0sIFssYl0pID0+IGIgLSBhKVxuICAgICAgLnNsaWNlKDAsIDEwKVxuICAgICAgLm1hcCgoW2JyYW5kLCBjb3VudF0pID0+ICh7XG4gICAgICAgIGJyYW5kLFxuICAgICAgICBwcm9kdWN0Q291bnQ6IGNvdW50LFxuICAgICAgICBtYXJrZXRTaGFyZTogKChjb3VudCAvIHByb2R1Y3RzLmxlbmd0aCkgKiAxMDApLnRvRml4ZWQoMSlcbiAgICAgIH0pKTtcblxuICAgIHJldHVybiB7XG4gICAgICB0b3RhbEJyYW5kczogT2JqZWN0LmtleXMoYnJhbmRDb3VudHMpLmxlbmd0aCxcbiAgICAgIHRvcEJyYW5kcyxcbiAgICAgIGJyYW5kQ29uY2VudHJhdGlvbjogdG9wQnJhbmRzLnNsaWNlKDAsIDMpLnJlZHVjZSgoc3VtLCBiKSA9PiBzdW0gKyBwYXJzZUZsb2F0KGIubWFya2V0U2hhcmUpLCAwKS50b0ZpeGVkKDEpXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgYW5hbHl6ZUNvbXBldGl0aW9uKHByb2R1Y3RzOiBhbnlbXSk6IGFueSB7XG4gICAgY29uc3QgdmFsaWRSYW5rcyA9IHByb2R1Y3RzLmZpbHRlcihwID0+IHAuc3RhdHM/LmN1cnJlbnRbM10pLm1hcChwID0+IHAuc3RhdHMuY3VycmVudFszXSk7XG4gICAgY29uc3QgYXZnUmFuayA9IHZhbGlkUmFua3MubGVuZ3RoID4gMCA/IHZhbGlkUmFua3MucmVkdWNlKChzdW0sIHIpID0+IHN1bSArIHIsIDApIC8gdmFsaWRSYW5rcy5sZW5ndGggOiAwO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIGNvbXBldGl0aW9uTGV2ZWw6IGF2Z1JhbmsgPCAxMDAwMCA/ICdIaWdoJyA6IGF2Z1JhbmsgPCA1MDAwMCA/ICdNZWRpdW0nIDogJ0xvdycsXG4gICAgICBhdmVyYWdlU2FsZXNSYW5rOiBhdmdSYW5rLFxuICAgICAgbWFya2V0U2F0dXJhdGlvbjogcHJvZHVjdHMubGVuZ3RoID4gNDAgPyAnSGlnaCcgOiBwcm9kdWN0cy5sZW5ndGggPiAyMCA/ICdNZWRpdW0nIDogJ0xvdydcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSBhbmFseXplUGVyZm9ybWFuY2UocHJvZHVjdHM6IGFueVtdKTogYW55IHtcbiAgICBjb25zdCByYXRpbmdzRGF0YSA9IHByb2R1Y3RzLmZpbHRlcihwID0+IHAuc3RhdHM/LmN1cnJlbnRbMTZdKS5tYXAocCA9PiBwLnN0YXRzLmN1cnJlbnRbMTZdIC8gMTApO1xuICAgIGNvbnN0IGF2Z1JhdGluZyA9IHJhdGluZ3NEYXRhLmxlbmd0aCA+IDAgPyByYXRpbmdzRGF0YS5yZWR1Y2UoKHN1bSwgcikgPT4gc3VtICsgciwgMCkgLyByYXRpbmdzRGF0YS5sZW5ndGggOiAwO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIGF2ZXJhZ2VSYXRpbmc6IGF2Z1JhdGluZyxcbiAgICAgIHRvdGFsUmF0ZWRQcm9kdWN0czogcmF0aW5nc0RhdGEubGVuZ3RoLFxuICAgICAgaGlnaFJhdGVkUHJvZHVjdHM6IHJhdGluZ3NEYXRhLmZpbHRlcihyID0+IHIgPj0gNC4wKS5sZW5ndGgsXG4gICAgICBxdWFsaXR5TGV2ZWw6IGF2Z1JhdGluZyA+PSA0LjIgPyAnRXhjZWxsZW50JyA6IGF2Z1JhdGluZyA+PSAzLjggPyAnR29vZCcgOiBhdmdSYXRpbmcgPj0gMy4wID8gJ0ZhaXInIDogJ1Bvb3InXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgZ2VuZXJhdGVNYXJrZXRJbnNpZ2h0cyhwcm9kdWN0czogYW55W10sIGFuYWx5c2lzVHlwZT86IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgICBjb25zdCBpbnNpZ2h0czogc3RyaW5nW10gPSBbXTtcbiAgICBjb25zdCB2YWxpZFByb2R1Y3RzID0gcHJvZHVjdHMuZmlsdGVyKHAgPT4gcC5wcmljZSA+IDAgJiYgcC5zdGF0cyk7XG5cbiAgICBpZiAodmFsaWRQcm9kdWN0cy5sZW5ndGggPT09IDApIHtcbiAgICAgIHJldHVybiBbJ0luc3VmZmljaWVudCBkYXRhIGZvciBtYXJrZXQgaW5zaWdodHMnXTtcbiAgICB9XG5cbiAgICAvLyBQcmljZSBpbnNpZ2h0c1xuICAgIGNvbnN0IHByaWNlcyA9IHZhbGlkUHJvZHVjdHMubWFwKHAgPT4gcC5wcmljZSk7XG4gICAgY29uc3QgYXZnUHJpY2UgPSBwcmljZXMucmVkdWNlKChzdW0sIHApID0+IHN1bSArIHAsIDApIC8gcHJpY2VzLmxlbmd0aDtcbiAgICBpZiAoYXZnUHJpY2UgPCAyNTAwKSB7XG4gICAgICBpbnNpZ2h0cy5wdXNoKCdCdWRnZXQtZnJpZW5kbHkgY2F0ZWdvcnkgd2l0aCBoaWdoIHZvbHVtZSBwb3RlbnRpYWwnKTtcbiAgICB9IGVsc2UgaWYgKGF2Z1ByaWNlID4gMTAwMDApIHtcbiAgICAgIGluc2lnaHRzLnB1c2goJ1ByZW1pdW0gY2F0ZWdvcnkgd2l0aCBoaWdoZXIgcHJvZml0IG1hcmdpbnMnKTtcbiAgICB9XG5cbiAgICAvLyBDb21wZXRpdGlvbiBpbnNpZ2h0c1xuICAgIGNvbnN0IHJhbmtzID0gdmFsaWRQcm9kdWN0cy5maWx0ZXIocCA9PiBwLnN0YXRzLmN1cnJlbnRbM10pLm1hcChwID0+IHAuc3RhdHMuY3VycmVudFszXSk7XG4gICAgY29uc3QgYXZnUmFuayA9IHJhbmtzLmxlbmd0aCA+IDAgPyByYW5rcy5yZWR1Y2UoKHN1bSwgcikgPT4gc3VtICsgciwgMCkgLyByYW5rcy5sZW5ndGggOiA5OTk5OTk7XG4gICAgaWYgKGF2Z1JhbmsgPCAxMDAwMCkge1xuICAgICAgaW5zaWdodHMucHVzaCgnSGlnaGx5IGNvbXBldGl0aXZlIG1hcmtldCAtIGVzdGFibGlzaGVkIHBsYXllcnMgZG9taW5hdGUnKTtcbiAgICB9IGVsc2UgaWYgKGF2Z1JhbmsgPiAxMDAwMDApIHtcbiAgICAgIGluc2lnaHRzLnB1c2goJ0xlc3MgY29tcGV0aXRpdmUgbmljaGUgd2l0aCBncm93dGggb3Bwb3J0dW5pdGllcycpO1xuICAgIH1cblxuICAgIC8vIFByb2R1Y3QgcXVhbGl0eSBpbnNpZ2h0c1xuICAgIGNvbnN0IHJhdGluZ3MgPSB2YWxpZFByb2R1Y3RzLmZpbHRlcihwID0+IHAuc3RhdHMuY3VycmVudFsxNl0pLm1hcChwID0+IHAuc3RhdHMuY3VycmVudFsxNl0gLyAxMCk7XG4gICAgY29uc3QgYXZnUmF0aW5nID0gcmF0aW5ncy5sZW5ndGggPiAwID8gcmF0aW5ncy5yZWR1Y2UoKHN1bSwgcikgPT4gc3VtICsgciwgMCkgLyByYXRpbmdzLmxlbmd0aCA6IDA7XG4gICAgaWYgKGF2Z1JhdGluZyA+PSA0LjIpIHtcbiAgICAgIGluc2lnaHRzLnB1c2goJ0hpZ2gtcXVhbGl0eSBjYXRlZ29yeSAtIGN1c3RvbWVyIHNhdGlzZmFjdGlvbiBpcyBrZXknKTtcbiAgICB9IGVsc2UgaWYgKGF2Z1JhdGluZyA8IDMuNSkge1xuICAgICAgaW5zaWdodHMucHVzaCgnUXVhbGl0eSBpbXByb3ZlbWVudCBvcHBvcnR1bml0eSAtIG1hbnkgcHJvZHVjdHMgdW5kZXJwZXJmb3JtJyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGluc2lnaHRzO1xuICB9XG5cbiAgcHJpdmF0ZSBjYWxjdWxhdGVPcHBvcnR1bml0eVNjb3JlKHByb2R1Y3RzOiBhbnlbXSk6IG51bWJlciB7XG4gICAgbGV0IHNjb3JlID0gNTA7IC8vIEJhc2Ugc2NvcmVcblxuICAgIGNvbnN0IHZhbGlkUHJvZHVjdHMgPSBwcm9kdWN0cy5maWx0ZXIocCA9PiBwLnByaWNlID4gMCAmJiBwLnN0YXRzKTtcbiAgICBpZiAodmFsaWRQcm9kdWN0cy5sZW5ndGggPT09IDApIHJldHVybiAwO1xuXG4gICAgLy8gQ29tcGV0aXRpb24gZmFjdG9yXG4gICAgY29uc3QgcmFua3MgPSB2YWxpZFByb2R1Y3RzLmZpbHRlcihwID0+IHAuc3RhdHMuY3VycmVudFszXSkubWFwKHAgPT4gcC5zdGF0cy5jdXJyZW50WzNdKTtcbiAgICBjb25zdCBhdmdSYW5rID0gcmFua3MubGVuZ3RoID4gMCA/IHJhbmtzLnJlZHVjZSgoc3VtLCByKSA9PiBzdW0gKyByLCAwKSAvIHJhbmtzLmxlbmd0aCA6IDk5OTk5OTtcbiAgICBpZiAoYXZnUmFuayA+IDUwMDAwKSBzY29yZSArPSAyMDsgLy8gTGVzcyBjb21wZXRpdGlvblxuICAgIGlmIChhdmdSYW5rID4gMTAwMDAwKSBzY29yZSArPSAxMDsgLy8gRXZlbiBsZXNzIGNvbXBldGl0aW9uXG5cbiAgICAvLyBRdWFsaXR5IGZhY3RvclxuICAgIGNvbnN0IHJhdGluZ3MgPSB2YWxpZFByb2R1Y3RzLmZpbHRlcihwID0+IHAuc3RhdHMuY3VycmVudFsxNl0pLm1hcChwID0+IHAuc3RhdHMuY3VycmVudFsxNl0gLyAxMCk7XG4gICAgY29uc3QgYXZnUmF0aW5nID0gcmF0aW5ncy5sZW5ndGggPiAwID8gcmF0aW5ncy5yZWR1Y2UoKHN1bSwgcikgPT4gc3VtICsgciwgMCkgLyByYXRpbmdzLmxlbmd0aCA6IDA7XG4gICAgaWYgKGF2Z1JhdGluZyA8IDMuOCkgc2NvcmUgKz0gMTU7IC8vIFJvb20gZm9yIGltcHJvdmVtZW50XG5cbiAgICAvLyBQcmljZSBmYWN0b3JcbiAgICBjb25zdCBwcmljZXMgPSB2YWxpZFByb2R1Y3RzLm1hcChwID0+IHAucHJpY2UpO1xuICAgIGNvbnN0IGF2Z1ByaWNlID0gcHJpY2VzLnJlZHVjZSgoc3VtLCBwKSA9PiBzdW0gKyBwLCAwKSAvIHByaWNlcy5sZW5ndGg7XG4gICAgaWYgKGF2Z1ByaWNlID4gMjAwMCAmJiBhdmdQcmljZSA8IDE1MDAwKSBzY29yZSArPSAxMDsgLy8gU3dlZXQgc3BvdCBwcmljaW5nXG5cbiAgICByZXR1cm4gTWF0aC5taW4oMTAwLCBNYXRoLm1heCgwLCBzY29yZSkpO1xuICB9XG5cbiAgcHJpdmF0ZSBnZW5lcmF0ZVJlY29tbWVuZGF0aW9ucyhwcm9kdWN0czogYW55W10sIHBhcmFtczogYW55KTogc3RyaW5nW10ge1xuICAgIGNvbnN0IHJlY29tbWVuZGF0aW9uczogc3RyaW5nW10gPSBbXTtcbiAgICBjb25zdCB2YWxpZFByb2R1Y3RzID0gcHJvZHVjdHMuZmlsdGVyKHAgPT4gcC5wcmljZSA+IDAgJiYgcC5zdGF0cyk7XG5cbiAgICBpZiAodmFsaWRQcm9kdWN0cy5sZW5ndGggPT09IDApIHtcbiAgICAgIHJldHVybiBbJ05lZWQgbW9yZSBwcm9kdWN0IGRhdGEgdG8gZ2VuZXJhdGUgcmVjb21tZW5kYXRpb25zJ107XG4gICAgfVxuXG4gICAgLy8gUHJpY2UgcmVjb21tZW5kYXRpb25zXG4gICAgY29uc3QgcHJpY2VzID0gdmFsaWRQcm9kdWN0cy5tYXAocCA9PiBwLnByaWNlKTtcbiAgICBjb25zdCBhdmdQcmljZSA9IHByaWNlcy5yZWR1Y2UoKHN1bSwgcCkgPT4gc3VtICsgcCwgMCkgLyBwcmljZXMubGVuZ3RoO1xuICAgIGlmIChhdmdQcmljZSA8IDI1MDApIHtcbiAgICAgIHJlY29tbWVuZGF0aW9ucy5wdXNoKCdDb25zaWRlciB2b2x1bWUtYmFzZWQgc3RyYXRlZ2llcyBmb3IgdGhpcyBidWRnZXQgY2F0ZWdvcnknKTtcbiAgICB9IGVsc2UgaWYgKGF2Z1ByaWNlID4gMTAwMDApIHtcbiAgICAgIHJlY29tbWVuZGF0aW9ucy5wdXNoKCdGb2N1cyBvbiBxdWFsaXR5IGFuZCBwcmVtaXVtIHBvc2l0aW9uaW5nJyk7XG4gICAgfVxuXG4gICAgLy8gQ29tcGV0aXRpb24gcmVjb21tZW5kYXRpb25zXG4gICAgY29uc3QgcmFua3MgPSB2YWxpZFByb2R1Y3RzLmZpbHRlcihwID0+IHAuc3RhdHMuY3VycmVudFszXSkubWFwKHAgPT4gcC5zdGF0cy5jdXJyZW50WzNdKTtcbiAgICBjb25zdCBhdmdSYW5rID0gcmFua3MubGVuZ3RoID4gMCA/IHJhbmtzLnJlZHVjZSgoc3VtLCByKSA9PiBzdW0gKyByLCAwKSAvIHJhbmtzLmxlbmd0aCA6IDk5OTk5OTtcbiAgICBpZiAoYXZnUmFuayA8IDEwMDAwKSB7XG4gICAgICByZWNvbW1lbmRhdGlvbnMucHVzaCgnSGlnaGx5IGNvbXBldGl0aXZlIC0gZGlmZmVyZW50aWF0aW9uIGFuZCBicmFuZGluZyBjcnVjaWFsJyk7XG4gICAgfSBlbHNlIGlmIChhdmdSYW5rID4gMTAwMDAwKSB7XG4gICAgICByZWNvbW1lbmRhdGlvbnMucHVzaCgnT3Bwb3J0dW5pdHkgZm9yIG1hcmtldCBlbnRyeSB3aXRoIGdvb2QgcHJvZHVjdHMnKTtcbiAgICB9XG5cbiAgICAvLyBRdWFsaXR5IHJlY29tbWVuZGF0aW9uc1xuICAgIGNvbnN0IHJhdGluZ3MgPSB2YWxpZFByb2R1Y3RzLmZpbHRlcihwID0+IHAuc3RhdHMuY3VycmVudFsxNl0pLm1hcChwID0+IHAuc3RhdHMuY3VycmVudFsxNl0gLyAxMCk7XG4gICAgY29uc3QgYXZnUmF0aW5nID0gcmF0aW5ncy5sZW5ndGggPiAwID8gcmF0aW5ncy5yZWR1Y2UoKHN1bSwgcikgPT4gc3VtICsgciwgMCkgLyByYXRpbmdzLmxlbmd0aCA6IDA7XG4gICAgaWYgKGF2Z1JhdGluZyA8IDMuOCkge1xuICAgICAgcmVjb21tZW5kYXRpb25zLnB1c2goJ1F1YWxpdHkgaW1wcm92ZW1lbnQgb3Bwb3J0dW5pdHkgZXhpc3RzJyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlY29tbWVuZGF0aW9ucztcbiAgfVxuXG4gIGFzeW5jIGdldEJlc3RTZWxsZXJzKHBhcmFtczogQmVzdFNlbGxlclF1ZXJ5UGFyYW1zKTogUHJvbWlzZTxLZWVwYUJlc3RTZWxsZXJbXT4ge1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdDx7IGJlc3RTZWxsZXJzTGlzdDogS2VlcGFCZXN0U2VsbGVyW10gfT4oJy9iZXN0c2VsbGVycycsIHBhcmFtcyk7XG4gICAgcmV0dXJuIChyZXNwb25zZSBhcyBhbnkpLmJlc3RTZWxsZXJzTGlzdCB8fCBbXTtcbiAgfVxuXG4gIC8vIE5FVzogSW52ZW50b3J5IEFuYWx5c2lzIEVuZ2luZSAtIFBvcnRmb2xpbyBNYW5hZ2VtZW50ICYgUmlzayBBc3Nlc3NtZW50XG4gIGFzeW5jIGFuYWx5emVJbnZlbnRvcnkocGFyYW1zOiB7XG4gICAgY2F0ZWdvcnlJZD86IG51bWJlcjtcbiAgICBhc2lucz86IHN0cmluZ1tdO1xuICAgIGRvbWFpbj86IG51bWJlcjtcbiAgICBhbmFseXNpc1R5cGU/OiAnb3ZlcnZpZXcnIHwgJ2Zhc3RfbW92ZXJzJyB8ICdzbG93X21vdmVycycgfCAnc3RvY2tvdXRfcmlza3MnIHwgJ3NlYXNvbmFsJztcbiAgICB0aW1lZnJhbWU/OiAnd2VlaycgfCAnbW9udGgnIHwgJ3F1YXJ0ZXInO1xuICAgIHRhcmdldFR1cm5vdmVyUmF0ZT86IG51bWJlcjtcbiAgfSk6IFByb21pc2U8YW55PiB7XG4gICAgdHJ5IHtcbiAgICAgIC8vIEdldCBzYWxlcyB2ZWxvY2l0eSBkYXRhIGZvciBpbnZlbnRvcnkgYW5hbHlzaXNcbiAgICAgIGNvbnN0IHZlbG9jaXR5RGF0YSA9IGF3YWl0IHRoaXMuYW5hbHl6ZVNhbGVzVmVsb2NpdHkoe1xuICAgICAgICBjYXRlZ29yeUlkOiBwYXJhbXMuY2F0ZWdvcnlJZCxcbiAgICAgICAgYXNpbnM6IHBhcmFtcy5hc2lucyxcbiAgICAgICAgZG9tYWluOiBwYXJhbXMuZG9tYWluIHx8IDEsXG4gICAgICAgIHRpbWVmcmFtZTogcGFyYW1zLnRpbWVmcmFtZSB8fCAnbW9udGgnXG4gICAgICB9KTtcblxuICAgICAgLy8gQW5hbHl6ZSBpbnZlbnRvcnkgbWV0cmljc1xuICAgICAgY29uc3QgYW5hbHlzaXMgPSB0aGlzLnBlcmZvcm1JbnZlbnRvcnlBbmFseXNpcyh2ZWxvY2l0eURhdGEsIHBhcmFtcyk7XG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIGFuYWx5c2lzVHlwZTogcGFyYW1zLmFuYWx5c2lzVHlwZSB8fCAnb3ZlcnZpZXcnLFxuICAgICAgICB0b3RhbFByb2R1Y3RzOiB2ZWxvY2l0eURhdGEubGVuZ3RoLFxuICAgICAgICBhdmVyYWdlVHVybm92ZXJSYXRlOiB0aGlzLmNhbGN1bGF0ZUF2ZXJhZ2VUdXJub3Zlcih2ZWxvY2l0eURhdGEpLFxuICAgICAgICBmYXN0TW92ZXJzOiB2ZWxvY2l0eURhdGEuZmlsdGVyKHAgPT4gcC5zYWxlc1ZlbG9jaXR5Lm1vbnRobHkgPj0gMzApLFxuICAgICAgICBzbG93TW92ZXJzOiB2ZWxvY2l0eURhdGEuZmlsdGVyKHAgPT4gcC5zYWxlc1ZlbG9jaXR5Lm1vbnRobHkgPCAxMCksXG4gICAgICAgIHN0b2Nrb3V0Umlza3M6IHZlbG9jaXR5RGF0YS5maWx0ZXIocCA9PiBwLmludmVudG9yeU1ldHJpY3Muc3RvY2tvdXRSaXNrID09PSAnSGlnaCcpLFxuICAgICAgICBzZWFzb25hbFBhdHRlcm5zOiB0aGlzLmFuYWx5emVTZWFzb25hbFBhdHRlcm5zKHZlbG9jaXR5RGF0YSksXG4gICAgICAgIHJlY29tbWVuZGF0aW9uczogdGhpcy5nZW5lcmF0ZUludmVudG9yeVJlY29tbWVuZGF0aW9ucyh2ZWxvY2l0eURhdGEsIHBhcmFtcy50YXJnZXRUdXJub3ZlclJhdGUgfHwgMTIpLFxuICAgICAgICAuLi5hbmFseXNpc1xuICAgICAgfTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS53YXJuKCdJbnZlbnRvcnkgYW5hbHlzaXMgZmFpbGVkOicsIGVycm9yKTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGFuYWx5c2lzVHlwZTogcGFyYW1zLmFuYWx5c2lzVHlwZSB8fCAnb3ZlcnZpZXcnLFxuICAgICAgICBlcnJvcjogJ0ZhaWxlZCB0byBhbmFseXplIGludmVudG9yeScsXG4gICAgICAgIHRvdGFsUHJvZHVjdHM6IDBcbiAgICAgIH07XG4gICAgfVxuICB9XG5cbiAgLy8gQ29tcHJlaGVuc2l2ZSBpbnZlbnRvcnkgYW5hbHlzaXMgZW5naW5lXG4gIHByaXZhdGUgcGVyZm9ybUludmVudG9yeUFuYWx5c2lzKHZlbG9jaXR5RGF0YTogYW55W10sIHBhcmFtczogYW55KTogYW55IHtcbiAgICBjb25zdCB0b3RhbFByb2R1Y3RzID0gdmVsb2NpdHlEYXRhLmxlbmd0aDtcbiAgICBpZiAodG90YWxQcm9kdWN0cyA9PT0gMCkgcmV0dXJuIHsgcmVjb21tZW5kYXRpb25zOiBbJ05vIHByb2R1Y3RzIHRvIGFuYWx5emUnXSB9O1xuXG4gICAgLy8gUGVyZm9ybWFuY2UgbWV0cmljc1xuICAgIGNvbnN0IGF2Z1ZlbG9jaXR5ID0gdmVsb2NpdHlEYXRhLnJlZHVjZSgoc3VtLCBwKSA9PiBzdW0gKyBwLnNhbGVzVmVsb2NpdHkubW9udGhseSwgMCkgLyB0b3RhbFByb2R1Y3RzO1xuICAgIGNvbnN0IGF2Z1R1cm5vdmVyID0gdGhpcy5jYWxjdWxhdGVBdmVyYWdlVHVybm92ZXIodmVsb2NpdHlEYXRhKTtcbiAgICBcbiAgICAvLyBSaXNrIGFzc2Vzc21lbnRcbiAgICBjb25zdCBoaWdoUmlza0NvdW50ID0gdmVsb2NpdHlEYXRhLmZpbHRlcihwID0+IHAuaW52ZW50b3J5TWV0cmljcy5zdG9ja291dFJpc2sgPT09ICdIaWdoJykubGVuZ3RoO1xuICAgIGNvbnN0IHNsb3dNb3ZlcnNDb3VudCA9IHZlbG9jaXR5RGF0YS5maWx0ZXIocCA9PiBwLnNhbGVzVmVsb2NpdHkubW9udGhseSA8IDEwKS5sZW5ndGg7XG4gICAgY29uc3QgZmFzdE1vdmVyc0NvdW50ID0gdmVsb2NpdHlEYXRhLmZpbHRlcihwID0+IHAuc2FsZXNWZWxvY2l0eS5tb250aGx5ID49IDMwKS5sZW5ndGg7XG5cbiAgICAvLyBDYXNoIGZsb3cgYW5hbHlzaXNcbiAgICBjb25zdCB0b3RhbFJldmVudWUgPSB2ZWxvY2l0eURhdGEucmVkdWNlKChzdW0sIHApID0+IHN1bSArIHAucHJvZml0YWJpbGl0eS5yZXZlbnVlVmVsb2NpdHksIDApO1xuICAgIGNvbnN0IGF2Z0RheXNJbnZlbnRvcnkgPSB2ZWxvY2l0eURhdGEucmVkdWNlKChzdW0sIHApID0+IHN1bSArIHAuaW52ZW50b3J5TWV0cmljcy5kYXlzT2ZJbnZlbnRvcnksIDApIC8gdG90YWxQcm9kdWN0cztcblxuICAgIHJldHVybiB7XG4gICAgICBwZXJmb3JtYW5jZU1ldHJpY3M6IHtcbiAgICAgICAgYXZlcmFnZVZlbG9jaXR5OiBNYXRoLnJvdW5kKGF2Z1ZlbG9jaXR5ICogMTApIC8gMTAsXG4gICAgICAgIGF2ZXJhZ2VUdXJub3ZlclJhdGU6IGF2Z1R1cm5vdmVyLFxuICAgICAgICB0b3RhbFJldmVudWU6IE1hdGgucm91bmQodG90YWxSZXZlbnVlICogMTAwKSAvIDEwMCxcbiAgICAgICAgYXZlcmFnZURheXNJbnZlbnRvcnk6IE1hdGgucm91bmQoYXZnRGF5c0ludmVudG9yeSlcbiAgICAgIH0sXG4gICAgICByaXNrQXNzZXNzbWVudDoge1xuICAgICAgICBoaWdoUmlza1Byb2R1Y3RzOiBoaWdoUmlza0NvdW50LFxuICAgICAgICByaXNrUGVyY2VudGFnZTogTWF0aC5yb3VuZCgoaGlnaFJpc2tDb3VudCAvIHRvdGFsUHJvZHVjdHMpICogMTAwKSxcbiAgICAgICAgc2xvd01vdmVyc1JhdGlvOiBNYXRoLnJvdW5kKChzbG93TW92ZXJzQ291bnQgLyB0b3RhbFByb2R1Y3RzKSAqIDEwMCksXG4gICAgICAgIGZhc3RNb3ZlcnNSYXRpbzogTWF0aC5yb3VuZCgoZmFzdE1vdmVyc0NvdW50IC8gdG90YWxQcm9kdWN0cykgKiAxMDApXG4gICAgICB9LFxuICAgICAgY2FzaEZsb3dNZXRyaWNzOiB7XG4gICAgICAgIGludmVudG9yeVR1cm5zOiBhdmdUdXJub3ZlcixcbiAgICAgICAgYXZnRGF5c1RvU2VsbDogYXZnRGF5c0ludmVudG9yeSxcbiAgICAgICAgcG9ydGZvbGlvSGVhbHRoOiB0aGlzLmFzc2Vzc1BvcnRmb2xpb0hlYWx0aCh2ZWxvY2l0eURhdGEpXG4gICAgICB9XG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgY2FsY3VsYXRlQXZlcmFnZVR1cm5vdmVyKHZlbG9jaXR5RGF0YTogYW55W10pOiBudW1iZXIge1xuICAgIGlmICh2ZWxvY2l0eURhdGEubGVuZ3RoID09PSAwKSByZXR1cm4gMDtcbiAgICBjb25zdCB0b3RhbFR1cm5vdmVyID0gdmVsb2NpdHlEYXRhLnJlZHVjZSgoc3VtLCBwKSA9PiBzdW0gKyBwLmludmVudG9yeU1ldHJpY3MudHVybm92ZXJSYXRlLCAwKTtcbiAgICByZXR1cm4gTWF0aC5yb3VuZCgodG90YWxUdXJub3ZlciAvIHZlbG9jaXR5RGF0YS5sZW5ndGgpICogMTApIC8gMTA7XG4gIH1cblxuICBwcml2YXRlIGFuYWx5emVTZWFzb25hbFBhdHRlcm5zKHZlbG9jaXR5RGF0YTogYW55W10pOiBhbnlbXSB7XG4gICAgLy8gU2Vhc29uYWwgYW5hbHlzaXMgcGF0dGVybnNcbiAgICBjb25zdCBwYXR0ZXJucyA9IFtcbiAgICAgIHtcbiAgICAgICAgcGVyaW9kOiAnUTQgSG9saWRheSBTZWFzb24gKE9jdC1EZWMpJyxcbiAgICAgICAgdmVsb2NpdHlNdWx0aXBsaWVyOiAyLjgsXG4gICAgICAgIHJlY29tbWVuZGF0aW9uOiAnSW5jcmVhc2UgaW52ZW50b3J5IDYwLTkwIGRheXMgYmVmb3JlIEJsYWNrIEZyaWRheSdcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIHBlcmlvZDogJ0JhY2stdG8tU2Nob29sIChKdWwtQXVnKScsXG4gICAgICAgIHZlbG9jaXR5TXVsdGlwbGllcjogMS43LFxuICAgICAgICByZWNvbW1lbmRhdGlvbjogJ1N0b2NrIHNlYXNvbmFsIHByb2R1Y3RzIGFuZCBvZmZpY2Ugc3VwcGxpZXMnXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBwZXJpb2Q6ICdTdW1tZXIgUGVhayAoTWF5LUp1bCknLFxuICAgICAgICB2ZWxvY2l0eU11bHRpcGxpZXI6IDEuNCxcbiAgICAgICAgcmVjb21tZW5kYXRpb246ICdNb25pdG9yIG91dGRvb3IgYW5kIHJlY3JlYXRpb25hbCBwcm9kdWN0cydcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIHBlcmlvZDogJ1Bvc3QtSG9saWRheSBTbG93ZG93biAoSmFuLUZlYiknLFxuICAgICAgICB2ZWxvY2l0eU11bHRpcGxpZXI6IDAuNixcbiAgICAgICAgcmVjb21tZW5kYXRpb246ICdSZWR1Y2UgaW52ZW50b3J5IGFuZCBmb2N1cyBvbiBjbGVhcmFuY2UnXG4gICAgICB9XG4gICAgXTtcblxuICAgIHJldHVybiBwYXR0ZXJucztcbiAgfVxuXG4gIHByaXZhdGUgZ2VuZXJhdGVJbnZlbnRvcnlSZWNvbW1lbmRhdGlvbnModmVsb2NpdHlEYXRhOiBhbnlbXSwgdGFyZ2V0VHVybm92ZXI6IG51bWJlcik6IHN0cmluZ1tdIHtcbiAgICBjb25zdCByZWNvbW1lbmRhdGlvbnM6IHN0cmluZ1tdID0gW107XG4gICAgXG4gICAgaWYgKHZlbG9jaXR5RGF0YS5sZW5ndGggPT09IDApIHtcbiAgICAgIHJldHVybiBbJ05vIHByb2R1Y3RzIHRvIGFuYWx5emUgLSBjb25zaWRlciBleHBhbmRpbmcgcHJvZHVjdCBwb3J0Zm9saW8nXTtcbiAgICB9XG5cbiAgICBjb25zdCBhdmdWZWxvY2l0eSA9IHZlbG9jaXR5RGF0YS5yZWR1Y2UoKHN1bSwgcCkgPT4gc3VtICsgcC5zYWxlc1ZlbG9jaXR5Lm1vbnRobHksIDApIC8gdmVsb2NpdHlEYXRhLmxlbmd0aDtcbiAgICBjb25zdCBoaWdoUmlza0NvdW50ID0gdmVsb2NpdHlEYXRhLmZpbHRlcihwID0+IHAuaW52ZW50b3J5TWV0cmljcy5zdG9ja291dFJpc2sgPT09ICdIaWdoJykubGVuZ3RoO1xuICAgIGNvbnN0IHNsb3dNb3ZlcnNDb3VudCA9IHZlbG9jaXR5RGF0YS5maWx0ZXIocCA9PiBwLnNhbGVzVmVsb2NpdHkubW9udGhseSA8IDEwKS5sZW5ndGg7XG4gICAgY29uc3QgZmFzdE1vdmVyc0NvdW50ID0gdmVsb2NpdHlEYXRhLmZpbHRlcihwID0+IHAuc2FsZXNWZWxvY2l0eS5tb250aGx5ID49IDMwKS5sZW5ndGg7XG5cbiAgICAvLyBQZXJmb3JtYW5jZSByZWNvbW1lbmRhdGlvbnNcbiAgICBpZiAoYXZnVmVsb2NpdHkgPiAyNSkge1xuICAgICAgcmVjb21tZW5kYXRpb25zLnB1c2goJ/CfmoAgU3Ryb25nIHBvcnRmb2xpbyB2ZWxvY2l0eSAtIG1haW50YWluIGN1cnJlbnQgc291cmNpbmcgc3RyYXRlZ3knKTtcbiAgICB9IGVsc2UgaWYgKGF2Z1ZlbG9jaXR5IDwgMTUpIHtcbiAgICAgIHJlY29tbWVuZGF0aW9ucy5wdXNoKCfimqDvuI8gTG93IHBvcnRmb2xpbyB2ZWxvY2l0eSAtIGNvbnNpZGVyIG1vcmUgYWdncmVzc2l2ZSBwcmljaW5nIGFuZCBwcm9tb3Rpb24nKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmVjb21tZW5kYXRpb25zLnB1c2goJ+Keoe+4jyBNb2RlcmF0ZSB2ZWxvY2l0eSAtIG9wdGltaXplIHByb2R1Y3QgbWl4IGZvciBiZXR0ZXIgcGVyZm9ybWFuY2UnKTtcbiAgICB9XG5cbiAgICAvLyBSaXNrIG1hbmFnZW1lbnQgcmVjb21tZW5kYXRpb25zICBcbiAgICBpZiAoaGlnaFJpc2tDb3VudCA+IHZlbG9jaXR5RGF0YS5sZW5ndGggKiAwLjIpIHtcbiAgICAgIHJlY29tbWVuZGF0aW9ucy5wdXNoKCfwn5S0IEhpZ2ggc3RvY2tvdXQgcmlzayBleHBvc3VyZSAtIGltcGxlbWVudCBhdXRvbWF0ZWQgcmVvcmRlciBwb2ludHMnKTtcbiAgICB9IGVsc2UgaWYgKGhpZ2hSaXNrQ291bnQgPiAwKSB7XG4gICAgICByZWNvbW1lbmRhdGlvbnMucHVzaCgn8J+foSBNb25pdG9yIHN0b2Nrb3V0IHJpc2tzIC0gc2V0IHVwIHZlbG9jaXR5IGFsZXJ0cyBmb3IgZmFzdCBtb3ZlcnMnKTtcbiAgICB9XG5cbiAgICAvLyBQcm9kdWN0IG1peCByZWNvbW1lbmRhdGlvbnNcbiAgICBpZiAoc2xvd01vdmVyc0NvdW50ID4gdmVsb2NpdHlEYXRhLmxlbmd0aCAqIDAuNCkge1xuICAgICAgcmVjb21tZW5kYXRpb25zLnB1c2goJ/CfkIwgVG9vIG1hbnkgc2xvdyBtb3ZlcnMgLSBpbXBsZW1lbnQgbGlxdWlkYXRpb24gc3RyYXRlZ3kgZm9yIGJvdHRvbSAyMCUnKTtcbiAgICB9XG4gICAgXG4gICAgaWYgKGZhc3RNb3ZlcnNDb3VudCA8IHZlbG9jaXR5RGF0YS5sZW5ndGggKiAwLjIpIHtcbiAgICAgIHJlY29tbWVuZGF0aW9ucy5wdXNoKCfwn5OIIE5lZWQgbW9yZSBmYXN0IG1vdmVycyAtIHJlc2VhcmNoIHRyZW5kaW5nIHByb2R1Y3RzIGluIHN1Y2Nlc3NmdWwgY2F0ZWdvcmllcycpO1xuICAgIH1cblxuICAgIC8vIENhc2ggZmxvdyByZWNvbW1lbmRhdGlvbnNcbiAgICBjb25zdCBhdmdEYXlzSW52ZW50b3J5ID0gdmVsb2NpdHlEYXRhLnJlZHVjZSgoc3VtLCBwKSA9PiBzdW0gKyBwLmludmVudG9yeU1ldHJpY3MuZGF5c09mSW52ZW50b3J5LCAwKSAvIHZlbG9jaXR5RGF0YS5sZW5ndGg7XG4gICAgaWYgKGF2Z0RheXNJbnZlbnRvcnkgPiA0NSkge1xuICAgICAgcmVjb21tZW5kYXRpb25zLnB1c2goJ/CfkrAgSGlnaCBpbnZlbnRvcnkgbGV2ZWxzIC0gb3B0aW1pemUgcmVvcmRlciBxdWFudGl0aWVzIHRvIGltcHJvdmUgY2FzaCBmbG93Jyk7XG4gICAgfSBlbHNlIGlmIChhdmdEYXlzSW52ZW50b3J5IDwgMTUpIHtcbiAgICAgIHJlY29tbWVuZGF0aW9ucy5wdXNoKCfimqEgTG93IGludmVudG9yeSBsZXZlbHMgLSBjb25zaWRlciBpbmNyZWFzaW5nIHNhZmV0eSBzdG9jayB0byBhdm9pZCBzdG9ja291dHMnKTtcbiAgICB9XG5cbiAgICAvLyBPcGVyYXRpb25hbCByZWNvbW1lbmRhdGlvbnNcbiAgICByZWNvbW1lbmRhdGlvbnMucHVzaCgn8J+TiiBNb25pdG9yIHZlbG9jaXR5IHdlZWtseSBhbmQgYWRqdXN0IHJlb3JkZXIgcG9pbnRzIGJhc2VkIG9uIHRyZW5kIGNoYW5nZXMnKTtcbiAgICByZWNvbW1lbmRhdGlvbnMucHVzaCgn8J+OryBUYXJnZXQgMjAtMzUgZGF5IGludmVudG9yeSBsZXZlbHMgZm9yIG9wdGltYWwgY2FzaCBmbG93IGJhbGFuY2UnKTtcbiAgICByZWNvbW1lbmRhdGlvbnMucHVzaCgn8J+TiCBGb2N1cyBtYXJrZXRpbmcgYnVkZ2V0IG9uIHByb2R1Y3RzIHdpdGggYWNjZWxlcmF0aW5nIHZlbG9jaXR5IHRyZW5kcycpO1xuXG4gICAgcmV0dXJuIHJlY29tbWVuZGF0aW9ucztcbiAgfVxuXG4gIHByaXZhdGUgYXNzZXNzUG9ydGZvbGlvSGVhbHRoKHZlbG9jaXR5RGF0YTogYW55W10pOiBzdHJpbmcge1xuICAgIGNvbnN0IGZhc3RNb3ZlcnMgPSB2ZWxvY2l0eURhdGEuZmlsdGVyKHAgPT4gcC5zYWxlc1ZlbG9jaXR5Lm1vbnRobHkgPj0gMzApLmxlbmd0aDtcbiAgICBjb25zdCBzbG93TW92ZXJzID0gdmVsb2NpdHlEYXRhLmZpbHRlcihwID0+IHAuc2FsZXNWZWxvY2l0eS5tb250aGx5IDwgMTApLmxlbmd0aDtcbiAgICBjb25zdCB0b3RhbFByb2R1Y3RzID0gdmVsb2NpdHlEYXRhLmxlbmd0aDtcblxuICAgIGNvbnN0IGZhc3RSYXRpbyA9IGZhc3RNb3ZlcnMgLyB0b3RhbFByb2R1Y3RzO1xuICAgIGNvbnN0IHNsb3dSYXRpbyA9IHNsb3dNb3ZlcnMgLyB0b3RhbFByb2R1Y3RzO1xuXG4gICAgaWYgKGZhc3RSYXRpbyA+IDAuMyAmJiBzbG93UmF0aW8gPCAwLjMpIHtcbiAgICAgIHJldHVybiAnRXhjZWxsZW50IC0gSGlnaCB2ZWxvY2l0eSwgbG93IHJpc2sgcG9ydGZvbGlvJztcbiAgICB9IGVsc2UgaWYgKGZhc3RSYXRpbyA+IDAuMiAmJiBzbG93UmF0aW8gPCAwLjQpIHtcbiAgICAgIHJldHVybiAnR29vZCAtIEJhbGFuY2VkIHZlbG9jaXR5IHdpdGggbWFuYWdlYWJsZSByaXNrJztcbiAgICB9IGVsc2UgaWYgKHNsb3dSYXRpbyA+IDAuNSkge1xuICAgICAgcmV0dXJuICdQb29yIC0gVG9vIG1hbnkgc2xvdyBtb3ZlcnMgaW1wYWN0aW5nIGNhc2ggZmxvdyc7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiAnRmFpciAtIFJvb20gZm9yIGltcHJvdmVtZW50IGluIHZlbG9jaXR5IG9wdGltaXphdGlvbic7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgc2VhcmNoUHJvZHVjdHMocGFyYW1zOiBhbnkpOiBQcm9taXNlPGFueVtdPiB7XG4gICAgLy8gRW5oYW5jZWQgUHJvZHVjdCBGaW5kZXIgd2l0aCBjb21wbGV0ZSBwYXJhbWV0ZXIgc2V0IGZyb20gZG9jdW1lbnRhdGlvblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBzZWxlY3Rpb246IGFueSA9IHt9O1xuICAgICAgXG4gICAgICAvLyBDb3JlIGZpbHRlcnMgd2l0aCBjYXRlZ29yeSB2YWxpZGF0aW9uXG4gICAgICBpZiAocGFyYW1zLmNhdGVnb3J5SWQpIHtcbiAgICAgICAgY29uc3QgY2F0ZWdvcnlOYW1lID0gZ2V0Q2F0ZWdvcnlOYW1lKHBhcmFtcy5jYXRlZ29yeUlkKTtcbiAgICAgICAgaWYgKCFjYXRlZ29yeU5hbWUpIHtcbiAgICAgICAgICAvLyBjb25zb2xlLndhcm4oYOKaoO+4jyBDQVRFR09SWSBXQVJOSU5HOiBDYXRlZ29yeSBJRCAke3BhcmFtcy5jYXRlZ29yeUlkfSBub3QgZm91bmQgaW4gdmVyaWZpZWQgY2F0ZWdvcmllcy4gVGhpcyBtYXkgY2F1c2UgZW1wdHkgcmVzdWx0cy5gKTtcbiAgICAgICAgICBjb25zdCBzdWdnZXN0ZWRDYXRlZ29yaWVzID0gT2JqZWN0LmVudHJpZXMoVkVSSUZJRURfQU1BWk9OX0NBVEVHT1JJRVMpXG4gICAgICAgICAgICAuc2xpY2UoMCwgNSlcbiAgICAgICAgICAgIC5tYXAoKFtuYW1lLCBpZF0pID0+IGAke25hbWV9ICgke2lkfSlgKVxuICAgICAgICAgICAgLmpvaW4oJywgJyk7XG4gICAgICAgICAgLy8gY29uc29sZS53YXJuKGDwn5KhIFNVR0dFU1RFRCBDQVRFR09SSUVTOiAke3N1Z2dlc3RlZENhdGVnb3JpZXN9YCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gY29uc29sZS5sb2coYOKchSBVc2luZyB2ZXJpZmllZCBjYXRlZ29yeTogJHtjYXRlZ29yeU5hbWV9ICgke3BhcmFtcy5jYXRlZ29yeUlkfSlgKTtcbiAgICAgICAgfVxuICAgICAgICAvLyBGSVhFRDogVXNlIHJvb3RDYXRlZ29yeSBhcnJheSBmb3JtYXQgYXMgcGVyIEFQSSBzeW50YXhcbiAgICAgICAgc2VsZWN0aW9uLnJvb3RDYXRlZ29yeSA9IFtwYXJhbXMuY2F0ZWdvcnlJZC50b1N0cmluZygpXTtcbiAgICAgIH1cbiAgICAgIFxuICAgICAgLy8gUHJpY2UgZmlsdGVycyAoaW4gY2VudHMpXG4gICAgICBpZiAocGFyYW1zLm1pblByaWNlIHx8IHBhcmFtcy5tYXhQcmljZSkge1xuICAgICAgICBzZWxlY3Rpb24uY3VycmVudF9BTUFaT04gPSB7fTtcbiAgICAgICAgaWYgKHBhcmFtcy5taW5QcmljZSkgc2VsZWN0aW9uLmN1cnJlbnRfQU1BWk9OLmd0ZSA9IHBhcmFtcy5taW5QcmljZTtcbiAgICAgICAgaWYgKHBhcmFtcy5tYXhQcmljZSkgc2VsZWN0aW9uLmN1cnJlbnRfQU1BWk9OLmx0ZSA9IHBhcmFtcy5tYXhQcmljZTtcbiAgICAgIH1cbiAgICAgIFxuICAgICAgLy8gRklYRUQ6IFNoaXBwaW5nIGNvc3QgZmlsdGVycyB1c2luZyBCVVlfQk9YX1NISVBQSU5HXG4gICAgICBpZiAocGFyYW1zLm1pblNoaXBwaW5nKSB7XG4gICAgICAgIHNlbGVjdGlvbi5jdXJyZW50X0JVWV9CT1hfU0hJUFBJTkdfZ3RlID0gcGFyYW1zLm1pblNoaXBwaW5nO1xuICAgICAgfVxuICAgICAgaWYgKHBhcmFtcy5tYXhTaGlwcGluZykge1xuICAgICAgICBzZWxlY3Rpb24uY3VycmVudF9CVVlfQk9YX1NISVBQSU5HX2x0ZSA9IHBhcmFtcy5tYXhTaGlwcGluZztcbiAgICAgIH1cbiAgICAgIFxuICAgICAgLy8gRklYRUQ6IFJhdGluZyBmaWx0ZXJzIChLZWVwYSB1c2VzIDEweCBzY2FsZTogNC41IHN0YXJzID0gNDUpXG4gICAgICBpZiAocGFyYW1zLm1pblJhdGluZykge1xuICAgICAgICBzZWxlY3Rpb24uY3VycmVudF9SQVRJTkdfZ3RlID0gTWF0aC5mbG9vcihwYXJhbXMubWluUmF0aW5nICogMTApO1xuICAgICAgfVxuICAgICAgaWYgKHBhcmFtcy5tYXhSYXRpbmcpIHtcbiAgICAgICAgc2VsZWN0aW9uLmN1cnJlbnRfUkFUSU5HX2x0ZSA9IE1hdGguZmxvb3IocGFyYW1zLm1heFJhdGluZyAqIDEwKTtcbiAgICAgIH1cbiAgICAgIFxuICAgICAgLy8gRklYRUQ6IFNhbGVzIHZlbG9jaXR5IGZpbHRlcnMgKGVzdGltYXRlZCBtb250aGx5IHNhbGVzKVxuICAgICAgaWYgKHBhcmFtcy5taW5Nb250aGx5U2FsZXMpIHtcbiAgICAgICAgc2VsZWN0aW9uLm1vbnRobHlTb2xkX2d0ZSA9IHBhcmFtcy5taW5Nb250aGx5U2FsZXM7XG4gICAgICB9XG4gICAgICBpZiAocGFyYW1zLm1heE1vbnRobHlTYWxlcykge1xuICAgICAgICBzZWxlY3Rpb24ubW9udGhseVNvbGRfbHRlID0gcGFyYW1zLm1heE1vbnRobHlTYWxlcztcbiAgICAgIH1cbiAgICAgIFxuICAgICAgLy8gRklYRUQ6IENvbXBldGl0aW9uIGZpbHRlcnMgKDkwLWRheSBhdmVyYWdlIHNlbGxlciBjb3VudClcbiAgICAgIGlmIChwYXJhbXMubWluU2VsbGVyQ291bnQpIHtcbiAgICAgICAgc2VsZWN0aW9uLmF2ZzkwX0NPVU5UX05FV19ndGUgPSBwYXJhbXMubWluU2VsbGVyQ291bnQ7XG4gICAgICB9XG4gICAgICBpZiAocGFyYW1zLm1heFNlbGxlckNvdW50KSB7XG4gICAgICAgIHNlbGVjdGlvbi5hdmc5MF9DT1VOVF9ORVdfbHRlID0gcGFyYW1zLm1heFNlbGxlckNvdW50O1xuICAgICAgfVxuICAgICAgXG4gICAgICAvLyBORVc6IFJldmlldyBjb3VudCBmaWx0ZXJcbiAgICAgIGlmIChwYXJhbXMubWluUmV2aWV3Q291bnQgfHwgcGFyYW1zLmhhc1Jldmlld3MgPT09IHRydWUpIHtcbiAgICAgICAgc2VsZWN0aW9uLmN1cnJlbnRfQ09VTlRfUkVWSUVXUyA9IHt9O1xuICAgICAgICBpZiAocGFyYW1zLm1pblJldmlld0NvdW50KSB7XG4gICAgICAgICAgc2VsZWN0aW9uLmN1cnJlbnRfQ09VTlRfUkVWSUVXUy5ndGUgPSBwYXJhbXMubWluUmV2aWV3Q291bnQ7XG4gICAgICAgIH0gZWxzZSBpZiAocGFyYW1zLmhhc1Jldmlld3MgPT09IHRydWUpIHtcbiAgICAgICAgICBzZWxlY3Rpb24uY3VycmVudF9DT1VOVF9SRVZJRVdTLmd0ZSA9IDE7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIFxuICAgICAgLy8gTkVXOiBQcmltZSBlbGlnaWJpbGl0eSBmaWx0ZXJcbiAgICAgIGlmIChwYXJhbXMuaXNQcmltZSA9PT0gdHJ1ZSkge1xuICAgICAgICBzZWxlY3Rpb24uaXNQcmltZSA9IHRydWU7XG4gICAgICB9XG4gICAgICBcbiAgICAgIC8vIE5FVzogU2FsZXMgcmFuayBmaWx0ZXJzIChsb3dlciByYW5rID0gYmV0dGVyIHNlbGxpbmcpXG4gICAgICBpZiAocGFyYW1zLm1pblNhbGVzUmFuayB8fCBwYXJhbXMubWF4U2FsZXNSYW5rKSB7XG4gICAgICAgIHNlbGVjdGlvbi5jdXJyZW50X1NBTEVTX1JBTksgPSB7fTtcbiAgICAgICAgaWYgKHBhcmFtcy5taW5TYWxlc1JhbmspIHNlbGVjdGlvbi5jdXJyZW50X1NBTEVTX1JBTksuZ3RlID0gcGFyYW1zLm1pblNhbGVzUmFuaztcbiAgICAgICAgaWYgKHBhcmFtcy5tYXhTYWxlc1JhbmspIHNlbGVjdGlvbi5jdXJyZW50X1NBTEVTX1JBTksubHRlID0gcGFyYW1zLm1heFNhbGVzUmFuaztcbiAgICAgIH1cbiAgICAgIFxuICAgICAgLy8gRklYRUQ6IEFkZCBwcm9kdWN0VHlwZSBhcnJheSAoc3RhbmRhcmQgcHJvZHVjdHMgPSBcIjBcIilcbiAgICAgIHNlbGVjdGlvbi5wcm9kdWN0VHlwZSA9IFtcIjBcIl07XG4gICAgICBcbiAgICAgIC8vIE5FVzogQWRkIGxhc3RSYXRpbmdVcGRhdGUgZmlsdGVyIGZvciBmcmVzaCBkYXRhXG4gICAgICAvLyBUaGlzIGVuc3VyZXMgcHJvZHVjdHMgaGF2ZSByZWNlbnQgcmF0aW5nIHVwZGF0ZXMgKGRhdGEgZnJlc2huZXNzKVxuICAgICAgLy8gVmFsdWUgYXBwZWFycyB0byBiZSBpbiBLZWVwYSB0aW1lIGZvcm1hdCAoZGF5cyBzaW5jZSBlcG9jaD8pXG4gICAgICBpZiAocGFyYW1zLmluY2x1ZGVSZWNlbnRSYXRpbmdzICE9PSBmYWxzZSkge1xuICAgICAgICAvLyBVc2UgYSByZWFzb25hYmxlIGRlZmF1bHQgZm9yIHJlY2VudCByYXRpbmcgdXBkYXRlc1xuICAgICAgICBzZWxlY3Rpb24ubGFzdFJhdGluZ1VwZGF0ZV9ndGUgPSA3NTQ3ODAwOyAvLyBGcm9tIEFQSSBleGFtcGxlXG4gICAgICB9XG4gICAgICBcbiAgICAgIC8vIEZJWEVEOiBBZGQgc29ydCBwYXJhbWV0ZXIgaW4gY29ycmVjdCBmb3JtYXRcbiAgICAgIGlmIChwYXJhbXMuc29ydEJ5KSB7XG4gICAgICAgIGNvbnN0IHNvcnRPcmRlciA9IHBhcmFtcy5zb3J0T3JkZXIgfHwgJ2Rlc2MnO1xuICAgICAgICBzZWxlY3Rpb24uc29ydCA9IFtbcGFyYW1zLnNvcnRCeSwgc29ydE9yZGVyXV07XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBEZWZhdWx0IHNvcnQgYnkgbW9udGhseSBzYWxlcyBkZXNjZW5kaW5nXG4gICAgICAgIHNlbGVjdGlvbi5zb3J0ID0gW1tcIm1vbnRobHlTb2xkXCIsIFwiZGVzY1wiXV07XG4gICAgICB9XG4gICAgICBcbiAgICAgIC8vIERlYnVnIGxvZyBmb3IgdHJvdWJsZXNob290aW5nICh1bmNvbW1lbnQgd2hlbiBkZWJ1Z2dpbmcpXG4gICAgICAvLyBjb25zb2xlLmxvZygn8J+UjSBTZWxlY3Rpb24gb2JqZWN0OicsIEpTT04uc3RyaW5naWZ5KHNlbGVjdGlvbiwgbnVsbCwgMikpO1xuICAgICAgXG4gICAgICAvLyBHZXQgQVNJTnMgZnJvbSBxdWVyeSBlbmRwb2ludFxuICAgICAgY29uc3QgcXVlcnlSZXNwb25zZSA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3QoJy9xdWVyeScsIHtcbiAgICAgICAgZG9tYWluOiBwYXJhbXMuZG9tYWluIHx8IDEsXG4gICAgICAgIHNlbGVjdGlvbjogSlNPTi5zdHJpbmdpZnkoc2VsZWN0aW9uKSxcbiAgICAgICAgcGFnZTogcGFyYW1zLnBhZ2UgfHwgMCxcbiAgICAgICAgcGVyUGFnZTogTWF0aC5taW4ocGFyYW1zLnBlclBhZ2UgfHwgMjUsIDUwKSAvLyBLZWVwYSBsaW1pdCBpcyA1MFxuICAgICAgfSkgYXMgS2VlcGFRdWVyeVJlc3BvbnNlO1xuICAgICAgXG4gICAgICBpZiAocXVlcnlSZXNwb25zZS5hc2luTGlzdCAmJiBxdWVyeVJlc3BvbnNlLmFzaW5MaXN0Lmxlbmd0aCA+IDApIHtcbiAgICAgICAgLy8gR2V0IGRldGFpbGVkIHByb2R1Y3QgZGF0YSBmb3IgdGhlIEFTSU5zXG4gICAgICAgIGNvbnN0IGRldGFpbGVkUHJvZHVjdHMgPSBhd2FpdCB0aGlzLmdldFByb2R1Y3RzQmF0Y2goXG4gICAgICAgICAgcXVlcnlSZXNwb25zZS5hc2luTGlzdCwgXG4gICAgICAgICAgcGFyYW1zLmRvbWFpbiB8fCAxLCBcbiAgICAgICAgICB7XG4gICAgICAgICAgICByYXRpbmc6IHRydWUsXG4gICAgICAgICAgICBvZmZlcnM6IDIwLFxuICAgICAgICAgICAgc3RhdHM6IDEgIC8vIENSSVRJQ0FMOiBJbmNsdWRlIHN0YXRpc3RpY3MgZGF0YSBmb3Igc2VsbGVyIGNvdW50c1xuICAgICAgICAgIH1cbiAgICAgICAgKTtcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBkZXRhaWxlZFByb2R1Y3RzLm1hcChwcm9kdWN0ID0+ICh7XG4gICAgICAgICAgLi4ucHJvZHVjdCxcbiAgICAgICAgICBzZWFyY2hTY29yZTogcXVlcnlSZXNwb25zZS50b3RhbFJlc3VsdHMsXG4gICAgICAgICAgaXNGcm9tUXVlcnk6IHRydWVcbiAgICAgICAgfSkpO1xuICAgICAgfVxuICAgICAgXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnNvbGUud2FybignUXVlcnkgZW5kcG9pbnQgZmFpbGVkLCBmYWxsaW5nIGJhY2sgdG8gYmVzdCBzZWxsZXJzOicsIGVycm9yKTtcbiAgICAgIFxuICAgICAgLy8gRmFsbGJhY2sgdG8gYmVzdCBzZWxsZXJzIGFwcHJvYWNoIGlmIHF1ZXJ5IGZhaWxzXG4gICAgICBpZiAocGFyYW1zLmNhdGVnb3J5SWQpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCBiZXN0U2VsbGVycyA9IGF3YWl0IHRoaXMuZ2V0QmVzdFNlbGxlcnMoe1xuICAgICAgICAgICAgZG9tYWluOiBwYXJhbXMuZG9tYWluIHx8IDEsXG4gICAgICAgICAgICBjYXRlZ29yeTogcGFyYW1zLmNhdGVnb3J5SWQsXG4gICAgICAgICAgICBwYWdlOiBwYXJhbXMucGFnZSB8fCAwXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgXG4gICAgICAgICAgaWYgKGJlc3RTZWxsZXJzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIGNvbnN0IGFzaW5MaXN0ID0gYmVzdFNlbGxlcnMuc2xpY2UoMCwgcGFyYW1zLnBlclBhZ2UgfHwgMjUpLm1hcChicyA9PiBicy5hc2luKTtcbiAgICAgICAgICAgIGNvbnN0IGRldGFpbGVkUHJvZHVjdHMgPSBhd2FpdCB0aGlzLmdldFByb2R1Y3RzQmF0Y2goYXNpbkxpc3QsIHBhcmFtcy5kb21haW4gfHwgMSwge1xuICAgICAgICAgICAgICByYXRpbmc6IHRydWUsXG4gICAgICAgICAgICAgIG9mZmVyczogMjAsXG4gICAgICAgICAgICAgIHN0YXRzOiAxICAvLyBDUklUSUNBTDogSW5jbHVkZSBzdGF0aXN0aWNzIGRhdGEgZm9yIHNlbGxlciBjb3VudHNcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gZGV0YWlsZWRQcm9kdWN0cy5tYXAoKHByb2R1Y3QsIGluZGV4KSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IGJlc3RTZWxsZXIgPSBiZXN0U2VsbGVyc1tpbmRleF07XG4gICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgLi4ucHJvZHVjdCxcbiAgICAgICAgICAgICAgICBtb250aGx5U29sZDogTWF0aC5tYXgoMTAwLCBNYXRoLmZsb29yKDIwMDAgLSAoYmVzdFNlbGxlci5zYWxlc1JhbmsgLyAxMDApKSksXG4gICAgICAgICAgICAgICAgYmVzdFNlbGxlclJhbms6IGJlc3RTZWxsZXIuc2FsZXNSYW5rLFxuICAgICAgICAgICAgICAgIGlzRnJvbUJlc3RTZWxsZXJzOiB0cnVlXG4gICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2ggKGZhbGxiYWNrRXJyb3IpIHtcbiAgICAgICAgICBjb25zb2xlLndhcm4oJ0Jlc3Qgc2VsbGVycyBmYWxsYmFjayBhbHNvIGZhaWxlZDonLCBmYWxsYmFja0Vycm9yKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICBcbiAgICByZXR1cm4gW107XG4gIH1cblxuICBhc3luYyBnZXRUb2tlbnNMZWZ0KCk6IFByb21pc2U8bnVtYmVyPiB7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0KCcvdG9rZW4nKTtcbiAgICByZXR1cm4gcmVzcG9uc2UudG9rZW5zTGVmdDtcbiAgfVxuXG4gIC8vIE5FVzogU2FsZXMgVmVsb2NpdHkgQW5hbHlzaXMgdXNpbmcgU3RhdGlzdGljcyBPYmplY3QgKEZSRUUgYW5hbHl0aWNzKVxuICBhc3luYyBhbmFseXplU2FsZXNWZWxvY2l0eShwYXJhbXM6IHtcbiAgICBhc2luPzogc3RyaW5nO1xuICAgIGFzaW5zPzogc3RyaW5nW107XG4gICAgY2F0ZWdvcnlJZD86IG51bWJlcjtcbiAgICBkb21haW4/OiBudW1iZXI7XG4gICAgbWluVmVsb2NpdHk/OiBudW1iZXI7XG4gICAgdGltZWZyYW1lPzogJ3dlZWsnIHwgJ21vbnRoJyB8ICdxdWFydGVyJztcbiAgfSk6IFByb21pc2U8YW55W10+IHtcbiAgICBsZXQgcHJvZHVjdHM6IEtlZXBhUHJvZHVjdFtdID0gW107XG5cbiAgICBpZiAocGFyYW1zLmFzaW4gfHwgcGFyYW1zLmFzaW5zKSB7XG4gICAgICAvLyBBbmFseXplIHNwZWNpZmljIHByb2R1Y3RzXG4gICAgICBjb25zdCBhc2lucyA9IHBhcmFtcy5hc2lucyB8fCBbcGFyYW1zLmFzaW4hXTtcbiAgICAgIHByb2R1Y3RzID0gYXdhaXQgdGhpcy5nZXRQcm9kdWN0c0JhdGNoKGFzaW5zLCBwYXJhbXMuZG9tYWluIHx8IDEsIHtcbiAgICAgICAgc3RhdHM6IDEsIC8vIEZSRUUgc3RhdGlzdGljcyBkYXRhXG4gICAgICAgIHJhdGluZzogdHJ1ZVxuICAgICAgfSk7XG4gICAgfSBlbHNlIGlmIChwYXJhbXMuY2F0ZWdvcnlJZCkge1xuICAgICAgLy8gRmluZCBwcm9kdWN0cyBpbiBjYXRlZ29yeSBhbmQgYW5hbHl6ZSB2ZWxvY2l0eVxuICAgICAgY29uc3Qgc2VhcmNoUmVzdWx0cyA9IGF3YWl0IHRoaXMuc2VhcmNoUHJvZHVjdHMoe1xuICAgICAgICBjYXRlZ29yeUlkOiBwYXJhbXMuY2F0ZWdvcnlJZCxcbiAgICAgICAgZG9tYWluOiBwYXJhbXMuZG9tYWluIHx8IDEsXG4gICAgICAgIHBlclBhZ2U6IDI1XG4gICAgICB9KTtcbiAgICAgIHByb2R1Y3RzID0gc2VhcmNoUmVzdWx0cztcbiAgICB9XG5cbiAgICByZXR1cm4gcHJvZHVjdHMubWFwKHByb2R1Y3QgPT4ge1xuICAgICAgY29uc3Qgc3RhdHMgPSBwcm9kdWN0LnN0YXRzO1xuICAgICAgaWYgKCFzdGF0cykgcmV0dXJuIG51bGw7XG5cbiAgICAgIC8vIENhbGN1bGF0ZSBzYWxlcyB2ZWxvY2l0eSBmcm9tIFN0YXRpc3RpY3Mgb2JqZWN0XG4gICAgICBjb25zdCBjdXJyZW50U2FsZXNSYW5rID0gc3RhdHMuY3VycmVudFszXTsgLy8gU2FsZXMgcmFuayBkYXRhIHR5cGVcbiAgICAgIGNvbnN0IGF2Z1NhbGVzUmFuayA9IHN0YXRzLmF2Z1szXTtcbiAgICAgIFxuICAgICAgLy8gRXN0aW1hdGUgZGFpbHkgc2FsZXMgYmFzZWQgb24gc2FsZXMgcmFuayAoaW5kdXN0cnkgZm9ybXVsYSlcbiAgICAgIGNvbnN0IGVzdGltYXRlZERhaWx5U2FsZXMgPSBjdXJyZW50U2FsZXNSYW5rID4gMCA/IFxuICAgICAgICBNYXRoLm1heCgxLCBNYXRoLmZsb29yKDEwMDAwMDAgLyBNYXRoLnNxcnQoY3VycmVudFNhbGVzUmFuaykpKSA6IDA7XG4gICAgICBcbiAgICAgIGNvbnN0IHdlZWtseVNhbGVzID0gZXN0aW1hdGVkRGFpbHlTYWxlcyAqIDc7XG4gICAgICBjb25zdCBtb250aGx5U2FsZXMgPSBlc3RpbWF0ZWREYWlseVNhbGVzICogMzA7XG5cbiAgICAgIC8vIENhbGN1bGF0ZSBpbnZlbnRvcnkgbWV0cmljc1xuICAgICAgY29uc3QgYnV5Qm94UHJpY2UgPSBzdGF0cy5idXlCb3hQcmljZSB8fCAwO1xuICAgICAgY29uc3Qgb3V0T2ZTdG9ja1BlcmNlbnRhZ2UgPSBzdGF0cy5vdXRPZlN0b2NrUGVyY2VudGFnZTMwIHx8IDA7XG4gICAgICBjb25zdCB0dXJub3ZlclJhdGUgPSBvdXRPZlN0b2NrUGVyY2VudGFnZSA8IDUwID8gXG4gICAgICAgIE1hdGgubWF4KDEsIDEyIC0gKG91dE9mU3RvY2tQZXJjZW50YWdlIC8gMTApKSA6IDE7XG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIGFzaW46IHByb2R1Y3QuYXNpbixcbiAgICAgICAgdGl0bGU6IHByb2R1Y3QudGl0bGUsXG4gICAgICAgIGJyYW5kOiBwcm9kdWN0LmJyYW5kLFxuICAgICAgICBwcmljZTogYnV5Qm94UHJpY2UsXG4gICAgICAgIHNhbGVzVmVsb2NpdHk6IHtcbiAgICAgICAgICBkYWlseTogZXN0aW1hdGVkRGFpbHlTYWxlcyxcbiAgICAgICAgICB3ZWVrbHk6IHdlZWtseVNhbGVzLFxuICAgICAgICAgIG1vbnRobHk6IG1vbnRobHlTYWxlcyxcbiAgICAgICAgICB0cmVuZDogYXZnU2FsZXNSYW5rID4gY3VycmVudFNhbGVzUmFuayA/ICdBY2NlbGVyYXRpbmcnIDogXG4gICAgICAgICAgICAgICAgIGF2Z1NhbGVzUmFuayA8IGN1cnJlbnRTYWxlc1JhbmsgPyAnRGVjbGluaW5nJyA6ICdTdGFibGUnLFxuICAgICAgICAgIGNoYW5nZVBlcmNlbnQ6IGF2Z1NhbGVzUmFuayA+IDAgPyBcbiAgICAgICAgICAgIE1hdGgucm91bmQoKChhdmdTYWxlc1JhbmsgLSBjdXJyZW50U2FsZXNSYW5rKSAvIGF2Z1NhbGVzUmFuaykgKiAxMDApIDogMFxuICAgICAgICB9LFxuICAgICAgICBpbnZlbnRvcnlNZXRyaWNzOiB7XG4gICAgICAgICAgdHVybm92ZXJSYXRlOiB0dXJub3ZlclJhdGUsXG4gICAgICAgICAgZGF5c09mSW52ZW50b3J5OiBNYXRoLmNlaWwoMzAgLyBNYXRoLm1heCgxLCBlc3RpbWF0ZWREYWlseVNhbGVzKSksXG4gICAgICAgICAgc3RvY2tvdXRSaXNrOiBvdXRPZlN0b2NrUGVyY2VudGFnZSA+IDMwID8gJ0hpZ2gnIDogXG4gICAgICAgICAgICAgICAgICAgICAgIG91dE9mU3RvY2tQZXJjZW50YWdlID4gMTUgPyAnTWVkaXVtJyA6ICdMb3cnLFxuICAgICAgICAgIHJlY29tbWVuZGVkT3JkZXJRdWFudGl0eTogTWF0aC5jZWlsKGVzdGltYXRlZERhaWx5U2FsZXMgKiAzMClcbiAgICAgICAgfSxcbiAgICAgICAgbWFya2V0TWV0cmljczoge1xuICAgICAgICAgIHJhdGluZzogc3RhdHMuY3VycmVudFsxNl0gPyBzdGF0cy5jdXJyZW50WzE2XSAvIDEwIDogMCwgLy8gUmF0aW5nIGRhdGEgdHlwZVxuICAgICAgICAgIHNhbGVzUmFuazogY3VycmVudFNhbGVzUmFuayxcbiAgICAgICAgICBjb21wZXRpdGlvbjogJ01lZGl1bScsIC8vIFdpbGwgZW5oYW5jZSBiYXNlZCBvbiBzZWxsZXIgY291bnRcbiAgICAgICAgICBzZWFzb25hbGl0eTogJ01lZGl1bScgIC8vIFdpbGwgZW5oYW5jZSB3aXRoIGhpc3RvcmljYWwgYW5hbHlzaXNcbiAgICAgICAgfSxcbiAgICAgICAgcHJvZml0YWJpbGl0eToge1xuICAgICAgICAgIHJldmVudWVWZWxvY2l0eTogZXN0aW1hdGVkRGFpbHlTYWxlcyAqIChidXlCb3hQcmljZSAvIDEwMCksXG4gICAgICAgICAgZXN0aW1hdGVkTWFyZ2luOiAwLjI1LCAvLyBEZWZhdWx0IDI1JSAtIGNhbiBiZSBjdXN0b21pemVkXG4gICAgICAgICAgcHJvZml0VmVsb2NpdHk6IGVzdGltYXRlZERhaWx5U2FsZXMgKiAoYnV5Qm94UHJpY2UgLyAxMDApICogMC4yNVxuICAgICAgICB9XG4gICAgICB9O1xuICAgIH0pLmZpbHRlcihpdGVtID0+IHtcbiAgICAgIGlmICghaXRlbSkgcmV0dXJuIGZhbHNlO1xuICAgICAgaWYgKHBhcmFtcy5taW5WZWxvY2l0eSAmJiBpdGVtLnNhbGVzVmVsb2NpdHkuZGFpbHkgPCBwYXJhbXMubWluVmVsb2NpdHkpIHJldHVybiBmYWxzZTtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH0pO1xuICB9XG5cbiAgcGFyc2VDU1ZEYXRhKGNzdkRhdGE6IG51bWJlcltdW10sIGRhdGFUeXBlOiBudW1iZXIpOiBBcnJheTx7IHRpbWVzdGFtcDogbnVtYmVyOyB2YWx1ZTogbnVtYmVyIH0+IHtcbiAgICBpZiAoIWNzdkRhdGFbZGF0YVR5cGVdKSB7XG4gICAgICByZXR1cm4gW107XG4gICAgfVxuXG4gICAgY29uc3QgZGF0YSA9IGNzdkRhdGFbZGF0YVR5cGVdO1xuICAgIGNvbnN0IHJlc3VsdDogQXJyYXk8eyB0aW1lc3RhbXA6IG51bWJlcjsgdmFsdWU6IG51bWJlciB9PiA9IFtdO1xuXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBkYXRhLmxlbmd0aDsgaSArPSAyKSB7XG4gICAgICBpZiAoaSArIDEgPCBkYXRhLmxlbmd0aCkge1xuICAgICAgICBjb25zdCB0aW1lc3RhbXAgPSB0aGlzLmtlZXBhVGltZVRvVW5peFRpbWUoZGF0YVtpXSk7XG4gICAgICAgIGNvbnN0IHZhbHVlID0gZGF0YVtpICsgMV07XG4gICAgICAgIHJlc3VsdC5wdXNoKHsgdGltZXN0YW1wLCB2YWx1ZSB9KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG5cbiAga2VlcGFUaW1lVG9Vbml4VGltZShrZWVwYVRpbWU6IG51bWJlcik6IG51bWJlciB7XG4gICAgcmV0dXJuIChrZWVwYVRpbWUgKyAyMTU2NDAwMCkgKiA2MDAwMDtcbiAgfVxuXG4gIHVuaXhUaW1lVG9LZWVwYVRpbWUodW5peFRpbWU6IG51bWJlcik6IG51bWJlciB7XG4gICAgcmV0dXJuIE1hdGguZmxvb3IodW5peFRpbWUgLyA2MDAwMCkgLSAyMTU2NDAwMDtcbiAgfVxuXG4gIGZvcm1hdFByaWNlKHByaWNlOiBudW1iZXIsIGRvbWFpbjogS2VlcGFEb21haW4gPSBLZWVwYURvbWFpbi5VUyk6IHN0cmluZyB7XG4gICAgaWYgKHByaWNlID09PSAtMSkgcmV0dXJuICdOL0EnO1xuICAgIFxuICAgIGNvbnN0IGN1cnJlbmNpZXM6IFJlY29yZDxLZWVwYURvbWFpbiwgc3RyaW5nPiA9IHtcbiAgICAgIFtLZWVwYURvbWFpbi5VU106ICckJyxcbiAgICAgIFtLZWVwYURvbWFpbi5VS106ICfCoycsXG4gICAgICBbS2VlcGFEb21haW4uREVdOiAn4oKsJyxcbiAgICAgIFtLZWVwYURvbWFpbi5GUl06ICfigqwnLFxuICAgICAgW0tlZXBhRG9tYWluLkpQXTogJ8KlJyxcbiAgICAgIFtLZWVwYURvbWFpbi5DQV06ICdDJCcsXG4gICAgICBbS2VlcGFEb21haW4uQ05dOiAnwqUnLFxuICAgICAgW0tlZXBhRG9tYWluLklUXTogJ+KCrCcsXG4gICAgICBbS2VlcGFEb21haW4uRVNdOiAn4oKsJyxcbiAgICAgIFtLZWVwYURvbWFpbi5JTl06ICfigrknLFxuICAgICAgW0tlZXBhRG9tYWluLk1YXTogJyQnXG4gICAgfTtcblxuICAgIGNvbnN0IGN1cnJlbmN5ID0gY3VycmVuY2llc1tkb21haW5dIHx8ICckJztcbiAgICBjb25zdCBmb3JtYXR0ZWRQcmljZSA9IChwcmljZSAvIDEwMCkudG9GaXhlZCgyKTtcbiAgICBcbiAgICByZXR1cm4gYCR7Y3VycmVuY3l9JHtmb3JtYXR0ZWRQcmljZX1gO1xuICB9XG5cbiAgZ2V0RG9tYWluTmFtZShkb21haW46IEtlZXBhRG9tYWluKTogc3RyaW5nIHtcbiAgICBjb25zdCBkb21haW5zOiBSZWNvcmQ8S2VlcGFEb21haW4sIHN0cmluZz4gPSB7XG4gICAgICBbS2VlcGFEb21haW4uVVNdOiAnYW1hem9uLmNvbScsXG4gICAgICBbS2VlcGFEb21haW4uVUtdOiAnYW1hem9uLmNvLnVrJyxcbiAgICAgIFtLZWVwYURvbWFpbi5ERV06ICdhbWF6b24uZGUnLFxuICAgICAgW0tlZXBhRG9tYWluLkZSXTogJ2FtYXpvbi5mcicsXG4gICAgICBbS2VlcGFEb21haW4uSlBdOiAnYW1hem9uLmNvLmpwJyxcbiAgICAgIFtLZWVwYURvbWFpbi5DQV06ICdhbWF6b24uY2EnLFxuICAgICAgW0tlZXBhRG9tYWluLkNOXTogJ2FtYXpvbi5jbicsXG4gICAgICBbS2VlcGFEb21haW4uSVRdOiAnYW1hem9uLml0JyxcbiAgICAgIFtLZWVwYURvbWFpbi5FU106ICdhbWF6b24uZXMnLFxuICAgICAgW0tlZXBhRG9tYWluLklOXTogJ2FtYXpvbi5pbicsXG4gICAgICBbS2VlcGFEb21haW4uTVhdOiAnYW1hem9uLmNvbS5teCdcbiAgICB9O1xuXG4gICAgcmV0dXJuIGRvbWFpbnNbZG9tYWluXSB8fCAnYW1hem9uLmNvbSc7XG4gIH1cblxuICAvKipcbiAgICogR2V0IHNlbGxlciBjb3VudCBmb3IgYSBwcm9kdWN0IGJhc2VkIG9uIHNwZWNpZmllZCB0aW1lZnJhbWVcbiAgICogQHBhcmFtIHByb2R1Y3QgLSBLZWVwYSBwcm9kdWN0IG9iamVjdCB3aXRoIHN0YXRzXG4gICAqIEBwYXJhbSB0aW1lZnJhbWUgLSBUaW1lZnJhbWUgdG8gdXNlIGZvciBzZWxsZXIgY291bnRcbiAgICogQHJldHVybnMgU2VsbGVyIGNvdW50IGFuZCB0aW1lZnJhbWUgZGVzY3JpcHRpb25cbiAgICovXG4gIGdldFNlbGxlckNvdW50KHByb2R1Y3Q6IGFueSwgdGltZWZyYW1lOiBzdHJpbmcgPSAnOTBkYXknKTogeyBjb3VudDogbnVtYmVyOyBkZXNjcmlwdGlvbjogc3RyaW5nIH0ge1xuICAgIGlmICghcHJvZHVjdD8uc3RhdHMpIHtcbiAgICAgIHJldHVybiB7IGNvdW50OiAxLCBkZXNjcmlwdGlvbjogJzkwLWRheSBhdmVyYWdlIChubyBzdGF0cyBhdmFpbGFibGUpJyB9O1xuICAgIH1cblxuICAgIGNvbnN0IHsgc3RhdHMgfSA9IHByb2R1Y3Q7XG4gICAgY29uc3QgQ09VTlRfTkVXX0lOREVYID0gMTE7IC8vIERhdGFUeXBlLkNPVU5UX05FV1xuXG4gICAgc3dpdGNoICh0aW1lZnJhbWUpIHtcbiAgICAgIGNhc2UgJ2N1cnJlbnQnOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvdW50OiBzdGF0cy5jdXJyZW50Py5bQ09VTlRfTkVXX0lOREVYXSA/PyAxLFxuICAgICAgICAgIGRlc2NyaXB0aW9uOiAnY3VycmVudCdcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgJzMwZGF5JzpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb3VudDogc3RhdHMuYXZnMzA/LltDT1VOVF9ORVdfSU5ERVhdID8/IDEsXG4gICAgICAgICAgZGVzY3JpcHRpb246ICczMC1kYXkgYXZlcmFnZSdcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgJzkwZGF5JzpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb3VudDogc3RhdHMuYXZnOTA/LltDT1VOVF9ORVdfSU5ERVhdID8/IDEsXG4gICAgICAgICAgZGVzY3JpcHRpb246ICc5MC1kYXkgYXZlcmFnZSdcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgJzE4MGRheSc6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY291bnQ6IHN0YXRzLmF2ZzE4MD8uW0NPVU5UX05FV19JTkRFWF0gPz8gMSxcbiAgICAgICAgICBkZXNjcmlwdGlvbjogJzE4MC1kYXkgYXZlcmFnZSdcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgJzM2NWRheSc6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY291bnQ6IHN0YXRzLmF2ZzM2NT8uW0NPVU5UX05FV19JTkRFWF0gPz8gMSxcbiAgICAgICAgICBkZXNjcmlwdGlvbjogJzM2NS1kYXkgYXZlcmFnZSdcbiAgICAgICAgfTtcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIC8vIERlZmF1bHQgdG8gOTAtZGF5IGlmIGludmFsaWQgdGltZWZyYW1lXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY291bnQ6IHN0YXRzLmF2ZzkwPy5bQ09VTlRfTkVXX0lOREVYXSA/PyAxLFxuICAgICAgICAgIGRlc2NyaXB0aW9uOiAnOTAtZGF5IGF2ZXJhZ2UgKGRlZmF1bHQpJ1xuICAgICAgICB9O1xuICAgIH1cbiAgfVxufSJdfQ==