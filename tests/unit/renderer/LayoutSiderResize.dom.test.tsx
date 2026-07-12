import { render } from '@testing-library/react';
import { describe, expect, it, beforeEach } from 'vitest';
import React from 'react';
import { useSiderWidth } from '@/renderer/hooks/context/LayoutContext';

function Probe() {
  const { width } = useSiderWidth();
  return <div data-testid='w'>{width}</div>;
}

describe('useSiderWidth', () => {
  beforeEach(() => localStorage.clear());
  it('defaults to 260 and reads a persisted width within [200,420]', () => {
    localStorage.setItem('app-sider-width-px', '320');
    const { getByTestId } = render(<Probe />);
    expect(getByTestId('w').textContent).toBe('320');
  });
  it('ignores an out-of-range persisted width', () => {
    localStorage.setItem('app-sider-width-px', '999');
    const { getByTestId } = render(<Probe />);
    expect(getByTestId('w').textContent).toBe('260');
  });
});
