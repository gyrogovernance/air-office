import { Card, Description, Header, Label, ListBox, ScrollShadow, SearchField, Separator, Surface, Tabs } from '@heroui/react';
import { useId, type ReactNode } from 'react';
import { WorkspaceHero, type WorkspaceHeroProps } from './workspace-hero.component';

export interface CollectionDashboardItem {
  id: string;
  title: string;
  description: string;
  icon: ReactNode;
  section?: string;
}

export interface CollectionDashboardPreview {
  title: string;
  description: string;
  headerAction?: ReactNode;
  configuration?: { title: string; facts: { label: string; value: ReactNode; icon: ReactNode }[] };
  content: ReactNode;
  actions: ReactNode;
}

interface CollectionDashboardProps {
  title: string;
  hero: WorkspaceHeroProps;
  heading: string;
  actions: ReactNode;
  listLabel: string;
  search: { value: string; onChange: (value: string) => void; placeholder: string; label: string } | null;
  items: CollectionDashboardItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  preview: CollectionDashboardPreview | null;
  empty: { title: string; description: string; action?: ReactNode };
}

export function WorkspaceDashboard({ title, hero, children }: { title: string; hero: WorkspaceHeroProps; children: ReactNode }) {
  return (
    <section className="collection-dashboard" data-workspace={title.toLowerCase()} aria-label={title}>
      <WorkspaceHero {...hero} />
      <div className="collection-dashboard__body">{children}</div>
      <div className="collection-dashboard__watermark" aria-hidden="true"><span className="collection-dashboard__watermark-spin"><span className="collection-dashboard__watermark-mark" /></span></div>
    </section>
  );
}

export function DashboardToolbar({ children, actions }: { children: ReactNode; actions: ReactNode }) {
  return (
    <Card className="collection-dashboard__toolbar p-3">
      <div className="collection-dashboard__navigation">{children}</div>
      <div className="collection-dashboard__actions">{actions}</div>
    </Card>
  );
}

export function DashboardViews<Key extends string>({
  label,
  selectedKey,
  onSelect,
  views,
}: {
  label: string;
  selectedKey: Key;
  onSelect: (key: Key) => void;
  views: { id: Key; label: string; actions: ReactNode; content: ReactNode }[];
}) {
  const selected = views.find((view) => view.id === selectedKey);
  return (
    <Tabs
      className="collection-dashboard__views"
      selectedKey={selectedKey}
      onSelectionChange={(key) => {
        const view = views.find((view) => view.id === key);
        if (view) onSelect(view.id);
      }}
    >
      <DashboardToolbar actions={selected?.actions}>
        <Tabs.ListContainer>
          <Tabs.List aria-label={label}>
            {views.map((view) => (
              <Tabs.Tab id={view.id} key={view.id} className="w-auto shrink-0 whitespace-nowrap">
                {view.label}
                <Tabs.Indicator />
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs.ListContainer>
      </DashboardToolbar>
      {views.map((view) => (
        <Tabs.Panel id={view.id} key={view.id} className="collection-dashboard__panel">
          {view.content}
        </Tabs.Panel>
      ))}
    </Tabs>
  );
}

export function DashboardCatalog({
  listLabel,
  search,
  items,
  selectedId,
  onSelect,
  emptyDescription,
  isDisabled = false,
}: Pick<CollectionDashboardProps, 'listLabel' | 'search' | 'items' | 'selectedId' | 'onSelect'> & { emptyDescription: string; isDisabled?: boolean }) {
  const sections = [...new Set(items.map((item) => item.section ?? listLabel))];
  const renderItem = (item: CollectionDashboardItem) => (
    <ListBox.Item key={item.id} id={item.id} textValue={item.title} className="collection-dashboard__item">
      <span className="collection-dashboard__item-icon">{item.icon}</span>
      <div className="collection-dashboard__item-copy">
        <Label>{item.title}</Label>
        {item.description && <Description>{item.description}</Description>}
      </div>
    </ListBox.Item>
  );
  return (
    <Card className={`collection-dashboard__catalog gap-3 overflow-hidden p-3${search ? ' pb-0' : ''}`}>
      {search && (
        <SearchField aria-label={search.label} value={search.value} onChange={search.onChange} fullWidth>
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder={search.placeholder} />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
      )}
      <ScrollShadow className="collection-dashboard__scroll">
        <ListBox
          aria-label={listLabel}
          selectionMode="single"
          selectionBehavior="replace"
          disallowEmptySelection
          disabledKeys={isDisabled ? items.map((item) => item.id) : []}
          selectedKeys={selectedId ? [selectedId] : []}
          onSelectionChange={(keys) => {
            if (keys === 'all') return;
            const key = keys.values().next().value;
            if (key !== undefined) onSelect(String(key));
          }}
          renderEmptyState={() => <Description className="block p-3">{emptyDescription}</Description>}
        >
          {items.some((item) => item.section)
            ? sections.map((section) => (
                <ListBox.Section key={section}>
                  <Header>{section}</Header>
                  {items.filter((item) => (item.section ?? listLabel) === section).map(renderItem)}
                </ListBox.Section>
              ))
            : items.map(renderItem)}
        </ListBox>
      </ScrollShadow>
    </Card>
  );
}

export function CollectionDashboard({
  title,
  hero,
  heading,
  actions,
  listLabel,
  search,
  items,
  selectedId,
  onSelect,
  preview,
  empty,
}: CollectionDashboardProps) {
  return (
    <WorkspaceDashboard title={title} hero={hero}>
      <DashboardToolbar actions={actions}>
        <Card.Title render={(props) => <h2 {...props} />}>{heading}</Card.Title>
      </DashboardToolbar>
      <DashboardCollection listLabel={listLabel} search={search} items={items} selectedId={selectedId} onSelect={onSelect} preview={preview} empty={empty} bubblePreview />
    </WorkspaceDashboard>
  );
}

export function DashboardCollection({
  listLabel,
  search,
  items,
  selectedId,
  onSelect,
  preview,
  empty,
  bubblePreview = false,
}: Pick<CollectionDashboardProps, 'listLabel' | 'search' | 'items' | 'selectedId' | 'onSelect' | 'preview' | 'empty'> & { bubblePreview?: boolean }) {
  const previewTitleId = useId();
  return (
    <div className="collection-dashboard__columns">
      <DashboardCatalog listLabel={listLabel} search={search} items={items} selectedId={selectedId} onSelect={onSelect} emptyDescription={empty.description} />
      <Card role="region" aria-labelledby={previewTitleId} className="collection-dashboard__preview gap-3 p-3">
        {preview ? (
          <>
            <Card variant="tertiary" className={bubblePreview ? "settings-section-intro collection-preview-bubble p-3" : "collection-preview-plain"}><Card.Header className="collection-dashboard__profile">
              <div className="collection-dashboard__item-copy">
                <Card.Title render={(props) => <h2 {...props} />} id={previewTitleId} className="text-lg">
                  {preview.title}
                </Card.Title>
                <Card.Description>{preview.description}</Card.Description>
              </div>
              {preview.headerAction ? <div className="collection-dashboard__header-action">{preview.headerAction}</div> : null}
            </Card.Header></Card>
            {!bubblePreview && <Separator />}
            <ScrollShadow className="collection-dashboard__scroll" tabIndex={0} role="region" aria-label={`${preview.title} details`}>
              <Card.Content className="collection-dashboard__details">
                {preview.configuration && (
                  <Surface variant="secondary" role="group" aria-label={preview.configuration.title} className="collection-preview-content flex flex-col gap-3 rounded-2xl p-3">
                    <h3 className="text-sm font-medium">{preview.configuration.title}</h3>
                    <Separator />
                    <dl className="collection-dashboard__facts">
                      {preview.configuration.facts.map((fact) => (
                        <div key={fact.label}>
                          <dt>
                            {fact.icon}
                            <span>{fact.label}</span>
                          </dt>
                          <dd className="text-sm font-medium">{fact.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </Surface>
                )}
                {bubblePreview ? <Surface variant="secondary" className="collection-preview-content rounded-2xl"><div className="collection-dashboard__content">{preview.content}</div></Surface> : <div className="collection-dashboard__content">{preview.content}</div>}
              </Card.Content>
            </ScrollShadow>
            <Separator />
            <Card.Footer className="collection-dashboard__actions">{preview.actions}</Card.Footer>
          </>
        ) : (
          <>
            <Card.Header>
              <Card.Title render={(props) => <h2 {...props} />} id={previewTitleId}>
                {empty.title}
              </Card.Title>
              <Card.Description>{empty.description}</Card.Description>
            </Card.Header>
            {empty.action && <Card.Footer className="collection-dashboard__actions">{empty.action}</Card.Footer>}
          </>
        )}
      </Card>
    </div>
  );
}
