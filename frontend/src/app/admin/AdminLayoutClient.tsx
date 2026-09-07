// Admin layout client wrapper (T004, T025)
// Renders AdminRoute guard + AdminSidebar + global header with OrgSwitcher

'use client';

import { useState } from 'react';
import AdminRoute from '@/components/AdminRoute';
import AdminSidebar from '@/components/AdminSidebar';
import OrgSwitcher from '@/components/OrgSwitcher';
import { OrgProvider } from '@/components/OrgContext';

export default function AdminLayoutClient({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <AdminRoute>
      <OrgProvider>
        <div className="flex h-screen overflow-hidden bg-gray-50 dark:bg-slate-900">
          <AdminSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

          {/* Main content area */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            {/* Global header with org switcher */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
              <div className="flex items-center">
                {/* Mobile sidebar toggle */}
                <button
                  onClick={() => setSidebarOpen(true)}
                  className="md:hidden p-1 mr-3 text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200"
                  aria-label="Open sidebar"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 6h16M4 12h16M4 18h16"
                    />
                  </svg>
                </button>
                <span className="md:hidden text-lg font-bold text-gray-900 dark:text-white">Admin</span>
              </div>
              <OrgSwitcher />
            </div>

            {/* Scrollable content */}
            <main className="flex-1 overflow-y-auto">{children}</main>
          </div>
        </div>
      </OrgProvider>
    </AdminRoute>
  );
}
