export interface KeepaConfig {
    apiKey: string;
    baseUrl?: string;
    timeout?: number;
    rateLimitDelay?: number;
}
export interface KeepaProduct {
    asin: string;
    domainId: number;
    title?: string;
    brand?: string;
    manufacturer?: string;
    productGroup?: string;
    partNumber?: string;
    model?: string;
    color?: string;
    size?: string;
    edition?: string;
    format?: string;
    packageHeight?: number;
    packageLength?: number;
    packageWidth?: number;
    packageWeight?: number;
    packageQuantity?: number;
    isAdultProduct?: boolean;
    isEligibleForTradeIn?: boolean;
    isEligibleForSuperSaverShipping?: boolean;
    offers?: KeepaOffer[];
    stats?: KeepaStats;
    imagesCSV?: string;
    categoryTree?: KeepaCategory[];
    parent?: string;
    variations?: string[];
    frequentlyBoughtTogether?: string[];
    buyBoxSellerIdHistory?: number[][];
    isRedirectASIN?: boolean;
    isSNS?: boolean;
    offerId?: number;
    oneHourOfferCount?: number;
    type?: string;
    hazardousMaterialType?: number;
    availabilityAmazon?: number;
    csv?: number[][];
}
export interface KeepaOffer {
    offerId: number;
    lastSeen: number;
    sellerId?: string;
    isPrime: boolean;
    isFBA: boolean;
    isMAP: boolean;
    isShippedByAmazon: boolean;
    isAmazon: boolean;
    isBuyBoxWinner: boolean;
    isUsed: boolean;
    offerCSV?: string;
    primeExclusive: boolean;
    isWarehouseDeal: boolean;
    isScam: boolean;
    shippingStr?: string;
    conditionComment?: string;
    condition: number;
    minOrderQuantity?: number;
    maxOrderQuantity?: number;
}
export interface KeepaStats {
    current: number[];
    avg: number[];
    atIntervalStart: number[];
    min: number[];
    max: number[];
    minInInterval: number[];
    maxInInterval: number[];
    out: number[];
    total: number[];
    retrievedOfferCount: number;
    buyBoxPrice?: number;
    buyBoxShipping?: number;
    buyBoxUsedPrice?: number;
    buyBoxUsedShipping?: number;
    salesRankReference?: number;
    salesRankReferenceDrop?: number;
    outOfStockPercentage30?: number;
    outOfStockPercentage90?: number;
    lightningDealInfo?: number[];
    couponHistory?: number[][];
    promotionHistory?: number[][];
}
export interface KeepaCategory {
    catId: number;
    name: string;
    children?: KeepaCategory[];
    parent?: number;
}
export interface KeepaDeal {
    asin: string;
    title: string;
    brand?: string;
    price: number;
    shipping: number;
    categoryTree: KeepaCategory[];
    salesRank: number;
    salesRankReference?: number;
    deltaPercent: any;
    delta: any;
    avgPrice: number;
    range: string;
    isLightningDeal: boolean;
    isPrimeExclusive: boolean;
    coupon?: number;
    promotion?: string;
    imageUrl?: string;
    domainId: number;
    dealScore: number;
    lightningEnd?: number;
    warehouseCondition?: number;
    warehouseConditionComment?: string;
}
export interface KeepaSeller {
    sellerId: string;
    sellerName: string;
    isScammer: boolean;
    hasFBM: boolean;
    hasFBA: boolean;
    isAmazon: boolean;
    totalStorefrontAsins?: number;
    avgRating?: number;
    ratingCount?: number;
    startDate?: number;
    sellerCSV?: string;
    storefront?: string[];
}
export interface KeepaBestSeller {
    asin: string;
    title: string;
    salesRank: number;
    categoryId: number;
    price?: number;
    isPrime: boolean;
    rating?: number;
    reviewCount: number;
    imageUrl?: string;
}
export interface KeepaApiResponse<T> {
    timestamp: number;
    tokensLeft: number;
    tokensConsumed: number;
    processingTimeInMs: number;
    version: string;
    statusCode: number;
    data?: T;
    error?: string;
}
export interface KeepaQueryResponse extends KeepaApiResponse<null> {
    asinList: string[];
    totalResults: number;
    refillIn?: number;
    refillRate?: number;
    tokenFlowReduction?: number;
}
export interface ProductQueryParams {
    asin?: string;
    asins?: string[];
    domain?: number;
    code?: string;
    days?: number;
    startdate?: number;
    enddate?: number;
    update?: number;
    history?: boolean;
    rating?: boolean;
    offers?: number;
    buybox?: boolean;
    fbafees?: boolean;
    variations?: boolean;
    onlylivefbafees?: boolean;
    categories?: boolean;
    update_ver?: number;
    stock?: boolean;
    product_codes?: number;
    promotions?: boolean;
    coupon_history?: boolean;
    lightning_deals?: boolean;
    stats?: number;
}
export interface DealQueryParams {
    domainId: number;
    dealType?: string;
    categoryId?: number;
    minPrice?: number;
    maxPrice?: number;
    minDiscount?: number;
    minRating?: number;
    isPrime?: boolean;
    sortType?: number;
    page?: number;
    perPage?: number;
}
export interface SellerQueryParams {
    seller?: string;
    domain?: number;
    storefront?: number;
    update?: number;
}
export interface BestSellerQueryParams {
    domain: number;
    category: number;
    page?: number;
}
export interface ProductFinderParams {
    domain?: number;
    categoryId?: number;
    minRating?: number;
    maxRating?: number;
    minPrice?: number;
    maxPrice?: number;
    minShipping?: number;
    maxShipping?: number;
    minMonthlySales?: number;
    maxMonthlySales?: number;
    minSellerCount?: number;
    maxSellerCount?: number;
    isPrime?: boolean;
    hasReviews?: boolean;
    productType?: number;
    sortBy?: 'monthlySold' | 'price' | 'rating' | 'reviewCount' | 'salesRank';
    sortOrder?: 'asc' | 'desc';
    page?: number;
    perPage?: number;
}
export interface ProductFinderResult {
    asin: string;
    title: string;
    brand?: string;
    price?: number;
    shipping?: number;
    rating?: number;
    reviewCount?: number;
    monthlySold?: number;
    salesRank?: number;
    categoryId?: number;
    sellerCount?: number;
    isPrime?: boolean;
    imageUrl?: string;
    profitMargin?: number;
    competition?: 'Low' | 'Medium' | 'High';
}
export interface CategoryAnalysisParams {
    domain?: number;
    categoryId: number;
    analysisType?: 'overview' | 'top_performers' | 'opportunities' | 'trends';
    priceRange?: 'budget' | 'mid' | 'premium' | 'luxury';
    minRating?: number;
    includeSubcategories?: boolean;
    timeframe?: 'week' | 'month' | 'quarter' | 'year';
}
export interface CategoryInsights {
    categoryId: number;
    categoryName?: string;
    totalProducts: number;
    averagePrice: number;
    priceRange: {
        min: number;
        max: number;
    };
    averageRating: number;
    totalReviews: number;
    competitionLevel: 'Low' | 'Medium' | 'High';
    marketSaturation: number;
    topBrands: Array<{
        brand: string;
        productCount: number;
        marketShare: number;
    }>;
    priceDistribution: Array<{
        range: string;
        count: number;
        percentage: number;
    }>;
    opportunityScore: number;
    trends: {
        salesTrend: 'Rising' | 'Stable' | 'Declining';
        priceTrend: 'Rising' | 'Stable' | 'Declining';
        competitionTrend: 'Increasing' | 'Stable' | 'Decreasing';
    };
    recommendations: string[];
}
export interface SalesVelocityParams {
    domain?: number;
    categoryId?: number;
    asin?: string;
    asins?: string[];
    timeframe?: 'week' | 'month' | 'quarter';
    minVelocity?: number;
    maxVelocity?: number;
    priceRange?: {
        min?: number;
        max?: number;
    };
    minRating?: number;
    sortBy?: 'velocity' | 'turnoverRate' | 'revenueVelocity' | 'trend';
    sortOrder?: 'asc' | 'desc';
    page?: number;
    perPage?: number;
}
export interface SalesVelocityData {
    asin: string;
    title: string;
    brand?: string;
    price: number;
    salesVelocity: {
        daily: number;
        weekly: number;
        monthly: number;
        trend: 'Accelerating' | 'Stable' | 'Declining';
        changePercent: number;
    };
    inventoryMetrics: {
        turnoverRate: number;
        daysOfInventory: number;
        stockoutRisk: 'Low' | 'Medium' | 'High';
        recommendedOrderQuantity: number;
    };
    marketMetrics: {
        rating: number;
        reviewCount: number;
        salesRank: number;
        competition: 'Low' | 'Medium' | 'High';
        seasonality: 'Low' | 'Medium' | 'High';
    };
    profitability: {
        revenueVelocity: number;
        grossMarginEstimate: number;
        profitVelocity: number;
    };
    alerts: string[];
}
export interface InventoryAnalysis {
    totalProducts: number;
    averageTurnoverRate: number;
    fastMovers: SalesVelocityData[];
    slowMovers: SalesVelocityData[];
    stockoutRisks: SalesVelocityData[];
    seasonalPatterns: Array<{
        period: string;
        velocityMultiplier: number;
        recommendation: string;
    }>;
    recommendations: string[];
}
export declare enum KeepaDomain {
    US = 1,
    UK = 2,
    DE = 3,
    FR = 4,
    JP = 5,
    CA = 6,
    CN = 7,
    IT = 8,
    ES = 9,
    IN = 10,
    MX = 11
}
export declare enum KeepaDataType {
    AMAZON = 0,
    NEW = 1,
    USED = 2,
    SALES_RANK = 3,
    LISTING_COUNT = 4,
    COLLECTIBLE = 5,
    REFURBISHED = 6,
    NEW_FBM = 7,
    LIGHTNING_DEAL = 8,
    WAREHOUSE = 9,
    NEW_FBA = 10,
    COUNT_NEW = 11,
    COUNT_USED = 12,
    COUNT_REFURBISHED = 13,
    COUNT_COLLECTIBLE = 14,
    EXTRA_INFO_UPDATES = 15,
    RATING = 16,
    COUNT_REVIEWS = 17,
    BUY_BOX = 18,
    USED_NEW_SHIPPING = 19,
    USED_VERY_GOOD_SHIPPING = 20,
    USED_GOOD_SHIPPING = 21,
    USED_ACCEPTABLE_SHIPPING = 22,
    COLLECTIBLE_NEW_SHIPPING = 23,
    COLLECTIBLE_VERY_GOOD_SHIPPING = 24,
    COLLECTIBLE_GOOD_SHIPPING = 25,
    COLLECTIBLE_ACCEPTABLE_SHIPPING = 26,
    REFURBISHED_SHIPPING = 27,
    BUY_BOX_SHIPPING = 28,
    NEW_SHIPPING = 29,
    TRADE_IN = 30
}
export declare class KeepaError extends Error {
    statusCode?: number | undefined;
    tokensLeft?: number | undefined;
    constructor(message: string, statusCode?: number | undefined, tokensLeft?: number | undefined);
}
export declare const VERIFIED_AMAZON_CATEGORIES: {
    readonly 'Alexa Skills': 96814;
    readonly 'Amazon Autos': 32373;
    readonly 'Amazon Devices & Accessories': 402;
    readonly Appliances: 2619525011;
    readonly 'Apps & Games': 2350149011;
    readonly 'Arts, Crafts & Sewing': 2617941011;
    readonly 'Audible Books & Originals': 18145289011;
    readonly Automotive: 15684181;
    readonly 'Baby Products': 165796011;
    readonly 'Beauty & Personal Care': 3760911;
    readonly Books: 283155;
    readonly 'CDs & Vinyl': 5174;
    readonly 'Cell Phones & Accessories': 2335752011;
    readonly 'Clothing, Shoes & Jewelry': 7141123011;
    readonly 'Collectibles & Fine Art': 4991425011;
    readonly 'Credit & Payment Cards': 3561432011;
    readonly 'Digital Music': 163856011;
    readonly Electronics: 172282;
    readonly 'Everything Else': 10272111;
    readonly 'Gift Cards': 2238192011;
    readonly 'Grocery & Gourmet Food': 16310101;
    readonly 'Handmade Products': 11260432011;
    readonly 'Health & Household': 3760901;
    readonly 'Home & Kitchen': 1055398;
    readonly 'Industrial & Scientific': 16310091;
    readonly 'Kindle Store': 133140011;
    readonly 'Luxury Stores': 18981045011;
    readonly 'Magazine Subscriptions': 599858;
    readonly 'Movies & TV': 2625373011;
    readonly 'Musical Instruments': 11091801;
    readonly 'Office Products': 1064954;
    readonly 'Patio, Lawn & Garden': 2972638011;
    readonly 'Pet Supplies': 2619533011;
    readonly 'Prime Video': 2858778011;
    readonly Software: 229534;
    readonly 'Sports & Outdoors': 3375251;
    readonly 'Tools & Home Improvement': 228013;
    readonly 'Toys & Games': 165793011;
    readonly 'Video Games': 468642;
    readonly 'Video Shorts': 9013971011;
};
export declare function getCategoryName(categoryId: number): string | undefined;
export declare function getCategoryId(categoryName: string): number | undefined;
export declare function getAvailableCategories(): string[];
