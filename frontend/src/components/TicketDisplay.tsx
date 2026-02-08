import React from 'react';

interface TicketDisplayProps {
  ticket: {
    id: string;
    qrCode?: string;
    qrCodeImage?: string;
    event: {
      name: string;
      venue: string;
      date?: string;
      eventDate?: string;
    };
    customer?: {
      email: string;
    };
    customerEmail?: string;
  };
}

export const TicketDisplay: React.FC<TicketDisplayProps> = ({ ticket }) => {
  const eventDate = new Date(ticket.event.date || ticket.event.eventDate || '');
  const formattedDate = eventDate.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const formattedTime = eventDate.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const holderEmail = ticket.customer?.email || ticket.customerEmail || '';

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg dark:shadow-lg dark:shadow-black/20 overflow-hidden max-w-md mx-auto border-2 border-gray-200 dark:border-slate-700 transition-colors">
      {/* Ticket Header */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-6">
        <h2 className="text-2xl font-bold mb-2">{ticket.event.name}</h2>
        <div className="flex items-center text-blue-100">
          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          <span>{formattedDate}</span>
        </div>
        <div className="flex items-center text-blue-100 mt-1">
          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span>{formattedTime}</span>
        </div>
        <div className="flex items-center text-blue-100 mt-1">
          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
          <span>{ticket.event.venue}</span>
        </div>
      </div>

      {/* QR Code Section */}
      {(ticket.qrCode || ticket.qrCodeImage) && (
        <div className="p-6 bg-gray-50 dark:bg-slate-900">
          <div className="bg-white dark:bg-slate-800 p-4 rounded-lg border-2 border-dashed border-gray-300 dark:border-slate-600 flex flex-col items-center">
            <img
              src={ticket.qrCode || ticket.qrCodeImage}
              alt="Ticket QR Code"
              className="w-48 h-48"
            />
            <p className="text-sm text-gray-600 dark:text-slate-400 mt-3 text-center">
              Show this QR code at the venue entrance
            </p>
          </div>
        </div>
      )}

      {/* Ticket Details */}
      <div className="p-6 border-t-2 border-dashed border-gray-300 dark:border-slate-600">
        <div className="space-y-3">
          <div>
            <p className="text-xs text-gray-500 dark:text-slate-500 uppercase tracking-wide">
              Ticket ID
            </p>
            <p className="text-sm font-mono text-gray-900 dark:text-slate-100">{ticket.id}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-slate-500 uppercase tracking-wide">
              Ticket Holder
            </p>
            <p className="text-sm text-gray-900 dark:text-slate-100">{holderEmail}</p>
          </div>
        </div>
      </div>

      {/* Important Notice */}
      <div className="bg-yellow-50 dark:bg-yellow-900/20 border-t border-yellow-200 dark:border-yellow-800/30 p-4">
        <div className="flex items-start">
          <svg
            className="w-5 h-5 text-yellow-600 dark:text-yellow-500 mr-2 flex-shrink-0 mt-0.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <div>
            <p className="text-xs text-yellow-800 dark:text-yellow-200 font-semibold mb-1">
              Important Notice
            </p>
            <ul className="text-xs text-yellow-700 dark:text-yellow-300 space-y-1">
              <li>• This ticket is non-transferable</li>
              <li>• Do not share or screenshot this QR code</li>
              <li>• Arrive 30 minutes before the event starts</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
