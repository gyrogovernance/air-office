import type { ToolConnection } from '@office/contracts/tool';

export type ConnectorPreset = {
  id: string;
  name: string;
  description: string;
  category: 'Research' | 'Productivity' | 'Development' | 'Business';
  auth: 'none' | 'key' | 'oauth' | 'local';
  endpoint: string | null;
  docs: string;
  keyUrl?: string;
  color: string;
};

export const CONNECTOR_PRESETS: readonly ConnectorPreset[] = [
  { id: 'notion', name: 'Notion', description: 'Work with pages, knowledge and databases in your workspace.', category: 'Productivity', auth: 'oauth', endpoint: 'https://mcp.notion.com/mcp', docs: 'https://developers.notion.com/docs/mcp', color: '#525252' },
  { id: 'perplexity', name: 'Perplexity', description: 'Research questions with web search and sourced answers.', category: 'Research', auth: 'key', endpoint: 'https://api.perplexity.ai/mcp', docs: 'https://docs.perplexity.ai/guides/mcp-server', keyUrl: 'https://www.perplexity.ai/settings/api', color: '#20808d' },
  { id: 'atlassian', name: 'Atlassian', description: 'Bring Jira issues and Confluence knowledge into your work.', category: 'Productivity', auth: 'oauth', endpoint: 'https://mcp.atlassian.com/v1/mcp', docs: 'https://support.atlassian.com/rovo/docs/getting-started-with-the-atlassian-remote-mcp-server/', color: '#0052cc' },
  { id: 'linear', name: 'Linear', description: 'Find issues, plan projects and follow your team’s work.', category: 'Productivity', auth: 'oauth', endpoint: 'https://mcp.linear.app/mcp', docs: 'https://linear.app/docs/mcp', color: '#5e6ad2' },
  { id: 'exa', name: 'Exa', description: 'Search the web and find relevant sources for your research.', category: 'Research', auth: 'none', endpoint: 'https://mcp.exa.ai/mcp', docs: 'https://docs.exa.ai', color: '#1741f6' },
  { id: 'cloudflare', name: 'Cloudflare', description: 'Work with your cloud infrastructure and developer services.', category: 'Development', auth: 'oauth', endpoint: 'https://mcp.cloudflare.com/mcp', docs: 'https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/', color: '#b76113' },
  { id: 'airtable', name: 'Airtable', description: 'Find records and work with structured information in your bases.', category: 'Productivity', auth: 'oauth', endpoint: 'https://mcp.airtable.com/mcp', docs: 'https://airtable.com/developers/mcp', color: '#ae7621' },
  { id: 'trello', name: 'Trello', description: 'Organize boards, lists and cards alongside your conversations.', category: 'Productivity', auth: 'oauth', endpoint: 'https://mcp.trello.com/v1', docs: 'https://support.atlassian.com/trello/docs/trello-mcp-server/', color: '#0052cc' },
  { id: 'stripe', name: 'Stripe', description: 'Explore payments, customers and billing in your account.', category: 'Business', auth: 'oauth', endpoint: 'https://mcp.stripe.com', docs: 'https://docs.stripe.com/mcp', color: '#635bff' },
  { id: 'paypal', name: 'PayPal', description: 'Access payment and commerce tools for your business.', category: 'Business', auth: 'oauth', endpoint: 'https://mcp.paypal.com/mcp', docs: 'https://developer.paypal.com/tools/mcp-server/', color: '#002991' },
  { id: 'supabase', name: 'Supabase', description: 'Inspect your database and manage development projects.', category: 'Development', auth: 'oauth', endpoint: 'https://mcp.supabase.com/mcp', docs: 'https://supabase.com/docs/guides/getting-started/mcp', color: '#25865d' },
  { id: 'sentry', name: 'Sentry', description: 'Investigate application errors and performance problems.', category: 'Development', auth: 'oauth', endpoint: 'https://mcp.sentry.dev/mcp', docs: 'https://docs.sentry.io/product/sentry-mcp/', color: '#6a567e' },
  { id: 'zapier', name: 'Zapier', description: 'Use the actions you have configured across connected apps.', category: 'Business', auth: 'key', endpoint: 'https://mcp.zapier.com/api/mcp/mcp', docs: 'https://docs.zapier.com/mcp', keyUrl: 'https://mcp.zapier.com', color: '#c44c16' },
  { id: 'calcom', name: 'Cal.com', description: 'Check availability and manage your scheduling workflow.', category: 'Productivity', auth: 'oauth', endpoint: 'https://mcp.cal.com/mcp', docs: 'https://cal.com/docs/developing/guides/mcp', color: '#525252' },
  { id: 'webflow', name: 'Webflow', description: 'Manage website content and collections with Webflow tools.', category: 'Development', auth: 'oauth', endpoint: 'https://mcp.webflow.com/sse', docs: 'https://developers.webflow.com/data/docs/ai-tools', color: '#146ef5' },
  { id: 'posthog', name: 'PostHog', description: 'Explore product analytics, experiments and feature flags.', category: 'Development', auth: 'oauth', endpoint: 'https://mcp.posthog.com/mcp', docs: 'https://posthog.com/docs/model-context-protocol', color: '#bd6525' },
  { id: 'shopify-dev', name: 'Shopify Dev', description: 'Look up Shopify APIs and resources for app development.', category: 'Development', auth: 'local', endpoint: null, docs: 'https://shopify.dev/docs/apps/build/devmcp', color: '#5c7c28' },
  { id: 'resend', name: 'Resend', description: 'Send transactional email through a local connector.', category: 'Business', auth: 'local', endpoint: null, docs: 'https://resend.com/docs/knowledge-base/mcp-server', color: '#525252' },
  { id: 'granola', name: 'Granola', description: 'Find meeting notes and bring useful context into your work.', category: 'Productivity', auth: 'oauth', endpoint: 'https://mcp.granola.ai/mcp', docs: 'https://www.granola.ai/docs/mcp', color: '#677624' },
  { id: 'firecrawl', name: 'Firecrawl', description: 'Read websites and extract useful information for research.', category: 'Research', auth: 'key', endpoint: 'https://mcp.firecrawl.dev/v2/mcp', docs: 'https://docs.firecrawl.dev/mcp-server', keyUrl: 'https://www.firecrawl.dev/app/api-keys', color: '#bc531c' },
  { id: 'atomicmail', name: 'Atomic Mail', description: 'Create an inbox and work with email through a local connector.', category: 'Business', auth: 'local', endpoint: null, docs: 'https://github.com/Atomic-Mail/atomic-mail-agentic', color: '#354052' },
];

export function matchesConnector(preset: ConnectorPreset, connection: ToolConnection): boolean {
  if (connection.kind !== 'mcp') return false;
  if (connection.local) return connection.local.catalogId === (preset.id === 'atomicmail' ? 'atomic-mail' : preset.id);
  if (connection.id === `connector-${preset.id}`) return true;
  if (!preset.endpoint || !connection.endpoint) return false;
  try {
    const expected = new URL(preset.endpoint);
    const actual = new URL(connection.endpoint);
    return actual.protocol === expected.protocol && actual.hostname === expected.hostname && actual.port === expected.port && actual.pathname.replace(/\/$/, '') === expected.pathname.replace(/\/$/, '');
  } catch { return false; }
}

export function connectorStatus(connection: ToolConnection | undefined): string {
  if (!connection) return 'Not configured';
  if (!connection.discoveredAt) return 'Needs discovery';
  return connection.enabled ? 'Tools discovered' : 'Paused';
}
