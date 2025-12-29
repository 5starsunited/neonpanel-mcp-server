export function renderSqlTemplate(
  template: string,
  variables: Record<string, string | number>,
): string {
  // Minimal and safe templating: only replaces {{key}} tokens.
  // Callers must ensure values are safe (e.g., LIMIT is numeric).
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    if (!(key in variables)) {
      throw new Error(`Missing SQL template variable: ${key}`);
    }
    return String(variables[key]);
  });
}
