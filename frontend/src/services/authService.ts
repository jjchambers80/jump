// Auth Service - API wrapper for authentication
// Register, login, logout, and current user

import { api } from './api';

export interface User {
  id: string;
  email: string;
  name: string;
  organization?: string;
}

export interface AuthResponse {
  user: User;
  userType: 'customer' | 'admin';
}

export interface RegisterResponse {
  user: User;
}

const authService = {
  /**
   * Register a new customer account
   */
  async register(email: string, name: string, password: string): Promise<RegisterResponse> {
    return api.post<RegisterResponse>('/auth/register', { email, name, password });
  },

  /**
   * Login as customer or admin
   */
  async login(email: string, password: string): Promise<AuthResponse> {
    return api.post<AuthResponse>('/auth/login', { email, password });
  },

  /**
   * Logout and invalidate session
   */
  async logout(): Promise<void> {
    return api.post('/auth/logout', {});
  },

  /**
   * Get current authenticated user
   */
  async getCurrentUser(): Promise<AuthResponse> {
    return api.get<AuthResponse>('/auth/me');
  },
};

export default authService;
