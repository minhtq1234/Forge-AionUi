import { describe, expect, it, vi } from 'vitest';
import {
  normalizeRemoteAccessArgs,
  resolveRemoteAccessPolicy,
  warnUnsupportedRemoteAccess,
} from '../remoteAccessPolicy';

describe('standalone WebUI remote-access compatibility policy', () => {
  const cliCases: ReadonlyArray<[string, string[], string[]]> = [
    ['a bare switch', ['--remote'], ['--remote']],
    ['an equals-form truthy switch', ['--remote=true'], ['--remote']],
    ['a spaced truthy switch', ['--remote', 'on'], ['--remote']],
    ['an equals-form false switch', ['--remote=false'], []],
    ['a spaced off switch', ['--remote', 'off'], []],
    ['a zero switch', ['--remote=0'], []],
  ];

  it.each(cliCases)('normalizes %s for shared policy evaluation', (_label, args, expected) => {
    const flags = normalizeRemoteAccessArgs(args);

    expect(resolveRemoteAccessPolicy(flags, {}).requestedBy).toEqual(expected);
  });

  it('uses loopback without warning when no retired control requests remote access', () => {
    const policy = resolveRemoteAccessPolicy(new Map(), {});

    expect(policy).toEqual({ allowRemote: false, requestedBy: [] });
  });

  it('records each truthy retired control without enabling remote access', () => {
    const policy = resolveRemoteAccessPolicy(new Map([['remote', true]]), {
      AIONUI_ALLOW_REMOTE: 'true',
      AIONUI_REMOTE: '1',
      AIONUI_HOST: '0.0.0.0',
    });

    expect(policy.allowRemote).toBe(false);
    expect(policy.requestedBy).toEqual(['--remote', 'AIONUI_ALLOW_REMOTE', 'AIONUI_REMOTE', 'AIONUI_HOST']);
  });

  it('ignores false-valued retired controls', () => {
    const policy = resolveRemoteAccessPolicy(new Map([['remote', 'false']]), {
      AIONUI_ALLOW_REMOTE: 'off',
      AIONUI_REMOTE: '0',
      AIONUI_HOST: '127.0.0.1',
    });

    expect(policy.requestedBy).toEqual([]);
  });

  it('emits one value-free warning for multiple request sources', () => {
    const warn = vi.fn();
    const policy = resolveRemoteAccessPolicy(new Map([['remote', true]]), {
      AIONUI_ALLOW_REMOTE: 'a-secret-looking-value',
      AIONUI_HOST: '0.0.0.0',
    });

    warnUnsupportedRemoteAccess(policy, warn);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      '[aionui-web] Remote access requested by --remote, AIONUI_HOST, but Forge WebUI is local-only; binding to 127.0.0.1.'
    );
    expect(warn.mock.calls[0][0]).not.toContain('a-secret-looking-value');
  });

  it('does not warn when no retired control requested remote access', () => {
    const warn = vi.fn();

    warnUnsupportedRemoteAccess(resolveRemoteAccessPolicy(new Map(), {}), warn);

    expect(warn).not.toHaveBeenCalled();
  });
});
