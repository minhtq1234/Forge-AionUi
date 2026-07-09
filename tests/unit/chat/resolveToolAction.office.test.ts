import { describe, expect, it } from 'vitest';
import { resolveToolAction } from '@/common/chat/toolActivity/resolveToolAction';

// Skill-wrapper tools (e.g. officecli) arrive with a generic name like "Skill";
// the meaningful signal is the command/args in the call detail.
describe('resolveToolAction — office-file detection from call detail', () => {
  it('labels a generic Skill wrapper as office when the detail names officecli', () => {
    expect(resolveToolAction('Skill', 'execute', 'officecli info /Users/x/report.xlsx')).toEqual({
      category: 'office',
    });
  });

  it('detects an office file extension in the detail (docx)', () => {
    expect(resolveToolAction('Skill', 'execute', '{"file":"/Users/x/Q2.docx"}')).toEqual({ category: 'office' });
  });

  it('falls back to the kind category when the detail is not office-related', () => {
    expect(resolveToolAction('Skill', 'execute', 'ls -la /tmp')).toEqual({ category: 'code' });
  });

  it('keeps name-based identity as the priority over detail', () => {
    expect(resolveToolAction('forge-reports_render_report', 'execute', 'chart.xlsx')).toEqual({
      toolKey: 'render_report',
      category: 'report',
    });
  });

  it('is unchanged when no detail is provided', () => {
    expect(resolveToolAction('Skill', 'execute')).toEqual({ category: 'code' });
  });
});
