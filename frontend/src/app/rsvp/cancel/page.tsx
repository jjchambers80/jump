'use client';

// RSVP cancel page (spec 034 D10): reads the cancel token, confirms, and
// calls POST /rsvps/cancel. Shows success or error states.

import React, { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { rsvpApi } from '@/services/api';

function RsvpCancelContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [status, setStatus] = useState<'confirm' | 'cancelling' | 'done' | 'error'>('confirm');
  const [message, setMessage] = useState('');

  const handleCancel = async () => {
    if (!token) {
      setStatus('error');
      setMessage('Missing cancel token. Please use the link from your confirmation email.');
      return;
    }

    try {
      setStatus('cancelling');
      await rsvpApi.cancel({ token });
      setStatus('done');
    } catch (err: any) {
      setStatus('error');
      if (err?.code === 'INVALID_TOKEN') {
        setMessage('This cancel link is invalid or has expired.');
      } else {
        setMessage(err.message || 'Failed to cancel RSVP. Please try again.');
      }
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-8 max-w-md w-full text-center">
          <p className="text-gray-600 dark:text-slate-400 mb-4">
            No cancel token provided. Please use the link from your RSVP confirmation email.
          </p>
          <Link href="/events" className="text-indigo-600 dark:text-indigo-400 hover:underline text-sm">
            Browse events
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-8 max-w-md w-full text-center">
        {status === 'confirm' && (
          <>
            <div className="text-amber-600 dark:text-amber-400 mb-4">
              <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100 mb-2">Cancel RSVP</h1>
            <p className="text-gray-600 dark:text-slate-400 mb-6">
              Are you sure you want to cancel your RSVP? Your spot will be released.
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={handleCancel}
                className="rounded-md bg-red-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-red-500"
              >
                Yes, Cancel RSVP
              </button>
              <button
                onClick={() => router.push('/events')}
                className="rounded-md border border-gray-300 dark:border-slate-600 px-6 py-2.5 text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700"
              >
                Keep RSVP
              </button>
            </div>
          </>
        )}

        {status === 'cancelling' && (
          <div>
            <svg className="animate-spin h-12 w-12 text-indigo-600 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <p className="text-gray-600 dark:text-slate-400">Cancelling your RSVP…</p>
          </div>
        )}

        {status === 'done' && (
          <>
            <div className="text-green-600 dark:text-green-400 mb-4">
              <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100 mb-2">RSVP Cancelled</h1>
            <p className="text-gray-600 dark:text-slate-400 mb-6">
              Your RSVP has been cancelled. Your spot has been released.
            </p>
            <Link
              href="/events"
              className="inline-block rounded-md bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
            >
              Browse events
            </Link>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="text-red-600 dark:text-red-400 mb-4">
              <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100 mb-2">Could Not Cancel RSVP</h1>
            <p className="text-gray-600 dark:text-slate-400 mb-6">{message}</p>
            <Link
              href="/events"
              className="inline-block rounded-md bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
            >
              Browse events
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

export default function RsvpCancelPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    }>
      <RsvpCancelContent />
    </Suspense>
  );
}