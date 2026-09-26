import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The app draws its screens at fixed type sizes, so Text and TextInput come
 * from components/Text.tsx (font scaling off) rather than 'react-native'.
 * One direct import brings the phone's Larger Text setting back for that
 * screen -- this is what catches it.
 */
const ROOT = join(__dirname, '..', '..');
const DIRS = ['app', 'components', 'lib'];
const ALLOWED = new Set(['components/Text.tsx']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('fixed font sizes', () => {
  it('imports Text and TextInput from components/Text, never react-native', () => {
    const offenders = DIRS.flatMap((dir) => sourceFiles(join(ROOT, dir)))
      .filter((path) => !ALLOWED.has(relative(ROOT, path)))
      .filter((path) => {
        const source = readFileSync(path, 'utf8');
        return [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]react-native['"]/g)].some(
          (m) => /\b(Text|TextInput)\b/.test(m[1].replace(/\btype\s+\w+/g, '')),
        );
      })
      .map((path) => relative(ROOT, path));
    expect(offenders).toEqual([]);
  });
});
