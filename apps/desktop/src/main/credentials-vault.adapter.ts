import { safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { officeProfileRoot } from './paths.adapter'

type VaultFile = {
  version: 1
  entries: Record<string, string>
}

function vaultPath(profile: 'Data' | 'Demo' = 'Data'): string {
  return join(officeProfileRoot(profile), 'private', 'credentials-vault.json')
}

function entryKey(service: string, account: string): string {
  return `${service}\0${account}`
}

function readVault(profile: 'Data' | 'Demo' = 'Data'): VaultFile {
  const path = vaultPath(profile)
  if (!existsSync(path)) return { version: 1, entries: {} }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as VaultFile
    if (parsed?.version !== 1 || typeof parsed.entries !== 'object' || !parsed.entries) {
      return { version: 1, entries: {} }
    }
    return parsed
  } catch {
    return { version: 1, entries: {} }
  }
}

function writeVault(vault: VaultFile, profile: 'Data' | 'Demo' = 'Data'): void {
  const path = vaultPath(profile)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(vault)}\n`, { mode: 0o600 })
}

function encrypt(secret: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    return Buffer.from(secret, 'utf8').toString('base64')
  }
  return safeStorage.encryptString(secret).toString('base64')
}

function decrypt(payload: string): string {
  const bytes = Buffer.from(payload, 'base64')
  if (!safeStorage.isEncryptionAvailable()) {
    return bytes.toString('utf8')
  }
  return safeStorage.decryptString(bytes)
}

export function vaultRead(service: string, account: string, profile: 'Data' | 'Demo' = 'Data'): string | null {
  const vault = readVault(profile)
  const encoded = vault.entries[entryKey(service, account)]
  if (!encoded) return null
  try {
    const secret = decrypt(encoded)
    return secret.length > 0 ? secret : null
  } catch {
    return null
  }
}

export function vaultExists(service: string, account: string, profile: 'Data' | 'Demo' = 'Data'): boolean {
  const vault = readVault(profile)
  return Boolean(vault.entries[entryKey(service, account)])
}

export function vaultWrite(service: string, account: string, secret: string, profile: 'Data' | 'Demo' = 'Data'): boolean {
  if (!secret) return false
  const vault = readVault(profile)
  vault.entries[entryKey(service, account)] = encrypt(secret)
  writeVault(vault, profile)
  return true
}

export function vaultDelete(service: string, account: string, profile: 'Data' | 'Demo' = 'Data'): boolean | 'absent' {
  const vault = readVault(profile)
  const key = entryKey(service, account)
  if (!(key in vault.entries)) return 'absent'
  delete vault.entries[key]
  writeVault(vault, profile)
  return true
}
