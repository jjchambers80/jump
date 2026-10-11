// Loading and not-found states of the public event page.

import { AlertCircle } from 'lucide-react';

export function EventPageLoading() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center">
      <div className="text-center">
        <svg className="animate-spin h-12 w-12 text-brand-link mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          ></path>
        </svg>
        <p className="text-gray-600 dark:text-slate-400">Loading event details...</p>
      </div>
    </div>
  );
}

export function EventPageError({ message }: { message: string | null }) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md dark:shadow-lg dark:shadow-black/20 p-8 max-w-md w-full text-center">
        <div className="text-red-600 dark:text-red-400 mb-4">
          <AlertCircle className="w-16 h-16 mx-auto" aria-hidden />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-slate-100 mb-2">Event Not Found</h2>
        <p className="text-gray-600 dark:text-slate-400 mb-6">{message || 'This event does not exist'}</p>
      </div>
    </div>
  );
}
