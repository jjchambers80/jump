// Holding page for a step a later card builds (050-J…N). The step keeps its
// place in the count so progress and resume are right; until it ships, the
// event page is where this part is set up (Save & exit goes there).

export default function PendingStep() {
  return (
    <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 sm:p-6">
      This part of setup is not in the wizard yet. Skip it for now, or choose Save &amp; exit and set it up on the
      event page.
    </p>
  );
}
