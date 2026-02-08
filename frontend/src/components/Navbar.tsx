// Navigation bar component (T128)
// Shows "My Tickets" link when authenticated as customer

'use client';

import React from 'react';
import Link from 'next/link';
import { useAuth } from '../hooks/useAuth';
import ThemeToggle from './ThemeToggle';

export default function Navbar() {
  const { user, userType, isAuthenticated, isAdmin, loading, logout } = useAuth();

  return (
    <nav className="bg-white dark:bg-slate-900 shadow-sm border-b border-gray-200 dark:border-slate-700 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          {/* Logo / Brand */}
          <Link href="/events" className="flex items-center gap-2">
            <span className="text-xl font-bold text-indigo-600 dark:text-indigo-400">Jump</span>
            <span className="text-sm text-gray-500 dark:text-slate-400 hidden sm:inline">
              Tickets
            </span>
          </Link>

          {/* Nav Links */}
          <div className="flex items-center gap-4">
            <Link
              href="/events"
              className="text-sm font-medium text-gray-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition"
            >
              Events
            </Link>

            {!loading && isAuthenticated && !isAdmin && (
              <Link
                href="/my-tickets"
                className="text-sm font-medium text-gray-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition"
              >
                My Tickets
              </Link>
            )}

            {!loading && isAuthenticated && isAdmin && (
              <Link
                href="/admin/dashboard"
                className="text-sm font-medium text-gray-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition"
              >
                Dashboard
              </Link>
            )}

            <ThemeToggle />

            {!loading && isAuthenticated ? (
              <div className="flex items-center gap-3 ml-2">
                <span className="text-xs text-gray-500 dark:text-slate-400 hidden md:inline">
                  {user?.name}
                </span>
                <button
                  onClick={() => logout()}
                  className="text-sm font-medium text-gray-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition px-3 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800"
                >
                  Logout
                </button>
              </div>
            ) : !loading ? (
              <Link
                href="/auth/login"
                className="text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 transition px-4 py-1.5 rounded-lg"
              >
                Sign In
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </nav>
  );
}
