'use client';

// The event page's info dialogs: tier description, event image (drawer on
// phones, dialog on desktop) and Event Information. Owned by the container,
// mounted only while open; preview mode never opens them (spec 050 §8.2).

import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import ContentHtml from '@/components/storefront/ContentHtml';
import { resolveAssetUrl } from '@/lib/assets';
import { useDialog } from '@/lib/useDialog';

const CLOSE = 'text-gray-400 hover:text-gray-600 dark:hover:text-slate-300';

function CloseButton({ onClose, className = 'transition-colors' }: { onClose: () => void; className?: string }) {
  return (
    <button onClick={onClose} aria-label="Close" className={`${CLOSE} ${className}`}>
      <X className="w-6 h-6" aria-hidden />
    </button>
  );
}

export function TierDescriptionDialog({ name, description, onClose }: { name: string; description?: string | null; onClose: () => void }) {
  const ref = useDialog(true, onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tier-description-heading"
        tabIndex={-1}
        className="bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-lg w-full max-h-[80vh] overflow-y-auto focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-slate-700">
          <h2 id="tier-description-heading" className="text-xl font-bold text-gray-900 dark:text-slate-100">
            {name}
          </h2>
          <CloseButton onClose={onClose} />
        </div>
        <div className="p-6">
          <p className="text-gray-700 dark:text-slate-300 text-lg leading-relaxed whitespace-pre-wrap">{description}</p>
        </div>
      </div>
    </div>
  );
}

/** Slide-up drawer on phones, centred dialog from `sm`, one content tree each. */
function ResponsiveDialog({
  label,
  title,
  desktopTitle,
  desktopClass,
  mobileBody,
  desktopBody,
  onClose,
}: {
  label: string;
  title: string;
  desktopTitle: ReactNode;
  desktopClass: string;
  mobileBody: ReactNode;
  desktopBody: ReactNode;
  onClose: () => void;
}) {
  const ref = useDialog(true, onClose);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center bg-black/60"
      onClick={onClose}
    >
      {/* Mobile: slide-up drawer */}
      <div className="sm:hidden w-full bg-white dark:bg-slate-800 rounded-t-2xl max-h-[85vh] overflow-hidden animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 bg-gray-300 dark:bg-slate-600 rounded-full" />
        </div>
        <div className="px-4 pb-2 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100">{title}</h3>
          <CloseButton onClose={onClose} className="p-1" />
        </div>
        {mobileBody}
      </div>
      {/* Desktop: centered dialog */}
      <div className={`hidden sm:block bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full m-4 ${desktopClass}`} onClick={(e) => e.stopPropagation()}>
        {desktopTitle}
        {desktopBody}
      </div>
    </div>
  );
}

export function ImageDialog({ name, logoUrl, onClose }: { name: string; logoUrl: string; onClose: () => void }) {
  const image = <img src={resolveAssetUrl(logoUrl) || undefined} alt={name} className="w-full h-auto object-contain rounded-lg" />;
  return (
    <ResponsiveDialog
      label={`${name} image`}
      title={name}
      desktopClass="max-w-2xl max-h-[85vh] overflow-hidden"
      desktopTitle={
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-slate-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100">{name}</h3>
          <CloseButton onClose={onClose} />
        </div>
      }
      mobileBody={<div className="px-4 pb-6">{image}</div>}
      desktopBody={<div className="p-4">{image}</div>}
      onClose={onClose}
    />
  );
}

export function DescriptionDialog({ description, onClose }: { description: string; onClose: () => void }) {
  return (
    <ResponsiveDialog
      label="Event Information"
      title="Event Information"
      desktopClass="max-w-4xl max-h-[80vh] overflow-y-auto"
      desktopTitle={
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-slate-700">
          <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">Event Information</h2>
          <CloseButton onClose={onClose} />
        </div>
      }
      mobileBody={
        <div className="px-4 pb-6 overflow-y-auto max-h-[70vh]">
          <ContentHtml html={description} className="text-base" />
        </div>
      }
      desktopBody={
        <div className="p-6">
          <ContentHtml html={description} className="text-lg" />
        </div>
      }
      onClose={onClose}
    />
  );
}
