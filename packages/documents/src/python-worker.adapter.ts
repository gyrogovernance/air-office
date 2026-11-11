import { spawn } from 'node:child_process';
import type { ExtractedPage, ExtractionArtifact, ExtractionWarning, SourceKind } from '@office/contracts/document';
import type { ExtractionRequest, ExtractionResult, ExtractionWorker } from './extraction-worker.port';

/** One capability line the worker prints before it accepts work. */
interface WorkerCapabilities {
  protocol_version: number;
  extractor: string;
  extractor_version: string;
  extraction_version: string;
}

/** One response line the worker prints for a request. */
interface WorkerResponse {
  protocol_version: number;
  request_id: string;
  ok: boolean;
  extractor: string;
  extractor_version: string;
  extraction_version: string;
  text: string;
  page_count: number | null;
  pages?: ExtractedPage[];
  warnings: ExtractionWarning[];
  content_hash: string;
  error: string | null;
}

export interface PythonWorkerOptions {
  /** Command that starts the worker, for example ["python", "-m", "office_documents.main"]. */
  command: string[];
  /** Working directory so the worker package resolves; defaults to the process cwd. */
  cwd?: string;
  /** Extra environment for the worker process, for example PYTHONPATH pointing at the package src. */
  env?: Record<string, string>;
  /** Overrides the advertised extractor identity, for tests that pin a version. */
  expectedProtocolVersion?: number;
  /** Deadline for a worker that never advertises its protocol. */
  startupTimeoutMs?: number;
}

/**
 * Managed extraction worker. It starts a Python process, verifies the protocol
 * version from the worker's capability line before sending work, and streams one
 * JSON request and one JSON response per line. The worker never receives the
 * application database; only a path to a bounded scratch copy crosses the
 * boundary. A protocol mismatch or an unexpected exit is an explicit failure.
 */
export class PythonExtractionWorker implements ExtractionWorker {
  readonly protocolVersion: number;
  readonly extractor: string;
  readonly extractorVersion: string;
  private readonly capabilities: WorkerCapabilities;
  private readonly command: string[];
  private readonly cwd: string | undefined;
  private readonly env: Record<string, string> | undefined;

  private constructor(capabilities: WorkerCapabilities, command: string[], cwd: string | undefined, env: Record<string, string> | undefined) {
    this.capabilities = capabilities;
    this.protocolVersion = capabilities.protocol_version;
    this.extractor = capabilities.extractor;
    this.extractorVersion = capabilities.extractor_version;
    this.command = command;
    this.cwd = cwd;
    this.env = env;
  }

  /** Starts the worker and reads its capability line, failing when the protocol does not match. */
  static async start(options: PythonWorkerOptions): Promise<PythonExtractionWorker> {
    // nosemgrep: javascript.lang.security.detect-child-process -- application wiring supplies the interpreter; argument-array spawn uses no shell.
    const probe = spawn(options.command[0]!, options.command.slice(1), { cwd: options.cwd, env: { ...process.env, ...options.env }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    probe.stderr.resume();
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const capabilities = await new Promise<WorkerCapabilities>((resolve, reject) => {
      deadline = setTimeout(() => reject(new Error('The document reader did not become ready before its startup deadline.')), options.startupTimeoutMs ?? 10_000);
      let buffered = '';
      const onData = (chunk: Buffer) => {
        buffered += chunk.toString('utf8');
        if (buffered.length > 65_536) { reject(new Error('The document reader returned an oversized readiness message.')); return; }
        const newline = buffered.indexOf('\n');
        if (newline === -1) return;
        try { resolve(JSON.parse(buffered.slice(0, newline)) as WorkerCapabilities); }
        catch (error) { reject(error instanceof Error ? error : new Error('Worker capability line was not JSON.')); }
      };
      probe.stdout.on('data', onData);
      probe.on('error', reject);
      probe.on('exit', (code) => reject(new Error(`Worker exited before advertising capabilities (code ${code ?? 'null'}).`)));
    }).finally(() => { clearTimeout(deadline); probe.kill(); });
    const expected = options.expectedProtocolVersion ?? capabilities.protocol_version;
    if (capabilities.protocol_version !== expected) throw new Error(`Worker protocol ${capabilities.protocol_version} does not match the required ${expected}.`);
    return new PythonExtractionWorker(capabilities, options.command, options.cwd, options.env);
  }

  async extract(request: ExtractionRequest): Promise<ExtractionResult> {
    return new Promise<ExtractionResult>((resolve, reject) => {
      const child = spawn(this.command[0]!, this.command.slice(1), { cwd: this.cwd, env: { ...process.env, ...this.env }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      child.stderr.resume();
      let buffered = '';
      let settled = false;
      const finish = (error: Error | null, value?: ExtractionResult) => {
        if (settled) return;
        settled = true;
        child.kill();
        if (error) reject(error);
        else resolve(value!);
      };
      const onAbort = () => finish(new Error('Extraction was cancelled.'));
      request.signal?.addEventListener('abort', onAbort, { once: true });
      child.on('error', (error) => finish(error));
      child.on('exit', (code) => finish(new Error(`Worker exited before returning a result (code ${code ?? 'null'}).`)));
      child.stdout.on('data', (chunk: Buffer) => {
        buffered += chunk.toString('utf8');
        let newline = buffered.indexOf('\n');
        while (newline !== -1) {
          const line = buffered.slice(0, newline);
          buffered = buffered.slice(newline + 1);
          if (!line.trim()) { newline = buffered.indexOf('\n'); continue; }
          let frame: Partial<WorkerResponse>;
          try { frame = JSON.parse(line) as Partial<WorkerResponse>; }
          catch { finish(new Error('Worker returned a non-JSON response line.')); return; }
          // A capability advertisement carries neither `ok` nor `request_id`.
          // A worker protocol error carries `ok: false`, so it fails the request
          // instead of being mistaken for the advertisement and dropped. Every
          // buffered line is consumed in one pass because the advertisement and
          // an immediate refusal can arrive in a single stdout chunk.
          if (frame.ok === undefined && frame.request_id === undefined) { newline = buffered.indexOf('\n'); continue; }
          if (frame.protocol_version !== this.protocolVersion) { finish(new Error('Worker response protocol mismatch.')); return; }
          if (!frame.ok) { finish(new Error(frame.error ?? 'Extraction failed.')); return; }
          const response = frame as WorkerResponse;
          const pages = Array.isArray(response.pages) ? response.pages.filter((page) => Number.isSafeInteger(page.page) && page.page >= 1 && typeof page.text === 'string') : undefined;
          const artifact: ExtractionArtifact = {
            extractor: response.extractor,
            extractorVersion: response.extractor_version,
            extractionVersion: response.extraction_version,
            text: response.text,
            pageCount: response.page_count,
            ...(pages && pages.length > 0 ? { pages } : {}),
            warnings: response.warnings,
            contentHash: response.content_hash,
            createdAt: new Date().toISOString()
          };
          finish(null, { artifact });
          return;
        }
      });
      child.stdin.write(`${JSON.stringify({ protocol_version: this.protocolVersion, request_id: request.sourceVersionId, source_version_id: request.sourceVersionId, kind: request.kind, input_path: request.inputPath })}\n`);
    });
  }
}

/** Maps a source kind to whether the worker needs an OCR-capable engine. */
export function requiresOcrResource(kind: SourceKind): boolean {
  return kind === 'image' || kind === 'pdf';
}
