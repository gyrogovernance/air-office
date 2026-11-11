import type { ComponentPropsWithoutRef, MouseEvent } from 'react';
import { useChatRenderContext } from './chat-render-context.composition';
import { citationState, citationVersionId } from './chat-rendering.policy';
import { airFilePath } from './workspace-file-link.policy';
import { ChatMediaEmbed, youTubeId } from './chat-media-embed.component';

const STATE_TITLES: Record<string, string> = {
  verified: 'Verified against the current source',
  stale: 'The source changed after this citation',
  unverified: 'This location could not be verified'
};

/**
 * Citation link rendering for chat messages (CHAT-104).
 *
 * Plain links pass through unchanged. Connected-folder `air-file:` links open
 * on the stage. Recognized citation links carry a status chip and open the
 * knowledge source through the render context; a stale chip means a newer
 * version of the same document exists.
 */
export function ChatCitationLink(props: ComponentPropsWithoutRef<'a'> & { node?: unknown }) {
  const { citation, openCitation, openWorkspacePath } = useChatRenderContext();
  const { node: _hastNode, ...anchor } = props;
  const workspacePath = airFilePath(props.href ?? null);
  if (workspacePath) {
    const open = (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      openWorkspacePath?.(workspacePath);
    };
    return <a {...anchor} className={`chat-workspace-file ${props.className ?? ''}`.trim()} title={workspacePath}
      {...(openWorkspacePath ? { onClick: open, href: '#' } : {})}>
      {props.children}
    </a>;
  }
  const mediaHref = typeof props.href === 'string' ? props.href : '';
  const mediaExtension = (() => {
    try { return new URL(mediaHref).pathname.split('.').at(-1)?.toLowerCase() ?? ''; } catch { return ''; }
  })();
  const isMedia = Boolean(youTubeId(mediaHref)) || ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'mp4', 'webm', 'mov'].includes(mediaExtension);
  const state = citation ? citationState(props.href ?? null, citation) : 'link';
  if (state === 'link') {
    if (isMedia) return <><ChatMediaEmbed url={mediaHref} label={typeof props.children === 'string' ? props.children : undefined}/><a {...anchor}/></>;
    return <a {...anchor}/>;
  }
  const versionId = citationVersionId(props.href ?? null);
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!openCitation || !versionId) return;
    event.preventDefault();
    openCitation(versionId);
  };
  const classes = `chat-citation ${props.className ?? ''}`.trim();
  return <a {...anchor} className={classes} data-citation-state={state} title={STATE_TITLES[state]}
    {...(openCitation && versionId ? { onClick: follow } : {})}>
    {props.children}<span className={`citation ${state}`}>{state}</span>
  </a>;
}
