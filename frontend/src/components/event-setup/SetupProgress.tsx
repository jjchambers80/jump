// Progress (spec 050 §11.2; simplified by spec 051): a 4 px fill bar and
// nothing else. Back and Next move between steps; the step's h1 names it, and
// a step change is announced in SetupShell's live region.

export default function SetupProgress({ index, total }: { index: number; total: number }) {
  return (
    <div
      role="progressbar"
      aria-label="Setup progress"
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={index}
      aria-valuetext={`Step ${index} of ${total}`}
      className="h-1 shrink-0 bg-gray-200 dark:bg-slate-700"
    >
      <div className="h-1 bg-accent-500 motion-safe:transition-[width] motion-safe:duration-200" style={{ width: `${(index / total) * 100}%` }} />
    </div>
  );
}
