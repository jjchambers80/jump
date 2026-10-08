'use client';

// Deleting a section that has photos: move them to another section or drop them.

import { useState } from 'react';
import ConfirmDialog from '@/components/content/ConfirmDialog';
import { removeSection, type DraftSection } from '@/lib/galleries';

interface SectionDeleteDialogProps {
  sections: DraftSection[];
  sectionKey: string;
  onClose: () => void;
  onConfirm: (next: DraftSection[]) => void;
}

export default function SectionDeleteDialog({ sections, sectionKey, onClose, onConfirm }: SectionDeleteDialogProps) {
  const index = sections.findIndex((section) => section.key === sectionKey);
  const section = sections[index];
  const name = (entry: DraftSection) => entry.title.trim() || `Section ${sections.indexOf(entry) + 1}`;
  const others = sections.filter((entry) => entry.key !== sectionKey);
  const [choice, setChoice] = useState<string>(others[Math.max(0, index - 1)]?.key ?? 'remove');
  const count = section.items.length;

  return (
    <ConfirmDialog
      titleId="delete-section-title"
      title={`Delete ${name(section)}?`}
      confirmLabel="Delete section"
      danger
      onClose={onClose}
      onConfirm={() => onConfirm(removeSection(sections, sectionKey, choice === 'remove' ? null : choice))}
    >
      <fieldset>
        <legend>
          It has {count} {count === 1 ? 'photo' : 'photos'}. What should happen to {count === 1 ? 'it' : 'them'}?
        </legend>
        <div className="mt-2 space-y-1">
          {others.map((entry) => (
            <label key={entry.key} className="flex min-h-10 items-center gap-2">
              <input
                type="radio"
                name="section-photos"
                checked={choice === entry.key}
                onChange={() => setChoice(entry.key)}
                className="h-4 w-4 text-accent-600 focus:ring-accent-500"
              />
              Move to {name(entry)}
            </label>
          ))}
          <label className="flex min-h-10 items-center gap-2">
            <input
              type="radio"
              name="section-photos"
              checked={choice === 'remove'}
              onChange={() => setChoice('remove')}
              className="h-4 w-4 text-accent-600 focus:ring-accent-500"
            />
            Remove them from the gallery (they stay in Files)
          </label>
        </div>
      </fieldset>
    </ConfirmDialog>
  );
}
