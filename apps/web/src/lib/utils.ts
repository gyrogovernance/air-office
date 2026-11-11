import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge Tailwind class names the way shadcn / assistant-ui Elements expect. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
