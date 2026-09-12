// Navigation bar component (T128, updated T096, T022-T023)
// Uses next-auth/react useSession for auth state
// Admin links consolidated into single "Admin" link per R6

'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import ThemeToggle from './ThemeToggle';

const ADMIN_ROLES = ['ADMIN', 'ORGANIZER', 'SYSTEM_ADMIN'];

export default function Navbar() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const loading = status === 'loading';
  const isAuthenticated = status === 'authenticated';
  const user = session?.user;
  const userRole = (user as any)?.role;
  const isAdminOrOrganizer = ADMIN_ROLES.includes(userRole);
  const isAdminArea = pathname?.startsWith('/admin');

  // Admin area has its own header with OrgSwitcher
  if (isAdminArea) return null;

  return (
    <nav className="bg-white dark:bg-slate-900 shadow-sm border-b border-gray-200 dark:border-slate-700 transition-colors">
      <div className="mx-auto px-4 sm:px-6">
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

            {/* Customer links — hidden for admin/organizer */}
            {!loading && isAuthenticated && !isAdminOrOrganizer && (
              <>
                <Link
                  href="/my-tickets"
                  className="text-sm font-medium text-gray-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition"
                >
                  My Tickets
                </Link>
                <Link
                  href="/orders"
                  className="text-sm font-medium text-gray-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition"
                >
                  Orders
                </Link>
              </>
            )}

            {/* Single Admin link — replaces 6 individual links (R6) */}
            {!loading && isAuthenticated && isAdminOrOrganizer && (
              <Link
                href="/admin"
                className={`text-sm font-medium transition ${
                  isAdminArea
                    ? 'text-indigo-600 dark:text-indigo-400'
                    : 'text-gray-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400'
                }`}
              >
                Admin
              </Link>
            )}

            {/* Cart icon — passive indicator */}
            <div className="hidden sm:flex items-center justify-center w-8 h-8 text-gray-500 dark:text-slate-400">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
              </svg>
            </div>

            <ThemeToggle />

            {!loading && isAuthenticated ? (
              <div className="flex items-center gap-3 ml-2">
                <span className="text-xs text-gray-500 dark:text-slate-400 hidden md:inline">
                  {user?.name}
                </span>
                <button
                  onClick={() => signOut({ callbackUrl: '/events' })}
                  className="text-sm font-medium text-gray-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition px-3 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800"
                >
                  Logout
                </button>
              </div>
            ) : !loading ? (
              <Link
                href="/auth/signin"
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
