// Public / Private pill for a venue: icon plus word, never color alone.

import { Globe, Lock } from 'lucide-react';

export default function VisibilityBadge({ isPublic }: { isPublic: boolean }) {
  return isPublic ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-400/20">
      <Globe className="h-3 w-3" aria-hidden />
      Public
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700 ring-1 ring-inset ring-gray-500/20 dark:bg-slate-700 dark:text-slate-200 dark:ring-white/10">
      <Lock className="h-3 w-3" aria-hidden />
      Private
    </span>
  );
}
