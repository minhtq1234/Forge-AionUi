/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

const CONTEXT_PREFIX = '/context';

export type ContextCommand =
  | { action: 'open' }
  | { action: 'compact' }
  | { action: 'pin'; text: string }
  | { action: 'handoff' };

export type ContextCommandInvalidCode = 'missing_pin_text' | 'unexpected_arguments' | 'unsupported_subcommand';

export type ContextCommandParseResult =
  | { kind: 'not_context' }
  | { kind: 'valid'; command: ContextCommand }
  | { kind: 'invalid'; code: ContextCommandInvalidCode; subcommand: string };

const isContextPrefix = (input: string): boolean => {
  if (!input.startsWith(CONTEXT_PREFIX)) {
    return false;
  }

  if (input.length === CONTEXT_PREFIX.length) {
    return true;
  }

  return /\s/.test(input[CONTEXT_PREFIX.length] ?? '');
};

export function parseContextCommand(input: string): ContextCommandParseResult {
  const trimmedInput = input.trim();
  if (!isContextPrefix(trimmedInput)) {
    return { kind: 'not_context' };
  }

  const remainder = trimmedInput.slice(CONTEXT_PREFIX.length).trim();
  if (!remainder) {
    return {
      kind: 'valid',
      command: { action: 'open' },
    };
  }

  const firstWhitespaceIndex = remainder.search(/\s/);
  const subcommand = firstWhitespaceIndex === -1 ? remainder : remainder.slice(0, firstWhitespaceIndex);
  const subcommandRemainder = firstWhitespaceIndex === -1 ? '' : remainder.slice(firstWhitespaceIndex);

  switch (subcommand) {
    case 'open':
      return subcommandRemainder.trim()
        ? { kind: 'invalid', code: 'unexpected_arguments', subcommand }
        : { kind: 'valid', command: { action: 'open' } };
    case 'compact':
      return subcommandRemainder.trim()
        ? { kind: 'invalid', code: 'unexpected_arguments', subcommand }
        : { kind: 'valid', command: { action: 'compact' } };
    case 'handoff':
      return subcommandRemainder.trim()
        ? { kind: 'invalid', code: 'unexpected_arguments', subcommand }
        : { kind: 'valid', command: { action: 'handoff' } };
    case 'pin': {
      const text = subcommandRemainder.trim();
      return text
        ? { kind: 'valid', command: { action: 'pin', text } }
        : { kind: 'invalid', code: 'missing_pin_text', subcommand };
    }
    default:
      return {
        kind: 'invalid',
        code: 'unsupported_subcommand',
        subcommand,
      };
  }
}
