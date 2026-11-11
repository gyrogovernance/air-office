import type { SVGProps } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Add01Icon, ArrowDown01Icon, ArrowLeft01Icon, ArrowRight01Icon, ArrowUp01Icon, Attachment01Icon, Cancel01Icon, CodeIcon, Copy01Icon, Delete02Icon, Download01Icon, DragDropVerticalIcon, File01Icon, FloppyDiskIcon, Folder01Icon, GitForkIcon, LayoutLeftIcon, LayoutRightIcon, Link01Icon, MagicWand01Icon, MoreHorizontalIcon, PencilEdit01Icon, RefreshIcon, Settings01Icon, StopIcon, TextBoldIcon, TextIndentLessIcon, TextIndentMoreIcon, TextItalicIcon, TextStrikethroughIcon, TextUnderlineIcon, ThumbsDownIcon, ThumbsUpIcon } from '@hugeicons/core-free-icons';

function createIcon(icon: typeof Add01Icon) {
  return function Icon(props: Omit<SVGProps<SVGSVGElement>, 'strokeWidth'> & { strokeWidth?: number }) {
    return <HugeiconsIcon icon={icon} size={16} strokeWidth={1.8} aria-hidden="true" focusable="false" {...props}/>;
  };
}

export const IconPanelLeft = createIcon(LayoutLeftIcon);
export const IconPanelRight = createIcon(LayoutRightIcon);
export const IconPlus = createIcon(Add01Icon);
export const IconChevronDown = createIcon(ArrowDown01Icon);
export const IconChevronLeft = createIcon(ArrowLeft01Icon);
export const IconChevronRight = createIcon(ArrowRight01Icon);
export const IconSave = createIcon(FloppyDiskIcon);
export const IconMore = createIcon(MoreHorizontalIcon);
export const IconDragHandle = createIcon(DragDropVerticalIcon);
export const IconClose = createIcon(Cancel01Icon);
export const IconFile = createIcon(File01Icon);
export const IconSettings = createIcon(Settings01Icon);
export const IconSparkles = createIcon(MagicWand01Icon);
export const IconFolder = createIcon(Folder01Icon);
export const IconSend = createIcon(ArrowUp01Icon);
export const IconArrowUp = createIcon(ArrowUp01Icon);
export const IconStop = createIcon(StopIcon);
export const IconEdit = createIcon(PencilEdit01Icon);
export const IconRefresh = createIcon(RefreshIcon);
export const IconPaperclip = createIcon(Attachment01Icon);
export const IconCopy = createIcon(Copy01Icon);
export const IconDownload = createIcon(Download01Icon);
export const IconBold = createIcon(TextBoldIcon);
export const IconItalic = createIcon(TextItalicIcon);
export const IconUnderline = createIcon(TextUnderlineIcon);
export const IconStrike = createIcon(TextStrikethroughIcon);
export const IconCode = createIcon(CodeIcon);
export const IconLink = createIcon(Link01Icon);
export const IconIndent = createIcon(TextIndentMoreIcon);
export const IconOutdent = createIcon(TextIndentLessIcon);
export const IconFork = createIcon(GitForkIcon);
export const IconTrash = createIcon(Delete02Icon);
export const IconThumbUp = createIcon(ThumbsUpIcon);
export const IconThumbDown = createIcon(ThumbsDownIcon);
