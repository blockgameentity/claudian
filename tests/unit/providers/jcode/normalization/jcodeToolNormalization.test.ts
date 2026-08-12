import {
  TOOL_ASK_USER_QUESTION,
  TOOL_BASH,
  TOOL_EDIT,
  TOOL_GLOB,
  TOOL_GREP,
  TOOL_READ,
  TOOL_SKILL,
  TOOL_SUBAGENT,
  TOOL_TODO_WRITE,
  TOOL_WEB_FETCH,
  TOOL_WEB_SEARCH,
  TOOL_WRITE,
} from '../../../../../src/core/tools/toolNames';
import {
  normalizeJcodeToolInput,
  normalizeJcodeToolName,
  normalizeJcodeToolUseResult,
  resolveJcodeRawToolName,
} from '../../../../../src/providers/jcode/normalization/jcodeToolNormalization';

describe('jcode tool name normalization', () => {
  it('maps jcode tool names to core tool names', () => {
    expect(normalizeJcodeToolName('bash')).toBe(TOOL_BASH);
    expect(normalizeJcodeToolName('edit')).toBe(TOOL_EDIT);
    expect(normalizeJcodeToolName('glob')).toBe(TOOL_GLOB);
    expect(normalizeJcodeToolName('grep')).toBe(TOOL_GREP);
    expect(normalizeJcodeToolName('question')).toBe(TOOL_ASK_USER_QUESTION);
    expect(normalizeJcodeToolName('read')).toBe(TOOL_READ);
    expect(normalizeJcodeToolName('skill')).toBe(TOOL_SKILL);
    expect(normalizeJcodeToolName('task')).toBe(TOOL_SUBAGENT);
    expect(normalizeJcodeToolName('todo')).toBe(TOOL_TODO_WRITE);
    expect(normalizeJcodeToolName('todowrite')).toBe(TOOL_TODO_WRITE);
    expect(normalizeJcodeToolName('webfetch')).toBe(TOOL_WEB_FETCH);
    expect(normalizeJcodeToolName('websearch')).toBe(TOOL_WEB_SEARCH);
    expect(normalizeJcodeToolName('write')).toBe(TOOL_WRITE);
  });

  it('is case-insensitive and falls back to the raw name', () => {
    expect(normalizeJcodeToolName('Bash')).toBe(TOOL_BASH);
    expect(normalizeJcodeToolName('unknown-tool')).toBe('unknown-tool');
    expect(normalizeJcodeToolName(undefined)).toBe('tool');
  });
});

describe('jcode tool input normalization', () => {
  it('normalizes read inputs', () => {
    expect(normalizeJcodeToolInput('read', {
      filePath: 'a.md',
      limit: 100,
      offset: 0,
      junk: true,
    })).toEqual({
      file_path: 'a.md',
      limit: 100,
      offset: 0,
    });
  });

  it('normalizes write and edit inputs', () => {
    expect(normalizeJcodeToolInput('write', {
      content: 'hello',
      file_path: 'a.md',
    })).toEqual({
      content: 'hello',
      file_path: 'a.md',
    });
    expect(normalizeJcodeToolInput('edit', {
      file_path: 'a.md',
      old_string: 'a',
      newString: 'b',
      replaceAll: true,
    })).toEqual({
      file_path: 'a.md',
      old_string: 'a',
      new_string: 'b',
      replace_all: true,
    });
  });

  it('normalizes todo inputs', () => {
    expect(normalizeJcodeToolInput('todo', {
      todos: [
        { content: 'one', status: 'completed', junk: true },
        { content: 'two' },
        { junk: true },
      ],
    })).toEqual({
      todos: [
        { activeForm: 'one', content: 'one', status: 'completed' },
        { activeForm: 'two', content: 'two', status: 'pending' },
      ],
    });
  });

  it('normalizes question inputs with answers', () => {
    expect(normalizeJcodeToolInput('question', {
      questions: [
        { header: 'Q1', question: 'Pick one?', options: ['a', { label: 'b' }] },
        { id: 'q2', question: 'Which?', multi_select: true },
      ],
    })).toEqual({
      questions: [
        {
          header: 'Q1',
          multiSelect: false,
          options: [{ description: '', label: 'a' }, { description: '', label: 'b' }],
          question: 'Pick one?',
        },
        {
          header: 'Q2',
          id: 'q2',
          multiSelect: true,
          options: [],
          question: 'Which?',
        },
      ],
    });
  });

  it('normalizes task inputs', () => {
    expect(normalizeJcodeToolInput('task', {
      command: ' fix it ',
      description: 'Fix the bug',
      run_in_background: true,
    })).toEqual({
      command: 'fix it',
      description: 'Fix the bug',
      run_in_background: true,
    });
  });

  it('normalizes websearch inputs', () => {
    expect(normalizeJcodeToolInput('websearch', {
      action: { type: 'search', query: 'obsidian' },
    })).toEqual({
      actionType: 'search',
      query: 'obsidian',
    });
    expect(normalizeJcodeToolInput('websearch', {
      action: { type: 'open_page', url: 'https://example.com' },
    })).toEqual({
      actionType: 'open_page',
      url: 'https://example.com',
    });
  });

  it('passes unknown tool inputs through unchanged', () => {
    const input = { foo: 'bar' };
    expect(normalizeJcodeToolInput('mystery', input)).toBe(input);
  });
});

describe('jcode tool use result normalization', () => {
  it('derives file paths for write and edit tools', () => {
    expect(normalizeJcodeToolUseResult('write', { file_path: 'a.md' }, 'ok')).toEqual({
      filePath: 'a.md',
    });
    expect(normalizeJcodeToolUseResult('edit', {}, {
      metadata: { filepath: 'b.md' },
    })).toEqual({
      filePath: 'b.md',
    });
  });

  it('extracts question answers from metadata', () => {
    expect(normalizeJcodeToolUseResult('question', {
      questions: [{ id: 'q1', question: 'Pick?' }],
    }, {
      metadata: { answers: ['Yes'] },
    })).toEqual({
      answers: { 'Pick?': 'Yes', q1: 'Yes' },
    });
  });

  it('returns undefined when nothing to normalize', () => {
    expect(normalizeJcodeToolUseResult('read', { file_path: 'a.md' }, 'ok')).toBeUndefined();
  });
});

describe('jcode raw tool name resolution', () => {
  it('prefers a known title over mapped kinds', () => {
    expect(resolveJcodeRawToolName(undefined, { kind: 'execute', title: 'read' }))
      .toEqual({ provenance: 'title', rawName: 'read' });
  });

  it('falls back to mapped kinds', () => {
    expect(resolveJcodeRawToolName(undefined, { kind: 'execute' }))
      .toEqual({ provenance: 'mapped-kind', rawName: 'bash' });
    expect(resolveJcodeRawToolName(undefined, { kind: 'fetch' }))
      .toEqual({ provenance: 'mapped-kind', rawName: 'webfetch' });
    expect(resolveJcodeRawToolName(undefined, { kind: 'read' }))
      .toEqual({ provenance: 'mapped-kind', rawName: 'read' });
    expect(resolveJcodeRawToolName(undefined, { kind: 'unknown' }))
      .toEqual({ provenance: 'fallback', rawName: 'tool' });
  });
});
