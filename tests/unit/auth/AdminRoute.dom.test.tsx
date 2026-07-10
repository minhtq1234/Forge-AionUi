import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AdminRoute } from '@/renderer/components/layout/Router';

type AuthState = {
  status: 'checking' | 'authenticated' | 'unauthenticated';
  user: { id: string; username: string; role: 'admin' | 'member' } | null;
};

const authMocks = vi.hoisted(() => ({
  state: {
    status: 'checking' as AuthState['status'],
    user: null as AuthState['user'],
  },
}));

vi.mock('@renderer/hooks/context/AuthContext', () => ({
  useAuth: () => authMocks.state,
}));

vi.mock('@renderer/components/layout/AppLoader', () => ({
  default: () => <div data-testid='checking-loader' />,
}));

const renderAdminRoute = () =>
  render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route
          path='/admin'
          element={
            <AdminRoute>
              <div data-testid='admin-content' />
            </AdminRoute>
          }
        />
        <Route path='/guid' element={<div data-testid='guid-page' />} />
        <Route path='/login' element={<div data-testid='login-page' />} />
      </Routes>
    </MemoryRouter>
  );

describe('AdminRoute', () => {
  it('renders the existing checking loader while auth is unresolved', () => {
    authMocks.state = { status: 'checking', user: null };

    renderAdminRoute();

    expect(screen.getByTestId('checking-loader')).toBeInTheDocument();
  });

  it('redirects unauthenticated users to login', () => {
    authMocks.state = { status: 'unauthenticated', user: null };

    renderAdminRoute();

    expect(screen.getByTestId('login-page')).toBeInTheDocument();
  });

  it('redirects authenticated members to the guide', () => {
    authMocks.state = {
      status: 'authenticated',
      user: { id: 'member-1', username: 'member', role: 'member' },
    };

    renderAdminRoute();

    expect(screen.getByTestId('guid-page')).toBeInTheDocument();
  });

  it('renders children for authenticated admins', () => {
    authMocks.state = {
      status: 'authenticated',
      user: { id: 'admin-1', username: 'admin', role: 'admin' },
    };

    renderAdminRoute();

    expect(screen.getByTestId('admin-content')).toBeInTheDocument();
  });
});
