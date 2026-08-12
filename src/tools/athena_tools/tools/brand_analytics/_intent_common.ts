import crypto from 'node:crypto';
import { neonPanelRequest } from '../../../../clients/neonpanel-api';
import type { ToolExecutionContext } from '../../../types';

/**
 * Shared helpers for the intent-clustering tools:
 *   - brand_analytics_cluster_search_terms
 *   - brand_analytics_create_user_intent_cluster
 *   - brand_analytics_list_user_intent_clusters
 */

type CompaniesWithPermissionResponse = {
  companies?: Array<{ company_id?: number; companyId?: number; id?: number }>;
};

/**
 * App-side surrogate BIGINT id. Monotonic-ish:
 *   id = Date.now() * 1000 + cryptoRand(0..999)
 * Fits comfortably in a signed 64-bit BIGINT (now ~1.78e15, headroom ~5e18).
 */
export function generateBigintId(): number {
  const suffix = crypto.randomInt(0, 1000);
  return Date.now() * 1000 + suffix;
}

/** intent_id slug: lowercase letters, digits, underscores. */
export function isValidIntentIdSlug(s: string): boolean {
  return /^[a-z0-9][a-z0-9_]{0,63}$/.test(s);
}

/**
 * Permission check: caller must have one of the brand-analytics permissions
 * on the requested company_id.
 */
export async function isAuthorizedForCompany(
  companyId: number,
  context: ToolExecutionContext,
): Promise<boolean> {
  const permissions = [
    'view:quicksight_group.sales_and_marketing_new',
    'view:quicksight_group.marketing',
  ];
  for (const permission of permissions) {
    try {
      const resp = await neonPanelRequest<CompaniesWithPermissionResponse>({
        token: context.userToken,
        path: `/api/v1/permissions/${encodeURIComponent(permission)}/companies`,
      });
      const ids = (resp.companies ?? [])
        .map((c) => c.company_id ?? c.companyId ?? c.id)
        .filter((id): id is number => typeof id === 'number' && Number.isFinite(id) && id > 0);
      if (ids.includes(companyId)) return true;
    } catch {
      // continue
    }
  }
  return false;
}
