import { describe, expect, it } from 'vitest';
import { resolveToolAction } from '@/common/chat/toolActivity/resolveToolAction';

describe('resolveToolAction', () => {
  it('matches a seeded tool with a server prefix', () => {
    expect(resolveToolAction('forge-reports_render_report')).toEqual({
      toolKey: 'render_report',
      category: 'report',
      purpose: 'delivering',
    });
  });
  it('matches a seeded tool without a prefix', () => {
    expect(resolveToolAction('render_report')).toEqual({
      toolKey: 'render_report',
      category: 'report',
      purpose: 'delivering',
    });
  });
  it('maps data_open to the fileRead category', () => {
    expect(resolveToolAction('forge-reports_data_open')).toEqual({
      toolKey: 'data_open',
      category: 'fileRead',
      purpose: 'reviewing',
    });
  });
  it('falls back to a keyword category for unseeded tools', () => {
    expect(resolveToolAction('acme_web_search')).toEqual({ category: 'web', purpose: 'discovering' });
  });
  it.each(['Search', 'search_files'])('classifies generic project search identity %s as project discovery', (name) => {
    expect(resolveToolAction(name, 'search')).toEqual({ category: 'search', purpose: 'discovering' });
  });
  it.each(['web_search', 'WebSearch', 'browse', 'fetch'])(
    'reserves web discovery for explicit web identity %s',
    (name) => {
      expect(resolveToolAction(name, 'search')).toEqual({ category: 'web', purpose: 'discovering' });
    }
  );
  it('uses the ACP kind when the name has no keyword', () => {
    expect(resolveToolAction('doit', 'read')).toEqual({ category: 'fileRead', purpose: 'reviewing' });
  });
  it('falls back to generic for unknown tools', () => {
    expect(resolveToolAction('mystery_thing_42')).toEqual({ category: 'generic', purpose: 'running' });
  });
  it('handles undefined names', () => {
    expect(resolveToolAction(undefined)).toEqual({ category: 'generic', purpose: 'running' });
  });
  it('classifies a search command wrapped by exec as discovery work', () => {
    expect(resolveToolAction('exec_command', 'execute', 'rg -n "toolActivity" packages/desktop/src')).toEqual({
      category: 'search',
      purpose: 'discovering',
    });
  });
  it('classifies a test command wrapped by exec as verification work', () => {
    expect(resolveToolAction('exec_command', 'execute', 'bun run test tests/unit/chat')).toEqual({
      category: 'verify',
      purpose: 'verifying',
    });
  });
  it('keeps unknown execution work generic without exposing its command', () => {
    expect(resolveToolAction('exec_command', 'execute', './private-script --secret')).toEqual({
      category: 'code',
      purpose: 'running',
    });
  });
  it.each([
    'bun test tests/unit/chat',
    'bun run lint',
    'npm run build',
    'pnpm run format',
    'yarn check',
    'bunx tsc --noEmit',
    'node scripts/check-i18n.js',
    'cargo test',
    'cargo check',
    'cargo clippy',
  ])('classifies validation detail hidden by a generic Skill wrapper: %s', (detail) => {
    expect(resolveToolAction('Skill', 'execute', detail)).toEqual({
      category: 'verify',
      purpose: 'verifying',
    });
  });
  it.each([
    ['rg -n journal packages', 'search', 'discovering'],
    ['find packages -name "*.ts"', 'search', 'discovering'],
    ['sed -n "1,120p" package.json', 'fileRead', 'reviewing'],
    ['cat package.json', 'fileRead', 'reviewing'],
  ] as const)('classifies %s detail hidden by a generic Skill wrapper', (detail, category, purpose) => {
    expect(resolveToolAction('Skill', 'execute', detail)).toEqual({ category, purpose });
  });
});
