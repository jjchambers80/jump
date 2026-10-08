// Small circular progress indicator for the onboarding checklist.

interface ProgressRingProps {
  done: number;
  total: number;
  className?: string;
}

const R = 7;
const C = 2 * Math.PI * R;

export default function ProgressRing({ done, total, className = 'w-4 h-4' }: ProgressRingProps) {
  const ratio = total > 0 ? Math.min(done / total, 1) : 0;
  return (
    <svg
      viewBox="0 0 18 18"
      className={`${className} -rotate-90 shrink-0`}
      role="img"
      aria-label={`${done} of ${total} steps done`}
    >
      <circle cx="9" cy="9" r={R} fill="none" strokeWidth="2.5" className="stroke-gray-200 dark:stroke-slate-600" />
      <circle
        cx="9"
        cy="9"
        r={R}
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={C}
        strokeDashoffset={C * (1 - ratio)}
        className="stroke-accent-600 dark:stroke-accent-400"
      />
    </svg>
  );
}
