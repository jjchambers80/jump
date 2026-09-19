import { redirect } from 'next/navigation';

// Content lands on Files (spec 025); Menus and Blog posts are siblings in the sidebar.
export default function ContentPage() {
  redirect('/admin/content/files');
}
