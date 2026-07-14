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

import OfficeDocViewer from '@/renderer/pages/conversation/Preview/components/viewers/OfficeDocViewer';

describe('OfficeDocViewer', () => {
  beforeEach(() => {
    officeWatchProps.current = null;
  });

  it('renders the Word watch viewer with its file context', () => {
    render(<OfficeDocViewer file_path='/docs/report.docx' workspace='/docs' refreshToken='2' />);

    expect(screen.getByTestId('office-watch-viewer')).toBeVisible();
    expect(officeWatchProps.current).toMatchObject({
      docType: 'word',
      file_path: '/docs/report.docx',
      workspace: '/docs',
      refreshToken: '2',
    });
  });

  it('forwards selection and guest navigation callbacks', () => {
    const onSelectionChange = vi.fn<(selection: OfficeArtifactSelection) => void>();
    const scriptRequest = { id: 4, script: "window.__forgeOfficeMoveSelection('left')" };

    render(
      <OfficeDocViewer
        file_path='/docs/report.docx'
        onSelectionChange={onSelectionChange}
        scriptRequest={scriptRequest}
      />
    );

    expect(officeWatchProps.current).toMatchObject({ onSelectionChange, scriptRequest });
  });

  it('renders without a file path', () => {
    render(<OfficeDocViewer />);
    expect(screen.getByTestId('office-watch-viewer')).toBeInTheDocument();
  });
});
