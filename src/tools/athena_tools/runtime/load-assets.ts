import fs from 'node:fs/promises';

export async function loadJsonFile<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw) as T;
}

export async function loadTextFile(filePath: string): Promise<string> {
  return fs.readFile(filePath, 'utf8');
}
