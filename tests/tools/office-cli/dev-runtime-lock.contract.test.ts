import { describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claimOwnerLock, DEFAULT_CONTEXT_TOKENS, initializeConfig, insideRoot, reclaimLocalAiOwnership } from '../../../tools/dev-runtime.adapter';

async function lockFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'owner-lock-'));
  const lock = join(root, 'owner.lock');
  await mkdir(lock, { recursive: true });
  return lock;
}

describe('local AI owner lock', () => {
  it('claims an unused lock', async () => {
    const lock = await lockFixture();
    try {
      claimOwnerLock(lock);
      expect(claimOwnerLock(lock)).toBeUndefined();
    } finally {
      await rm(lock, { recursive: true, force: true });
      await rm(join(lock, '..'), { recursive: true, force: true });
    }
  });

  it('reclaims a lock whose owner is gone, so a killed run cannot block the next one', async () => {
    const lock = await lockFixture();
    try {
      // A process id that cannot be running: the previous run was killed
      // rather than stopped, and left its lock behind.
      await writeFile(join(lock, 'owner.pid'), '2147483646', 'utf8');
      expect(() => claimOwnerLock(lock)).not.toThrow();
    } finally {
      await rm(lock, { recursive: true, force: true });
      await rm(join(lock, '..'), { recursive: true, force: true });
    }
  });

  it('refuses a lock whose owner is still running', async () => {
    const lock = await lockFixture();
    try {
      await writeFile(join(lock, 'owner.pid'), String(process.pid), 'utf8');
      expect(() => claimOwnerLock(lock, process.pid + 1)).toThrow(/already owned/);
    } finally {
      await rm(lock, { recursive: true, force: true });
      await rm(join(lock, '..'), { recursive: true, force: true });
    }
  });

  it('records the owning process so a later run can recognise a stale lock', async () => {
    const lock = await lockFixture();
    try {
      claimOwnerLock(lock, 4242);
      const recorded = await Bun.file(join(lock, 'owner.pid')).text();
      expect(recorded.trim()).toBe('4242');
    } finally {
      await rm(lock, { recursive: true, force: true });
      await rm(join(lock, '..'), { recursive: true, force: true });
    }
  });

  it('reclaimLocalAiOwnership kills a live previous owner then clears the lock (newest bun run wins)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'air-reclaim-ai-'));
    const lock = join(root, 'models', 'owner.lock');
    await mkdir(lock, { recursive: true });
    const previousOwner = 424242;
    await writeFile(join(lock, 'owner.pid'), String(previousOwner), 'utf8');
    const killed: number[] = [];
    try {
      const label = await reclaimLocalAiOwnership(root, {
        isAlive: (pid) => pid === previousOwner,
        killTree: async (pid) => { killed.push(pid); }
      });
      expect(label).toContain(String(previousOwner));
      expect(killed).toEqual([previousOwner]);
      expect(await Bun.file(join(lock, 'owner.pid')).exists()).toBe(false);
      expect(() => claimOwnerLock(lock, process.pid + 99)).not.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

/**
 * The orphan sweep must only ever terminate executables that live inside this
 * workspace's own data directory. A lemond or llama-server a user installed
 * elsewhere, or one an attached runtime owns, is never touched — so the
 * boundary the reaper relies on has to be exact, never a loose prefix.
 */
describe('runtime orphan boundary', () => {
  it('accepts an executable inside the data root', () => {
    expect(insideRoot(join('data'), join('data', 'models', 'state', 'bin', 'llama-server.exe'))).toBe(true);
  });

  it('rejects an executable outside the data root', () => {
    expect(insideRoot(join('data'), join('other', 'lemonade', 'lemond.exe'))).toBe(false);
  });

  it('rejects a sibling directory that merely shares a name prefix', () => {
    // `data-backup` starts with `data` but is not inside it; a naive prefix
    // match would wrongly reap it.
    expect(insideRoot(join('data'), join('data-backup', 'lemond.exe'))).toBe(false);
  });
});

/**
 * A model file carries its own small context window, which is too narrow for
 * a workspace: the retrieved knowledge, the conversation and the answer have
 * to fit together. A window the user chose is never overwritten.
 */
describe('local AI context window default', () => {
  it('gives a fresh configuration a workspace sized window', async () => {
    const root = await mkdtemp(join(tmpdir(), 'air-context-'));
    try {
      initializeConfig(join(root, 'state'), join(root, 'models'));
      const config = JSON.parse(await readFile(join(root, 'state', 'config.json'), 'utf8')) as { ctx_size: number };
      expect(config.ctx_size).toBe(DEFAULT_CONTEXT_TOKENS);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('leaves a window the user chose alone', async () => {
    const root = await mkdtemp(join(tmpdir(), 'air-context-'));
    try {
      await mkdir(join(root, 'state'), { recursive: true });
      await writeFile(join(root, 'state', 'config.json'), JSON.stringify({ ctx_size: 4096 }));
      initializeConfig(join(root, 'state'), join(root, 'models'));
      const config = JSON.parse(await readFile(join(root, 'state', 'config.json'), 'utf8')) as { ctx_size: number };
      expect(config.ctx_size).toBe(4096);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('replaces the model-native sentinel with the workspace window', async () => {
    const root = await mkdtemp(join(tmpdir(), 'air-context-'));
    try {
      await mkdir(join(root, 'state'), { recursive: true });
      await writeFile(join(root, 'state', 'config.json'), JSON.stringify({ ctx_size: -1 }));
      initializeConfig(join(root, 'state'), join(root, 'models'));
      const config = JSON.parse(await readFile(join(root, 'state', 'config.json'), 'utf8')) as { ctx_size: number };
      expect(config.ctx_size).toBe(DEFAULT_CONTEXT_TOKENS);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
