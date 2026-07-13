import { describe, expect, it } from 'vitest';
import { resolveToolAction } from '@/common/chat/toolActivity/resolveToolAction';

// Skill-wrapper tools (e.g. officecli) arrive with a generic name like "Skill";
// the meaningful signal is the command/args in the call detail.
describe('resolveToolAction — office-file detection from call detail', () => {
  it('labels a generic Skill wrapper as office when the detail names officecli', () => {
    expect(resolveToolAction('Skill', 'execute', 'officecli info /Users/x/report.xlsx')).toEqual({
      category: 'office',
      purpose: 'delivering',
    });
  });

  it('detects an office file extension in the detail (docx)', () => {
    expect(resolveToolAction('Skill', 'execute', '{"file":"/Users/x/Q2.docx"}')).toEqual({
      category: 'office',
      purpose: 'delivering',
    });
  });
  it('classifies Office work before the generic exec fallback', () => {
    expect(resolveToolAction('exec', 'execute', 'officecli view report.xlsx')).toEqual({
      category: 'office',
      purpose: 'delivering',
    });
  });

  it('uses shell intent before an Office filename for searches and reads', () => {
    expect(resolveToolAction('exec', 'execute', 'rg -n revenue report.xlsx')).toEqual({
      category: 'search',
      purpose: 'discovering',
    });
    expect(resolveToolAction('exec', 'execute', 'cat report.docx')).toEqual({
      category: 'fileRead',
      purpose: 'reviewing',
    });
  });

  it('uses verification intent before an Office filename', () => {
    expect(resolveToolAction('exec', 'execute', 'bun run test report.xlsx')).toEqual({
      category: 'verify',
      purpose: 'verifying',
    });
  });

  it('keeps an explicit officecli command as Office work when later shell segments differ', () => {
    expect(resolveToolAction('exec', 'execute', 'officecli edit report.xlsx && bun test')).toEqual({
      category: 'office',
      purpose: 'delivering',
    });
    expect(resolveToolAction('exec', 'execute', 'officecli view report.xlsx && cat output.txt')).toEqual({
      category: 'office',
      purpose: 'delivering',
    });
    expect(resolveToolAction('exec', 'execute', 'sudo -u root officecli edit report.xlsx && bun test')).toEqual({
      category: 'office',
      purpose: 'delivering',
    });
  });

  it('falls back to the kind category when the detail is not office-related', () => {
    expect(resolveToolAction('Skill', 'execute', 'ls -la /tmp')).toEqual({ category: 'code', purpose: 'running' });
  });

  it('keeps name-based identity as the priority over detail', () => {
    expect(resolveToolAction('forge-reports_render_report', 'execute', 'chart.xlsx')).toEqual({
      toolKey: 'render_report',
      category: 'report',
      purpose: 'delivering',
    });
  });

  it('is unchanged when no detail is provided', () => {
    expect(resolveToolAction('Skill', 'execute')).toEqual({ category: 'code', purpose: 'running' });
  });
});
