'use client';

// Chip input for free-form tags with suggestions from the organization's
// existing tags. Enter / comma adds, Backspace on empty removes the last.

import { X } from 'lucide-react';
import { useId, useState } from 'react';

interface TagInputProps {
  id?: string;
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  max?: number;
  maxLength?: number;
}

export default function TagInput({
  id,
  value,
  onChange,
  suggestions = [],
  max = 20,
  maxLength = 40,
}: TagInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const listId = `${inputId}-suggestions`;
  const [draft, setDraft] = useState('');

  const add = (raw: string) => {
    const tag = raw.trim().replace(/\s+/g, ' ').slice(0, maxLength);
    if (!tag) return;
    if (value.some((existing) => existing.toLowerCase() === tag.toLowerCase())) {
      setDraft('');
      return;
    }
    if (value.length >= max) return;
    onChange([...value, tag]);
    setDraft('');
  };

  const remove = (index: number) => onChange(value.filter((_, i) => i !== index));

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2 py-1.5 focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/30 dark:border-slate-600 dark:bg-slate-900">
      {value.map((tag, index) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800 dark:bg-slate-700 dark:text-slate-200"
        >
          {tag}
          <button
            type="button"
            aria-label={`Remove tag ${tag}`}
            onClick={() => remove(index)}
            className="rounded-full text-gray-500 hover:text-gray-900 dark:text-slate-400 dark:hover:text-white"
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
        </span>
      ))}
      <input
        id={inputId}
        list={listId}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            add(draft);
          } else if (event.key === 'Backspace' && !draft && value.length) {
            remove(value.length - 1);
          }
        }}
        onBlur={() => add(draft)}
        placeholder={value.length ? '' : 'Add a tag and press Enter'}
        maxLength={maxLength}
        className="min-w-[8rem] flex-1 border-0 bg-transparent p-0.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-0 dark:text-white"
      />
      <datalist id={listId}>
        {suggestions
          .filter((s) => !value.includes(s))
          .map((s) => (
            <option key={s} value={s} />
          ))}
      </datalist>
    </div>
  );
}
