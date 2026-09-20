'use client';

// Shopify-style organization switcher dropdown.
// Shows current org, list of orgs to switch, create new, user info, and logout.
// "Create organization" opens the /signup onboarding flow in a new tab
// (spec 022); OrgContext picks the new organization up when that tab finishes.

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useOrg } from './OrgContext';
import { resolveAssetUrl } from '@/lib/assets';

export const SIGNUP_FROM_ADMIN_PATH = '/signup?from_admin=1';

export default function OrgSwitcher() {
  const { organizations, selectedOrg, setSelectedOrgId } = useOrg();
  const { data: session } = useSession();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const handleSelect = (orgId: string) => {
    setSelectedOrgId(orgId);
    setOpen(false);
  };

  const handleCreate = () => {
    setOpen(false);
    // Synchronous in the click handler so popup blockers allow it; fall back
    // to navigating this tab when the popup is refused. (Passing 'noopener'
    // to window.open would make it return null even on success, so the
    // opener is severed by hand instead.)
    const popup = window.open(SIGNUP_FROM_ADMIN_PATH, '_blank');
    if (popup) popup.opener = null;
    else router.push(SIGNUP_FROM_ADMIN_PATH);
  };

  const handleLogout = () => {
    signOut({ callbackUrl: '/events' });
  };

  const userName = session?.user?.name || 'User';
  const userEmail = session?.user?.email || '';
  // Spec 030: uploaded photo (relative /images URL) or the provider picture
  const userImage = resolveAssetUrl(session?.user?.image);

  // Generate initials for avatar
  const initials = (selectedOrg?.name || 'O')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="org-switcher-trigger"
        className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
      >
        <span className="flex items-center justify-center w-7 h-7 rounded-full bg-indigo-600 text-white text-xs font-bold">
          {initials}
        </span>
        <span className="text-sm font-medium text-gray-900 dark:text-slate-100 max-w-[160px] truncate hidden sm:inline">
          {selectedOrg?.name || 'Select org'}
        </span>
        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown menu */}
      {open && (
        <div className="absolute right-0 mt-2 w-72 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-lg z-50 overflow-hidden">
          {/* Org list */}
          <div className="py-1">
            {organizations.map((org) => (
              <button
                key={org.id}
                onClick={() => handleSelect(org.id)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                  org.id === selectedOrg?.id
                    ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                    : 'text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700'
                }`}
              >
                <span className={`flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold ${
                  org.id === selectedOrg?.id
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-200 dark:bg-slate-600 text-gray-600 dark:text-slate-300'
                }`}>
                  {org.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                </span>
                <span className="flex-1 truncate font-medium">{org.name}</span>
                {org.id === selectedOrg?.id && (
                  <svg className="w-4 h-4 text-indigo-600 dark:text-indigo-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            ))}
          </div>

          {/* Create org */}
          <div className="border-t border-gray-100 dark:border-slate-700">
            <button
              type="button"
              onClick={handleCreate}
              data-testid="org-switcher-create"
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
            >
              <span className="flex items-center justify-center w-8 h-8 rounded-full border-2 border-dashed border-gray-300 dark:border-slate-500 text-gray-400 dark:text-slate-500">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </span>
              <span className="font-medium">Create organization</span>
            </button>
          </div>

          {/* User info (links to the personal account settings, spec 030) & logout */}
          <div className="border-t border-gray-100 dark:border-slate-700 py-1">
            <Link
              href="/admin/account"
              onClick={() => setOpen(false)}
              data-testid="org-switcher-account"
              className="px-4 py-2.5 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
            >
              {userImage ? (
                <img src={userImage} alt="" className="w-8 h-8 rounded-full object-cover bg-gray-200 dark:bg-slate-600" />
              ) : (
                <span className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-200 dark:bg-slate-600 text-gray-600 dark:text-slate-300 text-xs font-bold">
                  {userName.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                </span>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-slate-100 truncate">{userName}</p>
                <p className="text-xs text-gray-500 dark:text-slate-400 truncate">{userEmail}</p>
                <p className="text-xs text-indigo-600 dark:text-indigo-400">Manage account</p>
              </div>
            </Link>
            <button
              onClick={() => {
                if (theme === 'light') setTheme('dark');
                else if (theme === 'dark') setTheme('system');
                else setTheme('light');
              }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
            >
              <span className="flex items-center justify-center w-8 h-8">
                {theme === 'light' ? (
                  <svg className="w-5 h-5 text-gray-400 dark:text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                ) : theme === 'dark' ? (
                  <svg className="w-5 h-5 text-gray-400 dark:text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5 text-gray-400 dark:text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                )}
              </span>
              <span className="font-medium">
                {theme === 'light' ? 'Light mode' : theme === 'dark' ? 'Dark mode' : 'System mode'}
              </span>
            </button>
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
            >
              <span className="flex items-center justify-center w-8 h-8">
                <svg className="w-5 h-5 text-gray-400 dark:text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </span>
              <span className="font-medium">Log out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
