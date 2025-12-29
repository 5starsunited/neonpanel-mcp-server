# Athena Tools Implementation Plan (tool-by-tool)

Branch: `athena-tools-implementation`

Goals
- Implement tools one-by-one from the toolset JSON, each with its own `tool.json` + `query.sql`.
- Enforce user access reliably and filter Athena results using `company_id` (NOT `company_uuid`) because `company_id` is the partition key in all Athena tables.
- Keep `tools/list` driven by per-tool JSON, while `tools/call` uses Zod validation + runtime enforcement.

Non-goals
- Do not implement all tools in one PR.
- Do not build a generic “one path handles all tools” engine that obscures per-tool logic.

Repository conventions (per tool)
- Folder: `src/tools/athena_tools/tools/<tool_name>/`
  - `tool.json` (MCP discovery spec: name, description, inputSchema, outputSchema, examples)
  - `query.sql` (Athena SQL template; can start as stub and evolve)
  - `register.ts` (Zod schemas + permission gating + SQL rendering + runAthenaQuery)

Access control + company_id filtering (core change)
1) Permission check stays NeonPanel-driven
   - Continue using NeonPanel endpoint: `GET /api/v1/permissions/{permission}/companies`
   - This proves what the user is allowed to access.

2) Convert “permitted companies” into permitted `company_id` values
   - Problem: the permissions endpoint typically returns `uuid` (and name fields), but Athena tables are partitioned by `company_id`.
   - Solution approach:
     - Fetch a mapping from NeonPanel companies list endpoint (already used by `neonpanel.listCompanies`) that includes both `uuid` and `id`.
     - Build a lookup:
       - `uuid -> id`
       - (optionally) `id -> uuid` for reverse mapping when needed.
     - Compute `permittedCompanyIds: number[]` from the permitted UUIDs.

3) Tool input should prefer `company_id`
   - For all Athena tools:
     - Accept `companyId?: number` (or `companyIds?: number[]`) in input.
     - Do NOT accept `companyUuid` in the Athena tool inputs unless we have a strong reason.

4) SQL must filter by `company_id`
   - Every Athena query should include a filter clause based on `company_id`, e.g.
     - `WHERE company_id IN (...)`
   - If the user supplies `companyId`, intersect it with `permittedCompanyIds`.
   - If intersection is empty: return a denied message and do not run Athena.

5) Safety rules
   - Never rely on client-provided company identifiers for authorization.
   - Authorization is always: `requestedCompanyIds ∩ permittedCompanyIds`.

Tool-by-tool rollout process (repeat for each tool)
1) Select next tool from `amazon_supply_chain_toolset_v0.3.1.json`.
2) Create folder + `tool.json` (copy description + parameter/output schemas).
3) Add `query.sql` as stub first (or real SQL when ready).
4) Implement `register.ts`:
   - Zod input schema mirroring `tool.json`.
   - Permission lookup -> `permittedCompanyIds`.
   - Build safe SQL filtering (company_id + other validated filters).
   - Run Athena and return structured result.
5) Wire into `src/tools/athena_tools/index.ts` by adding an explicit registration call.
6) Build + verify:
   - `npm run build` (ensures assets copied to `dist/`)
   - `tools/list` shows the new tool.
   - One `tools/call` smoke test.

Immediate next steps (before implementing new tools)
1) Update the existing Athena FBA tool to use `company_id`:
   - Replace `companyUuid` input with `companyId`.
   - Update permission gating to compute `permittedCompanyIds`.
   - Update SQL to include `company_id` filtering.
2) Add a small shared helper in `src/tools/athena_tools/runtime/` for:
   - `getPermittedCompanyIds(userToken, requiredPermission)`
   - (optional) caching mapping per-request.
3) Add/adjust tests for the mapping + filtering logic.

Notes
- The big JSON toolset is treated as the backlog/source spec; each implemented tool gets its own runtime `tool.json`.
- Permissions can be stored in per-tool JSON as a structured field (not only in description), e.g. `x-neonpanel.requiredPermission`.
