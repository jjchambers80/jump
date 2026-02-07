// Navigation bar component (T128)
// Shows "My Tickets" link when authenticated as customer

'use client';

import React from 'react';
import Link from 'next/link';
import { useAuth } from '../hooks/useAuth';

export default function Navbar() {
  const { user, userType, isAuthenticated, isAdmin, loading, logout } = useAuth();

  return (
    <nav className="bg-white shadow-sm border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          {/* Logo / Brand */}
          <Link href="/events" className="flex items-center gap-2">
            <span className="text-xl font-bold text-indigo-600">Jump</span>
            <span className="text-sm text-gray-400 hidden sm:inline">Tickets</span>
          </Link>

          {/* Nav Links */}
          <div className="flex items-center gap-4">
            <Link
              href="/events"
              className="text-sm font-medium text-gray-600 hover:text-indigo-600 transition"
            >
              Events
            </Link>

            {!loading && isAuthenticated && !isAdmin && (
              <Link
                href="/my-tickets"
                className="text-sm font-medium text-gray-600 hover:text-indigo-600 transition"
              >
                My Tickets
              </Link>
            )}

            {!loading && isAuthenticated && isAdmin && (
              <Link
                href="/admin/dashboard"
                className="text-sm font-medium text-gray-600 hover:text-indigo-600 transition"
              >
                Dashboard
              </Link>
            )}

            {!loading && isAuthenticated ? (
              <div className="flex items-center gap-3 ml-2">
                <span className="text-xs text-gray-400 hidden md:inline">{user?.name}</span>
                <button
                  onClick={() => logout()}
                  className="text-sm font-medium text-gray-500 hover:text-red-600 transition px-3 py-1.5 rounded-lg hover:bg-gray-50"
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
