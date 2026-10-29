import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setLoading(false);
      return;
    }

    api.get('/api/auth/me')
      .then((data) => {
        if (data.user.role !== 'ADMIN') {
          localStorage.removeItem('token');
          setUser(null);
          return;
        }
        setUser(data.user);
      })
      .catch(() => {
        localStorage.removeItem('token');
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo(() => ({
    user,
    loading,
    async login(login, password) {
      const data = await api.post('/api/auth/login', { login, password });
      if (data.user.role !== 'ADMIN') {
        throw new Error('Веб-приложение доступно только администратору.');
      }
      localStorage.setItem('token', data.token);
      setUser(data.user);
    },
    async register(payload) {
      const data = await api.post('/api/auth/register', payload);
      localStorage.setItem('token', data.token);
      setUser(data.user);
    },
    logout() {
      localStorage.removeItem('token');
      setUser(null);
    },
  }), [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth должен использоваться внутри AuthProvider');
  }
  return context;
}