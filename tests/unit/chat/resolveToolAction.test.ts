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
  it.each([
    'web_search',
    'WebSearch',
    'Web Search',
    'web-search',
    'WebFetch',
    'browse',
    'Browse Web',
    'fetch',
    'Fetch URL',
  ])('reserves web discovery for explicit web identity %s', (name) => {
    expect(resolveToolAction(name, 'search')).toEqual({ category: 'web', purpose: 'discovering' });
  });
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
  it('classifies verification only when a verifier starts a shell segment', () => {
    expect(resolveToolAction('exec_command', 'execute', 'rg -n vitest tests')).toEqual({
      category: 'search',
      purpose: 'discovering',
    });
    expect(resolveToolAction('exec_command', 'execute', 'cat vitest.config.ts')).toEqual({
      category: 'fileRead',
      purpose: 'reviewing',
    });
    expect(resolveToolAction('exec_command', 'execute', 'printf vitest')).toEqual({
      category: 'code',
      purpose: 'running',
    });
    expect(resolveToolAction('exec_command', 'execute', 'cd packages && bun run lint')).toEqual({
      category: 'verify',
      purpose: 'verifying',
    });
    expect(resolveToolAction('exec_command', 'execute', 'echo ready || npm test')).toEqual({
      category: 'verify',
      purpose: 'verifying',
    });
    expect(resolveToolAction('exec_command', 'execute', 'echo ready; cargo clippy')).toEqual({
      category: 'verify',
      purpose: 'verifying',
    });
    expect(resolveToolAction('exec_command', 'execute', 'cat package.json | cargo check')).toEqual({
      category: 'verify',
      purpose: 'verifying',
    });
    expect(resolveToolAction('exec_command', 'execute', 'echo ready\nnode scripts/check-i18n.js')).toEqual({
      category: 'verify',
      purpose: 'verifying',
    });
  });
  it.each([
    [`rg -n 'jest|vitest' tests`, 'search', 'discovering'],
    [`printf 'status|vitest'`, 'code', 'running'],
    [`echo 'x; cargo check'`, 'code', 'running'],
    ['printf "status|vitest"', 'code', 'running'],
    ['printf `status|vitest`', 'code', 'running'],
  ] as const)('ignores verifier-like segments inside quotes for %s', (detail, category, purpose) => {
    expect(resolveToolAction('exec_command', 'execute', detail)).toEqual({ category, purpose });
  });
  it.each([
    ['printf status\\|vitest', 'code', 'running'],
    ['echo x\\; cargo check', 'code', 'running'],
    ['echo ready\\\nvitest', 'code', 'running'],
  ] as const)('ignores verifier-like segments after escaped operators for %s', (detail, category, purpose) => {
    expect(resolveToolAction('exec_command', 'execute', detail)).toEqual({ category, purpose });
  });
  it.each([
    ["printf $'status\\'; vitest'", 'code', 'running'],
    ['echo ready # note; cargo check', 'code', 'running'],
    ['printf ${value:-status|vitest}', 'code', 'running'],
    ['printf $(echo status | vitest)', 'code', 'running'],
  ] as const)('keeps verifier-like text inside protected shell syntax for %s', (detail, category, purpose) => {
    expect(resolveToolAction('exec_command', 'execute', detail)).toEqual({ category, purpose });
  });
  it('removes line continuations before matching verifier commands', () => {
    expect(resolveToolAction('exec_command', 'execute', 'cd packages && \\\nbun test')).toEqual({
      category: 'verify',
      purpose: 'verifying',
    });
    expect(resolveToolAction('exec_command', 'execute', 'cd packages && bun run \\\ntest')).toEqual({
      category: 'verify',
      purpose: 'verifying',
    });
  });
  it.each([
    `printf 'status|vitest' && bun test`,
    "printf $'status\\'; vitest' && bun test",
    'printf ${value:-status|vitest} && bun test',
  ])('finds a real verifier after protected operator text for %s', (detail) => {
    expect(resolveToolAction('exec_command', 'execute', detail)).toEqual({
      category: 'verify',
      purpose: 'verifying',
    });
  });
  it.each(['printf rg', 'printf cat'])(
    'keeps generic execute detail as code when command arguments name another command: %s',
    (detail) => {
      expect(resolveToolAction('Skill', 'execute', detail)).toEqual({ category: 'code', purpose: 'running' });
    }
  );
  it.each([
    ['rg -n journal tests', 'search', 'discovering'],
    ['echo ready && find tests -name "*.ts"', 'search', 'discovering'],
    ['cat package.json', 'fileRead', 'reviewing'],
    ['echo ready; sed -n "1,20p" package.json', 'fileRead', 'reviewing'],
    ['printf ready | git status', 'fileRead', 'reviewing'],
  ] as const)('classifies a real segment-start command in %s', (detail, category, purpose) => {
    expect(resolveToolAction('Skill', 'execute', detail)).toEqual({ category, purpose });
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
    'CI=1 bun test tests/unit/chat',
    'env CI=1 bun run lint',
    'sudo bunx tsc --noEmit',
    'env -i bun test tests/unit/chat',
    'env -u CI bun test tests/unit/chat',
    'sudo -E bun run lint',
    '/usr/bin/env CI=1 bun test tests/unit/chat',
    'bash -lc "bun run test"',
    "bash -l -c 'bun test'",
    "sh -c 'npm run lint'",
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
