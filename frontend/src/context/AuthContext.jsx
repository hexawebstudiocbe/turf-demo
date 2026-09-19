import React, { createContext, useContext, useState } from 'react';
import { authApi } from '../api/authApi';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => {
    const savedAdmin = localStorage.getItem('turfbook_admin');
    return savedAdmin ? JSON.parse(savedAdmin) : null;
  });
  const [token, setToken] = useState(localStorage.getItem('turfbook_token') || null);

  const login = async (email, password) => {
    const res = await authApi.login({ email, password });
    if (res.success && res.data?.token) {
      localStorage.setItem('turfbook_token', res.data.token);
      localStorage.setItem('turfbook_admin', JSON.stringify(res.data.admin));
      setToken(res.data.token);
      setUser(res.data.admin);
      return res.data.admin;
    }
  };

  const logout = () => {
    localStorage.removeItem('turfbook_token');
    localStorage.removeItem('turfbook_admin');
    setToken(null);
    setUser(null);
  };

  const loginAsDemoAdmin = async () => {
    return await login('admin@turfbook.com', 'AdminPassword123!');
  };

  const value = {
    user,
    token,
    loading: false,
    isAuthenticated: !!user,
    isAdmin: user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN',
    login,
    logout,
    loginAsDemoAdmin,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
