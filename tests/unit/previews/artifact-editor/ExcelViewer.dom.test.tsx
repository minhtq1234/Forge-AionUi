/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { OfficeArtifactSelection } from '@/common/types/office/artifactEditor';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const officeWatchProps = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));

vi.mock('@/renderer/pages/conversation/Preview/components/viewers/OfficeWatchViewer', () => ({
  default: (props: Record<string, unknown>) => {
    officeWatchProps.current = props;
    return <div data-testid='office-watch-viewer' />;
  },
}));

import ExcelViewer from '@/renderer/pages/conversation/Preview/components/viewers/ExcelViewer';

describe('ExcelViewer', () => {
  beforeEach(() => {
    officeWatchProps.current = null;
  });

  it('renders the Excel watch viewer with its file context', () => {
    render(<ExcelViewer file_path='/sheets/forecast.xlsx' workspace='/sheets' refreshToken='3' />);

    expect(screen.getByTestId('office-watch-viewer')).toBeVisible();
    expect(officeWatchProps.current).toMatchObject({
      docType: 'excel',
      file_path: '/sheets/forecast.xlsx',
      workspace: '/sheets',
      refreshToken: '3',
    });
  });

  it('forwards selection and guest navigation callbacks', () => {
    const onSelectionChange = vi.fn<(selection: OfficeArtifactSelection) => void>();
    const scriptRequest = { id: 8, script: "window.__forgeOfficeMoveSelection('down')" };

    render(
      <ExcelViewer
        file_path='/sheets/forecast.xlsx'
        onSelectionChange={onSelectionChange}
        scriptRequest={scriptRequest}
      />
    );

    expect(officeWatchProps.current).toMatchObject({ onSelectionChange, scriptRequest });
  });

  it('renders without a file path', () => {
    render(<ExcelViewer />);
    expect(screen.getByTestId('office-watch-viewer')).toBeInTheDocument();
  });
});
