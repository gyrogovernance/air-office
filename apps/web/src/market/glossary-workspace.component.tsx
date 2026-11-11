import { useEffect, useState } from 'react';
import { Streamdown } from 'streamdown';
import { MARKDOWN_COMPONENTS } from '../shared/markdown-table.component';
import type { ServiceClient } from '../shared/service-client.hook';
import { WorkspaceDestinationIcon } from '../app/workspace-destination-icon.component';
import { WorkspaceHero } from '../shared/workspace-hero.component';
import { Card, Chip, SearchField, Separator, Tabs, Tag, TagGroup } from '@heroui/react';

type GlossaryEntry = { id: string; title: string; content: string; collection: string; source: string; license: string | null };
type GlossaryView = 'definitions' | 'terminology' | 'grammar';
type GuidesView = 'protocols' | GlossaryView;
const referenceCollections = { terminology: 'Human Mark terminology', grammar: 'Human Mark grammar' };
const definitionCategory = (entry: GlossaryEntry) => entry.collection === 'Human Mark concepts' ? 'The Human Mark' : entry.collection === 'Workspace' ? 'AIR Office' : entry.collection;

const AIR_CRAFT_DOCS = 'https://github.com/gyrogovernance/air-craft/blob/main/docs';
const docLink = (path: string) => `${AIR_CRAFT_DOCS}/${path.replace(/^\//, '')}`;

type ProtocolDoc = { href: string; label: string };
type Protocol = {
  id: string;
  icon: string;
  title: string;
  subtitle: string;
  routeFocus: string;
  whatItIs: string;
  whatItIsFor: string;
  inPractice: string;
  tools?: string[];
  toolsNote?: string;
  toolLinks?: ProtocolDoc[];
  docs: ProtocolDoc[];
};

const PROTOCOLS: Protocol[] = [
  {
    id: 'thm',
    icon: '✋',
    title: 'The Human Mark (THM)',
    subtitle: 'Displacement taxonomy for AI safety',
    routeFocus: 'Focus: Education',
    whatItIs: 'An epistemic taxonomy for classifying AI safety failures as displacement patterns across Authority and Agency.',
    whatItIsFor: 'Consistent risk naming and communication across contributors, offices, and labs. Useful for jailbreak testing, deceptive alignment detection, control evaluations, mechanistic interpretability, and regulatory framing.',
    inPractice: 'A submission typically states the Direct sources, the Indirect processing used, and the displacement risks considered (GTD, IVD, IAD, IID). Published alignment work is expected to be consistent with ✋ the Human Mark.',
    tools: [
      'AI Inspector for browser-based evaluation and Human Mark review of AI outputs.',
      'GyroGem for technological literacy grounded in The Human Mark.',
      'GyroDiagnostics for structured evaluation and pathology detection.',
      'NotebookLM for interactive study of Human Mark vocabulary and examples (audio/video overviews, quiz, Q&A). A practical on-ramp before an AIR-Craft Submission.',
    ],
    toolLinks: [{ href: 'https://notebooklm.google.com/notebook/34e2d367-101a-4457-83fc-9c1049d29e32?authuser=1', label: 'Open NotebookLM' }],
    docs: [
      { href: docLink('the_human_mark/THM_Brief.md'), label: 'THM Brief' },
      { href: docLink('the_human_mark/THM.md'), label: 'The Human Mark' },
      { href: docLink('the_human_mark/THM_Terms.md'), label: 'THM Terms' },
      { href: docLink('the_human_mark/THM_Specs.md'), label: 'THM Specs' },
      { href: docLink('the_human_mark/THM_Grammar.md'), label: 'THM Grammar' },
      { href: docLink('the_human_mark/THM_Paper.md'), label: 'THM Paper' },
      { href: docLink('the_human_mark/THM_InTheWild.md'), label: 'THM In The Wild' },
      { href: docLink('the_human_mark/THM_Jailbreak.md'), label: 'THM Jailbreak guide' },
      { href: docLink('the_human_mark/THM_MechInterp.md'), label: 'THM Mechanistic Interpretability' },
      { href: 'https://github.com/gyrogovernance/tools', label: 'Behaviour Lab repository (gyrogovernance/tools)' },
    ],
  },
  {
    id: 'gyroscope',
    icon: '🔄',
    title: 'Gyroscope Protocol',
    subtitle: 'Coordination protocol for AI-assisted reasoning',
    routeFocus: 'Focus: Employment',
    whatItIs: 'A structured reasoning and coordination protocol for alignment-aware chat and iterative work.',
    whatItIsFor: 'Improving coherence, transparency, and stability of reasoning in AI-assisted workflows, without forcing conformity of content.',
    inPractice: 'Often used during drafting, research planning, and review comments so collaboration stays synchronized. Fellows can paste Quick Start or chat-guide text into ordinary model chats.',
    tools: [
      'Gyroscope Quick Start for immediate protocol use.',
      'Chat guides and example conversation for shared practice.',
      'AI Inspector when you want structured review of outputs produced with the protocol.',
    ],
    docs: [
      { href: docLink('gyroscope/Gyroscope_Quick_Start.md'), label: 'Gyroscope Quick Start' },
      { href: docLink('gyroscope/Gyroscope_Protocol_Specs.md'), label: 'Gyroscope Protocol Specs' },
      { href: docLink('gyroscope/Gyroscope_Protocol_2_Specs.md'), label: 'Gyroscope Protocol 2 Specs' },
      { href: docLink('gyroscope/gyroscope_chat_guides.txt'), label: 'Gyroscope chat guides' },
      { href: docLink('gyroscope/example_conversation.md'), label: 'Example conversation' },
      { href: 'https://github.com/gyrogovernance/tools', label: 'Behaviour Lab repository (gyrogovernance/tools)' },
    ],
  },
  {
    id: 'ggg',
    icon: '🌐',
    title: 'Gyroscopic Global Governance (GGG)',
    subtitle: 'Unified Scope governance and simulation',
    routeFocus: 'Focus: Ecology',
    whatItIs: 'A multi-domain governance framework and simulator for the Unified Scope across Economy, Employment, Education, and Ecology.',
    whatItIsFor: 'Scenario testing and intervention design that connects domains instead of treating crises in isolation.',
    inPractice: 'Used to frame AIR-Craft projects as interventions that connect across routes. Useful for labs and funders who need a shared scope story for portfolio and program design.',
    tools: [
      'GGG Paper, Report, and Results for framework and simulation reading.',
      'Published simulator results article for an interactive multi-domain overview.',
    ],
    docs: [
      { href: docLink('post-agi-economy/GGG_Paper.md'), label: 'GGG Paper' },
      { href: docLink('post-agi-economy/GGG_Report.md'), label: 'GGG Report' },
      { href: docLink('post-agi-economy/GGG_Results.md'), label: 'GGG Results' },
      { href: 'https://gyrogovernance.com/articles/ggg-simulator-results/', label: 'GGG simulator results article' },
      { href: 'https://github.com/gyrogovernance/tools', label: 'Behaviour Lab repository (gyrogovernance/tools)' },
    ],
  },
  {
    id: 'cgm',
    icon: '⚗️',
    title: 'Common Governance Model (CGM)',
    subtitle: 'Formal foundations for the four capacities',
    routeFocus: 'Focus: Economy',
    whatItIs: 'A formal deductive foundation establishing the four capacities as conditions for intelligibility.',
    whatItIsFor: 'Foundational consistency across governance claims and alignment reasoning, including vocabulary shared by THM, Gyroscope, and GGG.',
    inPractice: 'In AIR-Craft work, CGM most often appears as vocabulary discipline and consistency checks, rather than as a separate deliverable. Fellows use it to keep Authority and Agency framed as capacities, not entity identities.',
    toolsNote: 'CGM is primarily documentary and scientific. Use the science repository and CGM dataset when you need axioms, proofs, or structured Q&A material for research and evaluation.',
    docs: [
      { href: 'https://github.com/gyrogovernance/science/blob/main/docs/CommonGovernanceModel.md', label: 'Common Governance Model' },
      { href: 'https://github.com/gyrogovernance/science/blob/main/docs/CGM_Paper.md', label: 'CGM Paper' },
      { href: 'https://github.com/gyrogovernance/science/blob/main/docs/CGM_Logic.md', label: 'CGM Logic' },
      { href: 'https://github.com/gyrogovernance/science/tree/main/docs/datasets', label: 'CGM dataset' },
      { href: 'https://github.com/gyrogovernance/science', label: 'Science repository' },
    ],
  },
];

export function GlossaryWorkspace({ client }: { client: ServiceClient; appearance?: 'light' | 'dark' }) {
  const [entries, setEntries] = useState<GlossaryEntry[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [view, setView] = useState<GuidesView>('protocols');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    void client.json<{ entries: GlossaryEntry[] }>('/api/v1/lab/glossary').then((result) => {
      if (alive) setEntries(result.entries);
    }).catch((reason: unknown) => { if (alive) setError(reason instanceof Error ? reason.message : 'Guides unavailable.'); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [client]);

  const definitions = entries.filter((entry) => !Object.values(referenceCollections).includes(entry.collection));
  const categories = [...new Set(definitions.map(definitionCategory))].sort((left, right) => left.localeCompare(right));
  const needle = query.trim().toLocaleLowerCase();
  const visible = definitions.filter((entry) => (category === 'all' || definitionCategory(entry) === category) && (entry.title + ' ' + entry.content + ' ' + entry.source).toLocaleLowerCase().includes(needle)).sort((left, right) => left.title.localeCompare(right.title));
  const letters = [...new Set(visible.map((entry) => entry.title.charAt(0).toLocaleUpperCase()))];
  const referenceEntries = view === 'terminology' || view === 'grammar' ? entries.filter((entry) => entry.collection === referenceCollections[view]) : [];
  const reference = referenceEntries.map((entry) => entry.content).join('\n\n');

  return <section className="glossary-workspace workspace-hero-page" data-workspace="guides" aria-label="Guides">
    <WorkspaceHero icon={<WorkspaceDestinationIcon name="glossary" size={56} />} subtitle="Protocols and references for doing the work." />
    <Tabs className="glossary-views" selectedKey={view} onSelectionChange={(key) => { if (key === 'protocols' || key === 'definitions' || key === 'terminology' || key === 'grammar') setView(key); }}>
        <Tabs.ListContainer>
          <Tabs.List aria-label="Guides views">
            <Tabs.Tab id="protocols" className="whitespace-nowrap">Protocols<Tabs.Indicator/></Tabs.Tab>
            <Tabs.Tab id="definitions" className="whitespace-nowrap">Definitions<Tabs.Indicator/></Tabs.Tab>
            <Tabs.Tab id="terminology" className="whitespace-nowrap">Terminology guide<Tabs.Indicator/></Tabs.Tab>
            <Tabs.Tab id="grammar" className="whitespace-nowrap">Grammar guide<Tabs.Indicator/></Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>
    </Tabs>
    {error && <p className="sidebar-error" role="alert">{error}</p>}
    {view === 'protocols' ? <div className="protocol-list" aria-label="Protocols">
      {PROTOCOLS.map((protocol) => (
        <Card className="protocol-card" key={protocol.id} aria-labelledby={`protocol-${protocol.id}-title`} render={(props) => <article {...props} />}>
          <Card.Header className="protocol-card-header">
            <span className="protocol-card-icon" aria-hidden="true">{protocol.icon}</span>
            <div className="protocol-card-heading"><Card.Title id={`protocol-${protocol.id}-title`} render={(props) => <h2 {...props} />}>{protocol.title}</Card.Title><Card.Description>{protocol.subtitle}</Card.Description></div>
            <span className="protocol-route-focus">{protocol.routeFocus}</span>
          </Card.Header>
          <Separator />
          <Card.Content className="gap-3">
          <dl className="protocol-card-body">
            <div><dt>What it is</dt><dd>{protocol.whatItIs}</dd></div>
            <div><dt>What it is for</dt><dd>{protocol.whatItIsFor}</dd></div>
            <div><dt>In practice</dt><dd>{protocol.inPractice}</dd></div>
          </dl>
          {Boolean(protocol.toolsNote || protocol.tools?.length) && <><Separator /><div className="protocol-card-section"><h3>Tools</h3>{protocol.toolsNote && <p className="protocol-card-note">{protocol.toolsNote}</p>}{protocol.tools?.length ? <ul>{protocol.tools.map((tool) => <li key={tool}>{tool}</li>)}</ul> : null}{protocol.toolLinks?.length ? <ul className="protocol-docs">{protocol.toolLinks.map((doc) => <li key={doc.href}><a href={doc.href} target="_blank" rel="noopener noreferrer">{doc.label} <span aria-hidden="true">↗</span></a></li>)}</ul> : null}</div></>}
          <Separator /><div className="protocol-card-section"><h3>Documentation</h3><ul className="protocol-docs">{protocol.docs.map((doc) => <li key={doc.href}><a href={doc.href} target="_blank" rel="noopener noreferrer">{doc.label} <span aria-hidden="true">↗</span></a></li>)}</ul></div>
          </Card.Content>
        </Card>
      ))}
    </div> : view === 'definitions' ? <>
      <div className="glossary-toolbar"><SearchField aria-label="Search glossary" value={query} onChange={setQuery}><SearchField.Group><SearchField.SearchIcon /><SearchField.Input placeholder="Find a word or concept..." /><SearchField.ClearButton /></SearchField.Group></SearchField><span className="glossary-count" role="status">{loading ? 'Loading...' : visible.length + (visible.length === 1 ? ' definition' : ' definitions')}</span></div>
      <nav className="glossary-alphabet" aria-label="Jump to letter">{'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((letter) => letters.includes(letter) ? <a key={letter} href={'#glossary-letter-' + letter} onClick={(event) => { event.preventDefault(); document.getElementById('glossary-letter-' + letter)?.scrollIntoView({ block: 'start' }); }}>{letter}</a> : <span key={letter}>{letter}</span>)}</nav>
      <TagGroup aria-label="Definition categories" selectionMode="single" disallowEmptySelection selectedKeys={[category]} onSelectionChange={(keys) => { if (keys !== 'all') setCategory(String([...keys][0] ?? 'all')); }}>
        <TagGroup.List className="glossary-categories"><Tag id="all">All categories</Tag>{categories.map((name) => <Tag id={name} key={name}>{name}</Tag>)}</TagGroup.List>
      </TagGroup>
      <div className="glossary-definitions" aria-label="Glossary terms">{letters.map((letter) => <section className="glossary-letter-group" key={letter} id={'glossary-letter-' + letter}><h2>{letter}</h2><div className="glossary-letter-entries">{visible.filter((entry) => entry.title.charAt(0).toLocaleUpperCase() === letter).map((entry) => <Card className="glossary-definition" key={entry.id} render={(props) => <article {...props} />}>
        <Card.Header className="glossary-definition-header">
          <Card.Title className="glossary-term-title" render={(props) => <h3 {...props} />}>{entry.title}</Card.Title>
          <Chip size="sm" variant="soft">{definitionCategory(entry)}</Chip>
        </Card.Header>
        <Separator />
        <Card.Content className="glossary-entry prose"><Streamdown components={MARKDOWN_COMPONENTS} mode="static" parseIncompleteMarkdown={false} controls={{ code: { copy: true, download: false }, table: false, mermaid: false }}>{entry.content}</Streamdown></Card.Content>
        {entry.license && <><Separator /><Card.Footer className="glossary-provenance">{entry.license}</Card.Footer></>}
      </Card>)}</div></section>)}
        {!visible.length && !error && <p className="glossary-empty">{loading ? 'Loading guides...' : 'No terms match these filters.'}</p>}
      </div>
    </> : <Card className="glossary-reference-card"><Card.Header className="glossary-reference-label"><span>THE HUMAN MARK</span><span>{referenceEntries[0]?.license ?? 'CC BY-SA 4.0'}</span></Card.Header><Separator /><Card.Content><div className="glossary-reference prose">{reference ? <Streamdown components={MARKDOWN_COMPONENTS} mode="static" parseIncompleteMarkdown={false} controls={{ code: { copy: true, download: false }, table: false, mermaid: false }}>{reference}</Streamdown> : <p className="method-hint">{loading ? 'Loading reference...' : 'This reference is unavailable.'}</p>}</div></Card.Content></Card>}
  </section>;
}
