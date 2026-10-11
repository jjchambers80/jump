// Skeleton of a step's own fields while the wizard loads (§11.3).

export default function LoadingFields() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading this step" className="mx-auto w-full max-w-[640px] space-y-4 px-4 py-8 sm:px-6">
      <div className="h-8 w-1/2 animate-pulse rounded bg-gray-200 dark:bg-slate-700" />
      <div className="h-4 w-3/4 animate-pulse rounded bg-gray-200 dark:bg-slate-700" />
      <div className="h-11 animate-pulse rounded-md bg-gray-200 dark:bg-slate-700" />
    </div>
  );
}
