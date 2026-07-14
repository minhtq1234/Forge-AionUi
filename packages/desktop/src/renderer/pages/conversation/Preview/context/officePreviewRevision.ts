import type { PreviewContentType } from '@/common/types/office/preview';

export const isOfficePreviewContentType = (contentType: PreviewContentType): boolean =>
  contentType === 'word' || contentType === 'excel';

export const nextOfficePreviewRevision = (revision: number | undefined): number => (revision ?? 0) + 1;

export const getOfficePreviewRefreshToken = (
  filePath: string | undefined,
  officeRevision: number | undefined,
  manualRevision: number
): string => `${filePath ?? ''}:${officeRevision ?? 0}:${manualRevision}`;
