import { describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkStyles } from '../../../tools/office-cli/src/style-check.command';

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'style-check-'));
  await mkdir(join(root, 'architecture'), { recursive: true });
  await mkdir(join(root, 'tools'), { recursive: true });
  await writeFile(join(root, 'tools/role.catalog.json'), JSON.stringify({
    non_typescript_patterns: { styles: '^[a-z0-9-]+\\.(?:styles|tokens)\\.css$' },
  }), 'utf8');
  for (const [path, source] of Object.entries(files)) {
    const target = join(root, path);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, source, 'utf8');
  }
  return root;
}

const manifest = [
  "@import '@office/ui-kit/styles';",
  "@import '@office/ui-kit/base';",
  "@import '../shared/application.styles.css';",
  "@import '../shared/glass.styles.css';",
  "@import '@office/ui-kit/frost';",
].join('\n');

const validFiles: Record<string, string> = {
  'packages/ui-kit/src/ui-kit.tokens.css': ':root { --surface-raised: #fff; --text-body: #44515f; }',
  'packages/ui-kit/src/ui-kit-base.styles.css': '.prose { color: var(--text-body); }',
  'apps/web/src/entry/styles-manifest.styles.css': manifest,
  'apps/web/src/shared/application.styles.css': '.panel { color: var(--text-body); }',
  'apps/web/src/shared/glass.styles.css': '.lg-surface { color: var(--text-body); }',
  'packages/ui-kit/src/ui-kit-frost.styles.css': '.ui-frost { color: var(--text-body); }',
  'apps/web/src/chat/branch-overview.styles.css': '.react-aria-CalendarCell { color: var(--text-body); } .react-flow__controls { color: var(--text-body); }',
};

describe('style checker', () => {
  it('accepts a compliant stylesheet set', async () => {
    const root = await fixture(validFiles);
    try {
      expect(await checkStyles(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a stylesheet whose name does not match the declared role', async () => {
    const root = await fixture({ ...validFiles, 'apps/web/src/shared/BadName.css': '.x { color: red; }' });
    try {
      const issues = await checkStyles(root);
      expect(issues.some((issue) => issue.rule === 'style-name')).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a custom property that is never defined', async () => {
    const root = await fixture({ ...validFiles, 'apps/web/src/shared/application.styles.css': '.panel { color: var(--never-defined); }' });
    try {
      const issues = await checkStyles(root);
      const issue = issues.find((entry) => entry.rule === 'undefined-property');
      expect(issue).toBeDefined();
      expect(issue?.message).toContain('--never-defined');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('accepts a custom property that is provided at runtime', async () => {
    const root = await fixture({ ...validFiles, 'apps/web/src/shared/application.styles.css': '.panel { color: var(--depth); }' });
    try {
      const issues = await checkStyles(root);
      expect(issues.some((issue) => issue.rule === 'undefined-property')).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects two files that set the same class property to different values', async () => {
    const root = await fixture({
      ...validFiles,
      'apps/web/src/shared/application.styles.css': '.panel { color: var(--text-body); }',
      'apps/web/src/shared/other.styles.css': '.panel { color: var(--text-strong); }',
    });
    try {
      const issues = await checkStyles(root);
      const issue = issues.find((entry) => entry.rule === 'conflicting-class');
      expect(issue).toBeDefined();
      expect(issue?.message).toContain('.panel');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('accepts a class that two files merely extend', async () => {
    const root = await fixture({
      ...validFiles,
      'apps/web/src/shared/application.styles.css': '.panel { color: var(--text-body); }',
      'apps/web/src/shared/other.styles.css': '.panel { padding: 8px; }',
    });
    try {
      const issues = await checkStyles(root);
      expect(issues.some((issue) => issue.rule === 'conflicting-class')).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a manifest that imports the component styles before the shared base', async () => {
    const root = await fixture({
      ...validFiles,
      'apps/web/src/entry/styles-manifest.styles.css': [
        "@import '@office/ui-kit/styles';",
        "@import '../shared/application.styles.css';",
        "@import '@office/ui-kit/base';",
        "@import '../shared/glass.styles.css';",
        "@import '@office/ui-kit/frost';",
      ].join('\n'),
    });
    try {
      const issues = await checkStyles(root);
      expect(issues.some((issue) => issue.rule === 'import-order')).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a manifest that does not import UI-kit frost last', async () => {
    const root = await fixture({
      ...validFiles,
      'apps/web/src/entry/styles-manifest.styles.css': [
        "@import '@office/ui-kit/styles';",
        "@import '@office/ui-kit/base';",
        "@import '@office/ui-kit/frost';",
        "@import '../shared/glass.styles.css';",
      ].join('\n'),
    });
    try {
      const issues = await checkStyles(root);
      expect(issues.some((issue) => issue.rule === 'import-order')).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a manifest that imports tailwindcss after the shared base', async () => {
    const root = await fixture({
      ...validFiles,
      'apps/web/src/entry/styles-manifest.styles.css': [
        "@import '@office/ui-kit/styles';",
        "@import '@office/ui-kit/base';",
        "@import 'tailwindcss';",
        "@import '@heroui/styles';",
        "@import '../shared/heroui-bridge.styles.css';",
        "@import '../shared/application.styles.css';",
        "@import '../shared/glass.styles.css';",
        "@import '@office/ui-kit/frost';",
      ].join('\n'),
    });
    try {
      const issues = await checkStyles(root);
      expect(issues.some((issue) => issue.rule === 'import-order')).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a manifest that imports the glass stylesheet before @heroui/styles', async () => {
    const root = await fixture({
      ...validFiles,
      'apps/web/src/entry/styles-manifest.styles.css': [
        "@import '@office/ui-kit/styles';",
        "@import 'tailwindcss';",
        "@import '@heroui/styles';",
        "@import '../shared/glass.styles.css';",
        "@import '@office/ui-kit/base';",
        "@import '../shared/application.styles.css';",
        "@import '@office/ui-kit/frost';",
      ].join('\n'),
    });
    try {
      const issues = await checkStyles(root);
      expect(issues.some((issue) => issue.rule === 'import-order')).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a missing stylesheet manifest', async () => {
    const files = { ...validFiles };
    delete files['apps/web/src/entry/styles-manifest.styles.css'];
    const root = await fixture(files);
    try {
      const issues = await checkStyles(root);
      expect(issues.some((issue) => issue.rule === 'import-order')).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a library surface that no stylesheet defines', async () => {
    const files = { ...validFiles };
    delete files['apps/web/src/chat/branch-overview.styles.css'];
    const root = await fixture(files);
    try {
      const issues = await checkStyles(root);
      expect(issues.some((issue) => issue.rule === 'unstyled-library')).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
