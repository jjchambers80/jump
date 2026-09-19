// Renders organizer-authored HTML on the storefront. The backend sanitises
// every write (backend/src/utils/sanitizeHtml.js); this is the single place
// stored HTML is injected. Never render unsanitised input through it.

interface ContentHtmlProps {
  html: string;
  className?: string;
}

export default function ContentHtml({ html, className = '' }: ContentHtmlProps) {
  return (
    <div
      className={`jump-prose jump-prose--storefront text-gray-800 dark:text-slate-200 ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
