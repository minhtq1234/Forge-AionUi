/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen } from '@testing-library/react';
import React, { useState } from 'react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { StudioNavigationLock } from '@renderer/pages/studio/components/StudioNavigationLock';

const Harness: React.FC = () => {
  const [locked, setLocked] = useState(true);
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <>
      <StudioNavigationLock locked={locked} />
      <span>{location.pathname}</span>
      <button type='button' onClick={() => navigate('/other')}>
        Leave
      </button>
      <button type='button' onClick={() => navigate(-1)}>
        Back
      </button>
      <button type='button' onClick={() => setLocked(false)}>
        Resolve draft
      </button>
    </>
  );
};

const renderHarness = () =>
  render(
    <MemoryRouter initialEntries={['/first', '/studio']} initialIndex={1}>
      <Routes>
        <Route path='*' element={<Harness />} />
      </Routes>
    </MemoryRouter>
  );

describe('StudioNavigationLock', () => {
  it('blocks declarative-router push and back navigation until the draft is resolved', () => {
    renderHarness();

    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    expect(screen.getByText('/studio')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('/studio')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Resolve draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    expect(screen.getByText('/other')).toBeInTheDocument();
  });

  it('marks an app close as cancelable while the draft is unresolved', () => {
    renderHarness();
    const event = new Event('beforeunload', { cancelable: true });

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });
});
