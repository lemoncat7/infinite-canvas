import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import ts from 'typescript';

const root = resolve('src');
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
  });
}
const sources = new Map(files(root).map(path => [path, readFileSync(path, 'utf8')]));
test('entrypoints only compose and start; HTTP route inventory is preserved', () => {
  const entry = sources.get(resolve(root, 'server.ts'));
  const composition = sources.get(resolve(root, 'application.ts'));
  assert.ok(entry.split('\n').length <= 50, 'server.ts is growing into a monolith again');
  assert.ok(composition.split('\n').length <= 150, 'application.ts should only compose modules');
  assert.ok(!/SELECT |INSERT INTO |registerTool\(/.test(entry + composition));
  const routes = [...sources.values()].flatMap(source => [...source.matchAll(/app\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/g)].map(m => `${m[1].toUpperCase()} ${m[2]}`));
  const previous = JSON.parse(readFileSync(new URL('./fixtures/http-routes.json', import.meta.url), 'utf8'));
  for (const route of previous) assert.equal(routes.filter(value => value === route).length, 1, `Missing/duplicated original route: ${route}`);
});
test('MCP cannot bypass the API and business services cannot depend on HTTP composition', () => {
  for (const [path, source] of sources) {
    const name = relative(root, path);
    const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    for (const statement of file.statements) {
      if (!ts.isImportDeclaration(statement)) continue;
      const target = statement.moduleSpecifier.text;
      if (name.startsWith('mcp/')) assert.ok(!/storage|models\/store|providers\/|generation\/submit/.test(target), `${name} bypasses authenticated API: ${target}`);
      if (/^(generation|billing|assets)\//.test(name) && !name.endsWith('routes.ts'))
        assert.ok(!/http\/app|application|server\.js|mcp\//.test(target), `${name} depends on a transport: ${target}`);
    }
  }
});
test('new modules do not introduce import cycles', () => {
  const graph = new Map();
  for (const [path, source] of sources) {
    const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    graph.set(path, file.statements.filter(ts.isImportDeclaration).filter(s => {
      if (s.importClause?.isTypeOnly) return false;
      const bindings = s.importClause?.namedBindings;
      return !(bindings && ts.isNamedImports(bindings) && bindings.elements.every(e => e.isTypeOnly));
    }).map(s => s.moduleSpecifier.text).filter(value => value.startsWith('.')).map(value => resolve(dirname(path), value.replace(/\.js$/, '.ts'))));
  }
  const seen = new Set(), stack = new Set();
  function visit(path) {
    assert.ok(!stack.has(path), `Runtime import cycle at ${relative(root, path)}`);
    if (seen.has(path)) return;
    stack.add(path);
    for (const child of graph.get(path) || []) visit(child);
    stack.delete(path); seen.add(path);
  }
  visit(resolve(root, 'server.ts'));
});
