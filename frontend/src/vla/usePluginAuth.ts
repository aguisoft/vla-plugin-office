import { useEffect, useState } from 'react';
import { api } from './api';

export interface PluginUser {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  email: string;
  permissions: string[];
}

/**
 * Hook that fetches the current authenticated user.
 * Redirects to /login on 401.
 */
export function usePluginAuth() {
  const [user, setUser] = useState<PluginUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<PluginUser>('/auth/me')
      .then(u => { setUser(u); setLoading(false); })
      .catch(() => { setLoading(false); });
  }, []);

  return { user, loading, isAdmin: user?.role === 'ADMIN' };
}
