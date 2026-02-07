// Authentication hook for session management
// Login, logout, register, and current user state per FR-021, FR-023

'use client';

import { useState, useEffect, createContext, useContext, useCallback, ReactNode } from 'react';
import authService from '../services/authService';

export interface User {
  id: string;
  email: string;
  name: string;
  organization?: string;
}

interface AuthContextType {
  user: User | null;
  userType: 'customer' | 'admin' | null;
  loading: boolean;
  isAdmin: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, name: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userType, setUserType] = useState<'customer' | 'admin' | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const data = await authService.getCurrentUser();
      setUser(data.user);
      setUserType(data.userType);
    } catch {
      setUser(null);
      setUserType(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const login = async (email: string, password: string) => {
    const data = await authService.login(email, password);
    setUser(data.user);
    setUserType(data.userType);
  };

  const register = async (email: string, name: string, password: string) => {
    const data = await authService.register(email, name, password);
    setUser(data.user);
    setUserType('customer');
  };

  const logout = async () => {
    try {
      await authService.logout();
    } catch {
      // Ignore errors on logout
    }
    setUser(null);
    setUserType(null);
  };

  const isAdmin = userType === 'admin';
  const isAuthenticated = user !== null;

  return (
    <AuthContext.Provider
      value={{
        user,
        userType,
        loading,
        isAdmin,
        isAuthenticated,
        login,
        register,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
