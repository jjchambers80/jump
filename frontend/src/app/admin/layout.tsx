// Admin area layout (T004)
// Server component wrapper with client-side AdminRoute guard and AdminSidebar
// Per research.md R1: server layout renders client-side guard

import AdminLayoutClient from './AdminLayoutClient';

export const metadata = {
  title: 'Admin | Jump',
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminLayoutClient>{children}</AdminLayoutClient>;
}
