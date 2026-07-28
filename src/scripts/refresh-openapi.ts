import { logger } from '../logging/logger';
import { OpenApiService } from '../lib/openapi-service';

async function main() {
  const service = new OpenApiService();
  const result = await service.refreshFromRemote();
  if (result.outcome === 'fallback') {
    throw new Error(result.error ?? 'Remote OpenAPI document was not accepted');
  }
  const status = await service.getStatus({ includeCache: true });
  logger.info({ result, status }, 'Refreshed OpenAPI document');
}

main().catch((error) => {
  logger.error({ err: error }, 'Failed to refresh OpenAPI document');
  process.exit(1);
});
