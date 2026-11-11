import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { appDataDir, officeProfileRoot } from './paths.adapter'

export type Layout = {
  workspace: string
  files: string
  localAi: string
  private: string
  public: string
  models: string
  cache: string
}

export function storageConfigPath(): string {
  return path.join(appDataDir(), 'storage-location.json')
}

function emptyPath(): string {
  return ''
}

function asAbsolute(value: unknown): string {
  return typeof value === 'string' ? value : emptyPath()
}

export function paths(): Layout {
  const configPath = storageConfigPath()
  if (fs.existsSync(configPath)) {
    let record: unknown
    try {
      record = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    } catch {
      throw new Error('Storage settings could not be read.')
    }
    const active =
      record && typeof record === 'object' && record !== null && 'active' in record
        ? (record as { active: unknown }).active
        : undefined
    if (!active || typeof active !== 'object' || active === null) {
      throw new Error('Storage settings are invalid.')
    }
    const row = active as Record<string, unknown>
    const layout: Layout = {
      workspace: asAbsolute(row.workspace),
      files: asAbsolute(row.files),
      localAi: asAbsolute(row.localAi ?? row.local_ai),
      private: asAbsolute(row.private),
      public: asAbsolute(row.public),
      models: asAbsolute(row.models),
      cache: asAbsolute(row.cache),
    }
    if (!layout.private) {
      layout.private = path.dirname(layout.workspace) || ''
    }
    if (!layout.public) {
      layout.public = layout.private
        ? path.join(path.dirname(layout.private), 'public')
        : ''
    }
    if (!layout.models) {
      layout.models = layout.localAi
    }
    if (!layout.cache) {
      layout.cache = layout.private
        ? path.join(path.dirname(layout.private), 'cache')
        : ''
    }
    const required = [
      layout.workspace,
      layout.files,
      layout.localAi,
      layout.private,
      layout.public,
      layout.models,
      layout.cache,
    ]
    if (required.some((entry) => !entry || !path.isAbsolute(entry))) {
      throw new Error('Storage folders must be absolute paths.')
    }
    layout.localAi = layout.models
    return layout
  }

  const root = officeProfileRoot('Data')
  const privateRoot = path.join(root, 'private')
  const models = path.join(root, 'models')
  return {
    private: privateRoot,
    public: path.join(root, 'public'),
    models,
    cache: path.join(root, 'cache'),
    files: path.join(privateRoot, 'files'),
    workspace: path.join(privateRoot, 'workspace'),
    localAi: models,
  }
}

/** Parent of the models folder — Lemonade runtime storage root. */
export function dataDir(): string {
  const layout = paths()
  const parent = path.dirname(layout.localAi)
  if (!parent) {
    throw new Error('Local AI storage is invalid.')
  }
  return parent
}

export async function prepareStorage(executable: string): Promise<void> {
  const layout = paths()
  const dataRoot = path.dirname(layout.private) || layout.private
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OFFICE_STORAGE_CONFIG: storageConfigPath(),
    OFFICE_DATA_ROOT: dataRoot,
    OFFICE_RUNTIME_DIR: layout.workspace,
    OFFICE_FILES_ROOT: layout.files,
    OFFICE_DEFAULT_LOCAL_AI_DIR: layout.models,
    OFFICE_LEMONADE_MODELS_DIR: layout.models,
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, ['--prepare-storage'], {
      env,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.on('error', () => {
      reject(new Error('Storage preparation could not start.'))
    })
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(
        new Error(
          'The storage folder changed. Restart AIR Office to apply the selected location.',
        ),
      )
    })
  })
}
