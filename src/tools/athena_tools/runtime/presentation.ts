export type DerivedFromKey = 'sku' | 'asin' | 'inventory_id';

export type ItemPresentation = {
  identity: {
    sku?: string;
    asin?: string;
    inventory_id?: number;
    marketplace_code?: string;
  };
  media: {
    primary_image: {
      url?: string;
      derived_from: 'sku';
      source_field?: string;
      sku?: string;
    };
  };
  links: {
    neonpanel_inventory: {
      url?: string;
      derived_from: 'inventory_id';
      inventory_id?: number;
    };
    amazon_storefront: {
      url?: string;
      derived_from: 'asin';
      asin?: string;
      marketplace_code?: string;
    };
  };
};

function amazonDomainForMarketplace(marketplaceCode?: string): string {
  const code = (marketplaceCode ?? '').toUpperCase().trim();
  if (code === 'UK') return 'www.amazon.co.uk';
  // Default to US storefront.
  return 'www.amazon.com';
}

export function buildAmazonStorefrontUrl(asin: string, marketplaceCode?: string): string {
  const domain = amazonDomainForMarketplace(marketplaceCode);
  const safeAsin = encodeURIComponent(asin.trim());
  return `https://${domain}/dp/${safeAsin}`;
}

export function buildNeonpanelInventoryUrl(inventoryId: number): string {
  // Keep it stable + universal. Inventory pages support filtering by inventory_id.
  return `https://my.neonpanel.com/app/catalogs/inventory?inventory_id=${encodeURIComponent(String(inventoryId))}`;
}

export function buildItemPresentation(args: {
  sku?: string;
  asin?: string;
  inventory_id?: number;
  marketplace_code?: string;
  image_url?: string;
  image_source_field?: string;
}): ItemPresentation {
  const sku = args.sku?.trim() || undefined;
  const asin = args.asin?.trim() || undefined;
  const inventory_id = Number.isFinite(args.inventory_id ?? NaN) ? (args.inventory_id as number) : undefined;
  const marketplace_code = args.marketplace_code?.trim() || undefined;

  const image_url = args.image_url?.trim() || undefined;

  return {
    identity: {
      sku,
      asin,
      inventory_id,
      marketplace_code,
    },
    media: {
      primary_image: {
        url: image_url,
        derived_from: 'sku',
        source_field: args.image_source_field,
        sku,
      },
    },
    links: {
      neonpanel_inventory: {
        url: inventory_id ? buildNeonpanelInventoryUrl(inventory_id) : undefined,
        derived_from: 'inventory_id',
        inventory_id,
      },
      amazon_storefront: {
        url: asin ? buildAmazonStorefrontUrl(asin, marketplace_code) : undefined,
        derived_from: 'asin',
        asin,
        marketplace_code,
      },
    },
  };
}
