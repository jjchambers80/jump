'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function UnlockForm({ orgId }: { orgId: string }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  return (
    <form
      className="mt-6 space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await fetch(`/api/storefront/access/${encodeURIComponent(orgId)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ password }),
        });
        if (res.ok) router.refresh();
        else setError('Wrong password');
      }}
    >
      <label className="block text-left text-sm font-medium" htmlFor="store-password">Enter password</label>
      <input id="store-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded border px-3 py-2" />
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <button type="submit" className="w-full rounded bg-brand px-4 py-2 text-brand-fg">Enter</button>
    </form>
  );
}
