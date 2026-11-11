import { describe, expect, it } from 'bun:test';
import { analyzeImportBoundaries, type BoundaryPackage } from '../../../tools/office-cli/src/import-boundary.analyzer';

const packages: BoundaryPackage[] = [
  { name: '@office/domain', root: 'C:/fixture/packages/domain', exports: { './domain': './src/domain.domain.public.ts' }, dependencies: [] },
  { name: '@office/ui-kit', root: 'C:/fixture/packages/ui-kit', exports: { './ui': './src/ui-kit.ui.public.ts' }, dependencies: [] },
  { name: '@office/app', root: 'C:/fixture/packages/app', exports: {}, dependencies: ['@office/domain', '@office/ui-kit'] },
  { name: '@office/web', root: 'C:/fixture/apps/app', exports: {}, dependencies: ['@office/domain', '@office/ui-kit'] },
];
const file = (path: string, source: string) => ({ fileName: `C:/fixture/${path}`, source });
const check = (path: string, source: string) => analyzeImportBoundaries([file(path, source)], packages);

describe('import boundary analyzer', () => {
  it('rejects forbidden forms with the expected rule IDs', () => {
    for (const [path, source, ruleId] of [
      ['packages/app/src/a.composition.ts', "import type { X } from '@office/domain/src/private';", 'public-boundaries'],
      ['packages/app/src/a.composition.ts', "export type { X } from '@office/domain/private';", 'public-boundaries'],
      ['packages/app/src/a.composition.ts', "type X = import('@office/domain/private').X;", 'public-boundaries'],
      ['packages/app/src/a.composition.ts', "import X = require('@office/domain/private');", 'public-boundaries'],
      ['packages/app/src/a.composition.ts', "import '../../domain/src/internal';", 'public-boundaries'],
      ['packages/domain/src/rules.domain.ts', "import type { Runtime } from '@office/runtime/service';", 'domain-runtime'],
      ['packages/domain/src/rules.domain.ts', "export type { Stats } from 'node:fs';", 'domain-runtime'],
      ['packages/domain/src/rules.domain.ts', "type Data = import('https').RequestOptions;", 'domain-runtime'],
    ] as const) {
      const issues = check(path, source);
      expect(issues.some((issue) => issue.ruleId === ruleId), `${source} should trigger ${ruleId}`).toBe(true);
    }
  });

  it('allows declared public imports and rejects malformed syntax', () => {
    expect(check('apps/app/src/main.composition.ts', "import type { X } from '@office/domain/domain';")).toEqual([]);
    expect(check('apps/app/src/main.composition.ts', "import { X } from '@office/ui-kit/ui';")).toEqual([]);
    expect(check('apps/app/src/main.composition.ts', "import { X } from '@office/domain/domain';")).toEqual([]);
    expect(check('apps/app/src/main.composition.ts', 'import {').some((issue) => issue.ruleId === 'public-boundaries')).toBe(true);
  });

  it('rejects forbidden worker and database coupling with the expected rule IDs', () => {
    for (const [path, source, ruleId] of [
      ['packages/documents/src/extraction.entity.ts', "import { Database } from 'bun:sqlite';", 'domain-runtime'],
      ['packages/knowledge/src/chunk.entity.ts', "import { readFile } from 'node:fs';", 'domain-runtime'],
      ['packages/knowledge/src/retrieval.adapter.ts', "import type { Job } from '@office/domain/src/job-store.adapter';", 'public-boundaries'],
      ['packages/jobs/src/lease.adapter.ts', "import { createDocumentsService } from '@office/domain/src/private';", 'public-boundaries']
    ] as const) {
      const issues = check(path, source);
      expect(issues.some((issue) => issue.ruleId === ruleId), `${source} should trigger ${ruleId}`).toBe(true);
    }
  });
});
