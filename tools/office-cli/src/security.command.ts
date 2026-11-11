import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';

const root = resolve(import.meta.dir, '../../..');
const securityDir = join(root, 'security');
const pinManifestPath = join(securityDir, 'pin-manifest.json');

/** Required-scanner outcomes from 08-security.plan.md. Only `pass` satisfies the gate. */
type ScannerOutcome = 'pass' | 'blocked' | 'failed' | 'unavailable' | 'incomplete';

interface PinTool {
  version: string;
  source: string;
  install_method: string;
  sha256: string;
  verify?: string;
}

interface PinManifest {
  schema_version: number;
  updated: string;
  tools: Record<string, PinTool>;
}

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
  missing: boolean;
  timedOut: boolean;
}

interface ScannerResult {
  name: string;
  findings: unknown[];
  outcome: ScannerOutcome;
  detail?: string;
}

const BINARY_NAMES: Record<string, string> = {
  trufflehog: 'trufflehog',
  trivy: 'trivy',
  semgrep: 'semgrep',
  codeql: 'codeql',
  skillspector: 'skillspector',
};

const SEMGREP_RULES_DIR = join(securityDir, 'semgrep-rules');
const SEMGREP_RULES_PIN_PATH = join(SEMGREP_RULES_DIR, 'PIN.json');
const LAB_SKILLS_DIR = join(root, 'packages/lab-pack/data/skills');

const SHA256_HEX = /^[a-f0-9]{64}$/i;
const secretFindingReviewSchema = z.object({
  fingerprint: z.string().regex(SHA256_HEX),
  detector: z.string().min(1),
  path: z.string().min(1).refine((value) => !value.startsWith('/') && !value.split('/').includes('..')),
  reason: z.string().min(1),
  approved_by: z.string().min(1),
  review_by: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const timestamp = Date.parse(`${value}T00:00:00.000Z`);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
  }),
}).strict();
const secretFindingAllowlistSchema = z.object({
  schema_version: z.literal(2),
  entries: z.array(secretFindingReviewSchema),
}).strict();
const verifiedBinaries = new Map<string, string>();

async function loadPinManifest(): Promise<PinManifest> {
  const raw = await readFile(pinManifestPath, 'utf8');
  return JSON.parse(raw) as PinManifest;
}

function isPlaceholderDigest(sha256: string): boolean {
  return !SHA256_HEX.test(sha256) || /PLACEHOLDER/i.test(sha256);
}

function killProcessTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    return;
  }
  try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
}

async function runCommand(cmd: string, args: string[], cwd: string = root, timeoutMs: number = 120000): Promise<CommandResult> {
  return new Promise((settle) => {
    // nosemgrep: javascript.lang.security.detect-child-process -- trusted local scanner CLIs only; args are fixed by this suite
    const child = spawn(verifiedBinaries.get(cmd) ?? cmd, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        ...process.env,
        SEMGREP_SEND_METRICS: 'off',
        SEMGREP_FORCE_NO_METRICS: '1',
        // Suite ignore list lives under security/; Semgrep's default is a root .semgrepignore.
        SEMGREP_R2C_INTERNAL_EXPLICIT_SEMGREPIGNORE: join(securityDir, 'semgrepignore'),
      },
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      settle(result);
    };
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    const timeout = setTimeout(() => {
      killProcessTree(child.pid);
      finish({ code: 124, stdout, stderr: `${stderr}\nTIMEOUT`, missing: false, timedOut: true });
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timeout);
      const message = error.message;
      if (message.includes('ENOENT') || message.includes('not found')) {
        finish({ code: 127, stdout: '', stderr: message, missing: true, timedOut: false });
      } else {
        finish({ code: 1, stdout: '', stderr: message, missing: false, timedOut: false });
      }
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      finish({ code: code ?? 1, stdout, stderr, missing: false, timedOut: false });
    });
  });
}

async function resolveBinaryPath(binary: string): Promise<string | undefined> {
  const locator = process.platform === 'win32' ? 'where' : 'which';
  const result = await runCommand(locator, [binary], root, 15000);
  if (result.missing || result.code !== 0) return undefined;
  const candidates = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (candidates.length === 0) return undefined;
  if (process.platform === 'win32') {
    const exe = candidates.find((path) => /\.exe$/i.test(path));
    if (exe) return exe;
  }
  return candidates[0];
}

async function hashFile(path: string): Promise<string> {
  const bytes = await readFile(path);
  return createHash('sha256').update(bytes).digest('hex');
}

async function enforcePins(manifest: PinManifest): Promise<ScannerResult> {
  const issues: string[] = [];
  for (const [name, tool] of Object.entries(manifest.tools)) {
    if (isPlaceholderDigest(tool.sha256)) {
      issues.push(`${name}: pin digest is a placeholder or invalid (${tool.sha256})`);
      continue;
    }
    const binary = BINARY_NAMES[name] ?? name;
    const path = await resolveBinaryPath(binary);
    if (!path) {
      issues.push(`${name}: pinned digest recorded but binary '${binary}' was not found for verification`);
      continue;
    }
    try {
      const digest = await hashFile(path);
      if (digest !== tool.sha256.toLowerCase()) {
        issues.push(`${name}: digest mismatch for ${path} (expected ${tool.sha256.toLowerCase()}, got ${digest})`);
      } else {
        verifiedBinaries.set(binary, path);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push(`${name}: could not hash ${path}: ${message}`);
    }
  }
  if (issues.length > 0) {
    return {
      name: 'pin-manifest',
      findings: issues,
      outcome: 'incomplete',
      detail: issues.join('; '),
    };
  }
  return { name: 'pin-manifest', findings: [], outcome: 'pass' };
}

function commandFailure(name: string, result: CommandResult): ScannerResult | undefined {
  if (result.missing) {
    return { name, findings: [], outcome: 'unavailable', detail: result.stderr || 'scanner binary not found' };
  }
  if (result.timedOut) {
    return { name, findings: [], outcome: 'failed', detail: 'scanner timed out' };
  }
  return undefined;
}

async function runTruffleHog(): Promise<ScannerResult> {
  const name = 'TruffleHog (secrets)';
  // Verification stays on. Verified-only blocking with --no-verification yields an empty block set.
  // --no-update keeps the pinned binary from rewriting itself mid-run on Windows.
  const args = [
    'filesystem',
    '.',
    '--json',
    '--no-update',
    // Keep verification on for blocking; omit unverified noise from the report payload.
    '--results=verified,unknown',
    '--exclude-paths',
    'security/trufflehog-excludes.txt',
  ];
  const result = await runCommand('trufflehog', args, root, 300000);
  const early = commandFailure(name, result);
  if (early) return early;

  let reviewed = new Set<string>();
  let allowlistText: string;
  try {
    allowlistText = await readFile(join(securityDir, 'trufflehog-allowlist.json'), 'utf8');
  } catch {
    return { name, findings: [], outcome: 'incomplete', detail: 'Secret finding review allowlist is unavailable' };
  }
  let allowlistValue: unknown;
  try { allowlistValue = JSON.parse(allowlistText); }
  catch { return { name, findings: [], outcome: 'incomplete', detail: 'Secret finding review allowlist is malformed' }; }
  const parsedAllowlist = secretFindingAllowlistSchema.safeParse(allowlistValue);
  if (!parsedAllowlist.success) return { name, findings: [], outcome: 'incomplete', detail: 'Secret finding review allowlist is malformed' };
  if (parsedAllowlist.data.entries.some((entry) => Date.parse(`${entry.review_by}T23:59:59.999Z`) < Date.now())) {
    return { name, findings: [], outcome: 'incomplete', detail: 'A reviewed secret candidate has passed its review date' };
  }
  reviewed = new Set(parsedAllowlist.data.entries.map((entry) => entry.fingerprint));

  const lines = result.stdout.trim().split('\n').filter(Boolean);
  const findings: unknown[] = [];
  let blocked = false;
  let unreviewedUnknown = 0;
  let parseFailures = 0;
  for (const line of lines) {
    try {
      const finding: unknown = JSON.parse(line);
      if (!finding || typeof finding !== 'object' || !('Verified' in finding) || typeof finding.Verified !== 'boolean') throw new Error('Invalid finding');
      if (finding.Verified === true) blocked = true;
      const detector = 'DetectorName' in finding && typeof finding.DetectorName === 'string' ? finding.DetectorName : 'unknown';
      const metadata = 'SourceMetadata' in finding && finding.SourceMetadata && typeof finding.SourceMetadata === 'object' ? finding.SourceMetadata as Record<string, unknown> : {};
      const data = 'Data' in metadata && metadata.Data && typeof metadata.Data === 'object' ? metadata.Data as Record<string, unknown> : {};
      const filesystem = 'Filesystem' in data && data.Filesystem && typeof data.Filesystem === 'object' ? data.Filesystem as Record<string, unknown> : {};
      const path = 'file' in filesystem && typeof filesystem.file === 'string' ? filesystem.file.replaceAll('\\', '/') : '';
      const lineNumber = 'line' in filesystem && Number.isSafeInteger(filesystem.line) ? filesystem.line as number : 0;
      const raw = 'Raw' in finding && typeof finding.Raw === 'string' ? finding.Raw : '';
      const fingerprint = createHash('sha256').update(`${detector}\0${path}\0${lineNumber}\0${raw}`).digest('hex');
      const isReviewed = finding.Verified === false && reviewed.has(fingerprint);
      if (finding.Verified === false && !isReviewed) unreviewedUnknown += 1;
      findings.push({ DetectorName: detector, Verified: finding.Verified, path, line: lineNumber || undefined, fingerprint });
    } catch {
      parseFailures += 1;
    }
  }
  if (lines.length > 0 && findings.length === 0) {
    return { name, findings: [], outcome: 'failed', detail: 'TruffleHog stdout was not readable JSONL' };
  }
  if (result.code !== 0 || parseFailures > 0) {
    return {
      name,
      findings: [],
      outcome: 'failed',
      detail: parseFailures
        ? 'TruffleHog returned unreadable JSONL'
        : `trufflehog exited ${result.code}`,
    };
  }

  return {
    name,
    findings,
    outcome: blocked ? 'blocked' : unreviewedUnknown > 0 ? 'incomplete' : 'pass',
    detail: unreviewedUnknown > 0 ? `${unreviewedUnknown} secret candidates with unknown verification require review` : findings.length > 0 ? `${findings.length} exact, hash-pinned non-secret fixtures reviewed` : undefined,
  };
}

async function runTrivy(): Promise<ScannerResult> {
  const name = 'Trivy (deps + config)';
  const args = [
    'fs',
    '.',
    '--format',
    'json',
    '--scanners',
    'vuln,misconfig',
    '--skip-dirs',
    '.dev',
    '--skip-dirs',
    'node_modules',
    '--skip-dirs',
    '.tmp',
    '--skip-dirs',
    '.audit',
    '--skip-dirs',
    '.agents',
    '--skip-dirs',
    'security/semgrep-rules',
    '--skip-dirs',
    'verification',
    '--skip-dirs',
    'apps/desktop/resources',
    '--skip-dirs',
    'apps/desktop/binaries',
    '--skip-dirs',
    'apps/desktop/out',
    '--skip-dirs',
    '.git',
  ];
  const result = await runCommand('trivy', args, root, 600000);
  const early = commandFailure(name, result);
  if (early) return early;
  if (result.code !== 0) return { name, findings: [], outcome: 'failed', detail: `trivy exited ${result.code}` };

  let findings: unknown[] = [];
  try {
    if (!result.stdout.trim()) {
      return { name, findings: [], outcome: 'failed', detail: 'Trivy returned an empty report' };
    } else {
      const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
      if (parsed.SchemaVersion !== 2 || (parsed.Results !== undefined && !Array.isArray(parsed.Results))) {
        return { name, findings: [], outcome: 'failed', detail: 'Trivy returned an invalid report' };
      }
      findings = Array.isArray(parsed.Results) ? parsed.Results : [];
    }
  } catch {
    return { name, findings: [], outcome: 'failed', detail: 'Trivy stdout was not readable JSON' };
  }

  const blocked = findings.some((raw) => {
    const entry = raw as Record<string, unknown>;
    const misconfigs = entry.Misconfigurations;
    if (Array.isArray(misconfigs) && misconfigs.some((item) => item && typeof item === 'object' && 'Severity' in item && (item.Severity === 'HIGH' || item.Severity === 'CRITICAL'))) return true;
    const vulns = entry.Vulnerabilities as unknown[] | undefined;
    return vulns?.some((item) => {
      const vuln = item as Record<string, unknown>;
      return vuln.Severity === 'CRITICAL' || vuln.Severity === 'HIGH';
    }) ?? false;
  });

  return { name, findings, outcome: blocked ? 'blocked' : 'pass' };
}

async function writeTrivyCycloneDx(dateDir: string): Promise<ScannerResult> {
  const name = 'Trivy CycloneDX SBOM';
  await mkdir(dateDir, { recursive: true });
  const outPath = join(dateDir, 'sbom.cdx.json');
  const args = [
    'fs',
    '.',
    '--format',
    'cyclonedx',
    '--output',
    outPath,
    '--skip-dirs',
    '.dev',
    '--skip-dirs',
    'node_modules',
    '--skip-dirs',
    '.tmp',
    '--skip-dirs',
    '.audit',
    '--skip-dirs',
    '.agents',
    '--skip-dirs',
    'security/semgrep-rules',
    '--skip-dirs',
    'verification',
    '--skip-dirs',
    'apps/desktop/resources',
    '--skip-dirs',
    'apps/desktop/binaries',
    '--skip-dirs',
    'apps/desktop/out',
    '--skip-dirs',
    '.git',
  ];
  const result = await runCommand('trivy', args, root, 600000);
  const early = commandFailure(name, result);
  if (early) return early;
  if (result.code !== 0) {
    return { name, findings: [], outcome: 'failed', detail: result.stderr.trim() || `trivy cyclonedx exited ${result.code}` };
  }
  try {
    const raw = await readFile(outPath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const bomFormat = parsed.bomFormat ?? parsed.bom_format;
    if (bomFormat !== 'CycloneDX') {
      return { name, findings: [], outcome: 'failed', detail: `expected CycloneDX bomFormat, got ${String(bomFormat)}` };
    }
    return { name, findings: [{ path: outPath, bomFormat }], outcome: 'pass', detail: `wrote ${outPath}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { name, findings: [], outcome: 'failed', detail: `CycloneDX artifact unreadable: ${message}` };
  }
}

async function loadSemgrepRulesPin(): Promise<{ commit?: string; detail: string } | { error: string }> {
  try {
    const raw = await readFile(SEMGREP_RULES_PIN_PATH, 'utf8');
    const parsed = JSON.parse(raw) as { commit?: string; source?: string };
    if (!parsed.commit || typeof parsed.commit !== 'string') {
      return { error: 'Semgrep rules PIN.json is missing commit' };
    }
    return {
      commit: parsed.commit,
      detail: `pinned ${parsed.source ?? 'semgrep-rules'}@${parsed.commit.slice(0, 12)}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: `Semgrep rules PIN.json unreadable: ${message}` };
  }
}

async function runSemgrep(): Promise<ScannerResult> {
  const name = 'Semgrep CE (SAST)';
  const pin = await loadSemgrepRulesPin();
  if ('error' in pin) {
    return { name, findings: [], outcome: 'incomplete', detail: pin.error };
  }

  const sourceRoots = ['apps/web/src', 'apps/service/src', 'tools/office-cli/src', 'packages', 'workers', 'apps/desktop'];
  const skippedDirectories = new Set(['node_modules', '.git', '.venv', 'venv', '.pytest_cache', '__pycache__', 'target', 'dist', 'build']);
  const skippedGeneratedPaths = [
    'apps/desktop/resources',
    'apps/desktop/binaries',
    'apps/desktop/out',
  ];
  const sourceExtensions = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.py', '.rs', '.go', '.java', '.kt', '.swift', '.php', '.rb', '.vue', '.svelte']);
  const sourceFiles: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        const sourcePath = relative(root, path).split(sep).join('/');
        const generated = skippedGeneratedPaths.some((skipped) => sourcePath === skipped || sourcePath.startsWith(`${skipped}/`));
        if (!skippedDirectories.has(entry.name) && !generated) await visit(path);
      } else if (entry.isFile() && sourceExtensions.has(entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase())) {
        sourceFiles.push(path);
      }
    }
  };
  for (const sourceRoot of sourceRoots) await visit(join(root, sourceRoot));
  if (sourceFiles.length === 0) return { name, findings: [], outcome: 'incomplete', detail: 'No product source files were discovered for SAST' };

  const baseArgs = [
    'scan', `--config=${SEMGREP_RULES_DIR}`, '--no-git-ignore', '--json', '--metrics=off', '--timeout', '30', '--jobs', '1',
  ];
  const batches: string[][] = [];
  let batch: string[] = [];
  let batchLength = 0;
  for (const path of sourceFiles) {
    if (batch.length > 0 && batchLength + path.length + 1 > 22000) {
      batches.push(batch);
      batch = [];
      batchLength = 0;
    }
    batch.push(path);
    batchLength += path.length + 1;
  }
  if (batch.length > 0) batches.push(batch);

  const findings: unknown[] = [];
  let scanned = 0;
  for (const paths of batches) {
    const result = await runCommand('semgrep', [...baseArgs, ...paths], root, 180000);
    const early = commandFailure(name, result);
    if (early) return { ...early, detail: `${early.detail}; source batch ${scanned + 1}/${batches.length}` };
    if (result.code !== 0 && result.code !== 1) {
      return { name, findings: [], outcome: 'failed', detail: `semgrep exited ${result.code} on source batch ${scanned + 1}/${batches.length}` };
    }
    try {
      const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
      if (!Array.isArray(parsed.results) || !Array.isArray(parsed.errors)) {
        return { name, findings: [], outcome: 'incomplete', detail: `Semgrep report is missing results or errors arrays on source batch ${scanned + 1}/${batches.length}` };
      }
      if (parsed.errors.length > 0) {
        return { name, findings: [], outcome: 'incomplete', detail: `Semgrep reported ${parsed.errors.length} rule/engine errors on source batch ${scanned + 1}/${batches.length}` };
      }
      findings.push(...parsed.results);
    } catch {
      return { name, findings: [], outcome: 'failed', detail: `Semgrep stdout was not readable JSON on source batch ${scanned + 1}/${batches.length}` };
    }
    scanned += 1;
  }

  const blockedFindings = findings.filter((raw) => {
    const finding = raw as Record<string, unknown>;
    const extra = finding.extra as Record<string, unknown> | undefined;
    const severity = typeof extra?.severity === 'string' ? extra.severity.toUpperCase() : '';
    return severity === 'ERROR';
  });

  const redacted = findings.map((raw) => {
    const finding = raw as Record<string, unknown>;
    const extra = finding.extra as Record<string, unknown> | undefined;
    return {
      check_id: finding.check_id,
      path: finding.path,
      start: finding.start,
      end: finding.end,
      severity: extra?.severity,
    };
  });
  return {
    name,
    findings: redacted,
    outcome: blockedFindings.length > 0 ? 'blocked' : 'pass',
    detail: `${pin.detail}; ${blockedFindings.length} ERROR blockers; ${findings.length - blockedFindings.length} lower-severity review findings retained`,
  };
}

function extractJsonPayload(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('empty');
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    const arrayStart = trimmed.indexOf('[');
    const arrayEnd = trimmed.lastIndexOf(']');
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      return JSON.parse(trimmed.slice(arrayStart, arrayEnd + 1));
    }
    throw new Error('no JSON object in scanner stdout');
  }
}

function skillSpectorReports(parsed: unknown): Record<string, unknown>[] {
  if (Array.isArray(parsed)) {
    return parsed.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object');
  }
  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    if (Array.isArray(record.skills)) {
      return record.skills.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object');
    }
    if (Array.isArray(record.reports)) {
      return record.reports.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object');
    }
    return [record];
  }
  return [];
}

async function runSkillSpector(): Promise<ScannerResult> {
  const name = 'SkillSpector (agent skills)';
  const args = [
    'scan',
    LAB_SKILLS_DIR,
    '--recursive',
    '--no-llm',
    '--format',
    'json',
  ];
  const result = await runCommand('skillspector', args, root, 180000);
  const early = commandFailure(name, result);
  if (early) return early;
  if (result.code !== 0 && result.code !== 1) {
    return { name, findings: [], outcome: 'failed', detail: result.stderr.trim() || `skillspector exited ${result.code}` };
  }

  try {
    if (!result.stdout.trim()) {
      return { name, findings: [], outcome: 'failed', detail: 'SkillSpector returned an empty report' };
    }
    const parsed = extractJsonPayload(result.stdout);
    const reports = skillSpectorReports(parsed);
    if (reports.length === 0) {
      return { name, findings: [], outcome: 'failed', detail: 'SkillSpector JSON contained no skill reports' };
    }

    const redacted: unknown[] = [];
    let blocked = false;
    const details: string[] = ['static --no-llm'];
    for (const report of reports) {
      const risk = (report.risk_assessment ?? {}) as Record<string, unknown>;
      const recommendation = typeof risk.recommendation === 'string' ? risk.recommendation : undefined;
      const riskScore = typeof risk.score === 'number' ? risk.score : undefined;
      const severity = typeof risk.severity === 'string' ? risk.severity.toUpperCase() : '';
      const issues = Array.isArray(report.issues) ? report.issues : [];
      const skillName = (report.skill as Record<string, unknown> | undefined)?.name;
      if (recommendation === 'DO_NOT_INSTALL' || severity === 'CRITICAL' || severity === 'HIGH'
        || (typeof riskScore === 'number' && riskScore >= 70)) {
        blocked = true;
      }
      for (const raw of issues) {
        const issue = raw as Record<string, unknown>;
        const issueSeverity = String(issue.severity ?? issue.level ?? '').toUpperCase();
        if (issueSeverity === 'CRITICAL' || issueSeverity === 'HIGH' || issueSeverity === 'ERROR') {
          blocked = true;
        }
        redacted.push({
          skill: skillName,
          id: issue.id ?? issue.rule_id ?? issue.check_id,
          severity: issue.severity ?? issue.level,
          path: issue.path ?? issue.file,
        });
      }
      details.push([
        typeof skillName === 'string' ? skillName : 'skill',
        recommendation ? `recommendation=${recommendation}` : undefined,
        typeof riskScore === 'number' ? `score=${riskScore}` : undefined,
      ].filter(Boolean).join(' '));
    }

    return {
      name,
      findings: redacted,
      outcome: blocked ? 'blocked' : 'pass',
      detail: details.join('; '),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { name, findings: [], outcome: 'failed', detail: `SkillSpector stdout was not readable JSON (${message})` };
  }
}

async function runCodeQL(dateDir: string): Promise<ScannerResult> {
  const name = 'CodeQL (taint analysis)';
  const codeqlRoot = join(tmpdir(), `air-office-codeql-${process.pid}-${Date.now()}`);
  const dbPath = join(codeqlRoot, 'db');
  const sarifPath = join(dateDir, 'codeql.sarif');
  await mkdir(codeqlRoot, { recursive: true });
  await mkdir(dateDir, { recursive: true });

  const create = await runCommand('codeql', ['database', 'create', dbPath, '--language=typescript', '--build-mode=none', '--source-root=.', `--codescanning-config=${join(securityDir, 'codeql-config.yml')}`, '--overwrite'], root, 360000);
  const createEarly = commandFailure(name, create);
  if (createEarly) return createEarly;
  if (create.code !== 0) {
    return { name, findings: [], outcome: 'failed', detail: create.stderr.trim() || `codeql database create exited ${create.code}` };
  }

  const analyze = await runCommand('codeql', ['database', 'analyze', dbPath, `--search-path=${join(homedir(), '.codeql', 'packages')}`, '--format=sarif-latest', `--output=${sarifPath}`], root, 360000);
  const analyzeEarly = commandFailure(name, analyze);
  if (analyzeEarly) return analyzeEarly;
  if (analyze.code !== 0) {
    return { name, findings: [], outcome: 'failed', detail: analyze.stderr.trim() || `codeql database analyze exited ${analyze.code}` };
  }

  try {
    const raw = await readFile(sarifPath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.version !== '2.1.0' || !Array.isArray(parsed.runs) || parsed.runs.length === 0) {
      return { name, findings: [], outcome: 'incomplete', detail: 'CodeQL SARIF has no valid runs' };
    }
    const findings: unknown[] = [];
    for (const run of parsed.runs) {
      if (!run || typeof run !== 'object' || !('results' in run) || !Array.isArray(run.results)) {
        return { name, findings: [], outcome: 'incomplete', detail: 'CodeQL SARIF run has no results array' };
      }
      findings.push(...run.results);
    }
    return { name, findings, outcome: findings.length > 0 ? 'blocked' : 'pass', detail: `read ${sarifPath}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { name, findings: [], outcome: 'failed', detail: `CodeQL SARIF unreadable at ${sarifPath}: ${message}` };
  }
}

async function writeReport(dateDir: string, results: ScannerResult[], summary: string): Promise<void> {
  await mkdir(dateDir, { recursive: true });
  await writeFile(join(dateDir, 'report.json'), JSON.stringify({ results }, null, 2));
  await writeFile(join(dateDir, 'summary.md'), summary);
}

function outcomeLabel(outcome: ScannerOutcome): string {
  switch (outcome) {
    case 'pass': return 'pass';
    case 'blocked': return 'BLOCKED';
    case 'failed': return 'FAILED';
    case 'unavailable': return 'UNAVAILABLE';
    case 'incomplete': return 'INCOMPLETE';
  }
}

function buildSummary(results: ScannerResult[]): string {
  const lines = ['# Security Pipeline Report', '', `Date: ${new Date().toISOString()}`, ''];
  for (const r of results) {
    lines.push(`## ${r.name}`);
    lines.push(`- Findings: ${r.findings.length}`);
    lines.push(`- Status: ${outcomeLabel(r.outcome)}`);
    if (r.detail) lines.push(`- Detail: ${r.detail}`);
    lines.push('');
  }
  const gatePass = results.every((r) => r.outcome === 'pass');
  lines.push(`## Gate`);
  lines.push(`- Result: ${gatePass ? 'PASS' : 'NOT PASS'}`);
  lines.push('');
  return lines.join('\n');
}

function logScanner(result: ScannerResult): void {
  const suffix = result.detail ? ` (${result.detail})` : '';
  console.log(`${result.name}: ${result.findings.length} findings, ${outcomeLabel(result.outcome)}${suffix}`);
}

/** Hashes installed scanner binaries into pin-manifest.json; leaves missing tools as placeholders. */
export async function recordSecurityPins(): Promise<void> {
  const manifest = await loadPinManifest();
  const recorded: string[] = [];
  const missing: string[] = [];
  for (const [name, tool] of Object.entries(manifest.tools)) {
    const binary = BINARY_NAMES[name] ?? name;
    const path = await resolveBinaryPath(binary);
    if (!path) {
      missing.push(name);
      continue;
    }
    tool.sha256 = await hashFile(path);
    recorded.push(`${name}=${tool.sha256.slice(0, 12)}… (${path})`);
  }
  manifest.updated = new Date().toISOString().slice(0, 10);
  await writeFile(pinManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`Updated ${pinManifestPath}`);
  for (const line of recorded) console.log(`recorded: ${line}`);
  for (const name of missing) console.log(`unchanged (binary not found): ${name}`);
  if (missing.length) {
    console.error('Pin recording incomplete until every listed scanner binary is installed on PATH.');
    process.exitCode = 1;
  }
}

export async function runSecurity(args: string[]): Promise<void> {
  if (args.includes('--record-pins')) {
    await recordSecurityPins();
    return;
  }
  const full = args.includes('--full');
  verifiedBinaries.clear();
  const started = new Date().toISOString();
  const dateDir = join(root, '.tmp/verification/security', started.slice(0, 10), `${started.slice(11).replace(/[:.]/g, '-')}-${process.pid}`);
  const results: ScannerResult[] = [];

  console.log('Security pipeline starting...');
  console.log(full
    ? 'Mode: full (includes CodeQL)'
    : 'Mode: fast (secrets + deps + SAST + SkillSpector + CycloneDX SBOM)');

  let manifest: PinManifest;
  try {
    manifest = await loadPinManifest();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const pinResult: ScannerResult = {
      name: 'pin-manifest',
      findings: [],
      outcome: 'failed',
      detail: `could not load pin manifest: ${message}`,
    };
    results.push(pinResult);
    logScanner(pinResult);
    const summary = buildSummary(results);
    await writeReport(dateDir, results, summary);
    console.error('Security pipeline: NOT PASS');
    process.exitCode = 1;
    return;
  }

  const pins = await enforcePins(manifest);
  results.push(pins);
  logScanner(pins);
  if (pins.outcome !== 'pass') {
    await writeReport(dateDir, results, buildSummary(results));
    console.error('Security pipeline: NOT PASS. Scanner execution stopped because pins did not verify.');
    process.exitCode = 1;
    return;
  }

  const trufflehog = await runTruffleHog();
  results.push(trufflehog);
  logScanner(trufflehog);

  const trivy = await runTrivy();
  results.push(trivy);
  logScanner(trivy);

  const sbom = await writeTrivyCycloneDx(dateDir);
  results.push(sbom);
  logScanner(sbom);

  const semgrep = await runSemgrep();
  results.push(semgrep);
  logScanner(semgrep);

  const skillspector = await runSkillSpector();
  results.push(skillspector);
  logScanner(skillspector);

  if (full) {
    const codeql = await runCodeQL(dateDir);
    results.push(codeql);
    logScanner(codeql);

  }

  const summary = buildSummary(results);
  await writeReport(dateDir, results, summary);

  console.log(`Report written to ${dateDir}`);
  console.log(summary);

  const gatePass = results.every((r) => r.outcome === 'pass');
  if (!gatePass) {
    console.error('Security pipeline: NOT PASS');
    process.exitCode = 1;
  } else {
    console.log('Security pipeline: PASS');
  }
}
