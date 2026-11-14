import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import inventory from '../docs/paginas/inventario.json';
import { PUBLIC_MDX_FILES } from '../src/lib/public-mdx';
describe('documentação MDX', () => {
  it('cobre cada página e padrão de subpáginas sem exportar documentação interna', () => {
    const pages = fs.readdirSync('src/app', { recursive: true }).filter(name => /(?:^|[\\/])page\.(tsx|mdx)$/.test(String(name))).map(name => `src/app/${String(name).replaceAll('\\', '/')}`).sort();
    expect(inventory.map(item => item.source).sort()).toEqual(pages);
    for (const page of inventory) expect(fs.existsSync(page.mdx), page.route).toBe(true);
    expect(Object.keys(PUBLIC_MDX_FILES)).toHaveLength(9);
    for (const file of Object.values(PUBLIC_MDX_FILES)) {
      expect(file).not.toContain('..'); expect(fs.existsSync(`src/content/public/${file}`)).toBe(true);
    }
  });
});
