import React, { useState } from 'react';

interface PaymentFormProps {
  event: {
    id: string;
    name: string;
    ticketPrice: number;
  };
  quantity: number;
  onSubmit: (data: { email: string }) => Promise<void>;
  isLoading?: boolean;
}

export const PaymentForm: React.FC<PaymentFormProps> = ({
  event,
  quantity,
  onSubmit,
  isLoading = false,
}) => {
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<{ email?: string }>({});

  const totalAmount = (event.ticketPrice * quantity) / 100;

  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate email
    const newErrors: { email?: string } = {};
    if (!email) {
      newErrors.email = 'Email is required';
    } else if (!validateEmail(email)) {
      newErrors.email = 'Please enter a valid email address';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setErrors({});
    await onSubmit({ email });
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-md p-6">
      <h3 className="text-xl font-bold text-gray-900 mb-6">Purchase Summary</h3>

      {/* Order Summary */}
      <div className="bg-gray-50 rounded-lg p-4 mb-6">
        <div className="space-y-3">
          <div className="flex justify-between">
            <span className="text-gray-700">Event</span>
            <span className="font-semibold text-gray-900">{event.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-700">Quantity</span>
            <span className="font-semibold text-gray-900">
              {quantity} ticket{quantity > 1 ? 's' : ''}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-700">Price per ticket</span>
            <span className="font-semibold text-gray-900">
              ${(event.ticketPrice / 100).toFixed(2)}
            </span>
          </div>
          <div className="border-t border-gray-300 pt-3 flex justify-between">
            <span className="text-lg font-bold text-gray-900">Total</span>
            <span className="text-lg font-bold text-blue-600">${totalAmount.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* Email Input */}
      <div className="mb-6">
        <label htmlFor="email" className="block text-sm font-semibold text-gray-700 mb-2">
          Email Address
        </label>
        <input
          type="email"
          id="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (errors.email) {
              setErrors({ ...errors, email: undefined });
            }
          }}
          className={`w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            errors.email ? 'border-red-500' : 'border-gray-300'
          }`}
          placeholder="your.email@example.com"
          disabled={isLoading}
        />
        {errors.email && <p className="mt-2 text-sm text-red-600">{errors.email}</p>}
        <p className="mt-2 text-sm text-gray-500">
          Your tickets will be sent to this email address
        </p>
      </div>

      {/* Payment Notice */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <div className="flex items-start">
          <svg
            className="w-5 h-5 text-blue-600 mr-2 flex-shrink-0 mt-0.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div>
            <p className="text-sm text-blue-800 font-semibold mb-1">Secure Payment</p>
            <p className="text-xs text-blue-700">
              You will be redirected to Stripe for secure payment processing. Your payment
              information is never stored on our servers.
            </p>
          </div>
        </div>
      </div>

      {/* Submit Button */}
      <button
        type="submit"
        disabled={isLoading}
        className={`w-full py-3 px-6 rounded-lg font-bold text-white transition-colors duration-200 ${
          isLoading ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
        }`}
      >
        {isLoading ? (
          <span className="flex items-center justify-center">
            <svg
              className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              ></circle>
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path>
            </svg>
            Processing...
          </span>
        ) : (
          `Proceed to Payment - $${totalAmount.toFixed(2)}`
        )}
      </button>

      {/* Terms and Conditions */}
      <p className="mt-4 text-xs text-gray-500 text-center">
        By completing this purchase, you agree to our{' '}
        <a href="/terms" className="text-blue-600 hover:underline">
          Terms of Service
        </a>{' '}
        and{' '}
        <a href="/privacy" className="text-blue-600 hover:underline">
          Privacy Policy
        </a>
      </p>
    </form>
  );
};
