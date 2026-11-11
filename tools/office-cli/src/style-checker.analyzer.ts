/**
 * Style hygiene checks for the CSS the repository owns.
 *
 * These are rules that could silently break and that no compiler catches:
 * an undefined custom property renders as transparent or inherited, a class
 * defined in two files makes the winner depend on import order, and a library
 * surface left unstyled falls back to browser defaults.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

export type StyleIssue = { file: string; rule: string; message: string };

/** Custom properties that are written at runtime by TypeScript, not by CSS. */
export const RUNTIME_PROPERTIES = new Set([
  '--anchor-width',
  '--available-height',
  '--chat-composer-height',
  '--connector-color',
  '--depth',
  '--editor-block-gutter',
]);

/**
 * Class prefixes that a third-party library renders. A surface we render but
 * never style shows the browser's defaults, so each must appear in our CSS.
 */
const LIBRARY_PREFIXES = ['react-aria-', 'react-flow__', 'lg-'];

async function styleFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  for (const base of ['apps', 'packages', 'tools', 'tests']) {
    const directory = join(root, base);
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const nested = await styleFiles(join(directory, entry.name));
      for (const file of nested) if (file.endsWith('.css')) found.push(file);
    }
  }
  return found;
}

async function allStyleFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'target') continue;
        await walk(join(directory, entry.name));
        continue;
      }
      if (entry.name.endsWith('.css')) found.push(join(directory, entry.name));
    }
  };
  for (const base of ['apps', 'packages', 'tools', 'tests']) await walk(join(root, base));
  return found;
}

function definedProperties(source: string): Set<string> {
  const found = new Set<string>();
  for (const match of source.matchAll(/(--[a-z0-9-]+)\s*:/g)) found.add(match[1]);
  return found;
}

function usedProperties(source: string): Map<string, number[]> {
  const used = new Map<string, number[]>();
  const lines = source.split('\n');
  lines.forEach((line, index) => {
    for (const match of line.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
      const list = used.get(match[1]) ?? [];
      list.push(index + 1);
      used.set(match[1], list);
    }
  });
  return used;
}

/**
 * Layer files whose purpose is to override what other files define. A class
 * appearing in one of them and a component file is the intended override
 * pattern, not a collision.
 */
const OVERRIDE_LAYERS = ['ui-kit.tokens.css', 'ui-kit.base.styles.css', 'glass.styles.css'];

/**
 * State modifiers are contextual by nature: `.is-selected` means something
 * different in every list that uses it, so two files using it is not a clash.
 */
function isStateModifier(name: string): boolean {
  return /^(is|has|js)-/.test(name);
}

/** Class selectors that the file itself defines, ignoring nested and pseudo forms. */
function definedClasses(source: string): Set<string> {
  const found = new Set<string>();
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import[^;]+;/g, '');
  for (const match of withoutComments.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
    if (!isStateModifier(match[1])) found.add(match[1]);
  }
  return found;
}

/**
 * The declarations a class makes, with the value of each property. A class may
 * legitimately be extended by several files, but two files setting the same
 * property to different values is a real conflict: the winner depends on
 * import order.
 *
 * Only a standalone class selector counts. A descendant rule such as
 * `.panel p { margin: 0 }` is that rule's own business, and a state rule such
 * as `.button:hover` is an intentional override of the resting value.
 */
function classDeclarations(source: string): Map<string, Map<string, string>> {
  const declarations = new Map<string, Map<string, string>>();
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const blockPattern = /([^{}]+)\{([^{}]*)\}/g;
  for (const block of withoutComments.matchAll(blockPattern)) {
    const selectors = block[1].trim();
    const body = block[2];
    // Only a rule whose selector is exactly one class, with no state or part.
    const single = /^\.(-?[_a-zA-Z][\w-]*)$/.exec(selectors);
    if (!single) continue;
    const name = single[1];
    if (isStateModifier(name)) continue;
    const properties = new Map<string, string>();
    for (const declaration of body.split(';')) {
      const match = declaration.match(/^\s*([a-z-]+)\s*:\s*(.+?)\s*$/i);
      if (match) properties.set(match[1], match[2].replace(/\s+/g, ' '));
    }
    if (!properties.size) continue;
    const existing = declarations.get(name) ?? new Map<string, string>();
    for (const [property, value] of properties) {
      const previous = existing.get(property);
      if (previous === undefined) existing.set(property, value);
      else if (previous !== value) existing.set(property, `${previous} || ${value}`);
    }
    declarations.set(name, existing);
  }
  return declarations;
}

export async function checkStyles(root: string): Promise<StyleIssue[]> {
  const issues: StyleIssue[] = [];
  const files = await allStyleFiles(root);
  const rel = (file: string) => relative(root, file).split(sep).join('/');

  const sources = new Map<string, string>();
  for (const file of files) sources.set(file, await readFile(file, 'utf8'));

  // 1. The declared naming rule for styles. The role catalog already states it;
  //    this is where it is actually applied.
  const catalog = JSON.parse(await readFile(join(root, 'tools/role.catalog.json'), 'utf8')) as {
    non_typescript_patterns?: Record<string, string>;
  };
  const stylePattern = catalog.non_typescript_patterns?.styles ? new RegExp(catalog.non_typescript_patterns.styles) : null;
  if (stylePattern) {
    for (const file of files) {
      const name = file.split(sep).at(-1)!;
      if (!stylePattern.test(name)) issues.push({ file: rel(file), rule: 'style-name', message: `filename does not match the declared styles role (${name})` });
    }
  }

  // 2. Undefined custom properties. A var() with no definition resolves to the
  //    fallback or to nothing, so the property silently loses its effect.
  const globalDefined = new Set<string>();
  for (const source of sources.values()) for (const name of definedProperties(source)) globalDefined.add(name);
  for (const [file, source] of sources) {
    for (const [name, lines] of usedProperties(source)) {
      if (globalDefined.has(name) || RUNTIME_PROPERTIES.has(name)) continue;
      issues.push({ file: rel(file), rule: 'undefined-property', message: `var(${name}) is never defined (line ${lines.join(', ')})` });
    }
  }

  // 3. Two DIFFERENT files setting the same property of the same class to
  //    different values is a real conflict: the winner depends on import
  //    order. Repeating a class inside one file is a responsive or state
  //    override and is that file's own business.
  const owners = new Map<string, Map<string, Map<string, string>>>();
  for (const [file, source] of sources) {
    const name = file.split(sep).at(-1)!;
    if (OVERRIDE_LAYERS.includes(name)) continue;
    for (const [className, properties] of classDeclarations(source)) {
      const byFile = owners.get(className) ?? new Map<string, Map<string, string>>();
      const existing = byFile.get(rel(file)) ?? new Map<string, string>();
      for (const [property, value] of properties) existing.set(property, value);
      byFile.set(rel(file), existing);
      owners.set(className, byFile);
    }
  }
  for (const [name, byFile] of owners) {
    if (byFile.size < 2) continue;
    for (const [property, values] of (() => {
      const all = new Map<string, Map<string, string>>();
      for (const [file, properties] of byFile) {
        for (const [property_, value] of properties) {
          const list = all.get(property_) ?? new Map<string, string>();
          list.set(file, value);
          all.set(property_, list);
        }
      }
      return all;
    })()) {
      const distinct = new Set(values.values());
      if (distinct.size < 2) continue;
      issues.push({ file: [...values.keys()][0], rule: 'conflicting-class', message: `.${name} sets ${property} to conflicting values (${[...values].map(([file, value]) => `${value} in ${file}`).join('; ')})` });
    }
  }

  // 4. The app stylesheet manifest must keep a deterministic order: the base
  //    before the component styles, and the glass composition last.
  const manifest = join(root, 'apps/web/src/styles.entry.styles.css');
  if (await Bun.file(manifest).exists()) {
    const source = await readFile(manifest, 'utf8');
    const order = [...source.matchAll(/@import\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
    const position = (needle: string) => order.findIndex((entry) => entry.includes(needle));
    const base = position('@office/ui-kit/base');
    const application = position('application.styles.css');
    const glass = position('glass.styles.css');
    if (base < 0) issues.push({ file: rel(manifest), rule: 'import-order', message: 'the shared base is not imported' });
    if (application >= 0 && base >= 0 && application < base) issues.push({ file: rel(manifest), rule: 'import-order', message: 'the component styles are imported before the shared base' });
    if (glass >= 0 && glass !== order.length - 1) issues.push({ file: rel(manifest), rule: 'import-order', message: 'the glass stylesheet must be imported last' });
  } else {
    issues.push({ file: 'apps/web/src/styles.entry.styles.css', rule: 'import-order', message: 'the app stylesheet manifest is missing' });
  }

  // 5. A library surface we render must be styled by us, so it never shows
  //    browser defaults.
  const allClasses = new Set<string>();
  for (const source of sources.values()) for (const name of definedClasses(source)) allClasses.add(name);
  for (const prefix of LIBRARY_PREFIXES) {
    const styled = [...allClasses].some((name) => name.startsWith(prefix));
    if (!styled) issues.push({ file: 'apps/web/src', rule: 'unstyled-library', message: `no style is defined for the library surface "${prefix}*"` });
  }

  return issues;
}
