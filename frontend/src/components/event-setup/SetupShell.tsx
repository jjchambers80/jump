// Layout only (spec 050 §11.2): header, progress, then the form pane with its
// sticky footer and, from lg, the live preview on the right. In edit mode the
// "Jump to edit…" rail sits left of the form from xl. No admin sidebar.

export default function SetupShell({
  header,
  progress,
  rail,
  footer,
  preview,
  announcement,
  children,
}: {
  header: React.ReactNode;
  progress: React.ReactNode;
  rail?: React.ReactNode;
  footer: React.ReactNode;
  preview: React.ReactNode;
  /** Polite live text: "Step 4 of 12, Describe it". */
  announcement: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-[100dvh] flex-col bg-white dark:bg-slate-900">
      {header}
      {progress}
      <div className="flex min-h-0 flex-1">
        {rail}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:w-1/2 lg:flex-none xl:w-[44rem]">
          <main id="setup-main" className="min-h-0 flex-1 overflow-y-auto">
            {children}
          </main>
          {footer}
        </div>
        {preview}
      </div>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
