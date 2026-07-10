import React, { useEffect } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthRole } from '@/renderer/hooks/context/AuthContext';

const authResponse = (role: AuthRole): Response =>
  new Response(
    JSON.stringify({
      success: true,
      user: { id: `user-${role}`, username: role, role },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  Object.defineProperty(window, 'electronAPI', {
    value: global.electronAPI,
    configurable: true,
    writable: true,
  });
});

async function loadWebAuth() {
  Object.defineProperty(window, 'electronAPI', {
    value: undefined,
    configurable: true,
    writable: true,
  });
  vi.resetModules();

  const { AuthProvider, useAuth } = await import('@/renderer/hooks/context/AuthContext');

  const AuthRoleProbe: React.FC = () => {
    const { status, user } = useAuth();
    return <output data-testid='auth-role'>{`${status}:${user?.role ?? 'none'}`}</output>;
  };

  const LoginRoleProbe: React.FC = () => {
    const { login, status, user } = useAuth();

    useEffect(() => {
      void login({ username: 'member', password: 'password' });
    }, [login]);

    return <output data-testid='login-role'>{`${status}:${user?.role ?? 'none'}`}</output>;
  };

  return { AuthProvider, AuthRoleProbe, LoginRoleProbe };
}

describe('AuthProvider role parsing', () => {
  it.each<AuthRole>(['admin', 'member'])('retains the %s role returned by the current-user endpoint', async (role) => {
    const fetchMock = vi.fn(async (): Promise<Response> => authResponse(role));
    vi.stubGlobal('fetch', fetchMock);
    const { AuthProvider, AuthRoleProbe } = await loadWebAuth();

    render(
      <AuthProvider>
        <AuthRoleProbe />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-role')).toHaveTextContent(`authenticated:${role}`);
    });
  });

  it.each<AuthRole>(['admin', 'member'])('retains the %s role returned by the login endpoint', async (role) => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (init?.method === 'POST') return authResponse(role);
      return new Response(JSON.stringify({ success: false }), { status: 401 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { AuthProvider, LoginRoleProbe } = await loadWebAuth();

    render(
      <AuthProvider>
        <LoginRoleProbe />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('login-role')).toHaveTextContent(`authenticated:${role}`);
    });
  });
});
