// Admin root redirect page (T005)
// Per research.md R2: server-side redirect to /admin/dashboard
import { redirect } from 'next/navigation';

export default function AdminPage() {
  redirect('/admin/dashboard');
}
