import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { createRequire } from "node:module";
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const require = createRequire(import.meta.url);
const files = new Map();
const join = (prefix, path) => (prefix + "/" + path).replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
function parse(file) {
  if (files.has(file)) return files.get(file);
  const text = readFileSync(file, "utf8"), source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const imports = new Map(), registrations = [];
  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.startsWith(".")) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) for (const name of bindings.elements)
        imports.set(name.name.text, { file: resolve(dirname(file), node.moduleSpecifier.text + ".ts"), name: name.propertyName?.text ?? name.name.text });
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)) {
      const [path, child] = node.arguments;
      const method = node.expression.name.text;
      if (path && ts.isStringLiteral(path) && ["get","head","post","put","patch","delete","options","route"].includes(method))
        registrations.push({ router: node.expression.expression.text, method, path: path.text, child: child && ts.isIdentifier(child) ? child.text : null, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
    }
    ts.forEachChild(node, visit);
  }
  visit(source); const result = { imports, registrations }; files.set(file, result); return result;
}
function functionExports(path) {
  const text = readFileSync(resolve(root, path), "utf8");
  const compiled = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {}; new Function("exports", "require", compiled)(exports, require); return exports;
}
const { routeCachePolicy } = functionExports("server/src/lib/cache-policy.ts");
const { readCachePolicy } = functionExports("mobile/src/lib/request-policy.ts");
const { portalReadCacheTtl } = functionExports("portal/lib/api-cache-policy.ts");
const routes = new Map();
function walk(file, router, prefix, parents = []) {
  const key = file + ":" + router;
  if (parents.includes(key)) throw new Error("Router mount cycle: " + key);
  const parsed = parse(file);
  for (const registration of parsed.registrations.filter(item => item.router === router)) {
    const path = join(prefix, registration.path);
    if (registration.method === "route") {
      const imported = parsed.imports.get(registration.child);
      walk(imported?.file ?? file, imported?.name ?? registration.child, path, [...parents, key]);
    } else {
      const method = registration.method.toUpperCase(), routeKey = method + " " + path;
      const existing = routes.get(routeKey);
      const source = { file: relative(root, file), line: registration.line };
      if (existing) existing.sources.push(source);
      else routes.set(routeKey, { method, path, sources: [source], ...routeCachePolicy(method,path), mobile: method === "GET" ? readCachePolicy(path) : {freshMs:0,retainMs:0}, portalFreshMs: method === "GET" ? portalReadCacheTtl(path) : 0 });
    }
  }
}
walk(resolve(root,"server/src/app.ts"), "app", "");
const manifest = { version: 1, generatedFrom: "server/src/app.ts and recursively mounted source routers", policies: [...routes.values()].sort((a,b) => (a.path+a.method).localeCompare(b.path+b.method)) };
const output = resolve(root,"docs/cache-route-manifest.json");
const body = JSON.stringify(manifest,null,2) + "\n";
if (process.argv.includes("--check")) { if (readFileSync(output,"utf8") !== body) throw new Error("Cache route manifest is stale. Run node server/scripts/cache-route-manifest.mjs"); }
else writeFileSync(output,body);
console.log(`Verified ${manifest.policies.length} mounted route policies.`);
