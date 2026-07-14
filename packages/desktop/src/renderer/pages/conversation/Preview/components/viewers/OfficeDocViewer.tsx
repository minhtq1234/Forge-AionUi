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

type OfficeDocPreviewProps = {
  conversationId: string;
  file_path?: string;
  content?: string;
  workspace?: string;
  refreshToken?: string;
  onRefreshStateChange?: (state: OfficePreviewRefreshState) => void;
  onSelectionChange?: (selection: OfficeArtifactSelection) => void;
  scriptRequest?: WebviewHostScriptRequest;
};

const OfficeDocPreview: React.FC<OfficeDocPreviewProps> = (props) => <OfficeWatchViewer docType='word' {...props} />;

export default OfficeDocPreview;
