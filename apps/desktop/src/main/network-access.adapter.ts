import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { bundledResourcesDir, bundledServiceExecutable } from './paths.adapter'

export type NetworkAccessStatus = {
  prepared: boolean
  elevated: boolean
  programs: string[]
  detail: string
}

function resourcePrograms(): string[] {
  const programs: string[] = []
  programs.push(process.execPath)
  const resources = bundledResourcesDir()
  const service = bundledServiceExecutable()
  if (existsSync(service)) programs.push(service)
  const search = join(
    resources,
    'workers',
    'web-search',
    process.platform === 'win32' ? 'air-office-web-search.exe' : 'air-office-web-search',
  )
  if (existsSync(search)) programs.push(search)
  return [...new Set(programs)]
}

function ruleNameFor(program: string): string {
  const stem = program.split(/[/\\]/).pop()?.replace(/\.(exe|dll)$/i, '') ?? 'air-office'
  return `AIR Office ${stem}`
}

async function ruleExists(name: string): Promise<boolean> {
  return await new Promise((resolve) => {
    const child = spawn('netsh', ['advfirewall', 'firewall', 'show', 'rule', `name=${name}`], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    let out = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8')
    })
    child.on('close', (code) => {
      resolve(code === 0 && !out.includes('No rules match'))
    })
    child.on('error', () => resolve(false))
  })
}

async function addRule(program: string): Promise<boolean> {
  const name = ruleNameFor(program)
  if (await ruleExists(name)) return true
  return await new Promise((resolve) => {
    const child = spawn(
      'netsh',
      [
        'advfirewall',
        'firewall',
        'add',
        'rule',
        `name=${name}`,
        'dir=out',
        'action=allow',
        'profile=any',
        `program=${program}`,
        'enable=yes',
      ],
      { windowsHide: true, stdio: 'ignore' },
    )
    child.on('close', (code) => resolve(code === 0))
    child.on('error', () => resolve(false))
  })
}

export async function ensureWindowsNetworkAccess(): Promise<NetworkAccessStatus> {
  if (process.platform !== 'win32') {
    return { prepared: true, elevated: false, programs: [], detail: 'Not required on this platform.' }
  }
  const programs = resourcePrograms()
  let prepared = true
  for (const program of programs) {
    if (!(await addRule(program))) prepared = false
  }
  return {
    prepared,
    elevated: false,
    programs,
    detail: prepared
      ? 'Windows Firewall allow rules were registered for AIR Office helpers.'
      : 'Some Windows Firewall rules could not be registered without elevation.',
  }
}
