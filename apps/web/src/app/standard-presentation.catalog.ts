import type { CraftPackage } from '@office/methods/domain';

export type StandardSourceLink = { label: string; url: string };

export type StandardComponentItem = { name: string; description: string };
export type StandardComponentGroup = { title: string; items: StandardComponentItem[] };
export type StandardComponentsOutline = { summary: string; groups: StandardComponentGroup[] };

export type StandardPresentation = {
  id: string;
  about: string;
  sources: StandardSourceLink[];
  note?: string;
  /** Used when the craft package has no packaged methods or actions to list. */
  components?: StandardComponentsOutline;
};

const presentations: StandardPresentation[] = [
  {
    id: 'gyroscopic-reasoning',
    about: 'A method for persistent human-AI cooperation. It retains closed exchanges (a human contribution, the artificial inference it informs, and the next human contribution) so oversight, correction, and direction remain available as memory and as structured experience for later work.',
    sources: [
      { label: 'Overview', url: 'https://gyrogovernance.com/#gyroscope' },
      { label: 'Source', url: 'https://github.com/gyrogovernance/tools#gyroscope' },
    ],
    components: {
      summary: 'Closed-exchange memory',
      groups: [
        {
          title: 'Memory',
          items: [
            {
              name: 'Closed exchanges',
              description: 'Each retained unit is one human contribution, the model reply it informed, and the next human contribution.',
            },
          ],
        },
      ],
    },
  },
  {
    id: 'the-human-mark',
    about: 'A structural taxonomy of AI safety risks. It classifies failures as displacements of human authority and agency in systems where artificial processes derive from human intelligence, and gives a complete four-risk map rather than a loose list of failure modes.',
    sources: [
      { label: 'Overview', url: 'https://gyrogovernance.com/#thm' },
      { label: 'Source', url: 'https://github.com/gyrogovernance/tools#thm' },
    ],
    components: {
      summary: '1 skill · Authority and Agency taxonomy',
      groups: [
        {
          title: 'Skills',
          items: [
            {
              name: 'The Human Mark',
              description: 'Grounding for when human direction, evidence, interpretation, or judgement must stay traceable to its source.',
            },
          ],
        },
        {
          title: 'Taxonomy',
          items: [
            {
              name: 'Authority and Agency classes',
              description: 'Direct Authority and Direct Agency are human base capacity; Indirect Authority and Indirect Agency are artificial and constitutively dependent on that human ancestry.',
            },
            {
              name: 'Alignment principles',
              description: 'Governance Management Traceability (GMT), Information Curation Variety (ICV), Inference Interaction Accountability (IIA), and Intelligence Cooperation Integrity (ICI).',
            },
          ],
        },
      ],
    },
  },
  {
    id: 'owasp-secure-agent-playbook',
    about: 'OWASP (Open Worldwide Application Security Project) is a nonprofit that publishes open security standards for software and AI. The Secure Agent Playbook is structured assessment methodology for AI agents, LLM applications, MCP servers, and application code: skills, agents, and Actions that follow documented OWASP procedures instead of ad-hoc prompts.',
    sources: [
      { label: 'Resources', url: 'https://owasp.github.io/secure-agent-playbook/' },
      { label: 'Source', url: 'https://github.com/OWASP/secure-agent-playbook' },
    ],
    note: 'CC BY 4.0; companion licenses in References.',
  },
  {
    id: 'ngo-playbook',
    about: 'Evidence-based skills for NGO and development program design, SDG alignment, monitoring and evaluation, and funding strategy. Adapted from NGO Agent Skills by Lijie Zhou so teams can map programs to the SDGs, build logframes and Theories of Change, screen against OECD-DAC criteria, and examine funding options with documented methods.',
    sources: [
      { label: 'Resources', url: 'https://lijiezhou.github.io/ngo-agent-skills-site/' },
      { label: 'Source', url: 'https://github.com/LijieZhou/ngo-agent-skills' },
      { label: 'UN SDGs', url: 'https://sdgs.un.org/goals' },
      { label: 'OECD DAC evaluation', url: 'https://www.oecd.org/dac/evaluation/' },
    ],
    note: 'CC BY-SA 4.0 for playbook skills; companion indexes cite UN, OECD, and UNDP sources.',
  },
];

const byId = new Map(presentations.map((item) => [item.id, item]));

export function standardPresentation(id: string): StandardPresentation | undefined {
  return byId.get(id);
}

/** Reference packs that share the OWASP playbook provenance. */
const owaspReferenceIds = new Set([
  'owasp-aisvs',
  'owasp-llm-top10',
  'owasp-opencre',
  'owasp-asvs',
  'owasp-fiasse',
  'owasp-masvs',
  'owasp-secure-code-prompts',
  'owasp-mastg',
  'owasp-agent-security-plays',
  'owasp-code-security-plays',
]);

const ngoReferenceIds = new Set([
  'ngo-playbook-guides',
  'ngo-sdg-national-context',
  'un-sdg-indicator-framework',
  'oecd-dac-evaluation',
  'undp-dpi-approach',
]);

const referenceAboutById: Record<string, string> = {
  'inspect-evaluation': 'Practical guides from the UK AI Security Institute for building and analysing evaluations.',
  'ai-security-engineering': 'Threat models, adversarial attacks and secure model development.',
  'eu-ai-act': 'Original Official Journal text of Regulation (EU) 2024/1689.',
  'nist-ai-rmf': 'NIST AI Risk Management Framework 1.0 guidance for Govern, Map, Measure, and Manage.',
  'nist-genai': 'NIST Generative AI Profile risks and suggested actions that extend the AI RMF.',
  'oecd-ai': 'OECD Recommendation on Artificial Intelligence for trustworthy AI and public policy.',
  'human-mark': 'Framework, grammar, specifications, and terms for Human Mark governance analysis.',
  'mechanistic-interpretability': 'Practical methods for investigating the internals of language models.',
  'owasp-aisvs': 'AI Application Security Verification Standard extracts from the OWASP Secure Agent Playbook.',
  'owasp-llm-top10': 'LLM Top 10 for LLM Applications extracts from the OWASP Secure Agent Playbook.',
  'owasp-opencre': 'OpenCRE cross-reference extracts bundled with the OWASP Secure Agent Playbook.',
  'owasp-asvs': 'Application Security Verification Standard extracts from the OWASP Secure Agent Playbook.',
  'owasp-fiasse': 'FIASSE securability engineering extracts from the OWASP Secure Agent Playbook.',
  'owasp-masvs': 'Mobile Application Security Verification Standard extracts from the OWASP Secure Agent Playbook.',
  'owasp-secure-code-prompts': 'Secure code prompt library bundled with the OWASP Secure Agent Playbook.',
  'owasp-mastg': 'Mobile Application Security Testing Guide extracts from the OWASP Secure Agent Playbook.',
  'owasp-agent-security-plays': 'Full AI and agent security plays from the OWASP Secure Agent Playbook.',
  'owasp-code-security-plays': 'Full code and infrastructure security plays from the OWASP Secure Agent Playbook.',
  'ngo-playbook-guides': 'Evidence and exclusion notes shipped with the NGO Agent Skills library.',
  'ngo-sdg-national-context': 'Optional national SDG indicator overlays used by the SDG alignment skill.',
  'un-sdg-indicator-framework': 'Companion index to the 17 Sustainable Development Goals and official UN sources.',
  'oecd-dac-evaluation': 'Companion index to the six OECD-DAC evaluation criteria for program self-screens.',
  'undp-dpi-approach': 'Companion index to UNDP digital public infrastructure guidance for inclusive program design.',
};

const referenceSourcesById: Record<string, StandardSourceLink[]> = {
  'human-mark': [
    { label: 'Overview', url: 'https://gyrogovernance.com/#thm' },
    { label: 'Source', url: 'https://github.com/gyrogovernance/tools#thm' },
  ],
  'inspect-evaluation': [{ label: 'Inspect', url: 'https://inspect.aisi.org.uk/' }],
  'mechanistic-interpretability': [{ label: 'TransformerLens', url: 'https://github.com/TransformerLensOrg/TransformerLens' }],
};

export function referencePresentationAbout(collectionId: string): string | undefined {
  return referenceAboutById[collectionId];
}

export function referencePresentationSources(collectionId: string, publisher: string, sourceUrl: string): StandardSourceLink[] {
  if (owaspReferenceIds.has(collectionId)) {
    return [
      { label: 'OWASP', url: 'https://owasp.org/' },
      { label: 'Secure Agent Playbook', url: 'https://github.com/OWASP/secure-agent-playbook' },
    ];
  }
  if (ngoReferenceIds.has(collectionId)) {
    return [
      { label: 'NGO Agent Skills', url: 'https://github.com/LijieZhou/ngo-agent-skills' },
      { label: 'UN SDGs', url: 'https://sdgs.un.org/goals' },
      { label: 'OECD DAC evaluation', url: 'https://www.oecd.org/dac/evaluation/' },
    ];
  }
  const known = referenceSourcesById[collectionId];
  if (known) return known;
  const links: StandardSourceLink[] = [];
  if (/^https?:\/\//i.test(sourceUrl)) links.push({ label: publisher || 'Source', url: sourceUrl });
  return links;
}

export function firstSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  const match = trimmed.match(/^(.+?[.!?])(?:\s|$)/);
  return match?.[1] ?? trimmed;
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** Short purpose line for catalog blurbs: drop triggers, lists after dashes, and em dashes. */
function shortPurpose(text: string): string {
  let value = text.trim();
  if (!value) return '';
  value = value.replace(/\s+Use when\b[\s\S]*$/i, '');
  value = value.split(/\s+[—–]\s+/)[0] ?? value;
  value = value.split(/\s+-\s+/)[0] ?? value;
  value = firstSentence(value).replace(/[—–]/g, ',');
  return value.trim();
}

/** One-line inventory of packaged methods and actions. */
export function craftContentsSummary(craft: CraftPackage): string | null {
  const agents = craft.methods.filter((item) => item.kind === 'preset').length;
  const skills = craft.methods.filter((item) => item.kind === 'skill').length;
  const prompts = craft.methods.filter((item) => item.kind === 'prompt').length;
  const actions = craft.automations.length;
  const parts: string[] = [];
  if (agents) parts.push(countLabel(agents, 'agent'));
  if (skills) parts.push(countLabel(skills, 'skill'));
  if (prompts) parts.push(countLabel(prompts, 'prompt'));
  if (actions) parts.push(countLabel(actions, 'action'));
  return parts.length ? parts.join(' · ') : null;
}

/**
 * Detailed Components outline for a Standard craft.
 * Composition crafts list packaged agents, skills, prompts, and actions from the package.
 * Built-in crafts fall back to the presentation catalog when the package has no listable components.
 */
export function craftComponentsOutline(craft: CraftPackage): StandardComponentsOutline | null {
  // Built-in crafts use curated outlines; package method lists are empty or a single skill.
  if (craft.runtime === 'gyroscopic-reasoning' || craft.runtime === 'human-mark') {
    return standardPresentation(craft.id)?.components ?? null;
  }

  const skillById = new Map(
    craft.methods.filter((item) => item.kind === 'skill').map((item) => [item.value.id, item.value] as const),
  );
  const groups: StandardComponentGroup[] = [];

  const agents = craft.methods.filter((item) => item.kind === 'preset');
  if (agents.length) {
    groups.push({
      title: 'Agents',
      items: agents.map((item) => {
        const skillNames = item.value.skillIds
          .map((id) => skillById.get(id)?.name)
          .filter((name): name is string => Boolean(name));
        return {
          name: item.value.name,
          description: skillNames.length ? skillNames.join(' · ') : '',
        };
      }),
    });
  }

  const skills = craft.methods.filter((item) => item.kind === 'skill');
  if (skills.length) {
    groups.push({
      title: 'Skills',
      items: skills.map((item) => ({
        name: item.value.name,
        description: shortPurpose(item.value.description),
      })),
    });
  }

  const prompts = craft.methods.filter((item) => item.kind === 'prompt');
  if (prompts.length) {
    groups.push({
      title: 'Prompts',
      items: prompts.map((item) => ({ name: item.value.name, description: '' })),
    });
  }

  if (craft.automations.length) {
    groups.push({
      title: 'Actions',
      items: craft.automations.map((automation) => ({ name: automation.name, description: '' })),
    });
  }

  if (!groups.length) return null;
  return {
    summary: craftContentsSummary(craft) ?? countLabel(groups.reduce((total, group) => total + group.items.length, 0), 'component'),
    groups,
  };
}
