import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  TOOL_ASK_USER_QUESTION,
  TOOL_BASH,
  TOOL_EDIT,
  TOOL_READ,
} from '../../../../../src/core/tools/toolNames';
import type { ChatMessage } from '../../../../../src/core/types';
import {
  isJcodeSessionHydrationDiagnosticMessage,
  loadJcodeSessionMessages,
  loadJcodeSessionModel,
  mapJcodeMessages,
} from '../../../../../src/providers/jcode/history/JcodeHistoryStore';

function makeSessionMessages(): unknown[] {
  return [
    {
      id: 'msg-user-1',
      role: 'user',
      timestamp: '2026-01-01T10:00:00.000Z',
      content: [
        { type: 'text', text: 'Fix the bug' },
      ],
    },
    {
      id: 'msg-assistant-1',
      role: 'assistant',
      timestamp: '2026-01-01T10:00:05.000Z',
      content: [
        { type: 'reasoning', text: 'Let me think...' },
        { type: 'text', text: 'I will inspect the file.' },
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'read',
          input: { file_path: 'src/main.ts', limit: 100 },
        },
      ],
    },
    {
      id: 'msg-tool-result-1',
      role: 'user',
      timestamp: '2026-01-01T10:00:06.000Z',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'tool-1',
          content: 'file contents',
          is_error: false,
        },
      ],
    },
    {
      id: 'msg-assistant-2',
      role: 'assistant',
      timestamp: '2026-01-01T10:00:07.000Z',
      content: [
        {
          type: 'tool_use',
          id: 'tool-2',
          name: 'edit',
          input: {
            file_path: 'src/main.ts',
            old_string: 'a',
            new_string: 'b',
          },
        },
      ],
    },
    {
      id: 'msg-tool-result-2',
      role: 'user',
      timestamp: '2026-01-01T10:00:08.000Z',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'tool-2',
          content: 'edit applied',
          is_error: false,
        },
      ],
    },
    {
      id: 'msg-assistant-3',
      role: 'assistant',
      timestamp: '2026-01-01T10:00:09.000Z',
      content: [
        { type: 'text', text: 'Done.' },
      ],
    },
    {
      id: 'msg-reminder',
      role: 'assistant',
      display_role: 'system',
      timestamp: '2026-01-01T10:00:10.000Z',
      content: [
        { type: 'text', text: 'Injected reminder' },
      ],
    },
  ];
}

describe('mapJcodeMessages', () => {
  it('projects user and assistant messages with tool call pairing', () => {
    const messages = mapJcodeMessages(makeSessionMessages());
    expect(messages.map(message => message.role)).toEqual(['user', 'assistant']);

    const [user, assistant] = messages;
    expect(user).toMatchObject({
      content: 'Fix the bug',
      id: 'msg-user-1',
      role: 'user',
      userMessageId: 'msg-user-1',
    });

    expect(assistant?.id).toBe('msg-assistant-1');
    expect(assistant?.toolCalls).toEqual([
      expect.objectContaining({
        id: 'tool-1',
        input: { file_path: 'src/main.ts', limit: 100 },
        name: TOOL_READ,
        result: 'file contents',
        status: 'completed',
      }),
      expect.objectContaining({
        id: 'tool-2',
        name: TOOL_EDIT,
        result: 'edit applied',
        status: 'completed',
        diffData: expect.objectContaining({ filePath: 'src/main.ts' }),
      }),
    ]);
    expect(assistant?.contentBlocks).toEqual([
      { content: 'Let me think...', type: 'thinking' },
      { content: 'I will inspect the file.', type: 'text' },
      { toolId: 'tool-1', type: 'tool_use' },
      { toolId: 'tool-2', type: 'tool_use' },
      { content: 'Done.', type: 'text' },
    ]);
    expect(assistant?.content).toContain('Done.');
  });

  it('merges adjacent assistant messages', () => {
    const messages = mapJcodeMessages([
      { id: 'a1', role: 'assistant', timestamp: '2026-01-01T10:00:00.000Z', content: [{ type: 'text', text: 'Part one' }] },
      { id: 'a2', role: 'assistant', timestamp: '2026-01-01T10:00:01.000Z', content: [{ type: 'text', text: 'Part two' }] },
      { id: 'u1', role: 'user', timestamp: '2026-01-01T10:00:02.000Z', content: [{ type: 'text', text: 'next' }] },
    ]);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      content: 'Part onePart two',
      role: 'assistant',
    });
  });

  it('skips system display_role messages and unknown roles', () => {
    const messages = mapJcodeMessages([
      { id: 's1', role: 'assistant', display_role: 'system', content: [{ type: 'text', text: 'skip me' }] },
      { id: 'x1', role: 'tool', content: [{ type: 'text', text: 'skip me too' }] },
    ]);
    expect(messages).toHaveLength(0);
  });

  it('extracts images from user messages', () => {
    const messages = mapJcodeMessages([
      {
        id: 'u-img',
        role: 'user',
        timestamp: '2026-01-01T10:00:00.000Z',
        content: [
          { type: 'text', text: 'What is this?' },
          { type: 'image', media_type: 'image/png', data: 'aGVsbG8=' },
        ],
      },
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      content: 'What is this?',
      images: [expect.objectContaining({ mediaType: 'image/png' })],
    });
  });

  it('extracts AskUserQuestion answers from tool results', () => {
    const messages = mapJcodeMessages([
      {
        id: 'a-question',
        role: 'assistant',
        timestamp: '2026-01-01T10:00:00.000Z',
        content: [
          {
            type: 'tool_use',
            id: 'q-1',
            name: 'question',
            input: {
              questions: [{ id: 'q1', question: 'Proceed?', options: ['yes', 'no'] }],
            },
          },
        ],
      },
      {
        id: 'a-answer',
        role: 'user',
        timestamp: '2026-01-01T10:00:01.000Z',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'q-1',
            content: '{"answers": {"Proceed?": "yes", "q1": "yes"}}',
            is_error: false,
          },
        ],
      },
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.toolCalls?.[0]).toMatchObject({
      id: 'q-1',
      name: TOOL_ASK_USER_QUESTION,
      resolvedAnswers: {
        'Proceed?': 'yes',
        q1: 'yes',
      },
      status: 'completed',
    });
  });

  it('marks running tool calls when results are missing', () => {
    const messages = mapJcodeMessages([
      {
        id: 'a-run',
        role: 'assistant',
        timestamp: '2026-01-01T10:00:00.000Z',
        content: [
          {
            type: 'tool_use',
            id: 't-1',
            name: 'bash',
            input: { command: 'npm test' },
          },
        ],
      },
    ]);
    expect(messages[0]?.toolCalls).toEqual([
      expect.objectContaining({
        id: 't-1',
        name: TOOL_BASH,
        status: 'running',
      }),
    ]);
  });

  it('tolerates non-array content without crashing', () => {
    const messages = mapJcodeMessages([
      { id: 'bad', role: 'assistant', content: 'not-an-array' },
      { id: 'bad2', role: 'user', content: 42 },
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe('');
  });
});

describe('loadJcodeSessionMessages', () => {
  let sessionsDirPath: string;

  beforeEach(() => {
    sessionsDirPath = fs.mkdtempSync(path.join(os.tmpdir(), 'jcode-test-'));
  });

  afterEach(() => {
    fs.rmSync(sessionsDirPath, { force: true, recursive: true });
  });

  it('loads messages from the session file', async () => {
    fs.writeFileSync(
      path.join(sessionsDirPath, 'session-1.json'),
      JSON.stringify({
        id: 'session-1',
        model: 'anthropic/claude-sonnet-4',
        messages: makeSessionMessages(),
      }),
    );
    const messages = await loadJcodeSessionMessages('session-1', { sessionsDirPath });
    expect(messages).toHaveLength(2);
    expect(isJcodeSessionHydrationDiagnosticMessage(messages[0])).toBe(false);
  });

  it('returns a diagnostic when the session file is missing', async () => {
    const messages = await loadJcodeSessionMessages('session-missing', { sessionsDirPath });
    expect(messages).toHaveLength(1);
    expect(isJcodeSessionHydrationDiagnosticMessage(messages[0])).toBe(true);
  });

  it('returns nothing when no sessions dir exists anywhere', async () => {
    const previousJcodeHome = process.env.JCODE_HOME;
    process.env.JCODE_HOME = path.join(sessionsDirPath, 'elsewhere');
    try {
      const messages = await loadJcodeSessionMessages('session-1', {
        sessionsDirPath: path.join(sessionsDirPath, 'nope'),
      });
      expect(messages).toHaveLength(0);
    } finally {
      if (previousJcodeHome === undefined) {
        delete process.env.JCODE_HOME;
      } else {
        process.env.JCODE_HOME = previousJcodeHome;
      }
    }
  });

  it('recovers the historical model selection', async () => {
    fs.writeFileSync(
      path.join(sessionsDirPath, 'session-2.json'),
      JSON.stringify({
        id: 'session-2',
        model: 'anthropic/claude-sonnet-4',
        messages: [],
      }),
    );
    expect(await loadJcodeSessionModel('session-2', { sessionsDirPath }))
      .toBe('jcode:anthropic/claude-sonnet-4');
    expect(await loadJcodeSessionModel('session-unknown', { sessionsDirPath })).toBeNull();
  });
});

describe('hydration diagnostics', () => {
  it('identifies session-level diagnostic messages', () => {
    const message: ChatMessage = {
      assistantMessageId: undefined,
      content: 'Failed to hydrate Jcode session.',
      contentBlocks: [{ content: 'Failed to hydrate Jcode session.', type: 'text' }],
      id: 'jcode-hydration-error-session-s1',
      role: 'assistant',
      timestamp: Date.now(),
    };
    expect(isJcodeSessionHydrationDiagnosticMessage(message)).toBe(true);
  });
});
