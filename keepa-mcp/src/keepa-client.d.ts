import { KeepaConfig, KeepaProduct, KeepaDeal, KeepaSeller, KeepaBestSeller, ProductQueryParams, DealQueryParams, SellerQueryParams, BestSellerQueryParams, KeepaDomain } from './types';
export declare class KeepaClient {
    private client;
    private apiKey;
    private baseUrl;
    private rateLimitDelay;
    private lastRequestTime;
    constructor(config: KeepaConfig);
    private requestInterceptor;
    private responseInterceptor;
    private errorInterceptor;
    private makeRequest;
    getProduct(params: ProductQueryParams): Promise<KeepaProduct[]>;
    getProductByAsin(asin: string, domain?: KeepaDomain, options?: Partial<ProductQueryParams>): Promise<KeepaProduct | null>;
    getProductsBatch(asins: string[], domain?: KeepaDomain, options?: Partial<ProductQueryParams>): Promise<KeepaProduct[]>;
    getDeals(params: DealQueryParams): Promise<KeepaDeal[]>;
    discoverDeals(params: {
        domain?: number;
        categoryId?: number;
        minPrice?: number;
        maxPrice?: number;
        minDiscount?: number;
        maxDiscount?: number;
        minRating?: number;
        isPrime?: boolean;
        isLightningDeal?: boolean;
        isWarehouseDeal?: boolean;
        minDealScore?: number;
        sortBy?: 'dealScore' | 'discount' | 'price' | 'rating' | 'salesRank';
        sortOrder?: 'asc' | 'desc';
        page?: number;
        perPage?: number;
    }): Promise<any[]>;
    private extractDiscountPercent;
    private extractPriceChange;
    private calculateProfitPotential;
    private assessDealCompetition;
    getSeller(params: SellerQueryParams): Promise<KeepaSeller[]>;
    analyzeCategory(params: {
        categoryId: number;
        domain?: number;
        analysisType?: 'overview' | 'top_performers' | 'opportunities' | 'trends';
        priceRange?: 'budget' | 'mid' | 'premium' | 'luxury';
        minRating?: number;
        sampleSize?: number;
    }): Promise<any>;
    private performCategoryAnalysis;
    private calculatePriceStatistics;
    private categorizePrice;
    private analyzeBrands;
    private analyzeCompetition;
    private analyzePerformance;
    private generateMarketInsights;
    private calculateOpportunityScore;
    private generateRecommendations;
    getBestSellers(params: BestSellerQueryParams): Promise<KeepaBestSeller[]>;
    analyzeInventory(params: {
        categoryId?: number;
        asins?: string[];
        domain?: number;
        analysisType?: 'overview' | 'fast_movers' | 'slow_movers' | 'stockout_risks' | 'seasonal';
        timeframe?: 'week' | 'month' | 'quarter';
        targetTurnoverRate?: number;
    }): Promise<any>;
    private performInventoryAnalysis;
    private calculateAverageTurnover;
    private analyzeSeasonalPatterns;
    private generateInventoryRecommendations;
    private assessPortfolioHealth;
    searchProducts(params: any): Promise<any[]>;
    getTokensLeft(): Promise<number>;
    analyzeSalesVelocity(params: {
        asin?: string;
        asins?: string[];
        categoryId?: number;
        domain?: number;
        minVelocity?: number;
        timeframe?: 'week' | 'month' | 'quarter';
    }): Promise<any[]>;
    parseCSVData(csvData: number[][], dataType: number): Array<{
        timestamp: number;
        value: number;
    }>;
    keepaTimeToUnixTime(keepaTime: number): number;
    unixTimeToKeepaTime(unixTime: number): number;
    formatPrice(price: number, domain?: KeepaDomain): string;
    getDomainName(domain: KeepaDomain): string;
    /**
     * Get seller count for a product based on specified timeframe
     * @param product - Keepa product object with stats
     * @param timeframe - Timeframe to use for seller count
     * @returns Seller count and timeframe description
     */
    getSellerCount(product: any, timeframe?: string): {
        count: number;
        description: string;
    };
}
