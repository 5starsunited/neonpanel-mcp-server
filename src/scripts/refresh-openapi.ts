import { logger } from '../logging/logger';
import { OpenApiService } from '../lib/openapi-service';

async function main() {
  const service = new OpenApiService();
  await service.refreshFromRemote();
  const status = await service.getStatus({ includeCache: true });
  logger.info({ status }, 'Refreshed OpenAPI document');
}

main().catch((error) => {
  logger.error({ err: error }, 'Failed to refresh OpenAPI document');
  process.exit(1);
});
