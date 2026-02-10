// Admin Dashboard page (T111, T112, T118)
// Real-time stats with auto-refresh every 5 seconds (ADR-004)
// Event list with Edit and Publish buttons

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AdminRoute from '../../../components/AdminRoute';
import { useSession, signOut } from 'next-auth/react';
import adminService, { AdminEvent, DashboardStats } from '../../../services/adminService';

function DashboardContent() {
  const router = useRouter();
  const { data: session } = useSession();
  const user = session?.user;
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [publishingId, setPublishingId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [statsData, eventsData] = await Promise.all([
        adminService.getDashboardStats(),
        adminService.getEvents(),
      ]);
      setStats(statsData);
      setEvents(eventsData.events);
      setError('');
    } catch (err: any) {
      setError(err.message || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load and auto-refresh every 5 seconds (T118, ADR-004)
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handlePublish = async (eventId: string) => {
    setPublishingId(eventId);
    try {
      await adminService.publishEvent(eventId);
      await fetchData(); // Refresh data
    } catch (err: any) {
      setError(err.message || 'Failed to publish event');
    } finally {
      setPublishingId(null);
    }
  };

  const handleLogout = async () => {
    await signOut({ callbackUrl: '/auth/signin' });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900">
      {/* Header */}
      <header className="bg-white dark:bg-slate-800 shadow-sm dark:shadow-lg dark:shadow-black/20">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">
              Admin Dashboard
            </h1>
            <p className="text-sm text-gray-500 dark:text-slate-500">Welcome, {user?.name}</p>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/admin/create-event"
              className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 transition-colors text-sm font-medium"
            >
              + Create Event
            </Link>
            <button
              onClick={handleLogout}
              className="text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-100 text-sm font-medium"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {error && (
          <div className="mb-6 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-slate-700 text-red-700 dark:text-red-400 px-4 py-3 rounded-md">
            {error}
          </div>
        )}

        {/* Stats Cards (T111) */}
        {stats && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <StatCard
              label="Total Capacity"
              value={stats.totalCapacity.toLocaleString()}
              icon="🎫"
            />
            <StatCard
              label="Tickets Sold"
              value={stats.ticketsSold.toLocaleString()}
              icon="✅"
              subtitle={`${stats.remainingCapacity.toLocaleString()} remaining`}
            />
            <StatCard
              label="Sales Rate"
              value={`${stats.salesRate}/min`}
              icon="📈"
              subtitle="Last hour"
            />
            <StatCard label="Payment Success" value={`${stats.paymentSuccessRate}%`} icon="💳" />
          </div>
        )}

        {/* Capacity bar */}
        {stats && stats.totalCapacity > 0 && (
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm dark:shadow-lg dark:shadow-black/20 p-6 mb-8">
            <h3 className="text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
              Overall Capacity
            </h3>
            <div className="w-full bg-gray-200 dark:bg-slate-700 rounded-full h-4">
              <div
                className="bg-indigo-600 h-4 rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min(100, (stats.ticketsSold / stats.totalCapacity) * 100)}%`,
                }}
              />
            </div>
            <p className="mt-1 text-xs text-gray-500 dark:text-slate-500">
              {stats.ticketsSold} / {stats.totalCapacity} tickets sold (
              {((stats.ticketsSold / stats.totalCapacity) * 100).toFixed(1)}%)
            </p>
          </div>
        )}

        {/* Events List (T112) */}
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm dark:shadow-lg dark:shadow-black/20">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-700 flex justify-between items-center">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Your Events</h2>
            <span className="text-sm text-gray-500 dark:text-slate-500">
              {events.length} events
            </span>
          </div>

          {events.length === 0 ? (
            <div className="px-6 py-12 text-center text-gray-500 dark:text-slate-500">
              <p className="text-lg mb-2">No events yet</p>
              <p className="text-sm mb-4">Create your first event to get started</p>
              <Link
                href="/admin/create-event"
                className="inline-block bg-indigo-600 text-white px-6 py-2 rounded-md hover:bg-indigo-700 transition-colors"
              >
                Create Event
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-gray-200 dark:divide-slate-700">
              {events.map((event) => (
                <div
                  key={event.id}
                  className="px-6 py-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-slate-700"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-medium text-gray-900 dark:text-slate-100">
                        {event.name}
                      </h3>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          event.status === 'PUBLISHED'
                            ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400'
                            : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400'
                        }`}
                      >
                        {event.status}
                      </span>
                    </div>
                    <div className="mt-1 text-sm text-gray-500 dark:text-slate-500 flex gap-4">
                      <span>📅 {new Date(event.date).toLocaleDateString()}</span>
                      <span>📍 {event.venue}</span>
                      <span>
                        🎫 {event.ticketsSold}/{event.capacity} sold
                      </span>
                      <span>💰 ${Number(event.ticketPrice).toFixed(2)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {event.status === 'DRAFT' && (
                      <button
                        onClick={() => handlePublish(event.id)}
                        disabled={publishingId === event.id}
                        className="bg-green-600 text-white px-3 py-1.5 rounded-md text-sm hover:bg-green-700 transition-colors disabled:opacity-50"
                      >
                        {publishingId === event.id ? 'Publishing...' : 'Publish'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Auto-refresh indicator */}
        <p className="mt-4 text-xs text-gray-400 dark:text-slate-500 text-center">
          Dashboard auto-refreshes every 5 seconds
        </p>
      </main>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  subtitle,
}: {
  label: string;
  value: string;
  icon: string;
  subtitle?: string;
}) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm dark:shadow-lg dark:shadow-black/20 p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-600 dark:text-slate-400">{label}</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-slate-100 mt-1">{value}</p>
          {subtitle && <p className="text-xs text-gray-500 dark:text-slate-500 mt-1">{subtitle}</p>}
        </div>
        <span className="text-3xl">{icon}</span>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <AdminRoute>
      <DashboardContent />
    </AdminRoute>
  );
}
