/**
 * Shared select_fields projection with validation for Brand Analytics tools.
 *
 * When a caller provides field names that don't exist in the query result,
 * this utility includes `_unrecognized_fields` and `_available_fields`
 * in the response so the caller can self-correct.
 */

export function applySelectFields(
  rows: Record<string, unknown>[],
  selectFields: string[] | undefined,
): { items: Record<string, unknown>[]; _unrecognized_fields?: string[]; _available_fields?: string[] } {
  if (!selectFields || selectFields.length === 0) {
    return { items: rows };
  }

  // Determine available columns from the first row (all rows share the same schema)
  const availableColumns = rows.length > 0 ? Object.keys(rows[0]) : [];
  const availableSet = new Set(availableColumns);

  const recognized = selectFields.filter((f) => availableSet.has(f));
  const unrecognized = selectFields.filter((f) => !availableSet.has(f));

  const keep = new Set(recognized);
  const projected = rows.map((r) =>
    Object.fromEntries(Object.entries(r).filter(([k]) => keep.has(k))),
  );

  const result: { items: Record<string, unknown>[]; _unrecognized_fields?: string[]; _available_fields?: string[] } = {
    items: projected,
  };

  if (unrecognized.length > 0) {
    result._unrecognized_fields = unrecognized;
    result._available_fields = availableColumns;
  }

  return result;
}
