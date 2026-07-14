/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import type { OfficeArtifactSelection } from '@/common/types/office/artifactEditor';
import type { WebviewHostScriptRequest } from '@/renderer/components/media/WebviewHost';
import type { OfficePreviewRefreshState } from '@/renderer/pages/conversation/Preview/types';
import OfficeWatchViewer from './OfficeWatchViewer';

type ExcelPreviewProps = {
  conversationId: string;
  file_path?: string;
  content?: string;
  workspace?: string;
  refreshToken?: string;
  onRefreshStateChange?: (state: OfficePreviewRefreshState) => void;
  onSelectionChange?: (selection: OfficeArtifactSelection) => void;
  scriptRequest?: WebviewHostScriptRequest;
};

const ExcelPreview: React.FC<ExcelPreviewProps> = (props) => <OfficeWatchViewer docType='excel' {...props} />;

export default ExcelPreview;
