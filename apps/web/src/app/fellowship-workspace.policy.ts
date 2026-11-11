export type FellowshipRouteId = 'economy' | 'employment' | 'education' | 'ecology';
export type FellowshipContributionId = 'report' | 'dataset' | 'evaluation' | 'tool';
export type FellowshipReviewAppId = 'policy-audit' | 'policy-report' | 'meta-evaluation';
export type FellowshipOfficeDestination = 'teams' | 'prompts' | 'glossary' | 'library' | 'programs' | 'craft';

export interface FellowshipPlan {
  route: FellowshipRouteId;
  contribution: FellowshipContributionId;
  question: string;
  parentId?: string;
}

export const fellowshipRoutes = [
  { id: 'economy', label: 'Economy', description: 'Institutions, resources, incentives, and power.' },
  { id: 'employment', label: 'Employment', description: 'Work, livelihoods, capability, and displacement.' },
  { id: 'education', label: 'Education', description: 'Learning, access, assessment, and development.' },
  { id: 'ecology', label: 'Ecology', description: 'Living systems, infrastructure, and shared environments.' },
] as const satisfies readonly { id: FellowshipRouteId; label: string; description: string }[];

export const fellowshipContributions = [
  { id: 'report', label: 'Report', description: 'A sourced account of a question, finding, or governance problem.' },
  { id: 'dataset', label: 'Dataset', description: 'Documented evidence that others can inspect and reuse.' },
  { id: 'evaluation', label: 'Evaluation', description: 'A repeatable test, audit, or analysis of a claim or system.' },
  { id: 'tool', label: 'Tool or protocol', description: 'A practical method that makes careful work easier to repeat.' },
] as const satisfies readonly { id: FellowshipContributionId; label: string; description: string }[];

const route = (id: FellowshipRouteId) => fellowshipRoutes.find((entry) => entry.id === id)!;
const contribution = (id: FellowshipContributionId) => fellowshipContributions.find((entry) => entry.id === id)!;
const cleanQuestion = (question: string) => question.trim().replace(/\s+/g, ' ');

export function fellowshipProgramInstruction(): string {
  return [
    'This is AIR Fellowship work. Help the person produce a useful, inspectable contribution without assuming a particular academic or technical background.',
    'Keep sources, direct observations, interpretations, AI-generated material, uncertainties, and open questions distinguishable.',
    'Do not invent evidence or authority. Preserve provenance and make limitations visible. The human contributor remains responsible for the work and any public submission.',
  ].join(' ');
}

export function fellowshipRouteInstruction(routeId: FellowshipRouteId): string {
  const selected = route(routeId);
  return `This project follows the AIR-Craft ${selected.label} route. Relate the work to ${selected.description.toLocaleLowerCase()} Keep the contribution concrete enough to review, reproduce, or reuse.`;
}

export function fellowshipResearchTitle(plan: FellowshipPlan, createdAt: Date): string {
  const subject = cleanQuestion(plan.question).slice(0, 84);
  const time = createdAt.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return `${contribution(plan.contribution).label}: ${subject} · ${time}`;
}

export function fellowshipResearchMarkdown(plan: FellowshipPlan): string {
  const selectedRoute = route(plan.route);
  const selectedContribution = contribution(plan.contribution);
  const question = cleanQuestion(plan.question);
  return `# ${question}

**AIR-Craft route:** ${selectedRoute.label}  
**Contribution:** ${selectedContribution.label}  
**Status:** Working research record

## Why this matters

Describe who or what is affected, the safety or governance relevance, and why this question is tractable now.

## Working question

${question}

## Sources and direct observations

Record each source, link, dataset, interview, or direct observation. Keep quotations and your interpretation separate.

## Claims and evidence

For each important claim, note the supporting evidence, counterevidence, assumptions, and confidence.

## Method and work log

Explain what you did. Mark AI-assisted searches, summaries, analysis, or drafting so another person can inspect the process.

## Findings or artifact

Develop the ${selectedContribution.label.toLocaleLowerCase()} here, or link to its working files.

## Limitations and open questions

State what the work does not establish, what could be wrong, and what should be checked next.

## AIR-Craft readiness

- [ ] Public name and GitHub profile are ready
- [ ] Fellowship introduction link is ready
- [ ] Primary artifact has a stable public link
- [ ] AIR-Craft Submission / THM risk checklist is complete
- [ ] Route, artifact type, title, and summary match the artifact
- [ ] AI assistance and human responsibility are disclosed clearly
`;
}

export function craftSubmissionTitle(createdAt: Date): string {
  return `AIR-Craft submission record · ${createdAt.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
}

export function craftSubmissionMarkdown(projectName = ''): string {
  return `# AIR-Craft submission record

Use this note to prepare the public GitHub submission. The public issue, not this private note, is the catalogue record.

## Fellow identity

**Public name:**  
**GitHub profile:**  
**Fellowship introduction URL:**

## Contribution

**Route:** Economy / Employment / Education / Ecology  
**Artifact type:** Dataset / Evaluation / Report / Tool / Protocol / Other  
**Title:** ${projectName.replace(/\s+/g, ' ').trim()}  
**One-paragraph summary:**  
**Primary public link:**

## AIR-Craft Submission / THM risk checklist

Complete the canonical checklist from the AIR-Craft submission guide. Record governance flow, risks, and the status and location of GTD, IVD, IAD, and IID where applicable.

## Evidence and provenance check

- [ ] Important claims point to inspectable evidence
- [ ] Direct sources and interpretation are distinguishable
- [ ] AI-assisted work is disclosed
- [ ] Limitations and unresolved questions are visible
- [ ] Links work without private access

## Peer feedback

**Feedback preference:**  
**Questions for reviewers:**

## Publication log

**Submission issue URL:**  
**Formal report URL, if any:**  
**Follow-up actions:**
`;
}
