import type { ChatRunRequest } from '@office/contracts/chat';
import type { ReplayStep } from '@office/providers/service';

const EDIT_INTENT = /\b(rewrite|revise|edit|clean up|tidy|rephrase)\b/i;

function streamText(messageId: string, answer: string): ReplayStep[] {
  return answer.split(' ').map((word, index) => ({ type: 'text-delta', payload: { messageId, text: index ? ` ${word}` : word } } as ReplayStep<'text-delta'>));
}

function match(question: string, ...patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(question));
}

/** Showcase replies for Demo mode. Kept short enough to read in a screenshot. */
function showcaseAnswer(question: string, selection: string | undefined, fileName: string): string {
  if (selection && EDIT_INTENT.test(question)) {
    return `Here is a tighter revision of the ${selection.length}-character selection from ${fileName}. Review the proposed edit before applying it, and keep any citations that still belong with the claim.`;
  }
  if (selection) {
    return `Looking at the selection from ${fileName}: keep the claim only if the cited passage supports it under the stated conditions. Where the wording overreaches the evidence, narrow the claim and record the residual uncertainty for the decision owner.`;
  }
  if (match(question, /\bsafety case\b/i, /\bfrontier\b/i, /\bdeployment\b/i)) {
    return `## Decision frame\n\nName the deployment, the approving owner, and the evidence that would change the release decision.\n\n### Evidence to request\n\n- Exact model and deployment configuration\n- Evaluation protocol, failures observed, and assessor independence\n- Monitoring, incident escalation, and conditions for restriction\n\nSeparate measured results from judgements about residual risk. Record disagreements instead of averaging them into a single confidence score.`;
  }
  if (match(question, /\bclaim\b/i, /\bevidence\b/i, /\bbenchmark\b/i)) {
    return `Bound the claim to the reported test conditions: “Under the stated configuration, no failures were observed on the selected tasks.” Then document coverage, elicitation effort, deployment differences, and the evidence still needed for residual risk. A benchmark result is not a release recommendation by itself.`;
  }
  if (match(question, /\beu ai act\b/i, /\bnist\b/i, /\bframework\b/i, /\bcompar/i)) {
    return `Compare by legal status, scope, audience, and the decision the memo must support. Cite passage-level references, distinguish obligations from voluntary guidance, and keep a separate list of questions for legal review. Similarity of themes is not a finding of compliance.`;
  }
  if (match(question, /\bincident\b/i, /\breport\b/i, /\bpreparedness\b/i, /\btabletop\b/i)) {
    return `Capture what was observed, the affected service, time of detection, immediate impact, and containment steps. Label unresolved details and name a contact for updates. Keep the first report short enough to submit promptly, with a follow-up path for technical evidence and corrective action.`;
  }
  if (match(question, /\bbrief\b/i, /\bagenda\b/i, /\bsummar/i, /\brecommend/i)) {
    return `## Brief outline\n\n1. Decision requested and accountable owner\n2. Options with evidence and trade-offs\n3. Material uncertainties and open questions\n4. Follow-up actions with named owners\n\nKeep recommendations proportional to the evidence supplied in this workspace, and flag anything that still needs technical or legal review.`;
  }
  const trimmed = question.trim().replace(/\s+/g, ' ');
  const preview = trimmed.length > 160 ? `${trimmed.slice(0, 157)}…` : trimmed;
  return `I can help structure that request against the notes and collections in this workspace. Restate the decision you need, the evidence already in hand, and any constraint on scope or deadline.\n\nYour question: “${preview || 'Empty request'}”`;
}

function noteVaultPath(fileId: string, fileName: string): string {
  const raw = fileId.startsWith('note:') ? fileId.slice('note:'.length) : fileId;
  if (raw.endsWith('.md') || raw.endsWith('.note.json')) return raw;
  const base = fileName.endsWith('.md') ? fileName : `${fileName.replace(/\.note$/i, '')}.md`;
  if (raw.includes('/') || raw.includes('\\')) return raw.endsWith('.md') ? raw : `${raw.replace(/\.note\.json$/i, '')}.md`;
  return `programs/general/notes/${base}`;
}

/**
 * Builds the deterministic Demo-mode chat script used for promotion and live
 * walkthroughs. Edit-intent selections emit apply_markdown_note with a vault path.
 */
export async function demoReplayScript(request: ChatRunRequest, readNote?: (fileId: string) => Promise<{ content: string; version: string }>): Promise<ReplayStep[]> {
  const messageId = `${request.runId}:message`;
  const question = request.messages.at(-1)?.content ?? '';
  const selection = request.context?.selection?.trim();
  const fileName = request.context?.fileName ?? 'the document';
  const noteId = request.context?.fileId?.startsWith('note:') ? request.context.fileId : null;
  const note = selection && EDIT_INTENT.test(question) && noteId && readNote ? await readNote(noteId) : null;
  const canEdit = Boolean(note && selection && note.content.includes(selection));
  const answer = selection && EDIT_INTENT.test(question) && !canEdit
    ? `Save the note and select text from its current content before requesting an edit.`
    : showcaseAnswer(question, selection, fileName);
  const events: ReplayStep[] = [
    ...streamText(messageId, answer),
    { type: 'message-complete', payload: { messageId, text: answer } },
    { type: 'usage', payload: { inputTokens: question.length, outputTokens: answer.length } },
  ];
  if (selection && noteId && note && canEdit) {
    const after = selection.replace(/\s+/g, ' ').trim();
    const markdown = note.content.replace(selection, after);
    const path = noteVaultPath(noteId, fileName);
    const argumentsPayload = { path, markdown };
    const args = JSON.stringify(argumentsPayload);
    const split = Math.ceil(args.length / 2);
    events.push(
      { type: 'tool-arguments-fragment', payload: { toolCallId: `${request.runId}:apply-markdown-note`, name: 'apply_markdown_note', argumentsDelta: args.slice(0, split) } },
      { type: 'tool-arguments-fragment', payload: { toolCallId: `${request.runId}:apply-markdown-note`, name: 'apply_markdown_note', argumentsDelta: args.slice(split) } },
      { type: 'tool-request', payload: { toolCallId: `${request.runId}:apply-markdown-note`, name: 'apply_markdown_note', arguments: argumentsPayload } },
    );
  } else {
    events.push({ type: 'completion', payload: { reason: 'stop' } });
  }
  return events;
}
