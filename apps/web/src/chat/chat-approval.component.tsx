import { useCallback, useState, type ReactNode } from 'react';
import { ApprovalCard } from '@/components/assistant-ui/elements/approval-card';
import { toolApprovalCopy } from '../shared/tool-approval.policy';

export type ChatApprovalInput = {
  toolCallId?: string;
  name: string;
  arguments: Record<string, unknown>;
  signal?: AbortSignal;
};

type ChatApprovalEntry = ChatApprovalInput & {
  id: string;
  resolve: (value: boolean) => void;
};

/**
 * Queues Ask-first tool approvals for the Elements ApprovalCard above the
 * composer. One request shows at a time; answering posts through the runtime
 * to `/tool-approval`.
 */
export function useChatApprovalQueue() {
  const [pending, setPending] = useState<ChatApprovalEntry[]>([]);
  const request = useCallback((input: ChatApprovalInput) => new Promise<boolean>((resolve) => {
    const id = crypto.randomUUID();
    let settled = false;
    const signal = input.signal;
    let onAbort = () => undefined;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      setPending((current) => current.filter((entry) => entry.id !== id));
      resolve(value);
    };
    onAbort = () => finish(false);
    setPending((current) => [...current, { ...input, id, resolve: finish }]);
    if (!signal) return;
    signal.addEventListener('abort', onAbort);
    if (signal.aborted) onAbort();
  }), []);
  const active = pending[0] ?? null;
  return { request, active };
}

/** Elements ApprovalCard for the active Ask-first tool request. */
export function ChatApprovalBanner({ approval }: { approval: ChatApprovalEntry | null }): ReactNode {
  if (!approval) return null;
  const copy = toolApprovalCopy(approval.name, approval.arguments);
  const command = typeof approval.arguments.command === 'string'
    ? approval.arguments.command
    : typeof approval.arguments.fullCommandText === 'string'
      ? approval.arguments.fullCommandText
      : undefined;
  return (
    <ApprovalCard
      state="request"
      title={copy.title}
      subtitle={copy.detailLabel ?? approval.name}
      description={copy.message}
      command={command}
      details={copy.detail && !command ? [{ label: copy.detailLabel ?? 'Detail', value: copy.detail }] : undefined}
      variant={copy.destructive ? 'destructive' : 'default'}
      allowOnceLabel={copy.confirmLabel}
      denyLabel="Deny"
      onAllowOnce={() => approval.resolve(true)}
      onDeny={() => approval.resolve(false)}
    />
  );
}
