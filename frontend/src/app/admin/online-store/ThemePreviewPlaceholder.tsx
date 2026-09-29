// Static stand-in for the theme thumbnails (spec 038 §10) until card 038K
// ships cookie-free thumbnail renders. Decorative: hidden from assistive tech.

export default function ThemePreviewPlaceholder({
  brandColor,
  name,
  variant,
}: {
  brandColor: string | null;
  name: string;
  variant: 'desktop' | 'mobile';
}) {
  const accent = brandColor && /^#[0-9a-f]{6}$/i.test(brandColor) ? brandColor : '#2563eb';
  const mobile = variant === 'mobile';
  return (
    <div
      aria-hidden
      className={`overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900 ${
        mobile ? 'mx-auto h-48 w-24 sm:h-56 sm:w-28' : 'h-48 w-full sm:h-56'
      }`}
    >
      <div className="flex items-center gap-1.5 border-b border-gray-200 px-2 py-1.5 dark:border-slate-700">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: accent }} />
        <span className="truncate text-[9px] font-semibold text-gray-700 dark:text-slate-300">{name}</span>
      </div>
      <div className="h-1/3 opacity-80" style={{ backgroundColor: accent }} />
      <div className="space-y-2 p-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-1.5">
            <div className="h-6 w-6 shrink-0 rounded" style={{ backgroundColor: accent, opacity: 0.6 }} />
            <div className="flex-1 space-y-1">
              <div className="h-1.5 w-3/4 rounded bg-gray-200 dark:bg-slate-700" />
              <div className="h-1.5 w-1/2 rounded bg-gray-100 dark:bg-slate-800" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
