import ts from 'typescript';
import { dirname, resolve, sep } from 'node:path';

export interface BoundarySource { fileName: string; source: string; }
export interface BoundaryPackage { name: string; root: string; exports: Record<string, string>; dependencies: string[]; }
export interface BoundaryIssue { fileName: string; ruleId: 'public-boundaries' | 'domain-runtime'; message: string; }

/**
 * Tests live in a single tree that mirrors the product layout, for example
 * `tests/packages/editor/...` for the `packages/editor` module. A test may
 * reach into the internals of the module it exercises, because that is the
 * only layer allowed to observe internals. It may not reach into another
 * module's internals: that stays a cross-package relative import.
 */
export interface TestOwnerMap { testsRoot: string; owners: Record<string, string>; }

export function analyzeImportBoundaries(files: BoundarySource[], packages: BoundaryPackage[], testOwners?: TestOwnerMap): BoundaryIssue[] {
  const issues: BoundaryIssue[] = [];
  const byRoot = [...packages].sort((a, b) => b.root.length - a.root.length);
  const packageFor = (fileName: string) => byRoot.find((pkg) => resolve(fileName).startsWith(`${resolve(pkg.root)}${sep}`));
  const testsRoot = testOwners ? resolve(testOwners.testsRoot) : null;
  const testOwnersByPath = testOwners?.owners ?? {};
  const ownerPackageFor = (fileName: string): BoundaryPackage | null => {
    if (!testsRoot) return null;
    const resolved = resolve(fileName);
    if (!resolved.startsWith(`${testsRoot}${sep}`)) return null;
    const relativeToTests = resolved.slice(testsRoot.length + 1).split(sep);
    const owner = Object.keys(testOwnersByPath)
      .filter((key) => key.split('/').every((segment, index) => relativeToTests[index] === segment))
      .sort((a, b) => b.length - a.length)[0];
    if (!owner) return null;
    const name = testOwnersByPath[owner];
    return packages.find((pkg) => pkg.name === name) ?? null;
  };
  for (const file of files) {
    const importer = packageFor(file.fileName);
    const ownerPackage = ownerPackageFor(file.fileName);
    const isDomain = /^[a-z][a-z0-9-]*\.(?:domain|entity|policy|event)(?:\.public)?\.tsx?$/.test(file.fileName.split(/[\\/]/).at(-1) ?? '');
    const sourceFile = ts.createSourceFile(file.fileName, file.source, ts.ScriptTarget.Latest, true, file.fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    if (((sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? []).length) {
      issues.push({ fileName: file.fileName, ruleId: 'public-boundaries', message: 'TypeScript parse diagnostics' });
      continue;
    }
    const references: string[] = [];
    const visit = (node: ts.Node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) references.push(node.moduleSpecifier.text);
      else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) references.push(node.argument.literal.text);
      else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression && ts.isStringLiteral(node.moduleReference.expression)) references.push(node.moduleReference.expression.text);
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    for (const spec of references) {
      if (isDomain && (/^@office\/(?:runtime|ui-kit)(?:\/|$)/.test(spec) || /^(?:bun:|node:)?(?:fs|path|os|net|http|https|dns|tls|child_process|worker_threads|sqlite|util|crypto|stream|events|buffer)(?:\/|$)/.test(spec) && !spec.startsWith('@'))) issues.push({ fileName: file.fileName, ruleId: 'domain-runtime', message: `domain import ${spec}` });
      if (spec.startsWith('.')) {
        const resolved = resolve(dirname(file.fileName), spec);
        if (ownerPackage) {
          // A test file belongs to the module it exercises. Reaching into that
          // module's own internals is allowed; reaching into another module's
          // internals is not.
          const ownerRoot = resolve(ownerPackage.root);
          if (!resolved.startsWith(`${ownerRoot}${sep}`) && byRoot.some((pkg) => pkg.name !== ownerPackage.name && resolved.startsWith(`${resolve(pkg.root)}${sep}`))) issues.push({ fileName: file.fileName, ruleId: 'public-boundaries', message: `cross-package relative import ${spec}` });
          continue;
        }
        if (importer && byRoot.some((pkg) => pkg !== importer && resolved.startsWith(`${resolve(pkg.root)}${sep}`))) issues.push({ fileName: file.fileName, ruleId: 'public-boundaries', message: `cross-package relative import ${spec}` });
        else if (importer && resolve(dirname(file.fileName), spec).startsWith(`${resolve(importer.root, 'src')}${sep}`) && spec.split(/[\\/]/).includes('src')) issues.push({ fileName: file.fileName, ruleId: 'public-boundaries', message: `package source path ${spec}` });
        continue;
      }
      const target = packages.find((pkg) => spec === pkg.name || spec.startsWith(`${pkg.name}/`));
      if (!target || target === importer) continue;
      const subpath = spec === target.name ? '.' : `./${spec.slice(target.name.length + 1)}`;
      if (!Object.hasOwn(target.exports, subpath)) issues.push({ fileName: file.fileName, ruleId: 'public-boundaries', message: `unexported package path ${spec}` });
      if (ownerPackage) {
        // A test file may import any exported subpath of any module; the
        // dependency declaration belongs to the module under test.
        continue;
      }
      if (importer && !importer.dependencies.includes(target.name)) issues.push({ fileName: file.fileName, ruleId: 'public-boundaries', message: `undeclared dependency ${target.name}` });
      if (/\/src\//.test(spec)) issues.push({ fileName: file.fileName, ruleId: 'public-boundaries', message: `package source path ${spec}` });
      if (/\/ui(?:\/|$)/.test(subpath) && importer?.name.endsWith('/service')) issues.push({ fileName: file.fileName, ruleId: 'public-boundaries', message: `service imports UI ${spec}` });
      if (/\/service(?:\/|$)/.test(subpath) && importer?.name.endsWith('/ui-kit')) issues.push({ fileName: file.fileName, ruleId: 'public-boundaries', message: `UI imports service ${spec}` });
      if (importer?.name.endsWith('/web') && /\/service(?:\/|$)/.test(subpath) && !['@office/files', '@office/providers'].includes(target.name)) issues.push({ fileName: file.fileName, ruleId: 'public-boundaries', message: `UI imports service ${spec}` });
    }
  }
  return issues;
}
