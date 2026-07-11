import { describe, expect, it } from 'vitest';
import {
  getOfficePreviewRefreshToken,
  isOfficePreviewContentType,
  nextOfficePreviewRevision,
} from '@renderer/pages/conversation/Preview/context/officePreviewRevision';

describe('office preview revision helpers', () => {
  it('recognizes Word and Excel preview types only', () => {
    expect(isOfficePreviewContentType('word')).toBe(true);
    expect(isOfficePreviewContentType('excel')).toBe(true);
    expect(isOfficePreviewContentType('ppt')).toBe(false);
    expect(isOfficePreviewContentType('html')).toBe(false);
  });

  it('starts an Office refresh revision at one', () => {
    expect(nextOfficePreviewRevision(undefined)).toBe(1);
  });

  it('increments an existing Office refresh revision', () => {
    expect(nextOfficePreviewRevision(4)).toBe(5);
  });

  it('uses the file identity to distinguish a refresh after switching Office files', () => {
    expect(getOfficePreviewRefreshToken('/workspace/a.docx', 0, 2)).not.toBe(
      getOfficePreviewRefreshToken('/workspace/b.docx', 0, 2)
    );
  });
});
