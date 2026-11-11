import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, Input, Label, Modal, TextArea } from '@heroui/react';
import { toolApprovalCopy } from './tool-approval.policy';
import './app-dialogs.styles.css';

export type AppConfirmOptions = {
  title: string;
  message: string;
  detail?: string;
  detailLabel?: string;
  confirmLabel?: string;
  destructive?: boolean;
  signal?: AbortSignal;
};
export type AppPromptOptions = { title: string; label: string; initialValue?: string; submitLabel?: string; multiline?: boolean; signal?: AbortSignal };
export type AppChoiceOptions = { title: string; message: string; options: { label: string; value: string; destructive?: boolean }[]; signal?: AbortSignal; url?: string };
export type AppDialogs = {
  prompt: (options: AppPromptOptions) => Promise<string | null>;
  confirm: (options: AppConfirmOptions) => Promise<boolean>;
  choose: (options: AppChoiceOptions) => Promise<string | null>;
};

export function confirmToolPermission(dialogs: AppDialogs, request: { name: string; arguments: Record<string, unknown>; signal?: AbortSignal }): Promise<boolean> {
  const copy = toolApprovalCopy(request.name, request.arguments);
  return dialogs.confirm({
    title: copy.title,
    message: copy.message,
    ...(copy.detail ? { detail: copy.detail } : {}),
    ...(copy.detailLabel ? { detailLabel: copy.detailLabel } : {}),
    confirmLabel: copy.confirmLabel,
    ...(copy.destructive ? { destructive: true } : {}),
    signal: request.signal,
  });
}
export async function answerAgentQuestion(dialogs: AppDialogs, request: { question: string; choices?: string[]; allowFreeform: boolean; url?: string; signal?: AbortSignal }): Promise<{ answer: string; wasFreeform: boolean } | null> {
  if (request.choices?.length) {
    const options = request.choices.map((label, index) => ({ label, value: String(index) }));
    if (request.allowFreeform) options.push({ label: 'Write an answer', value: 'freeform' });
    const choice = await dialogs.choose({ title: 'Assistant question', message: request.question, options, signal: request.signal, url: request.url });
    if (choice === null) return null;
    if (choice !== 'freeform') {
      const answer = request.choices[Number(choice)];
      return answer === undefined ? null : { answer, wasFreeform: false };
    }
  }
  if (!request.allowFreeform) return null;
  const answer = await dialogs.prompt({ title: 'Assistant question', label: request.question, submitLabel: 'Send', multiline: true, signal: request.signal });
  return answer === null ? null : { answer, wasFreeform: true };
}
type Request =
  | { kind: 'prompt'; options: AppPromptOptions; resolve: (value: string | null) => void }
  | { kind: 'confirm'; options: AppConfirmOptions; resolve: (value: boolean) => void }
  | { kind: 'choice'; options: AppChoiceOptions; resolve: (value: string | null) => void };

const DialogContext = createContext<AppDialogs | null>(null);

export function useAppDialogs(): AppDialogs {
  const dialogs = useContext(DialogContext);
  if (!dialogs) throw new Error('useAppDialogs requires AppDialogsProvider.');
  return dialogs;
}

export function AppDialogsProvider({ children }: { children: ReactNode }) {
  const pending = useRef<Request[]>([]);
  const [active, setActive] = useState<Request | null>(null);
  const cleanups = useRef(new Map<Request, () => void>());
  const settle = useCallback((request: Request, value: string | null | boolean) => {
    const index = pending.current.indexOf(request);
    if (index < 0) return;
    pending.current.splice(index, 1);
    cleanups.current.get(request)?.();
    cleanups.current.delete(request);
    if (request.kind === 'prompt' || request.kind === 'choice') request.resolve(typeof value === 'string' ? value : null);
    else request.resolve(value === true);
    if (index === 0) setActive(pending.current[0] ?? null);
  }, []);
  const enqueue = useCallback((request: Request) => {
    pending.current.push(request);
    if (pending.current.length === 1) setActive(request);
    const signal = request.options.signal;
    if (signal) {
      const abort = () => settle(request, null);
      signal.addEventListener('abort', abort, { once: true });
      cleanups.current.set(request, () => signal.removeEventListener('abort', abort));
      if (signal.aborted) abort();
    }
  }, [settle]);
  const dialogs = useMemo<AppDialogs>(() => ({
    prompt: (options) => new Promise((resolve) => enqueue({ kind: 'prompt', options, resolve })),
    confirm: (options) => new Promise((resolve) => enqueue({ kind: 'confirm', options, resolve })),
    choose: (options) => new Promise((resolve) => enqueue({ kind: 'choice', options, resolve }))
  }), [enqueue]);
  useEffect(() => () => {
    for (const request of pending.current.splice(0)) {
      cleanups.current.get(request)?.();
      cleanups.current.delete(request);
      if (request.kind === 'prompt' || request.kind === 'choice') request.resolve(null);
      else request.resolve(false);
    }
  }, []);

  return <DialogContext.Provider value={dialogs}>
    {children}
    {active && <AppDialog request={active} onFinish={(value) => settle(active, value)}/>}
  </DialogContext.Provider>;
}

function AppDialog({ request, onFinish }: { request: Request; onFinish: (value: string | null | boolean) => void }) {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const id = useId();
  const finished = useRef(false);
  const [value, setValue] = useState(request.kind === 'prompt' ? request.options.initialValue ?? '' : '');
  useLayoutEffect(() => {
    finished.current = false;
    setValue(request.kind === 'prompt' ? request.options.initialValue ?? '' : '');
    if (request.kind === 'prompt') {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [request]);

  const finish = (next: string | null | boolean) => {
    if (finished.current) return;
    finished.current = true;
    onFinish(next);
  };

  const confirm = request.kind === 'confirm';
  const choice = request.kind === 'choice';
  const options = choice ? request.options.options : [];
  const cancelValue = request.kind === 'prompt' || request.kind === 'choice' ? null : false;
  const choiceSize = choice && options.length >= 4 ? 'lg' : 'md';
  return <Modal isOpen onOpenChange={(open) => { if (!open) finish(cancelValue); }}>
    <Modal.Backdrop>
      <Modal.Container size={choiceSize}>
        <Modal.Dialog className={choice ? 'app-dialog app-dialog--choice' : 'app-dialog'} aria-labelledby={`${id}-title`} aria-describedby={request.kind === 'prompt' ? undefined : `${id}-message`}>
          <form className="app-dialog-form" onSubmit={(event) => { event.preventDefault(); if (request.kind === 'prompt') finish(value); else if (request.kind === 'confirm') finish(true); }}>
            <Modal.Header>
              <Modal.Heading id={`${id}-title`}>{request.options.title}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              {request.kind === 'prompt' ? <div className="app-dialog-field">
                <Label htmlFor={`${id}-input`}>{request.options.label}</Label>
                {request.options.multiline
                  ? <TextArea ref={(element) => { inputRef.current = element; }} id={`${id}-input`} rows={7} fullWidth value={value} onChange={(event) => setValue(event.target.value)}/>
                  : <Input ref={(element) => { inputRef.current = element; }} id={`${id}-input`} type="text" fullWidth value={value} onChange={(event) => setValue(event.target.value)}/>}
              </div> : <>
                <p id={`${id}-message`} className="app-dialog-message">{request.options.message}</p>
                {request.kind === 'confirm' && request.options.detail && (
                  <div className="app-dialog-detail">
                    {request.options.detailLabel && <span className="app-dialog-detail-label">{request.options.detailLabel}</span>}
                    <pre className="app-dialog-detail-body">{request.options.detail}</pre>
                  </div>
                )}
                {request.kind === 'choice' && request.options.url && <p><a href={request.options.url} target="_blank" rel="noopener noreferrer">Open {new URL(request.options.url).host}</a></p>}
                {choice ? <div className="app-dialog-choices" role="group" aria-label="Choices">
                  {options.map((option) => (
                    <Button key={option.value} size="sm" variant={option.destructive ? 'danger' : 'secondary'} onPress={() => finish(option.value)}>{option.label}</Button>
                  ))}
                </div> : null}
              </>}
            </Modal.Body>
            <Modal.Footer className={choice ? 'app-dialog-footer app-dialog-footer--choice' : 'app-dialog-footer'}>
              {choice
                ? <Button variant="secondary" onPress={() => finish(null)}>Cancel</Button>
                : <>
                    <Button variant="secondary" onPress={() => finish(cancelValue)}>Cancel</Button>
                    <Button type="submit" variant={confirm && request.options.destructive ? 'danger' : 'primary'}>
                      {request.kind === 'prompt' ? request.options.submitLabel ?? 'Save' : request.kind === 'confirm' ? request.options.confirmLabel ?? 'Continue' : 'Continue'}
                    </Button>
                  </>}
            </Modal.Footer>
          </form>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  </Modal>;
}
