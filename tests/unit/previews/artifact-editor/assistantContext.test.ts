import type { OfficeArtifactInspection } from '@/common/types/office/artifactEditor';
import { buildOfficeAssistantContext } from '@/renderer/pages/conversation/Preview/components/ArtifactEditor/assistantContext';
import { describe, expect, it } from 'vitest';

const translations: Record<string, string> = {
  'preview.office.editor.requestPlaceholder': 'Describe the change you want Forge to make.',
  'preview.office.editor.askWordContext':
    'File: {{fileName}}\nParagraph: {{path}}\nSelected text: {{text}}\nRequest: {{placeholder}}',
  'preview.office.editor.askExcelContext':
    'File: {{fileName}}\nRange: {{range}}\nCells:\n{{cells}}\nRequest: {{placeholder}}',
};

const translate = (key: string, values?: Record<string, string>): string => {
  let result = translations[key] ?? key;
  for (const [name, value] of Object.entries(values ?? {})) {
    result = result.replaceAll(`{{${name}}}`, value);
  }
  return result;
};

describe('buildOfficeAssistantContext', () => {
  it('builds Excel context from the display name and canonical inspected range', () => {
    const inspection: OfficeArtifactInspection = {
      kind: 'excel',
      range: 'Forecast!B4:C6',
      cells: [
        { path: '/Forecast/B4', displayText: '120', input: '120' },
        { path: '/Forecast/C4', displayText: '240', input: '=B4*2' },
      ],
      canEdit: false,
    };

    const text = buildOfficeAssistantContext(translate, '/Users/alice/work/forecast.xlsx', inspection);

    expect(text).toContain('File: forecast.xlsx');
    expect(text).toContain('Forecast!B4:C6');
    expect(text).toContain('Describe the change you want Forge to make.');
    expect(text).not.toContain('/Users/');
  });

  it('builds Word context without exposing a host file path', () => {
    const inspection: OfficeArtifactInspection = {
      kind: 'word',
      path: '/body/p[3]',
      selectedText: 'Operating margin',
      start: 8,
      end: 24,
      canReplace: true,
      canFormat: true,
      formatting: { bold: false, italic: false, underline: false },
    };

    const text = buildOfficeAssistantContext(translate, 'C:\\Users\\alice\\memo.docx', inspection);

    expect(text).toContain('File: memo.docx');
    expect(text).toContain('Paragraph: /body/p[3]');
    expect(text).toContain('Selected text: Operating margin');
    expect(text).not.toContain('C:\\Users\\alice');
  });
});
