import { useMemo, useState } from 'react';
import type { ConversationGraph } from '@office/chat/domain';
import { IconClose, IconCopy } from '../app/ui-icons.component';
import { Button, Modal } from '@heroui/react';
import { CollapsibleSection } from '../shared/collapsible-section.component';
import { ChatSafePreview, isSafePreviewLanguage } from './chat-safe-preview.component';

/**
 * Chat artifacts workspace (CHAT-106, CHAT-131, CHAT-132).
 *
 * The panel collects the code fences the conversation produced, groups them by
 * derived title so regenerations become versions of one artifact, and offers
 * previous/next version navigation, fullscreen viewing and download. Content
 * comes from the stored graph only, so the panel shows exactly what the
 * service keeps and nothing the renderer invented.
 */

export interface ChatArtifact {
  id: string;
  title: string;
  language: string;
  code: string;
  messageId: string;
  createdAt: string;
}

export interface ArtifactVersionGroup {
  title: string;
  language: string;
  versions: ChatArtifact[];
}

const FENCE_PATTERN = /```([A-Za-z0-9_-]*)\n([\s\S]*?)```/g;

/** Derives a stable title from the first heading or first line of a fence. */
export function artifactTitle(code: string, language: string): string {
  const heading = code.match(/^#\s+(.+)$/m)?.[1];
  if (heading?.trim()) return heading.trim().slice(0, 60);
  const firstLine = code.split('\n').find((line) => line.trim().length > 0)?.trim() ?? 'Untitled';
  return `${language || 'text'}: ${firstLine.slice(0, 52)}`;
}

/** Collects code fences from the conversation graph in message order. */
export function collectArtifacts(graph: ConversationGraph | null): ChatArtifact[] {
  if (!graph) return [];
  const artifacts: ChatArtifact[] = [];
  for (const message of graph.messages) {
    if (message.role !== 'assistant') continue;
    let index = 0;
    for (const match of message.content.matchAll(FENCE_PATTERN)) {
      const language = (match[1] ?? '').toLowerCase();
      const code = match[2] ?? '';
      if (!code.trim()) continue;
      index += 1;
      artifacts.push({
        id: `${message.id}:${index}`,
        title: artifactTitle(code, language),
        language: language || 'text',
        code,
        messageId: message.id,
        createdAt: message.createdAt
      });
    }
  }
  return artifacts;
}

/** Groups artifacts whose derived title matches, newest first. */
export function groupArtifactVersions(artifacts: ChatArtifact[]): ArtifactVersionGroup[] {
  const groups = new Map<string, ChatArtifact[]>();
  for (const artifact of artifacts) {
    const key = `${artifact.language}:${artifact.title}`;
    const list = groups.get(key) ?? [];
    list.push(artifact);
    groups.set(key, list);
  }
  return [...groups.values()].map((versions) => ({
    title: versions[0]!.title,
    language: versions[0]!.language,
    versions: [...versions].reverse()
  }));
}

function download(artifact: ChatArtifact) {
  const extensions: Record<string, string> = { javascript: 'js', typescript: 'ts', python: 'py', html: 'html', css: 'css', json: 'json', markdown: 'md' };
  const extension = extensions[artifact.language] ?? (artifact.language === 'text' ? 'txt' : artifact.language);
  const blob = new Blob([artifact.code], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${artifact.title.replace(/[^\w.-]+/g, '-').slice(0, 48) || 'artifact'}.${extension}`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Fullscreen artifact viewer. */
function ArtifactViewer(props: { artifact: ChatArtifact; onClose: () => void }) {
  const { artifact } = props;
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(artifact.code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { setCopied(false); }
  };
  return <Modal isOpen onOpenChange={(open) => { if (!open) props.onClose(); }}>
    <Modal.Backdrop>
      <Modal.Container size="full">
        <Modal.Dialog aria-label={`Artifact ${artifact.title}`}>
          <Modal.Header>
            <Modal.Heading>{artifact.title}</Modal.Heading>
            <span>{artifact.language} · version from {new Date(artifact.createdAt).toLocaleString()}</span>
            <div className="artifact-viewer-actions">
              <Button variant="ghost" size="sm" aria-label={copied ? 'Artifact copied' : 'Copy artifact'} onPress={() => void copy()}><IconCopy/>{copied ? 'Copied' : 'Copy'}</Button>
              <Button variant="ghost" size="sm" onPress={() => download(artifact)}>Download</Button>
              <Button variant="ghost" size="sm" aria-label="Close artifact viewer" onPress={props.onClose}><IconClose/> Close</Button>
            </div>
          </Modal.Header>
          <Modal.Body>
            {isSafePreviewLanguage(artifact.language)
              ? <ChatSafePreview code={artifact.code} language={artifact.language} className="max-w-none" heightClassName="min-h-[50vh] w-full" />
              : <pre className="artifact-viewer-body">{artifact.code}</pre>}
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  </Modal>;
}

export function ArtifactsPanel(props: { graph: ConversationGraph | null }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<Record<string, number>>({});
  const artifacts = useMemo(() => collectArtifacts(props.graph), [props.graph]);
  const groups = useMemo(() => groupArtifactVersions(artifacts), [artifacts]);
  const open = artifacts.find((artifact) => artifact.id === openId) ?? null;
  if (!groups.length) return <div className="chat-empty-state" role="status"><p>Code this conversation produces appears here as artifacts.</p></div>;
  return <div className="artifacts-panel" aria-label="Artifacts">
    {groups.map((group) => {
      const versionIndex = Math.min(selectedVersion[group.title] ?? 0, group.versions.length - 1);
      const current = group.versions[versionIndex]!;
      return <CollapsibleSection className="artifact-group" key={`${group.language}:${group.title}`} defaultExpanded title={<>{group.title} <span className="artifact-version-count">{group.versions.length > 1 ? `${group.versions.length} versions` : '1 version'}</span></>}>
        <div className="artifact-version-nav" role="group" aria-label={`${group.title} versions`}>
          <Button variant="ghost" size="sm" aria-label={`Previous version of ${group.title}`} isDisabled={versionIndex >= group.versions.length - 1} onPress={() => setSelectedVersion((current) => ({ ...current, [group.title]: versionIndex + 1 }))}>Previous</Button>
          <span>{versionIndex + 1} / {group.versions.length}</span>
          <Button variant="ghost" size="sm" aria-label={`Next version of ${group.title}`} isDisabled={versionIndex === 0} onPress={() => setSelectedVersion((current) => ({ ...current, [group.title]: versionIndex - 1 }))}>Next</Button>
        </div>
        {isSafePreviewLanguage(current.language)
          ? <ChatSafePreview code={current.code} language={current.language} className="max-w-none" />
          : <pre className="artifact-preview">{current.code.length > 600 ? `${current.code.slice(0, 600)}...` : current.code}</pre>}
        <div className="artifact-group-actions">
          <Button variant="ghost" size="sm" onPress={() => setOpenId(current.id)}>Open</Button>
          <Button variant="ghost" size="sm" onPress={() => download(current)}>Download</Button>
        </div>
      </CollapsibleSection>;
    })}
    {open && <ArtifactViewer artifact={open} onClose={() => setOpenId(null)}/>}
  </div>;
}
