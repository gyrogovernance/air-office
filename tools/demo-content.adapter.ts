import { createRichDocument, markdownToNativeBody } from '../packages/editor/src/rich-document.domain.public';
import type { MethodDefinition } from '../packages/methods/src/methods.domain.public';
import { loadShippedSkillDefinitions } from '../packages/lab-pack/src/lab-pack.service.public';
import { slugify } from '../packages/vault/src/vault.domain.public';

export type DemoCall = <T>(path: string, body?: unknown, method?: string) => Promise<T>;
const prefix = 'demo-research-';
const id = (value: string) => `${prefix}${value}`;

/** One showcase seed at a time within a process (desktop in-process seed). */
let seedLock: Promise<void> | null = null;

/**
 * Showcase map for promotion screenshots:
 * - Home / Programs: Frontier Governance, Societal Preparedness, Standards Stack
 * - Notes + chat stage: Safety Case beside the Deploy Gate conversation
 * - Teams: Policy analyst, Evidence reviewer, Research partner (first three for the favorite strip)
 * - Actions / review: Claim Audit chat and Human Agency review note
 * - Calendar: Research calendar with events relative to today
 * - Schedules: paused Evidence Review and Briefing Prep
 */

type DemoNote = {
  key: string;
  parent: string;
  title: string;
  sections: readonly (readonly [string, string])[];
};

type DemoChat = {
  key: string;
  parent: string;
  title: string;
  pinned?: boolean;
  turns: readonly { user: string; answer: string }[];
};

export const demoNotes: readonly DemoNote[] = [
  { key: 'brief', parent: 'frontier-deploy', title: 'Safety Case', sections: [
    ['Decision for the policy team', 'Commission a scoped review of the evidence required before a frontier AI deployment. Specify who can approve release, who can request further testing, and which findings require escalation.'],
    ['Working recommendation', 'Organize the review around a documented safety case: intended uses, plausible misuse pathways, evaluation coverage, deployment controls, and residual uncertainty. Record the accountable owner for each unresolved issue.'],
    ['Evidence needed', 'Request the evaluation protocol, testing conditions, observed failure cases, assessor independence, and the rationale for deployment thresholds. Distinguish measured performance from an inference about real-world risk.'],
    ['Questions for consultation', 'What evidence would change the release decision? Which controls can be checked independently? How will incident reporting reach the people authorized to restrict deployment?'],
    ['Next step', 'Prepare an evidence request and circulate it for technical and legal review. Preserve disagreements in the decision record rather than averaging them into a single confidence score.'],
  ] },
  { key: 'deploy-conditions', parent: 'frontier-deploy', title: 'Access Controls', sections: [
    ['Access and use', 'List intended users, prohibited uses, and the technical controls that enforce those boundaries.'],
    ['Monitoring', 'Define the signals that trigger review, who receives them, and the maximum time to triage.'],
    ['Restriction path', 'Name who can restrict or suspend deployment and what evidence they need to act.'],
  ] },
  { key: 'evidence', parent: 'frontier-eval', title: 'Eval Protocol', sections: [
    ['Scope', 'Identify the exact model version, deployment setting, access conditions, and capability under review. Record which claims the evaluation can support.'],
    ['Testing quality', 'Check task selection, contamination controls, human baselines, elicitation effort, and reproducibility. Ask whether the reported result changes under plausible prompting or tool access.'],
    ['Interpretation', 'Separate an observed failure from the estimated frequency of that failure in deployment. Document missing evidence, competing explanations, and the limits of generalization.'],
    ['Review record', 'Assign an owner and a follow-up action to every material gap. Retain the original report alongside the review so another analyst can trace each judgement.'],
  ] },
  { key: 'claims-draft', parent: 'frontier-eval', title: 'Claim Audit', sections: [
    ['Passage under review', '“The system passed the internal safety benchmark, therefore deployment in customer environments is safe.”'],
    ['Claim', 'Passing the internal safety benchmark establishes that deployment is safe.'],
    ['Evidence offered', 'Internal benchmark results under a fixed prompt set; no independent assessor; deployment differences not stated.'],
    ['Working revision', 'Under the reported test configuration, no failures were observed on the selected tasks. Residual risk for customer environments remains unassessed pending coverage of tool use, longer-horizon tasks, and independent review.'],
    ['Open questions', 'Which failures were excluded from the reported set? Who can halt deployment if monitoring detects a novel failure mode?'],
  ] },
  { key: 'consultation-plan', parent: 'frontier-consultation', title: 'Stakeholder Map', sections: [
    ['Audiences', 'Technical assessors, legal reviewers, and operational owners who can change deployment conditions.'],
    ['Core questions', 'What evidence would change the release decision? Which controls can be checked independently? How do incidents reach restriction authority?'],
    ['Outputs', 'A short decision brief, an evidence request, and a record of unresolved disagreements.'],
  ] },
  { key: 'incident', parent: 'prep-reporting', title: 'Incident Intake', sections: [
    ['Purpose', 'Develop a reporting process that supports timely investigation and corrective action while protecting sensitive information.'],
    ['Proposed reporting fields', 'Capture what happened, the affected deployment, the observed impact, the evidence available, and the immediate containment action. Allow preliminary reports with explicitly unresolved details.'],
    ['Governance questions', 'Define reporting thresholds, responsibility for triage, access to confidential material, and the route for escalating a recurring failure. Test the process with a tabletop exercise.'],
    ['Consultation questions', 'Which incidents are currently missed? What prevents reporting? Which information is necessary for a useful investigation, and which fields create avoidable disclosure risks?'],
  ] },
  { key: 'exercise', parent: 'prep-exercises', title: 'Tabletop Drill', sections: [
    ['Scenario', 'A public institution receives conflicting reports about an AI-enabled disruption to an essential service. Participants must establish what is known and coordinate a proportionate response.'],
    ['Exercise objectives', 'Test evidence handoffs, decision authority, communication under uncertainty, and the conditions for requesting technical support. Use simulated reports throughout.'],
    ['Discussion prompts', 'Who can authorize a precautionary action? How are uncertain claims communicated? Which decisions require additional evidence, and who is responsible for obtaining it?'],
    ['After-action review', 'Record decision delays, missing contacts, unclear authority, and information gaps. Convert each observation into an assigned improvement with a review date.'],
  ] },
  { key: 'comms-protocol', parent: 'prep-comms', title: 'Crisis Comms', sections: [
    ['Purpose', 'Keep public and internal messages aligned with what is known, what is uncertain, and who owns the next update.'],
    ['Message rules', 'Separate confirmed facts from working hypotheses. Name the next update time. Avoid attributing decisions to automated systems.'],
    ['Handoffs', 'Technical lead supplies verified facts; communications lead drafts; accountable official approves release.'],
  ] },
  { key: 'frameworks', parent: 'standards-compare', title: 'Source Matrix', sections: [
    ['Research question', 'How should a governance team compare legal obligations, voluntary risk-management guidance, and internal deployment policy without treating them as interchangeable?'],
    ['Primary-source reading list', 'EU AI Act: https://eur-lex.europa.eu/eli/reg/2024/1689/oj\nNIST AI RMF 1.0: https://doi.org/10.6028/NIST.AI.100-1\nNIST Generative AI Profile: https://doi.org/10.6028/NIST.AI.600-1\nOECD AI Principles: https://oecd.ai/en/ai-principles'],
    ['Comparison method', 'For each source, record its legal status, intended audience, scope, terminology, and relevant passages. Check the current edition and applicable dates before drawing a compliance conclusion.'],
    ['Deliverable', 'A short comparison memo with passage-level references and a separate list of questions for legal review.'],
  ] },
  { key: 'comparison-memo', parent: 'standards-compare', title: 'Act vs RMF', sections: [
    ['Purpose of this memo', 'Support a policy meeting on how to read the EU AI Act alongside NIST risk-management guidance without treating thematic overlap as compliance.'],
    ['Working distinctions', 'Legal obligation, voluntary practice, and internal policy answer different questions. Record legal status, scope, audience, and edition date before comparing topics.'],
    ['Topics for the next reading', 'Risk management documentation; post-market monitoring language; transparency and incident reporting; human oversight requirements.'],
    ['Questions for legal review', 'Which provisions apply to the deployments under discussion? Where does voluntary guidance fill a gap the regulation leaves open? Which internal controls already exceed the minimum reading?'],
  ] },
  { key: 'human-mark', parent: 'standards-human-mark', title: 'Human Agency', sections: [
    ['Document under review', 'Evaluation summary that attributes findings to “the system” without naming the accountable human reviewer for each recommendation.'],
    ['Focus for Meta-Evaluation', 'Authority and agency classifications; displacement patterns; breaks in traceability between evidence, inference, and recommendation.'],
    ['Draft finding', 'Several recommendations read as autonomous authority. Reframe each as a proposal for Direct Agency review, with the supporting passage and residual uncertainty attached.'],
    ['Next pass', 'Run Policy Auditing on the claims section, then Meta-Evaluation on the recommendations. Keep human judgement as the final gate before any circulated brief.'],
  ] },
  { key: 'internal-policy', parent: 'standards-internal', title: 'Policy Gaps', sections: [
    ['Scope', 'Map internal deployment policy against the obligations and guidance topics already listed in the comparison memo.'],
    ['Gaps to record', 'Missing owners, undocumented escalation routes, and controls that exist in practice but not in the written policy.'],
    ['Update rule', 'Change the internal policy only after legal review confirms the intended reading of each external source.'],
  ] },
  { key: 'reading', parent: 'standards', title: 'Open Questions', sections: [
    ['Evidence quality', 'Which evaluation findings would justify changing a deployment condition? What independent access would be needed to check them?'],
    ['Institutional readiness', 'Where do technical assessment and public decision authority meet? Which escalation routes can be exercised before an incident?'],
    ['Publication check', 'Verify citations, distinguish proposals from current requirements, and retain a record of material uncertainty.'],
  ] },
  { key: 'welcome', parent: 'frontier', title: 'Threat Model', sections: [
    ['Assets in scope', 'Frontier model weights, evaluation harnesses, deployment credentials, incident logs, and the decision records that authorize release or restriction.'],
    ['Adversary classes', 'External misuse of exposed capabilities; insider misuse of privileged access; accidental over-claim in published evaluation results; supply-chain compromise of tooling used for assessment.'],
    ['Misuse pathways', 'Tool-enabled longer-horizon tasks, jailbreak elicitation of withheld capabilities, data exfiltration through connected knowledge sources, and social engineering of operators who hold restriction authority.'],
    ['Residual risk', 'Coverage gaps for novel tool use, incomplete independent assessment, and unclear ownership when monitoring signals conflict. Record each gap with an owner before any release decision.'],
  ] },
] as const;

export const demoConversations: readonly DemoChat[] = [
  {
    key: 'oversight', parent: 'frontier-deploy', title: 'Deploy Gate', pinned: true,
    turns: [
      {
        user: 'Help structure a decision brief on the evidence a policy team should request before deployment.',
        answer: '## Start with the decision\n\nState the deployment under consideration and identify the person authorized to approve it. Then organize the evidence around intended use, foreseeable misuse, evaluation coverage, deployment controls, and remaining uncertainty.\n\n### Evidence request\n\n- Exact model and deployment configuration\n- Evaluation protocols and observed failure cases\n- Independent assessment arrangements\n- Monitoring and incident escalation procedures\n- Conditions for restricting or suspending deployment\n\nA useful brief makes the connection between each evidence gap and the decision it could change.',
      },
      {
        user: 'Turn that into three consultation questions we can put at the top of the brief.',
        answer: '1. What evidence would change the release decision, and who is authorized to act on it?\n2. Which evaluation claims can be checked independently under the same conditions?\n3. How do monitoring findings reach the people who can restrict or suspend deployment?\n\nPlace these above the evidence request so reviewers see the decision stakes before the detail.',
      },
    ],
  },
  {
    key: 'claims', parent: 'frontier-eval', title: 'Claim Strength', pinned: true,
    turns: [
      {
        user: 'A draft says that passing a benchmark establishes that deployment is safe. How should we revise the claim?',
        answer: 'Use a statement bounded by the evaluation conditions: “Under the reported test configuration, no failures were observed on the selected tasks.”\n\nThen document task coverage, elicitation effort, deployment differences, and the evidence needed to assess residual risk. A benchmark result supports a specific empirical claim; a release recommendation also requires judgement about the intended setting and available controls.',
      },
      {
        user: 'List the claim, the evidence offered, and the gap in one short table for Policy Auditing.',
        answer: '| Element | Text |\n| --- | --- |\n| Claim | Passing the internal safety benchmark establishes that deployment is safe. |\n| Evidence offered | Internal benchmark under a fixed prompt set; assessor independence not stated. |\n| Gap | Deployment differences, tool-use coverage, and independent review are missing; residual risk is unassessed. |\n\nSuggested revision: keep the measured result, drop the deployment-safety inference, and assign an owner for the missing evidence.',
      },
    ],
  },
  {
    key: 'response', parent: 'prep-reporting', title: 'First Report',
    turns: [
      {
        user: 'What should an initial incident report contain when the facts are still incomplete?',
        answer: 'Capture the observed event, affected service, time of detection, immediate impact, and containment steps. Label unresolved details and identify a contact responsible for updates.\n\nKeep the initial report short enough to submit promptly, with a follow-up record for technical evidence and corrective action. Access rules should protect sensitive information while allowing the responsible investigators to review it.',
      },
    ],
  },
  {
    key: 'comparison', parent: 'standards-compare', title: 'Act vs NIST',
    turns: [
      {
        user: 'How should we structure a comparison of the EU AI Act and NIST risk-management guidance?',
        answer: 'Begin with legal status, scope, intended audience, and the decision the comparison will support. For each topic, cite the relevant passage and distinguish a legal obligation from a voluntary practice or an internal recommendation.\n\nUse a separate section for applicability questions that require legal review, and record the edition and review date of each source. Avoid presenting a thematic similarity as a finding of compliance.',
      },
    ],
  },
  {
    // Last-frame chat: short enough to read in two seconds; composer can hold “Thnx <3”.
    key: 'human-mark-chat', parent: 'standards-human-mark', title: 'Human Power', pinned: true,
    turns: [
      {
        user: 'Still our call?',
        answer: 'Yes. Models propose. People decide.',
      },
    ],
  },
  {
    key: 'teams-start', parent: 'frontier-consultation', title: 'Minister Brief',
    turns: [
      {
        user: 'I need options for a ministerial briefing on frontier deployment conditions. Keep it to one page.',
        answer: '## One-page options\n\n**Option A — Evidence gate before deployment.** Require a documented safety case, named approver, and independent review of evaluation coverage.\n\n**Option B — Staged access.** Allow limited deployment with monitoring thresholds that trigger automatic escalation.\n\n**Option C — Pause for consultation.** Hold public-facing deployment until incident reporting and restriction authority are exercised in a tabletop.\n\nTrade-offs: A is strongest on accountability, B preserves learning under controls, C buys time at the cost of delay. Flag legal review for whichever option you advance.',
      },
    ],
  },
  {
    key: 'tabletop-chat', parent: 'prep-exercises', title: 'Crisis Authority',
    turns: [
      {
        user: 'In the essential-service disruption exercise, who should be allowed to authorize a precautionary action while facts are incomplete?',
        answer: 'Give precautionary authority to a named operational owner who can act within a pre-agreed scope, with a duty to record the uncertain facts and trigger a timed review. Technical support advises; it does not hold the decision. Communications wait for the approved facts list before public updates.',
      },
    ],
  },
] as const;

function localDate(offsetDays: number, timeZone = 'UTC'): string {
  const stamp = Date.now() + offsetDays * 86_400_000;
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(stamp));
}

function notesDirForParent(parentId: string): string {
  if (parentId.startsWith('program:')) return `programs/${parentId.slice('program:'.length)}/notes`;
  if (parentId.startsWith('project:')) {
    const rest = parentId.slice('project:'.length);
    const slash = rest.indexOf('/');
    if (slash > 0) return `programs/${rest.slice(0, slash)}/projects/${rest.slice(slash + 1)}/notes`;
  }
  throw new Error(`Demo parent ${parentId} is not a program or project.`);
}

export async function seedDemoContent(call: DemoCall): Promise<void> {
  if (!seedLock) seedLock = seedDemoContentUnlocked(call).finally(() => { seedLock = null; });
  await seedLock;
}

async function seedDemoContentUnlocked(call: DemoCall): Promise<void> {
  const bootstrap = await call<{ demo?: boolean }>('/api/v1/bootstrap');
  if (bootstrap.demo !== true) throw new Error('Sample research content requires the isolated Demo service.');
  const now = new Date().toISOString();
  const catalog = await call<{ nodes: { id: string; kind: string; name: string; parentId: string | null; targetId?: string }[] }>('/api/v1/workspace/nodes');
  /** Stable demo keys → real vault catalog ids (program:… / project:… / note:path). */
  const byKey = new Map<string, string>();
  const nodes = new Set(catalog.nodes.map((node) => node.id));
  for (const item of catalog.nodes) {
    if (item.kind === 'note' && item.targetId) byKey.set(`path:${item.targetId}`, item.id);
  }

  async function ensureNode(key: string, body: Record<string, unknown>): Promise<string> {
    const known = byKey.get(key);
    if (known && nodes.has(known)) {
      const patch: Record<string, unknown> = {};
      if (typeof body.name === 'string') patch.name = body.name;
      if (typeof body.instruction === 'string') patch.instruction = body.instruction;
      if (Object.keys(patch).length > 0) await call(`/api/v1/workspace/nodes/${encodeURIComponent(known)}`, patch, 'PATCH');
      return known;
    }
    if (body.kind === 'program' || body.kind === 'project') {
      const match = catalog.nodes.find((item) => item.kind === body.kind && item.name === body.name
        && (body.kind === 'program' || item.parentId === body.parentId));
      if (match) {
        byKey.set(key, match.id);
        nodes.add(match.id);
        const patch: Record<string, unknown> = {};
        if (typeof body.instruction === 'string') patch.instruction = body.instruction;
        if (Object.keys(patch).length > 0) await call(`/api/v1/workspace/nodes/${encodeURIComponent(match.id)}`, patch, 'PATCH');
        return match.id;
      }
    }
    if (body.kind === 'note' && typeof body.targetId === 'string') {
      const match = catalog.nodes.find((item) => item.kind === 'note' && item.targetId === body.targetId);
      if (match) {
        byKey.set(key, match.id);
        nodes.add(match.id);
        return match.id;
      }
    }
    const created = await call<{ node: { id: string } }>('/api/v1/workspace/nodes', { id: id(key), ...body });
    byKey.set(key, created.node.id);
    nodes.add(created.node.id);
    catalog.nodes.push({ id: created.node.id, kind: String(body.kind), name: String(body.name), parentId: (body.parentId as string | null | undefined) ?? null, ...(typeof body.targetId === 'string' ? { targetId: body.targetId } : {}) });
    return created.node.id;
  }

  await ensureNode('frontier', { name: 'Frontier Governance', kind: 'program', instruction: 'Distinguish observed evidence, interpretation, and recommendations. Cite original sources and state material uncertainty.' });
  await ensureNode('preparedness', { name: 'Societal Preparedness', kind: 'program', instruction: 'Plan exercises and incident processes with explicit decision authority. Label scenario elements that are not live incidents.' });
  // Older demos created `standards` as a project under General. Prefer that id as a
  // program on fresh installs; otherwise use a dedicated hub so projects can nest.
  const standardsExisting = catalog.nodes.find((item) => item.id === id('standards') || item.name === 'Standards Stack');
  const standardsProgramKey = !standardsExisting || standardsExisting.kind === 'program' ? 'standards' : 'standards-hub';
  await ensureNode(standardsProgramKey, { name: 'Standards Stack', kind: 'program', instruction: 'Compare legal obligations with voluntary guidance without treating thematic overlap as compliance.' });
  const projects: readonly { key: string; name: string; program: string; instruction: string }[] = [
    { key: 'frontier-eval', name: 'Model Evals', program: 'frontier', instruction: 'Bound evaluation claims to test conditions. Separate measured results from deployment judgements.' },
    { key: 'frontier-deploy', name: 'Deploy Gates', program: 'frontier', instruction: 'Document access limits, monitoring, and who can restrict or suspend deployment.' },
    { key: 'frontier-consultation', name: 'Consultations', program: 'frontier', instruction: 'Prepare audiences, questions, and briefing outputs for technical, legal, and operational review.' },
    { key: 'prep-reporting', name: 'Incident Reports', program: 'preparedness', instruction: 'Design reporting fields, triage ownership, and escalation routes. Label scenario examples that are not live incidents.' },
    { key: 'prep-exercises', name: 'Tabletops', program: 'preparedness', instruction: 'Run simulated scenarios that test decision authority and evidence handoffs.' },
    { key: 'prep-comms', name: 'Crisis Comms', program: 'preparedness', instruction: 'Keep public and internal messages aligned with confirmed facts and named owners.' },
    { key: 'standards-compare', name: 'Regulatory Scan', program: standardsProgramKey, instruction: 'Record legal status, scope, audience, and edition before comparing passages.' },
    { key: 'standards-human-mark', name: 'Human Mark', program: standardsProgramKey, instruction: 'Keep recommendations under human Direct Agency; treat model findings as proposals.' },
    { key: 'standards-internal', name: 'Policy Align', program: standardsProgramKey, instruction: 'Map internal controls to external obligations and guidance without silent gaps.' },
  ];
  for (const project of projects) {
    const parentId = byKey.get(project.program);
    if (!parentId) throw new Error(`Demo program ${project.program} was not created.`);
    await ensureNode(project.key, { name: project.name, kind: 'project', parentId, instruction: project.instruction });
  }

  for (const note of demoNotes) {
    const parentKey = note.parent === 'standards' ? standardsProgramKey : note.parent;
    const parentId = byKey.get(parentKey);
    if (!parentId) throw new Error(`Demo parent ${parentKey} was not created for note ${note.key}.`);
    const path = `${notesDirForParent(parentId)}/${slugify(note.title)}.note.json`;
    const document = { ...createRichDocument(note.title, id(note.key)), path };
    const sections: string[] = [];
    note.sections.forEach(([heading, text]) => sections.push(`## ${heading}\n\n${text}`));
    // Always refresh title and body so renames in this file show up on re-seed.
    const saved = await call<{ document: { id: string; path?: string } }>('/api/v1/rich-documents', { ...document, body: markdownToNativeBody(sections.join('\n\n')) });
    const notePath = saved.document.path ?? path;
    await ensureNode(`placement-${note.key}`, { kind: 'note', name: note.title, parentId, targetId: notePath });
  }

  const history = await call<{ conversations: { id: string }[] }>('/api/v1/conversations?limit=1000&archived=include');
  const conversations = new Set(history.conversations.map((conversation) => conversation.id));
  for (const chat of demoConversations) {
    const conversationId = id(chat.key);
    // Recreate so title and turn text from this file always win on re-seed.
    if (conversations.has(conversationId)) await call(`/api/v1/conversations/${conversationId}`, undefined, 'DELETE');
    await call('/api/v1/conversations', { conversationId });
    await call(`/api/v1/conversations/${conversationId}`, { title: chat.title, tags: ['governance', 'research', 'safety'], pinned: chat.pinned === true }, 'PATCH');
    for (let index = 0; index < chat.turns.length; index += 1) {
      const turn = chat.turns[index]!;
      const questionId = `${conversationId}-q${index + 1}`;
      const answerId = `${conversationId}-a${index + 1}`;
      await call(`/api/v1/conversations/${conversationId}/messages`, { id: questionId, parentId: index === 0 ? null : `${conversationId}-a${index}`, role: 'user', content: turn.user, complete: true });
      await call(`/api/v1/conversations/${conversationId}/messages`, { id: answerId, parentId: questionId, role: 'assistant', content: turn.answer, complete: true });
    }
    const chatParent = byKey.get(chat.parent);
    if (!chatParent) throw new Error(`Demo chat parent ${chat.parent} was not created.`);
    await call('/api/v1/workspace/move-chats', { ids: [conversationId], parentId: chatParent });
  }

  const existing = await call<{ definitions: MethodDefinition[] }>('/api/v1/methods');
  const methods = new Set(existing.definitions.map((definition) => definition.value.id));
  // Order matters: the home Favorite agents strip uses the first three when no favorites are chosen.
  const roles = [
    ['policy-analyst', 'Policy analyst', 'Develop concise policy options with explicit decision criteria, accountable owners, trade-offs, and uncertainties. Distinguish existing requirements from proposed measures and flag questions for legal review.'],
    ['evidence-reviewer', 'Evidence reviewer', 'Review claims against the supplied evidence. Identify unsupported inferences, describe testing limitations, and suggest bounded revisions. Preserve passage references and distinguish absent evidence from evidence of absence.'],
    ['research-partner', 'Research partner', 'Help plan evidence-led research on transformative AI. Compare explanations, identify missing sources, and maintain an open-questions log. Use only supplied or verified references.'],
    ['preparedness-planner', 'Preparedness planner', 'Prepare tabletop exercises and after-action reviews. Specify decision authority, evidence handoffs, escalation conditions, and practical follow-up actions. Label scenario elements that are not live incidents.'],
    ['human-mark-reviewer', 'Human Mark reviewer', 'Examine authority, agency, and traceability in evaluation or governance text. Propose revisions that keep recommendations under human Direct Agency. Findings are proposals for human review.'],
  ] as const;
  for (const [key, name, instructions] of roles) if (!methods.has(id(key))) await call('/api/v1/methods', { kind: 'preset', value: { id: id(key), name, provider: 'demo-openai', model: 'Demo-Chat', instructions, settings: { temperature: 0.2 }, knowledgeCollectionIds: [], skillIds: [], toolIds: [], updatedAt: now } });
  for (const [key, name, instructions] of [
    ['claim-review', 'Claim Check', 'For each claim in the supplied draft, identify its supporting passage, the inference required, and any material uncertainty. Suggest a revision where the wording exceeds the evidence.'],
    ['decision-brief', 'Decision Brief', 'Prepare a brief with the decision requested, available options, evidence, trade-offs, and unresolved questions. Identify who owns each follow-up action.'],
    ['source-comparison', 'Source Compare', 'Compare the supplied sources by question, scope, method, and conclusion. Explain disagreements and retain citations to the passages that support the comparison.'],
    ['ministerial-one-pager', 'Minister Brief', 'Compress the supplied material into a one-page briefing: decision, three options, trade-offs, and open questions for legal or technical review.'],
  ] as const) if (!methods.has(id(key))) await call('/api/v1/methods', { kind: 'prompt', value: { id: id(key), name, instructions, variables: [], updatedAt: now } });
  if (!methods.has(id('research-skill'))) await call('/api/v1/methods', { kind: 'skill', value: { id: id('research-skill'), name: 'Evidence Review', description: 'A repeatable review method for research notes and policy drafts.', instructions: '1. State the decision and scope.\n2. List claims and their cited evidence.\n3. Check source provenance and applicability.\n4. Separate observation, interpretation, and recommendation.\n5. Examine alternatives and material uncertainty.\n6. Propose revisions with a traceable rationale.\n7. Retain questions that require technical or legal review.', updatedAt: now } });
  for (const definition of loadShippedSkillDefinitions(now)) {
    if (definition.kind !== 'skill') continue;
    if (!methods.has(definition.value.id)) await call('/api/v1/methods', { kind: 'skill', value: { ...definition.value, id: id(definition.value.id), name: definition.value.name } });
  }

  // Schedules need a resolvable demo connection. Prefer the OpenAI · Demo
  // connection from demo startup; fall back to the always-present local-replay.
  const connections = await call<{ connections: { id: string }[] }>('/api/v1/model-connections');
  if (!connections.connections.some((connection) => connection.id === 'demo-openai')) {
    await call('/api/v1/model-connections', { connection: { id: 'demo-openai', name: 'OpenAI · Demo', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:9/v1', models: ['Demo-Chat'], imageModels: [] } }, 'PUT');
  }
  const scheduleModel = { providerId: 'demo-openai', modelId: 'Demo-Chat', role: 'chat' as const };
  const schedules = await call<{ automations: { id: string }[] }>('/api/v1/automations');
  for (const [key, name, prompt] of [
    ['weekly-review', 'Evidence Review', 'Review the supplied research notes and list evidence gaps that need follow-up.'],
    ['briefing-prep', 'Briefing Prep', 'Draft an agenda from the supplied decision briefs, retaining unresolved questions.'],
    ['framework-digest', 'Framework Digest', 'Summarise newly attached framework notes into three distinctions and three questions for legal review.'],
  ] as const) if (!schedules.automations.some((item) => item.id === id(key))) await call('/api/v1/automations', { definition: { id: id(key), path: `automations/${id(key)}.automation.yaml`, name, enabled: false, recurrence: { frequency: 'weekly', interval: 1, weekdays: [1], localTime: '09:00', timezone: 'UTC', startDate: now.slice(0, 10) }, missedRunPolicy: 'skip', steps: [{ kind: 'prompt', prompt, modelReference: scheduleModel }], createdAt: now, updatedAt: now } });

  const lists = await call<{ lists: { id: string }[] }>('/api/v1/calendar/lists');
  if (!lists.lists.some((list) => list.id === id('calendar'))) {
    await call('/api/v1/calendar/lists', { list: { id: id('calendar'), name: 'Research Calendar', color: '#334155', visible: true, createdAt: now, updatedAt: now } });
  }
  const calendarEvents = [
    { key: 'standup-evidence', title: 'Evidence Desk', offset: 0, allDay: false, time: '09:30', description: 'Walk the open questions in the Frontier Governance program.' },
    { key: 'briefing-sync', title: 'Briefing Sync', offset: 1, allDay: false, time: '14:00', description: 'Align the Safety Case brief with consultation questions.' },
    { key: 'tabletop', title: 'Tabletop Drill', offset: 3, allDay: true, description: 'Run the essential-service disruption exercise.' },
    { key: 'framework-read', title: 'Framework Read', offset: 5, allDay: false, time: '11:00', description: 'Compare regulation and voluntary guidance passages for the Act vs RMF memo.' },
  ] as const;
  for (const event of calendarEvents) {
    await call('/api/v1/calendar/events', {
      event: {
        id: id(event.key),
        calendarId: id('calendar'),
        title: event.title,
        date: localDate(event.offset),
        ...(event.allDay ? { allDay: true } : { allDay: false, time: event.time }),
        timezone: 'UTC',
        description: event.description,
        createdAt: now,
        updatedAt: now,
      },
    });
  }
}
