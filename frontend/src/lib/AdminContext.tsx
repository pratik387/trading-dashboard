"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";

interface AdminContextType {
  adminToken: string | null;
  setAdminToken: (token: string | null) => void;
  isAdmin: boolean;
  clearToken: () => void;
}

const AdminContext = createContext<AdminContextType | undefined>(undefined);

const ADMIN_TOKEN_KEY = "trading_admin_token";

export function AdminProvider({ children }: { children: ReactNode }) {
  const [adminToken, setAdminTokenState] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  // Load token from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(ADMIN_TOKEN_KEY);
    if (stored) {
      setAdminTokenState(stored);
    }
    setIsHydrated(true);
  }, []);

  const setAdminToken = (token: string | null) => {
    setAdminTokenState(token);
    if (token) {
      localStorage.setItem(ADMIN_TOKEN_KEY, token);
    } else {
      localStorage.removeItem(ADMIN_TOKEN_KEY);
    }
  };

  const clearToken = () => {
    setAdminToken(null);
  };

  // Don't render children until we've checked localStorage
  if (!isHydrated) {
    return null;
  }

  return (
    <AdminContext.Provider
      value={{
        adminToken,
        setAdminToken,
        isAdmin: !!adminToken,
        clearToken,
      }}
    >
      {children}
    </AdminContext.Provider>
  );
}

export function useAdmin() {
  const context = useContext(AdminContext);
  if (!context) {
    throw new Error("useAdmin must be used within an AdminProvider");
  }
  return context;
}
