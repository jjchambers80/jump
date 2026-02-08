// Admin Create Event page (T110, T116, T117)
// Form with name, date, venue, capacity, ticket_price
// Validation matching backend validators
// Success/error notifications

'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import AdminRoute from '../../../components/AdminRoute';
import { AuthProvider } from '../../../hooks/useAuth';
import adminService from '../../../services/adminService';

function CreateEventForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [formData, setFormData] = useState({
    name: '',
    date: '',
    venue: '',
    capacity: '',
    ticketPrice: '',
  });

  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  // Client-side validation matching backend (T116)
  const validate = (): boolean => {
    const errors: Record<string, string> = {};

    if (!formData.name.trim()) {
      errors.name = 'Event name is required';
    } else if (formData.name.length > 255) {
      errors.name = 'Event name must be 255 characters or less';
    }

    if (!formData.date) {
      errors.date = 'Event date is required';
    } else if (new Date(formData.date) <= new Date()) {
      errors.date = 'Event date must be in the future';
    }

    if (!formData.venue.trim()) {
      errors.venue = 'Venue is required';
    } else if (formData.venue.length > 500) {
      errors.venue = 'Venue must be 500 characters or less';
    }

    const capacity = parseInt(formData.capacity);
    if (!formData.capacity) {
      errors.capacity = 'Capacity is required';
    } else if (isNaN(capacity) || capacity < 1 || capacity > 100000) {
      errors.capacity = 'Capacity must be between 1 and 100,000';
    }

    const price = parseFloat(formData.ticketPrice);
    if (formData.ticketPrice === '') {
      errors.ticketPrice = 'Ticket price is required';
    } else if (isNaN(price) || price < 0) {
      errors.ticketPrice = 'Price must be 0 or greater';
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!validate()) return;

    setLoading(true);
    try {
      const result = await adminService.createEvent({
        name: formData.name,
        date: new Date(formData.date).toISOString(),
        venue: formData.venue,
        capacity: parseInt(formData.capacity),
        ticketPrice: parseFloat(formData.ticketPrice),
      });

      // T117: Success notification
      setSuccess(`Event "${result.event.name}" created successfully! It's in DRAFT status.`);
      setFormData({ name: '', date: '', venue: '', capacity: '', ticketPrice: '' });

      // Redirect to dashboard after short delay
      setTimeout(() => router.push('/admin/dashboard'), 2000);
    } catch (err: any) {
      // T117: Error notification
      setError(err.message || 'Failed to create event. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Get tomorrow's date for min attribute
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minDate = tomorrow.toISOString().slice(0, 16);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900 py-8">
      <div className="max-w-2xl mx-auto px-4">
        <div className="mb-6">
          <button
            onClick={() => router.push('/admin/dashboard')}
            className="text-indigo-600 hover:text-indigo-500 text-sm font-medium"
          >
            ← Back to Dashboard
          </button>
        </div>

        <h1 className="text-3xl font-bold text-gray-900 dark:text-slate-100 mb-8">
          Create New Event
        </h1>

        {success && (
          <div className="mb-6 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-slate-700 text-green-700 dark:text-green-400 px-4 py-3 rounded-md">
            ✅ {success}
          </div>
        )}

        {error && (
          <div className="mb-6 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-slate-700 text-red-700 dark:text-red-400 px-4 py-3 rounded-md">
            ❌ {error}
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          className="bg-white dark:bg-slate-800 shadow-md dark:shadow-lg dark:shadow-black/20 rounded-lg p-8 space-y-6"
        >
          <div>
            <label
              htmlFor="name"
              className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1"
            >
              Event Name *
            </label>
            <input
              id="name"
              type="text"
              maxLength={255}
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-slate-700 dark:text-slate-100 ${
                validationErrors.name
                  ? 'border-red-300 dark:border-red-500'
                  : 'border-gray-300 dark:border-slate-600'
              }`}
              placeholder="e.g. Summer Music Festival 2026"
            />
            {validationErrors.name && (
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">{validationErrors.name}</p>
            )}
          </div>

          <div>
            <label
              htmlFor="date"
              className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1"
            >
              Event Date & Time *
            </label>
            <input
              id="date"
              type="datetime-local"
              min={minDate}
              value={formData.date}
              onChange={(e) => setFormData({ ...formData, date: e.target.value })}
              className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-slate-700 dark:text-slate-100 ${
                validationErrors.date
                  ? 'border-red-300 dark:border-red-500'
                  : 'border-gray-300 dark:border-slate-600'
              }`}
            />
            {validationErrors.date && (
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">{validationErrors.date}</p>
            )}
          </div>

          <div>
            <label
              htmlFor="venue"
              className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1"
            >
              Venue *
            </label>
            <input
              id="venue"
              type="text"
              maxLength={500}
              value={formData.venue}
              onChange={(e) => setFormData({ ...formData, venue: e.target.value })}
              className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-slate-700 dark:text-slate-100 ${
                validationErrors.venue
                  ? 'border-red-300 dark:border-red-500'
                  : 'border-gray-300 dark:border-slate-600'
              }`}
              placeholder="e.g. Madison Square Garden, New York"
            />
            {validationErrors.venue && (
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                {validationErrors.venue}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="capacity"
                className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1"
              >
                Capacity *
              </label>
              <input
                id="capacity"
                type="number"
                min={1}
                max={100000}
                value={formData.capacity}
                onChange={(e) => setFormData({ ...formData, capacity: e.target.value })}
                className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-slate-700 dark:text-slate-100 ${
                  validationErrors.capacity
                    ? 'border-red-300 dark:border-red-500'
                    : 'border-gray-300 dark:border-slate-600'
                }`}
                placeholder="e.g. 500"
              />
              {validationErrors.capacity && (
                <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                  {validationErrors.capacity}
                </p>
              )}
              <p className="mt-1 text-xs text-gray-500 dark:text-slate-500">1 to 100,000</p>
            </div>

            <div>
              <label
                htmlFor="ticketPrice"
                className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1"
              >
                Ticket Price (USD) *
              </label>
              <input
                id="ticketPrice"
                type="number"
                min={0}
                step={0.01}
                value={formData.ticketPrice}
                onChange={(e) => setFormData({ ...formData, ticketPrice: e.target.value })}
                className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-slate-700 dark:text-slate-100 ${
                  validationErrors.ticketPrice
                    ? 'border-red-300 dark:border-red-500'
                    : 'border-gray-300 dark:border-slate-600'
                }`}
                placeholder="e.g. 49.99"
              />
              {validationErrors.ticketPrice && (
                <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                  {validationErrors.ticketPrice}
                </p>
              )}
              <p className="mt-1 text-xs text-gray-500 dark:text-slate-500">0 for free events</p>
            </div>
          </div>

          <div className="pt-4">
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 text-white py-3 px-4 rounded-md hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium text-lg"
            >
              {loading ? 'Creating Event...' : 'Create Event'}
            </button>
            <p className="mt-2 text-xs text-gray-500 dark:text-slate-500 text-center">
              Events are created in DRAFT status. You can publish them from the dashboard.
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function CreateEventPage() {
  return (
    <AuthProvider>
      <AdminRoute>
        <CreateEventForm />
      </AdminRoute>
    </AuthProvider>
  );
}
