import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button, TextArea } from '@heroui/react';
import { IconChevronDown } from '../app/ui-icons.component';

export type ChatAskInput = {
  question: string;
  choices?: string[];
  allowFreeform: boolean;
  url?: string;
  signal?: AbortSignal;
};

export type ChatAskAnswer = { answer: string; wasFreeform: boolean };

type ChatAskEntry = ChatAskInput & {
  id: string;
  resolve: (value: ChatAskAnswer | null) => void;
};

/**
 * Queues assistant questions for the chat dock. One question is shown at a time
 * above the composer so the rest of the workspace stays usable.
 */
export function useChatAskQueue() {
  const [pending, setPending] = useState<ChatAskEntry[]>([]);
  const ask = useCallback((input: ChatAskInput) => new Promise<ChatAskAnswer | null>((resolve) => {
    const id = crypto.randomUUID();
    let settled = false;
    const signal = input.signal;
    let onAbort = () => undefined;
    const finish = (value: ChatAskAnswer | null) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      setPending((current) => current.filter((entry) => entry.id !== id));
      resolve(value);
    };
    onAbort = () => finish(null);
    setPending((current) => [...current, { ...input, id, resolve: finish }]);
    if (!signal) return;
    signal.addEventListener('abort', onAbort);
    if (signal.aborted) onAbort();
  }), []);
  const active = pending[0] ?? null;
  return { ask, active };
}

/** Assistant question card that sits above the composer and can be minimized. */
export function ChatAskBanner({ ask }: { ask: ChatAskEntry | null }): ReactNode {
  const [minimized, setMinimized] = useState(false);
  const [value, setValue] = useState('');
  const [freeform, setFreeform] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fieldId = useId();
  const askId = ask?.id;

  useEffect(() => {
    setMinimized(false);
    setValue('');
    setFreeform(false);
  }, [askId]);

  useEffect(() => {
    if (!ask || minimized || freeform || ask.choices?.length) return;
    inputRef.current?.focus();
  }, [ask, minimized, freeform]);

  if (!ask) return null;

  const showFreeform = freeform || !ask.choices?.length;
  const preview = ask.question.trim().split(/\n/)[0] ?? 'Assistant question';

  if (minimized) {
    return <div className="chat-ask chat-ask--minimized" role="status">
      <span className="chat-ask-preview">{preview}</span>
      <Button variant="tertiary" size="sm" onPress={() => setMinimized(false)}>Show</Button>
    </div>;
  }

  return <section className="chat-ask" aria-labelledby={`${fieldId}-title`}>
    <div className="chat-ask-head">
      <h3 id={`${fieldId}-title`} className="chat-ask-title">Assistant question</h3>
      <Button isIconOnly variant="ghost" size="sm" aria-label="Minimize question" onPress={() => setMinimized(true)}><IconChevronDown/></Button>
    </div>
    <p className="chat-ask-question">{ask.question}</p>
    {ask.url && <p className="chat-ask-link"><a href={ask.url} target="_blank" rel="noopener noreferrer">Open {safeHost(ask.url)}</a></p>}
    {ask.choices?.length && !freeform ? <div className="chat-ask-actions" role="group" aria-label="Answer choices">
      {ask.choices.map((choice) => <Button key={choice} size="sm" variant="secondary" onPress={() => ask.resolve({ answer: choice, wasFreeform: false })}>{choice}</Button>)}
      {ask.allowFreeform && <Button size="sm" variant="tertiary" onPress={() => setFreeform(true)}>Write an answer</Button>}
      <Button size="sm" variant="tertiary" onPress={() => ask.resolve(null)}>Skip</Button>
    </div> : null}
    {showFreeform && ask.allowFreeform ? <form className="chat-ask-form" onSubmit={(event) => { event.preventDefault(); ask.resolve({ answer: value, wasFreeform: true }); }}>
      <label className="chat-ask-field" htmlFor={fieldId}>
        <span className="sr-only">Your answer</span>
        <TextArea ref={(element) => { inputRef.current = element; }} id={fieldId} rows={3} fullWidth value={value} placeholder="Your answer" onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            ask.resolve({ answer: value, wasFreeform: true });
          }
        }}/>
      </label>
      <div className="chat-ask-actions">
        {ask.choices?.length ? <Button size="sm" variant="tertiary" onPress={() => setFreeform(false)}>Back</Button> : <Button size="sm" variant="tertiary" onPress={() => ask.resolve(null)}>Skip</Button>}
        <Button type="submit" size="sm">Send</Button>
      </div>
    </form> : null}
    {!ask.allowFreeform && !ask.choices?.length ? <div className="chat-ask-actions"><Button size="sm" variant="tertiary" onPress={() => ask.resolve(null)}>Dismiss</Button></div> : null}
  </section>;
}

function safeHost(url: string): string {
  try { return new URL(url).host; } catch { return 'link'; }
}
