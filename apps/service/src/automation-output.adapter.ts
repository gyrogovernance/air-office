import type { WorkflowStep } from '@office/automations/domain';
import type { AutomationRunContext } from '@office/automations/service';
import type { ConversationStore } from '@office/chat/service';
import { activeLeaf } from '@office/chat/service';
import type { CalendarStore } from '@office/calendar/store';
import { calendarPathForListId, conversationIdFromPath } from '@office/vault/domain';
import { createHash } from 'node:crypto';

type OutputStep = Extract<WorkflowStep, { kind: 'calendar-event' | 'chat-message' }>;

export function writeAutomationOutput(step: OutputStep, context: AutomationRunContext, calendar: CalendarStore, conversations: ConversationStore) {
  const id = `automation-result:${createHash('sha256').update(`${context.occurrence.id}:${context.stepIndex}`).digest('hex').slice(0, 32)}`;
  const result = context.completedSteps.at(-1)?.result;
  const content = typeof result === 'string' ? result : JSON.stringify(result ?? '');
  if (step.kind === 'calendar-event') {
    const list = calendar.lists().find((item) => calendarPathForListId(item.id) === step.calendarPath || item.id === step.calendarPath);
    if (!list) throw new Error('The result calendar no longer exists.');
    const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: context.automation.recurrence.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(context.occurrence.scheduledAt));
    const date = new Date(`${localDate}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + step.daysAfterRun);
    const previous = calendar.events(list.id).find((event) => event.id === id);
    if (previous) return { eventId: id, calendarPath: step.calendarPath };
    const now = new Date().toISOString();
    calendar.saveEvent({
      id,
      calendarId: list.id,
      title: step.title,
      date: date.toISOString().slice(0, 10),
      allDay: step.allDay,
      time: step.allDay ? undefined : step.time,
      timezone: context.automation.recurrence.timezone,
      description: content.slice(0, 5000),
      automationId: context.automation.id,
      automationOccurrenceId: context.occurrence.id,
      createdAt: now,
      updatedAt: now,
    });
    return { eventId: id, calendarPath: step.calendarPath };
  }
  const conversationId = conversationIdFromPath(step.conversationPath) ?? step.conversationPath;
  const graph = conversations.load(conversationId);
  if (!graph) throw new Error('The result chat no longer exists.');
  if (!graph.messages.some((message) => message.id === id)) {
    conversations.appendMessage({ conversationId, id, parentId: activeLeaf(graph), role: 'assistant', content, complete: true, runId: context.occurrence.jobId });
    conversations.setMeta(conversationId, { unreadAt: new Date().toISOString() });
  }
  return { conversationPath: step.conversationPath, messageId: id };
}
