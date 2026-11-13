import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { apiRequest, tokenStorage } from '../api/client';
import { ApiSuccessResponse, AuthUser, UserRole } from '../types';

interface LoginResponseData {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasRole: (...allowedRoles: UserRole[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const restoreSession = useCallback(async () => {
    const token = tokenStorage.getAccess();
    if (!token) {
      setLoading(false);
      return;
    }

    try {
      const res = await apiRequest<ApiSuccessResponse<AuthUser>>('/auth/me');
      setUser(res.data);
    } catch {
      tokenStorage.clear();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void restoreSession();
  }, [restoreSession]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiRequest<ApiSuccessResponse<LoginResponseData>>('/auth/login', {
      method: 'POST',
      body: { email, password },
      skipAuth: true,
    });
    tokenStorage.setTokens(res.data.accessToken, res.data.refreshToken);
    setUser(res.data.user);
  }, []);

  const logout = useCallback(async () => {
    const refreshToken = tokenStorage.getRefresh();
    try {
      if (tokenStorage.getAccess()) {
        await apiRequest('/auth/logout', {
          method: 'POST',
          body: refreshToken ? { refreshToken } : {},
        });
      }
    } catch {
      // Clear local session regardless of server response
    } finally {
      tokenStorage.clear();
      setUser(null);
    }
  }, []);

  const hasRole = useCallback(
    (...allowedRoles: UserRole[]) => {
      if (!user) return false;
      return allowedRoles.includes(user.role);
    },
    [user]
  );

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, hasRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
