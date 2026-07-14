/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { useResizableSplit } from '@/renderer/hooks/ui/useResizableSplit';

/**
 * Left panel sized by a right-edge divider handle (the chat<->artifact
 * geometry). The handle's grandparent is the measured container; its
 * offsetWidth is stubbed because jsdom reports 0 for laid-out widths.
 */
const LeftPanelHarness: React.FC<{ reverse?: boolean; containerWidth: number }> = ({ reverse, containerWidth }) => {
  const { splitRatio, createDragHandle } = useResizableSplit({
    unit: 'ratio',
    defaultWidth: 50,
    minWidth: 20,
    maxWidth: 80,
  });
  const outerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (outerRef.current) {
      Object.defineProperty(outerRef.current, 'offsetWidth', { configurable: true, value: containerWidth });
    }
  }, [containerWidth]);

  return (
    <div ref={outerRef} data-testid='outer'>
      <div data-testid='panel'>{createDragHandle({ className: 'handle', reverse, linePlacement: 'start' })}</div>
      <span data-testid='ratio'>{splitRatio}</span>
    </div>
  );
};

const dragDivider = (fromX: number, toX: number) => {
  const handle = screen.getByTestId('panel').firstElementChild;
  if (!handle) throw new Error('drag handle not rendered');
  act(() => {
    fireEvent.pointerDown(handle, { clientX: fromX, button: 0, pointerId: 1 });
  });
  act(() => {
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: toX }));
  });
};

const readRatio = () => Number(screen.getByTestId('ratio').textContent);

describe('useResizableSplit — left-panel/right-edge drag direction', () => {
  afterEach(() => cleanup());

  it('grows the left panel when the divider is dragged right (no reverse)', () => {
    render(<LeftPanelHarness containerWidth={1000} />);
    expect(readRatio()).toBe(50);

    // Drag the divider 100px to the right: +100/1000 => +10 => 60.
    dragDivider(200, 300);

    expect(readRatio()).toBeGreaterThan(50);
    expect(readRatio()).toBeCloseTo(60, 0);
  });

  it('would move the WRONG way with reverse:true (guards against the inverted-drag regression)', () => {
    render(<LeftPanelHarness containerWidth={1000} reverse />);
    expect(readRatio()).toBe(50);

    // Same rightward drag, but reverse inverts it: 50 - 10 => 40 (the bug).
    dragDivider(200, 300);

    expect(readRatio()).toBeLessThan(50);
  });
});
