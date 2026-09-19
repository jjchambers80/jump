'use client';

import { Check, Link as LinkIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { copyText } from '@/lib/content';
import { showToast } from './Toast';

interface CopyLinkButtonProps {
  url: string;
  label?: string;
  /** Hidden until the row is hovered or focused (Files table). */
  revealOnHover?: boolean;
  className?: string;
}

export default function CopyLinkButton({
  url,
  label = 'Copy link',
  revealOnHover = false,
  className = '',
}: CopyLinkButtonProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-testid="copy-link"
      onClick={async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const ok = await copyText(url);
        setCopied(ok);
        showToast(ok ? 'Link copied' : 'Could not copy the link');
      }}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition-opacity duration-150 hover:bg-gray-100 hover:text-gray-900 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 motion-reduce:transition-none dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white ${
        revealOnHover ? 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100' : ''
      } ${className}`}
    >
      {copied ? (
        <Check className="h-4 w-4 text-green-600" aria-hidden />
      ) : (
        <LinkIcon className="h-4 w-4" aria-hidden />
      )}
    </button>
  );
}
