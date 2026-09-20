// Admin layout client wrapper (T004, T025)
// Renders AdminRoute guard + AdminSidebar + global header with OrgSwitcher

'use client';

import { Search } from 'lucide-react';
import { useRef, useState } from 'react';
import AdminRoute from '@/components/AdminRoute';
import AdminSearch from '@/components/AdminSearch';
import AdminSidebar from '@/components/AdminSidebar';
import OrgSwitcher from '@/components/OrgSwitcher';
import { OrgProvider } from '@/components/OrgContext';

export default function AdminLayoutClient({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const mobileSearchButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <AdminRoute>
      <OrgProvider>
        <div className="flex h-screen overflow-hidden bg-gray-50 dark:bg-slate-900">
          <AdminSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

          {/* Main content area */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            {/* Global header with org switcher */}
            <header className="border-b border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800">
              <div className="flex items-center gap-4 px-4 py-3">
                <div className="flex min-w-0 items-center md:w-0">
                  {/* Mobile sidebar toggle */}
                  <button
                    onClick={() => setSidebarOpen(true)}
                    className="mr-3 p-1 text-gray-500 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-slate-400 dark:hover:text-slate-200 md:hidden"
                    aria-label="Open sidebar"
                  >
                    <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 6h16M4 12h16M4 18h16"
                      />
                    </svg>
                  </button>
                  <span className="truncate text-lg font-bold text-gray-900 dark:text-white md:hidden">
                    Eventimus
                  </span>
                </div>

                <div className="hidden flex-1 justify-center md:flex">
                  <AdminSearch />
                </div>

                <div className="ml-auto flex flex-shrink-0 items-center gap-2">
                  <button
                    ref={mobileSearchButtonRef}
                    type="button"
                    data-admin-search-toggle
                    aria-label={mobileSearchOpen ? 'Close administration search' : 'Open administration search'}
                    aria-expanded={mobileSearchOpen}
                    onClick={() => setMobileSearchOpen(!mobileSearchOpen)}
                    className="rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200 md:hidden"
                  >
                    <Search className="h-5 w-5" aria-hidden />
                  </button>
                  <OrgSwitcher />
                </div>
              </div>

              {mobileSearchOpen && (
                <div className="px-4 pb-3 md:hidden">
                  <AdminSearch
                    mobile
                    onClose={(restoreFocus) => {
                      setMobileSearchOpen(false);
                      if (restoreFocus) {
                        window.requestAnimationFrame(() => mobileSearchButtonRef.current?.focus());
                      }
                    }}
                  />
                </div>
              )}
            </header>

            {/* Scrollable content */}
            <main className="flex-1 overflow-y-auto">{children}</main>
          </div>
        </div>
      </OrgProvider>
    </AdminRoute>
  );
}
