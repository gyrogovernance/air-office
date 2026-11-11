import type { ConversationSummary } from '@office/chat/domain';
import { useEffect, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Search01Icon,
  File01Icon,
  Database01Icon,
  Leaf01Icon,
  Briefcase01Icon,
  Mortarboard01Icon,
  ChartLineData01Icon,
  ToolsIcon,
  ArrowUpRight01Icon,
} from '@hugeicons/core-free-icons';
import { FellowshipActivity } from './fellowship-activity.component';
import { ResearchScope } from './research-scope.component';
import { Button, Card, Fieldset, Tag, TagGroup, TextArea, Separator, buttonVariants } from '@heroui/react';
import { DashboardCollection, DashboardViews, WorkspaceDashboard } from '../shared/collection-dashboard.component';
import { AlignmentCrafts } from './alignment-crafts.component';
import { WorkspaceDestinationIcon } from './workspace-destination-icon.component';
import {
  fellowshipContributions,
  fellowshipRoutes,
  type FellowshipContributionId,
  type FellowshipOfficeDestination,
  type FellowshipPlan,
  type FellowshipReviewAppId,
  type FellowshipRouteId,
} from './fellowship-workspace.policy';
import {
  BUNDLED_AIR_CRAFT_PROJECTS,
  CURATED_EXTERNAL_PRODUCTS,
  airCraftDomainCount,
  airCraftDomainFilters,
  fetchAirCraftProjects,
  filterAirCraftProjects,
  groupAirCraftProjects,
  type AirCraftProject,
} from './craft-catalog.policy';

const FELLOWSHIP_INTRODUCTION_URL = 'https://github.com/gyrogovernance/air-craft/discussions/new?category=introductions';
const FELLOW_AGREEMENT_URL = 'https://github.com/gyrogovernance/air-craft/blob/main/FELLOW_AGREEMENT.md';
const SUBMISSION_GUIDE_URL = 'https://github.com/gyrogovernance/air-craft/blob/main/protocols/submissions/README.md';
const SUBMIT_URL = 'https://github.com/gyrogovernance/air-craft/issues/new?template=1-submit.yml';
const REPORT_URL = 'https://github.com/gyrogovernance/air-craft/issues/new?template=2-report.yml';
const routeIcons = { economy: ChartLineData01Icon, employment: Briefcase01Icon, education: Mortarboard01Icon, ecology: Leaf01Icon };
const contributionIcons = { report: File01Icon, dataset: Database01Icon, evaluation: Search01Icon, tool: ToolsIcon };

interface FellowshipWorkspaceProps {
  chats?: ConversationSummary[];
  onOpenChat?: (id: string) => void;
  onOpenNote?: (id: string) => void;
  onPreparePackage?: () => void;
  initialScopeId?: string;
  onScopeChange?: (id: string) => void;
  onStartChat?: (id: string) => Promise<void>;
  onCreateWorkspace: (plan: FellowshipPlan) => Promise<string | void>;
  onCreateSubmissionDraft: (parentId?: string) => Promise<void>;
  onOpenDestination: (destination: FellowshipOfficeDestination, scopeId?: string) => void;
  onOpenReviewApp: (appId: FellowshipReviewAppId, scopeId?: string) => void | Promise<void>;
}

function ExternalLink({ href, children, primary = false }: { href: string; children: React.ReactNode; primary?: boolean }) {
  return (
    <a className={buttonVariants({ variant: primary ? 'primary' : 'secondary', size: 'sm' })} href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

export function FellowshipWorkspace({
  chats = [],
  onOpenChat,
  onOpenNote,
  onPreparePackage,
  onCreateWorkspace,
  onCreateSubmissionDraft,
  onOpenDestination,
  onOpenReviewApp,
  initialScopeId,
  onScopeChange,
  onStartChat,
}: FellowshipWorkspaceProps) {
  const [route, setRoute] = useState<FellowshipRouteId>('economy');
  const [view, setView] = useState<'work' | 'start' | 'craft'>('work');
  const [contribution, setContribution] = useState<FellowshipContributionId>('report');
  const questionKey = `office.fellowship-question:${localStorage.getItem('office.development.demo') === 'on' ? 'demo' : 'personal'}`;
  const [question, setQuestion] = useState(() => localStorage.getItem(questionKey) ?? '');
  useEffect(() => { if (question) localStorage.setItem(questionKey, question); else localStorage.removeItem(questionKey); }, [question, questionKey]);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState('');
  const [parentId, setParentId] = useState(initialScopeId ?? '');
  useEffect(() => {
    setParentId(initialScopeId ?? '');
  }, [initialScopeId]);
  const selectScope = (id: string) => {
    setParentId(id);
    onScopeChange?.(id);
  };
  async function openReview(appId: FellowshipReviewAppId) {
    if (!parentId) {
      setStatus('Choose a project to review its material.');
      return;
    }
    setPending(true);
    setStatus('');
    try {
      await onOpenReviewApp(appId, parentId);
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : 'The review could not be opened.');
    } finally {
      setPending(false);
    }
  }
  async function startChat() {
    if (!parentId || !onStartChat) return;
    setPending(true);
    setStatus('');
    try {
      await onStartChat(parentId);
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : 'The project chat could not be opened.');
    } finally {
      setPending(false);
    }
  }

  const createWorkspace = async () => {
    const normalized = question.trim();
    if (!normalized || pending) return;
    setPending(true);
    setStatus('');
    try {
      const projectId = await onCreateWorkspace({ route, contribution, question: normalized, ...(parentId ? { parentId } : {}) });
      if (projectId) selectScope(projectId);
      setQuestion('');
      setView('work');
      setStatus('Your research record is ready in the project.');
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : 'The Fellowship workspace could not be created.');
    } finally {
      setPending(false);
    }
  };

  const createDraft = async () => {
    if (pending || !parentId) return;
    setPending(true);
    setStatus('');
    try {
      await onCreateSubmissionDraft(parentId || undefined);
      setStatus('Your submission record is ready in your project.');
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : 'The submission record could not be created.');
    } finally {
      setPending(false);
    }
  };

  const workView = (
    <div className="fellowship-dashboard-content">
      <Card className="collection-dashboard__form fellowship-panel fellowship-current" render={(props) => <section {...props} />}>
        <div className="fellowship-current-header">
          <div className="fellowship-current-icon" aria-hidden="true"><HugeiconsIcon icon={ChartLineData01Icon} size={26} /></div>
          <Card.Header><Card.Title render={(props) => <h2 {...props} />}>Continue working</Card.Title><Card.Description>Pick up where you left off.</Card.Description></Card.Header>
        </div>
        <ResearchScope value={parentId} onChange={selectScope} allowProgram />
        <FellowshipActivity chats={chats} onOpenChat={onOpenChat} scopeId={parentId} onOpenNote={(id) => onOpenNote ? onOpenNote(id) : onOpenDestination('library', parentId)} onOpenProject={(id) => { selectScope(id); onOpenDestination('programs', id); }} />
        <div className="fellowship-action-row">
          <Button size="sm" onPress={() => onOpenDestination('programs', parentId || undefined)}>Open Programs</Button>
          {onStartChat && <Button variant="secondary" size="sm" isDisabled={pending || !parentId} onPress={() => void startChat()}>Project chat</Button>}
          <Button variant="secondary" size="sm" onPress={() => onOpenDestination('library', parentId || undefined)}>Open Library</Button>
        </div>
      </Card>
      <Card className="collection-dashboard__form fellowship-panel fellowship-work-panel" render={(props) => <section {...props} />}>
        <Card.Header><Card.Title render={(props) => <h2 {...props} />}><HugeiconsIcon icon={ToolsIcon} size={20} aria-hidden="true" /> Your toolkit</Card.Title></Card.Header>
        <div className="fellowship-card-grid">
          <Card variant="secondary" className="fellowship-inner-card fellowship-tool-card market-tone-science">
            <span className="market-topic-art" aria-hidden="true"><HugeiconsIcon icon={Search01Icon} size={26} /></span>
            <Card.Title render={(props) => <h3 {...props} />}>Explore</Card.Title>
            <Card.Description>Explore ideas with your agents, notes, and guides.</Card.Description>
            <div className="fellowship-action-row"><Button variant="secondary" size="sm" onPress={() => onOpenDestination('teams')}>Teams <HugeiconsIcon icon={ArrowUpRight01Icon} size={15} aria-hidden="true" /></Button><Button variant="tertiary" size="sm" onPress={() => onOpenDestination('prompts')}>Notes</Button><Button variant="tertiary" size="sm" onPress={() => onOpenDestination('glossary')}>Guides</Button></div>
          </Card>
          <Card variant="secondary" className="fellowship-inner-card fellowship-tool-card market-tone-governance">
            <span className="market-topic-art" aria-hidden="true"><HugeiconsIcon icon={Database01Icon} size={26} /></span>
            <Card.Title render={(props) => <h3 {...props} />}>Review</Card.Title>
            <Card.Description>Examine claims, evidence, and findings in your project.</Card.Description>
            <div className="fellowship-action-row"><Button variant="secondary" size="sm" isDisabled={pending || !parentId} onPress={() => void openReview('policy-audit')}>Map evidence</Button><Button variant="tertiary" size="sm" isDisabled={pending || !parentId} onPress={() => void openReview('meta-evaluation')}>Evaluate</Button></div>
          </Card>
          <Card variant="secondary" className="fellowship-inner-card fellowship-tool-card market-tone-security">
            <span className="market-topic-art" aria-hidden="true"><HugeiconsIcon icon={File01Icon} size={26} /></span>
            <Card.Title render={(props) => <h3 {...props} />}>Create</Card.Title>
            <Card.Description>Develop a report or prepare material for a Craft.</Card.Description>
            <div className="fellowship-action-row"><Button variant="secondary" size="sm" isDisabled={pending || !parentId} onPress={() => void openReview('policy-report')}>Build report</Button><Button variant="tertiary" size="sm" onPress={() => setView('craft')}>Explore Crafts</Button></div>
          </Card>
        </div>
      </Card>
    </div>
  );

  const startView = (
    <Card className="collection-dashboard__form fellowship-panel research-builder" render={(props) => <section {...props} />}>
      <Card.Header><Card.Title render={(props) => <h2 {...props} />}><HugeiconsIcon icon={Search01Icon} size={20} aria-hidden="true" /> Start a project</Card.Title><Card.Description>Bring a question, a program, and a contribution together.</Card.Description></Card.Header>
      <label className="research-question-field"><span>Working question</span><TextArea value={question} onChange={(event) => setQuestion(event.target.value)} rows={3} placeholder="What would you like to investigate?" /></label>
      <ResearchScope value={parentId} onChange={selectScope} allowProgram createProject onManage={() => onOpenDestination('programs', parentId || undefined)} />
      <div className="research-options">
        <Fieldset className="research-choice-group"><Fieldset.Legend>Area</Fieldset.Legend><div className="research-route-grid">
          {fellowshipRoutes.map((option) => <Button key={option.id} variant="secondary" data-route={option.id} aria-pressed={route === option.id} onPress={() => setRoute(option.id)}><HugeiconsIcon icon={routeIcons[option.id]} size={30} aria-hidden="true" /><strong>{option.label}</strong><span>{option.description}</span></Button>)}
        </div></Fieldset>
        <Fieldset className="research-choice-group"><Fieldset.Legend>Contribution</Fieldset.Legend><div className="research-contribution-grid">
          {fellowshipContributions.map((option) => <Button key={option.id} variant="secondary" aria-pressed={contribution === option.id} onPress={() => setContribution(option.id)}><HugeiconsIcon icon={contributionIcons[option.id]} size={30} aria-hidden="true" /><strong>{option.label}</strong><span>{option.description}</span></Button>)}
        </div></Fieldset>
      </div>
      <Separator />
      <div className="fellowship-action-row"><Button size="sm" isDisabled={!question.trim() || pending} onPress={() => void createWorkspace()}>{pending ? 'Creating project...' : 'Start project'}</Button></div>
    </Card>
  );

  const craftView = (
    <div className="fellowship-dashboard-content">
      <Card className="collection-dashboard__form fellowship-panel" render={(props) => <section {...props} />}>
        <Card.Header><Card.Title render={(props) => <h2 {...props} />}><HugeiconsIcon icon={ToolsIcon} size={20} aria-hidden="true" /> Crafts</Card.Title><Card.Description>Package your project for reuse or sharing.</Card.Description></Card.Header>
        <ResearchScope value={parentId} onChange={selectScope} allowProgram onManage={() => onOpenDestination('programs', parentId || undefined)} />
        <div className="fellowship-card-grid fellowship-card-grid--two">
          <Card variant="secondary" className="fellowship-inner-card fellowship-tool-card market-tone-science"><span className="market-topic-art" aria-hidden="true"><HugeiconsIcon icon={ToolsIcon} size={26} /></span><Card.Title render={(props) => <h3 {...props} />}>Use in Office</Card.Title><Card.Description>Explore Crafts that bring agents, actions, skills, and resources together.</Card.Description><div className="fellowship-action-row"><Button size="sm" isDisabled={!onPreparePackage} onPress={onPreparePackage}>Prepare package</Button><Button variant="tertiary" size="sm" onPress={() => onOpenDestination('teams')}>Open Teams</Button></div></Card>
          <Card variant="secondary" className="fellowship-inner-card fellowship-tool-card market-tone-governance"><span className="market-topic-art" aria-hidden="true"><HugeiconsIcon icon={File01Icon} size={26} /></span><Card.Title render={(props) => <h3 {...props} />}>Prepare to share</Card.Title><Card.Description>Prepare a submission record and review your work.</Card.Description><div className="fellowship-action-row"><Button variant="secondary" size="sm" isDisabled={pending || !parentId} onPress={() => void createDraft()}>{pending ? 'Preparing...' : 'Prepare record'}</Button><Button variant="tertiary" size="sm" isDisabled={pending || !parentId} onPress={() => void openReview('policy-report')}>Review report</Button></div></Card>
        </div>
      </Card>
      <Card className="collection-dashboard__form fellowship-panel" render={(props) => <section {...props} />}>
        <Card.Header><Card.Title render={(props) => <h2 {...props} />}><HugeiconsIcon icon={File01Icon} size={20} aria-hidden="true" /> Share and participate</Card.Title><Card.Description>Find the contribution guide, submit work, or join the Fellowship.</Card.Description></Card.Header>
        <div className="fellowship-action-row"><ExternalLink href={SUBMISSION_GUIDE_URL}>Submission guide</ExternalLink><ExternalLink primary href={SUBMIT_URL}>Submit work</ExternalLink><ExternalLink href={REPORT_URL}>File a report</ExternalLink><ExternalLink href={FELLOW_AGREEMENT_URL}>Fellow agreement</ExternalLink><ExternalLink href={FELLOWSHIP_INTRODUCTION_URL}>Introduce yourself</ExternalLink></div>
      </Card>
    </div>
  );

  return (
    <WorkspaceDashboard title="Fellowship" hero={{ icon: <WorkspaceDestinationIcon name="fellowship" size={56} />, subtitle: 'Develop work together, from a question to a Craft.' }}>
      <div className="fellowship-dashboard">
        <DashboardViews label="Fellowship views" selectedKey={view} onSelect={setView} views={[
          { id: 'work', label: 'Your work', actions: <Button size="sm" onPress={() => setView('start')}>New project</Button>, content: workView },
          { id: 'start', label: 'Start', actions: <Button variant="secondary" size="sm" onPress={() => setView('work')}>Your work</Button>, content: startView },
          { id: 'craft', label: 'Crafts', actions: <Button size="sm" onPress={() => onOpenDestination('craft')}>Open Crafts</Button>, content: craftView },
        ]} />
        {status && <p className="research-status" role="status">{status}</p>}
      </div>
    </WorkspaceDashboard>
  );
}

export function CraftWorkspace({
  onOpenFellowship,
  onManageResources,
  onOpenKnowledge,
  onOpenMarket,
  onChanged,
}: {
  onOpenFellowship?: () => void;
  onManageResources?: () => void;
  onOpenKnowledge?: () => void;
  onOpenMarket?: (request: { category: 'skill' | 'mcp'; query?: string; group?: 'News & research' | 'Government & money' }) => void;
  onChanged?: () => Promise<void>;
}) {
  const [projects, setProjects] = useState<AirCraftProject[]>([...BUNDLED_AIR_CRAFT_PROJECTS, ...CURATED_EXTERNAL_PRODUCTS]);
  const [view, setView] = useState<'projects' | 'crafts'>('crafts');
  const [domain, setDomain] = useState('All');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [catalogSource, setCatalogSource] = useState('Bundled AIR-Craft catalogue snapshot');

  useEffect(() => {
    const controller = new AbortController();
    fetchAirCraftProjects(controller.signal)
      .then((fetched) => {
        if (!controller.signal.aborted) {
          setProjects([...fetched, ...CURATED_EXTERNAL_PRODUCTS.filter(item => !fetched.some(project => project.linkUrl === item.linkUrl))]);
          setCatalogSource('AIR-Craft catalogue on GitHub');
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) console.error('AIR-Craft catalogue fetch failed; using bundled snapshot.', reason);
      });
    return () => controller.abort();
  }, []);

  const searched = filterAirCraftProjects(projects, query);
  const visible = domain === 'All' ? searched : searched.filter((project) => project.domain === domain);
  const groups = groupAirCraftProjects(visible);
  const filters = airCraftDomainFilters(projects);
  const ordered = groups.flatMap((group) => group.projects);
  const projectId = (project: AirCraftProject) => `${project.domain}:${project.title}`;
  const selected = ordered.find((project) => projectId(project) === selectedId) ?? ordered[0];
  const fellowshipAction = onOpenFellowship ? (
    <Button size="sm" onPress={onOpenFellowship}>
      Open Fellowship
    </Button>
  ) : (
    <ExternalLink primary href={FELLOWSHIP_INTRODUCTION_URL}>
      Open Fellowship
    </ExternalLink>
  );

  return (
    <WorkspaceDashboard
      title="Craft"
      hero={{
        icon: <WorkspaceDestinationIcon name="craft" size={56} />,
        subtitle: 'Verified safety and good governance products.',
      }}
    >
      <DashboardViews
        label="Craft views"
        selectedKey={view}
        onSelect={setView}
        views={[
          {
            id: 'crafts',
            label: 'Standards',
            actions: (
              <Button size="sm" onPress={() => onManageResources?.()}>
                Manage
              </Button>
            ),
            content: <div className="fellowship-dashboard-content">
              <Card variant="tertiary" className="settings-section-intro collection-preview-bubble p-3"><Card.Description>Verified by Gyro Governance Lab.</Card.Description></Card>
              <AlignmentCrafts onManage={() => onManageResources?.()} onOpenKnowledge={() => onOpenKnowledge ? onOpenKnowledge() : onManageResources?.()} onChanged={onChanged} />
            </div>,
          },
          {
            id: 'projects',
            label: 'Products',
            actions: fellowshipAction,
            content: (
              <>
                <Card className="gap-3 p-3">
                  <TagGroup
                    aria-label="Filter projects by route"
                    selectionMode="single"
                    disallowEmptySelection
                    selectedKeys={[domain]}
                    onSelectionChange={(keys) => {
                      if (keys === 'all') return;
                      const selected = keys.values().next().value;
                      if (selected !== undefined) setDomain(String(selected));
                    }}
                  >
                    <TagGroup.List>
                      {filters.map((name) => (
                        <Tag key={name} id={name} textValue={name} className="gap-2 whitespace-nowrap">
                          <span>{name}</span>
                          <span className="text-xs">{airCraftDomainCount(projects, name)}</span>
                        </Tag>
                      ))}
                    </TagGroup.List>
                  </TagGroup>
                </Card>
                <DashboardCollection
                  listLabel="Craft projects"
                  search={{ value: query, onChange: setQuery, placeholder: 'Search projects...', label: 'Search projects' }}
                  items={ordered.map((project) => ({
                    id: projectId(project),
                    title: project.title,
                    description: project.domain,
                    section: project.domain,
                    icon: (
                      <span aria-hidden="true" className="text-xl">
                        {project.emoji}
                      </span>
                    ),
                  }))}
                  selectedId={selected ? projectId(selected) : null}
                  onSelect={setSelectedId}
                  preview={
                    selected
                      ? {
                          title: selected.title,
                          description: selected.domain,
                          content: (
                            <>
                              <p className="collection-dashboard__prose text-sm leading-relaxed">{selected.description}</p>
                              <h3 className="text-sm font-medium">Source</h3>
                              <p className="text-sm text-muted">{selected.publisher ?? catalogSource}</p>
                              {selected.sources && <div className="fellowship-action-row">{selected.sources.map(source => <ExternalLink key={source.name} href={source.url}>{source.name}</ExternalLink>)}</div>}
                              {!selected.publisher && <a
                                href="https://github.com/gyrogovernance/air-craft/blob/main/AIR-Craft.md"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm underline"
                              >
                                View the project catalogue
                              </a>}
                            </>
                          ),
                          actions: (
                            <>
                              {selected.marketCategory && onOpenMarket && <Button size="sm" onPress={() => { if (selected.marketCategory) onOpenMarket({ category: selected.marketCategory, query: selected.marketQuery, group: selected.marketGroup }); }}>Open in Market</Button>}
                              <ExternalLink primary={!selected.marketCategory} href={selected.linkUrl}>{selected.linkText}</ExternalLink>
                            </>
                          ),
                        }
                      : null
                  }
                  empty={{ title: 'No matching projects', description: 'Try another search or route filter.' }}
                />
                <Card className="gap-3 p-3" role="region" aria-labelledby="craft-submit-title">
                  <Card.Header>
                    <Card.Title id="craft-submit-title" render={(props) => <h2 {...props} />}>
                      Submit your project
                    </Card.Title>
                    <Card.Description>Prepare and review your submission in Fellowship, then publish the finished contribution to AIR-Craft.</Card.Description>
                  </Card.Header>
                  <Card.Footer className="collection-dashboard__actions">
                    <ExternalLink href={SUBMISSION_GUIDE_URL}>Read the submission protocol</ExternalLink>
                    {fellowshipAction}
                  </Card.Footer>
                </Card>
              </>
            ),
          },
        ]}
      />
    </WorkspaceDashboard>
  );
}
