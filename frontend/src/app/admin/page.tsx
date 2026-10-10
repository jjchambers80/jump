// Admin root. src/middleware.ts routes /admin on the edge (SYSTEM_ADMIN →
// /admin/system, everyone else → /admin/dashboard) because the role claim is
// readable there without a DB round trip; this is the fallback.
import { redirect } from 'next/navigation';

export default function AdminPage() {
  redirect('/admin/dashboard');
}
