/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StudioProviderAdapterId } from '@/common/types/project/creativeStudioTypes';
import { createBytePlusSeedanceAdapter, type BytePlusSeedanceAdapterDeps } from './bytePlusSeedanceAdapter';
import { createImageGenerationAdapter, type ImageGenerationAdapterDeps } from './imageAdapter';
import { createMediaGatewayAdapter, type MediaGatewayAdapterDeps } from './mediaGatewayAdapter';
import type { GenerationProviderAdapter } from './types';

export * from './bytePlusSeedanceAdapter';
export * from './imageAdapter';
export * from './mediaGatewayAdapter';
export * from './types';

/** Main-process registry: never place this object or its providers in a renderer DTO. */
export type GenerationProviderAdapterRegistry = ReadonlyMap<StudioProviderAdapterId, GenerationProviderAdapter>;

export type GenerationProviderAdapterRegistryDeps = {
  image: ImageGenerationAdapterDeps;
  bytePlusSeedance?: BytePlusSeedanceAdapterDeps;
  mediaGateway?: MediaGatewayAdapterDeps;
};

export const createGenerationProviderAdapterRegistry = (
  deps: GenerationProviderAdapterRegistryDeps
): GenerationProviderAdapterRegistry =>
  new Map<StudioProviderAdapterId, GenerationProviderAdapter>([
    ['weprompt-image-v1', createImageGenerationAdapter(deps.image)],
    ['byteplus-seedance-v1', createBytePlusSeedanceAdapter(deps.bytePlusSeedance)],
    ['weprompt-media-gateway-v1', createMediaGatewayAdapter(deps.mediaGateway)],
  ]);
