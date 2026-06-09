// Engine purity (spec §1.1 architecture rule, plan Task 2): the rules engine
// must be renderer-independent — zero host-environment access — and may only
// import from within src/engine/.
import { describe, expect, it } from 'vitest';

// @types/node is not installed in this project, so a literal `import 'node:fs'`
// would fail the typecheck. Vitest runs in a node environment, so a computed
// dynamic import resolves at runtime; we type the minimal surface ourselves.
const fsModuleName = 'node:fs';
const fs = (await import(fsModuleName)) as {
  readdirSync(path: string): string[];
  readFileSync(path: string, encoding: 'utf8'): string;
};

// fileURLToPath equivalent without node:url (POSIX paths; %20 etc. decoded).
const ENGINE_DIR = decodeURIComponent(new URL('../../src/engine/', import.meta.url).pathname);

const FORBIDDEN_STRINGS = [
  'document.',
  'window.',
  'navigator.',
  'localStorage',
  'HTMLElement',
  'canvas',
];

describe('engine purity (spec §1.1)', () => {
  const files = fs.readdirSync(ENGINE_DIR).filter((f) => f.endsWith('.ts'));

  it('covers the full expected engine module set', () => {
    expect(files.sort()).toEqual([
      'board.ts',
      'game.ts',
      'pieces.ts',
      'rng.ts',
      'serialize.ts',
      'tray.ts',
      'types.ts',
    ]);
  });

  it.each(files.map((f) => [f]))('%s contains no host-environment references', (file) => {
    const source = fs.readFileSync(ENGINE_DIR + file, 'utf8');
    for (const forbidden of FORBIDDEN_STRINGS) {
      expect(source.includes(forbidden), `"${forbidden}" found in ${file}`).toBe(false);
    }
    expect(/import.*from.*app/.test(source), `app-layer import in ${file}`).toBe(false);
  });

  it.each(files.map((f) => [f]))('%s only imports from within src/engine/', (file) => {
    const source = fs.readFileSync(ENGINE_DIR + file, 'utf8');
    // Match both `import ... from '...'` and `export ... from '...'` specifiers.
    const specifiers = [...source.matchAll(/(?:import|export)[^;]*?from\s+['"]([^'"]+)['"]/g)].map(
      (m) => m[1],
    );
    for (const spec of specifiers) {
      expect(spec, `${file} imports ${spec}`).toMatch(/^\.\/[a-zA-Z0-9_-]+$/);
    }
    // No dynamic imports or requires escaping the engine either.
    expect(/import\(/.test(source)).toBe(false);
    expect(/\brequire\(/.test(source)).toBe(false);
  });
});
