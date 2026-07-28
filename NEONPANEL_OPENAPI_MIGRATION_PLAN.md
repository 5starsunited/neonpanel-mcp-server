# NeonPanel Consolidated OpenAPI Migration Plan

## Context

NeonPanel application version 1.5.138 consolidates future API Reference updates into one machine-readable document:

- OpenAPI YAML: `https://my.neonpanel.com/api/v1/openapi`
- Visual reference: `https://my.neonpanel.com/api/v1/reference`

The following endpoints are deprecated and must no longer be used by maintained code or current documentation:

- `http://my.neonpanel.com/api/v1/scheme/authorization`
- `http://my.neonpanel.com/api/v1/scheme/3.0.3`
- `http://my.neonpanel.com/api/v1/scheme/3.1.0`
- `http://my.neonpanel.com/api/v1/scheme/documents`

As of 2026-07-28, a HEAD request to the consolidated endpoint returns HTTP 200 with `Content-Type: application/yaml` and `Content-Disposition: inline; filename="openapi.yaml"`.

## Current State

- `src/config/index.ts` defaults `NEONPANEL_OPENAPI_URL` to the deprecated 3.1.0 endpoint.
- `infrastructure/lib/neonpanel-mcp-stack.ts` explicitly injects the same deprecated URL into ECS, overriding the application default in production.
- `src/lib/openapi-service.ts` already supports JSON and YAML responses, ETags, disk fallback, and local persistence.
- A failed or malformed remote refresh can silently retain a local cache, while `src/scripts/refresh-openapi.ts` still logs the operation as successful.
- The fetched value is not validated as a usable OpenAPI document before replacing the in-memory and on-disk cache.
- `README.md` treats the old General and Documents schemas as separate authoritative sources.
- `openapi.json` is the runtime fallback snapshot. Historical dated YAML files are reference artifacts and should not be rewritten as part of this migration.
- Project-management and other MCP request schemas are hand-maintained; they are not generated automatically from the upstream OpenAPI document.

## Goals

1. Make the consolidated endpoint the only active upstream OpenAPI source.
2. Prevent invalid, partial, or unexpectedly shaped responses from replacing a valid cache.
3. Make manual refresh fail clearly when the remote document was not accepted.
4. Audit MCP REST paths and request payloads against the consolidated contract.
5. Keep the MCP server's `/openapi.json`, `/openapi.yaml`, health checks, and offline fallback working with the larger document.
6. Remove deprecated links from maintained operational documentation without editing generated CDK output.

## Non-Goals

- Do not generate MCP tools directly from the consolidated OpenAPI document in this change.
- Do not remove NeonPanel's deprecated upstream endpoints.
- Do not rewrite historical snapshots such as `openapi.3.0.3.yaml` or dated `openapi.3.1.0.*.yaml` files.
- Do not hand-edit `dist/`, `infrastructure/cdk.out*`, or synthesized CloudFormation assets.
- Do not deploy with `DEPLOY.sh`; deployment follows the repository's main-branch GitHub Actions workflow.

## Implementation

### 1. Switch the active source URL

- Change the `NEONPANEL_OPENAPI_URL` default in `src/config/index.ts` to `https://my.neonpanel.com/api/v1/openapi`.
- Change the ECS environment value in `infrastructure/lib/neonpanel-mcp-stack.ts` to the same URL.
- Keep the environment override supported for local and emergency rollback use.
- Update `README.md` to identify `/api/v1/openapi` as the sole machine-readable source and `/api/v1/reference` as the visual documentation.
- Replace the Documents-schema curl example with the consolidated endpoint and update its inspection guidance.

### 2. Validate remote documents before cache replacement

Add a small runtime validator in or adjacent to `src/lib/openapi-service.ts`. An accepted document must have:

- a root object;
- an `openapi` string beginning with `3.`;
- an `info` object;
- a `paths` object with at least one operation;
- no obvious HTML/error-envelope shape.

On validation failure:

- retain the current memory or disk cache;
- do not persist the rejected payload;
- log status, content type, response size, and a bounded body snippet;
- report the refresh as failed rather than successful.

The validator should verify structure, not lock the server to a specific API version or exact path count.

### 3. Make refresh outcomes explicit

- Have `refreshFromRemote()` return a result describing `updated`, `not-modified`, or `fallback`, including an error reason where applicable.
- Make `npm run openapi:refresh` exit non-zero unless the remote document was accepted or returned a valid 304 against an existing cache.
- Extend OpenAPI status with the configured remote URL, last refresh outcome, and accepted document metadata such as OpenAPI version, path count, and serialized size.
- Preserve disk fallback for normal server startup and request handling; only the explicit refresh command should be strict.

### 4. Add focused tests

Extend `tests/openapi-service.test.ts` to cover:

- consolidated YAML (`application/yaml`) parsing and persistence;
- JSON parsing remains supported;
- valid document metadata and path count reporting;
- malformed YAML, HTML, and structurally invalid JSON do not replace a valid cache;
- a failed first fetch falls back to a valid disk document;
- refresh failure is observable by the refresh script;
- ETag/304 behavior retains an existing document;
- concurrent refresh calls still coalesce.

Add a config or infrastructure assertion that prevents either maintained configuration source from regressing to `/api/v1/scheme/*`.

### 5. Refresh and audit the consolidated contract

After version 1.5.138 is confirmed available:

1. Download the document to a temporary file first; do not immediately overwrite `openapi.json`.
2. Parse it with `js-yaml` and record OpenAPI version, byte size, path count, operation count, and component-schema count.
3. Verify representative endpoint families used by this server, including OAuth/permissions, companies, inventory, warehouses, reports, imports, and all project-management document routes.
4. Compare every method/path issued through `neonPanelRequest` with the consolidated specification.
5. Compare project-management payloads in `src/tools/project_management/schemas.ts` and adapters with their request-body schemas, including required fields, nullability, enums, identifiers, and line-item shapes.
6. Classify differences as upstream additions, intentional MCP restrictions, or defects requiring code changes.
7. Only after these checks pass, run `npm run openapi:refresh` to replace the tracked `openapi.json` fallback.

Contract corrections discovered by the audit should be committed separately from the source-URL migration when they alter tool behavior. This keeps rollback and review straightforward.

### 6. Check large-document behavior

Because the consolidated reference is expected to be substantially larger:

- measure refresh time, parse time, serialized size, and process memory before and after loading;
- verify `/openapi.json` and `/openapi.yaml` return complete documents locally;
- verify the health endpoint's deep check remains fast and does not download the document (HEAD only);
- confirm ECS/ALB response limits and timeouts are not approached;
- confirm startup still succeeds from the checked-in fallback with no network access;
- avoid adding the full upstream document to AI prompts or MCP `tools/list`; those surfaces should continue using the curated tool registry.

If size becomes operationally significant, add a configurable maximum response size with a limit based on the measured consolidated document plus headroom. Do not guess a restrictive limit before measuring the production file.

## Validation Commands

```bash
npm test
npm run build
npm run openapi:refresh
```

Then run local HTTP checks against the built server:

```bash
curl -fsS 'http://localhost:3030/healthz?deep=1'
curl -fsS 'http://localhost:3030/openapi.json' | jq '.openapi, (.paths | length)'
curl -fsS 'http://localhost:3030/openapi.yaml' | sed -n '1,10p'
```

Final repository checks:

```bash
git grep -nE 'api/v1/scheme/(authorization|3\.0\.3|3\.1\.0|documents)' -- ':!README_OLD.md' ':!openapi.3.*' ':!infrastructure/cdk.out*' ':!dist/*'
git diff --check
```

The first command must return no matches in maintained code or current documentation.

## Rollout

1. Implement validation and tests before changing the production URL.
2. Switch both application and CDK configuration in the same commit so local and ECS behavior cannot diverge.
3. Refresh and review `openapi.json` only after the consolidated contract audit passes.
4. Build and run the full test suite locally.
5. Commit only the intended source, tests, documentation, and reviewed fallback snapshot; exclude unrelated working-tree changes and generated CDK output.
6. Push the migration to `main` so GitHub Actions performs the deployment.
7. Verify production `/healthz?deep=1`, `/openapi.json`, and `/openapi.yaml`, then inspect ECS logs for refresh or parsing warnings.
8. Run representative MCP read and project-management calls with a valid token.

## Rollback

- Set `NEONPANEL_OPENAPI_URL` temporarily to the deprecated 3.1.0 endpoint while it remains available, or revert the migration commit.
- Retain the last validated `openapi.json` so the server continues serving a usable contract during upstream failures.
- Do not roll back contract fixes independently unless the corresponding MCP behavior is also reverted.

## Acceptance Criteria

- Maintained source and current docs contain no active `/api/v1/scheme/*` references.
- Both local defaults and ECS use `https://my.neonpanel.com/api/v1/openapi`.
- Valid consolidated YAML is parsed, validated, cached, and served as JSON and YAML.
- Invalid remote payloads cannot replace the last valid cache.
- `npm run openapi:refresh` fails when no remote document is accepted.
- Tests and TypeScript build pass.
- All MCP-used NeonPanel methods and paths are accounted for in the consolidated contract or documented as intentional exceptions.
- Production deep health reports the new endpoint as reachable after GitHub Actions deployment.