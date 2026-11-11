/**
 * Export service ports. The bundle side assembles a verifiable payload; the
 * import side validates before writing and reports every rejection reason.
 */
import type { WorkspaceBundle, ImportReport } from '@office/contracts/export';
import type { ExportSources } from './file/file.exports.public';
import type { RestoredWorkspace } from './file/bundle.policy';

export interface ExportsService {
  exportWorkspace(): Promise<WorkspaceBundle>;
  importBundle(raw: string): Promise<{ report: ImportReport; restored: RestoredWorkspace | null }>;
}
