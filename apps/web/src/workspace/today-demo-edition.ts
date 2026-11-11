import { renderEdition, type Edition } from './today-edition.policy';

/**
 * Authored newspaper for the showcase workspace: frontier oversight, evaluation
 * evidence, and standards reading. Links are the primary sources already listed
 * in the workspace notes; no live retrieval.
 */
export const DEMO_TODAY_EDITION: Edition = {
  introduction:
    'Today’s edition looks at three practical pieces of AI oversight work. A frontier deployment brief still needs a named decision owner before evidence can change the release. Evaluation claims stay useful only when they stay inside the reported test conditions. Reading the EU AI Act beside NIST guidance starts with legal status, not shared vocabulary.',
  stories: [
    {
      title: 'Release Authority',
      summary:
        'A useful oversight brief states who can approve, restrict, or escalate a frontier deployment, then lists the evidence that would change that decision. Intended use, foreseeable misuse, evaluation coverage, and residual uncertainty belong in separate lines so disagreements stay visible.',
      url: 'https://doi.org/10.6028/NIST.AI.100-1',
    },
    {
      title: 'Eval Boundaries',
      summary:
        'An internal safety benchmark result supports only the configuration that was measured: model version, access conditions, task set, and elicitation effort. Separating an observed failure from its estimated frequency in deployment keeps the review honest. Independent assessment and missing coverage belong in the record, not in a single confidence score.',
      url: 'https://doi.org/10.6028/NIST.AI.600-1',
    },
    {
      title: 'Obligation Gaps',
      summary:
        'Legal obligation, voluntary practice, and internal policy answer different questions. Record legal status, scope, audience, and edition date before comparing passages from the EU AI Act with NIST risk-management guidance. Thematic overlap is not a finding of compliance; keep applicability questions for legal review.',
      url: 'https://eur-lex.europa.eu/eli/reg/2024/1689/oj',
    },
  ],
};

/** Markdown form used by note export and localStorage, matching a live print. */
export function demoTodayEditionMarkdown(): string {
  return renderEdition(DEMO_TODAY_EDITION);
}
