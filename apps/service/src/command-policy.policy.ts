import type { CommandProgram } from '@office/tools/service';

/**
 * The command-line tools the workspace has approved for `run_command`.
 *
 * A name on this list is the only way a command reaches a process: the runner
 * resolves the name to an executable on PATH and refuses anything else, so a
 * model cannot introduce a new program or use a shell. Adding a name here is a
 * deliberate operator decision, and each name carries the arguments that must
 * precede anything the model supplies, which keeps a command aimed at the tool
 * the operator approved.
 *
 * These programs come from the skills that depend on them. A skill whose
 * program is missing still loads, and its instructions tell the model to report
 * that the tool is not installed instead of guessing an alternative.
 */
export const approvedCommands: readonly CommandProgram[] = [
  { name: 'gh', executable: 'gh', fixedArguments: [] },
  { name: 'docker', executable: 'docker', fixedArguments: [] },
  { name: 'ffmpeg', executable: 'ffmpeg', fixedArguments: [] },
  { name: 'ffprobe', executable: 'ffprobe', fixedArguments: [] },
  { name: 'magick', executable: 'magick', fixedArguments: [] },
  { name: 'pandoc', executable: 'pandoc', fixedArguments: [] },
  { name: 'qpdf', executable: 'qpdf', fixedArguments: [] },
  { name: 'pdftotext', executable: 'pdftotext', fixedArguments: [] },
  { name: 'pdfinfo', executable: 'pdfinfo', fixedArguments: [] },
  { name: 'ocrmypdf', executable: 'ocrmypdf', fixedArguments: [] },
  { name: 'icalBuddy', executable: 'icalBuddy', fixedArguments: [] },
  { name: 'osascript', executable: 'osascript', fixedArguments: [] },
  { name: 'memo', executable: 'memo', fixedArguments: [] },
  { name: 'remindctl', executable: 'remindctl', fixedArguments: [] },
  { name: 'gog', executable: 'gog', fixedArguments: [] },
  { name: 'whisper', executable: 'whisper', fixedArguments: [] },
  { name: 'curl', executable: 'curl', fixedArguments: [] },
  { name: 'python3', executable: 'python3', fixedArguments: [] }
];

/** Hosts the approved skills call. An empty list would allow every host. */
export const approvedHttpHosts: readonly string[] = [
  'api.frankfurter.dev',
  'wttr.in',
  'en.wikipedia.org',
  'api.wikimedia.org',
  'api.notion.com'
];
