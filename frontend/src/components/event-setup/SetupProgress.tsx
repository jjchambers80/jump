// Progress (spec 050 §11.2, §11.4; simplified by spec 051): a 4 px fill bar
// and "Step n of N — Name" ("Editing Name" on a set-up event). No step list:
// Back and Next move between steps.

export default function SetupProgress({
  index,
  total,
  title,
  editMode = false,
  aside,
}: {
  index: number;
  total: number;
  title: string;
  /** A set-up event (050-O): "Editing <step>" instead of "Step n of N". */
  editMode?: boolean;
  /** The save indicator, beside the step line. */
  aside: React.ReactNode;
}) {
  return (
    <div className="border-b border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <div
        role="progressbar"
        aria-label="Setup progress"
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={index}
        aria-valuetext={`Step ${index} of ${total}`}
        className="h-1 bg-gray-200 dark:bg-slate-700"
      >
        <div className="h-1 bg-accent-500 motion-safe:transition-[width] motion-safe:duration-200" style={{ width: `${(index / total) * 100}%` }} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2">
        <p className="text-sm text-gray-700 dark:text-slate-300">
          {editMode ? (
            <>
              <span className="text-gray-500 dark:text-slate-400">Editing</span> {title}
            </>
          ) : (
            <>
              Step {index} of {total} — {title}
            </>
          )}
        </p>
        {aside}
      </div>
    </div>
  );
}
