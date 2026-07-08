import { describe, expect, it } from 'vitest';
import { resolveToolAction } from '@/common/chat/toolActivity/resolveToolAction';

describe('resolveToolAction', () => {
  it('matches a seeded tool with a server prefix', () => {
    expect(resolveToolAction('forge-reports_render_report')).toEqual({ toolKey: 'render_report', category: 'report' });
  });
  it('matches a seeded tool without a prefix', () => {
    expect(resolveToolAction('render_report')).toEqual({ toolKey: 'render_report', category: 'report' });
  });
  it('maps data_open to the fileRead category', () => {
    expect(resolveToolAction('forge-reports_data_open')).toEqual({ toolKey: 'data_open', category: 'fileRead' });
  });
  it('falls back to a keyword category for unseeded tools', () => {
    expect(resolveToolAction('acme_web_search')).toEqual({ category: 'web' });
  });
  it('uses the ACP kind when the name has no keyword', () => {
    expect(resolveToolAction('doit', 'read')).toEqual({ category: 'fileRead' });
  });
  it('falls back to generic for unknown tools', () => {
    expect(resolveToolAction('mystery_thing_42')).toEqual({ category: 'generic' });
  });
  it('handles undefined names', () => {
    expect(resolveToolAction(undefined)).toEqual({ category: 'generic' });
  });
});
