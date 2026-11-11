import type { FileSnapshot } from '@office/contracts/file';
import type { FilesystemTarget } from '@office/files/domain';
import { externalFileId } from '@office/files/domain';
import type { ServiceClient } from './service-client.hook';

export { externalFileId, externalFileTarget } from '@office/files/domain';
export function createExplorerFileClient(client: ServiceClient) {
  const path = (target: FilesystemTarget) => `/api/v1/external/text?${new URLSearchParams({ ...target })}`;
  const identify = (target: FilesystemTarget, file: FileSnapshot): FileSnapshot => ({ ...file, id: externalFileId(target) });
  return {
    async read(target: FilesystemTarget) { return identify(target, (await client.json<{ file: FileSnapshot }>(path(target))).file); },
    async save(target: FilesystemTarget, content: string, expectedVersion: string) { return identify(target, (await client.json<{ file: FileSnapshot }>(path(target), { method: 'PUT', body: JSON.stringify({ content, expectedVersion }) })).file); }
  };
}
