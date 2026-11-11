"use client";

import { cn } from "@/lib/utils";
import {
  createThreadRowsSelector,
  groupPartByType,
  ThreadPrimitive,
  useAuiState,
} from "@assistant-ui/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type FC,
  type RefObject,
} from "react";

const ESTIMATED_ROW_HEIGHT = 96;
const AT_BOTTOM_THRESHOLD = 48;
const OVERSCAN = 6;

/**
 * One assistant turn is one virtual row. Reasoning, tools, and reply text share
 * `group-chainOfThought` so they are not separate bubbles beside each other.
 */
export const threadRowGroupBy = groupPartByType({
  reasoning: ["group-chainOfThought", "group-reasoning"],
  "tool-call": ["group-chainOfThought", "group-tool"],
  text: ["group-chainOfThought"],
  image: ["group-chainOfThought"],
  file: ["group-chainOfThought"],
  indicator: ["group-chainOfThought"],
  "standalone-tool-call": [],
});

const selectThreadRows = createThreadRowsSelector({ groupBy: threadRowGroupBy });

export type ThreadRowRender = NonNullable<
  ComponentProps<typeof ThreadPrimitive.Row>["children"]
>;

export type VirtualThreadScrollerApi = {
  jumpToBottom: () => void;
  isAtBottom: boolean;
};

type ThreadVirtualMessagesProps = {
  renderRow: ThreadRowRender;
  scrollerRef: RefObject<HTMLDivElement | null>;
  onAtBottomChange?: (atBottom: boolean) => void;
  apiRef?: RefObject<VirtualThreadScrollerApi | null>;
};

/**
 * Owns scroll follow and TanStack measurement for the message list. Composer
 * and load-earlier stay outside so sticky chrome does not fight the virtualizer.
 */
export const ThreadVirtualMessages: FC<ThreadVirtualMessagesProps> = ({
  renderRow,
  scrollerRef,
  onAtBottomChange,
  apiRef,
}) => {
  const rows = useAuiState(selectThreadRows);
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const contentRef = useRef<HTMLDivElement>(null);
  const stickyRef = useRef(true);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const virtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    getItemKey: (index) => rows[index]!.key,
    getScrollElement: () => scrollerRef.current,
    overscan: OVERSCAN,
    scrollToFn: (offset, { adjustments = 0, behavior }, instance) => {
      const el = instance.scrollElement;
      if (!el) return;
      const top = offset + adjustments;
      if (stickyRef.current) {
        const maxScroll = el.scrollHeight - el.clientHeight;
        if (maxScroll - el.scrollTop <= AT_BOTTOM_THRESHOLD && top < maxScroll) return;
      }
      el.scrollTo({ top, ...(behavior ? { behavior } : {}) });
    },
  });

  const jumpToBottom = useCallback(() => {
    stickyRef.current = true;
    if (rows.length > 0) {
      virtualizer.scrollToIndex(rows.length - 1, { align: "end" });
    }
    requestAnimationFrame(() => {
      const el = scrollerRef.current;
      if (el && stickyRef.current) el.scrollTop = el.scrollHeight;
    });
  }, [rows.length, scrollerRef, virtualizer]);

  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = { jumpToBottom, isAtBottom };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, isAtBottom, jumpToBottom]);

  useEffect(() => {
    onAtBottomChange?.(isAtBottom);
  }, [isAtBottom, onAtBottomChange]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let lastScrollTop = el.scrollTop;
    let lastScrollHeight = el.scrollHeight;
    let lastClientHeight = el.clientHeight;
    const onScroll = () => {
      const atBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM_THRESHOLD;
      if (atBottom) stickyRef.current = true;
      else if (
        el.scrollTop < lastScrollTop &&
        el.scrollHeight === lastScrollHeight &&
        Math.abs(el.clientHeight - lastClientHeight) <= 1
      ) {
        stickyRef.current = false;
      }
      lastScrollTop = el.scrollTop;
      lastScrollHeight = el.scrollHeight;
      lastClientHeight = el.clientHeight;
      setIsAtBottom(atBottom);
    };
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) stickyRef.current = false;
    };
    const disarm = () => {
      stickyRef.current = false;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchmove", disarm, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchmove", disarm);
    };
  }, [scrollerRef]);

  useEffect(() => {
    const el = scrollerRef.current;
    const content = contentRef.current;
    if (!el || !content) return;
    const observer = new ResizeObserver(() => {
      if (stickyRef.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [scrollerRef]);

  const prevIsRunningRef = useRef(false);
  useLayoutEffect(() => {
    if (isRunning && !prevIsRunningRef.current) jumpToBottom();
    prevIsRunningRef.current = isRunning;
  }, [isRunning, jumpToBottom]);

  const didInitialJumpRef = useRef(false);
  useLayoutEffect(() => {
    if (didInitialJumpRef.current || rows.length === 0) return;
    didInitialJumpRef.current = true;
    jumpToBottom();
  }, [rows.length, jumpToBottom]);

  const items = virtualizer.getVirtualItems();
  const paddingTop = items[0]?.start ?? 0;
  const paddingBottom = Math.max(
    0,
    virtualizer.getTotalSize() - (items.at(-1)?.end ?? 0),
  );

  return (
    <div
      ref={contentRef}
      data-slot="aui_message-group"
      className="flex flex-col"
      style={{ paddingTop, paddingBottom }}
    >
      {items.map((item) => {
        const row = rows[item.index];
        if (!row) return null;
        return (
          <div
            key={item.key}
            data-index={item.index}
            ref={virtualizer.measureElement}
            className={cn(
              "aui-virtual-row",
              row.type === "turn-end" ? "pb-4" : "pb-2",
            )}
          >
            <ThreadPrimitive.Row row={row}>{renderRow}</ThreadPrimitive.Row>
          </div>
        );
      })}
    </div>
  );
};
