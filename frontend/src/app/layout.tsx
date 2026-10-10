import { inter } from '@/lib/interFont';
import './globals.css';
import '../styles/content.css';
import { SessionProvider } from 'next-auth/react';
import { ThemeProvider } from '../components/ThemeProvider';

export const metadata = {
  title: 'Jump Tickets - Online Event Ticketing',
  description: 'Purchase tickets for amazing events with instant QR code delivery',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} ${inter.variable}`}>
        <ThemeProvider>
          <SessionProvider>
            {children}
          </SessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
