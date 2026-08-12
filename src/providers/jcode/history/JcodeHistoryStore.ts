import * as fs from 'node:fs';
import * as path from 'node:path';

import { extractResolvedAnswersFromResultText } from '../../../core/tools/toolInput';
import { isWriteEditTool, TOOL_ASK_USER_QUESTION } from '../../../core/tools/toolNames';
import type { ChatMessage, ContentBlock, ImageAttachment, ToolCallInfo } from '../../../core/types';
import { extractUserQuery } from '../../../utils/context';
import { extractDiffData } from '../../../utils/diff';
import {
  buildImageAttachmentFromBase64,
} from '../../../utils/imageAttachment';
import { encodeJcodeModelId } from '../models';
import {
  normalizeJcodeToolInput,
  normalizeJcodeToolName,
  normalizeJcodeToolUseResult,
} from '../normalization/jcodeToolNormalization';
import { resolveExistingJcodeSessionsDir } from '../runtime/JcodePaths';
import type { JcodeProviderState } from '../types';

interface StoredMessage {
  content: unknown[];
  displayRole?: unknown;
  display_role?: unknown;
  id?: unknown;
  role?: unknown;
  timestamp?: unknown;
}

interface StoredSessionFile {
  id?: unknown;
  messages?: unknown;
  model?: unknown;
  title?: unknown;
}

interface JcodeHydrationDiagnosticContext {
  messageId?: string;
  reason: string;
  sessionId?: string;
  sessionsDirPath?: string;
}

const JCODE_HYDRATION_DIAGNOSTIC_ID_PREFIX = 'jcode-hydration-error';

export async function loadJcodeSessionMessages(
  sessionId: string,
  providerState?: JcodeProviderState,
): Promise<ChatMessage[]> {
  const sessionsDirPath = resolveExistingJcodeSessionsDir(
    providerState?.sessionsDirPath,
  );
  if (!sessionsDirPath || !fs.existsSync(sessionsDirPath)) {
    return [];
  }

  const sessionFile = readJcodeSessionFile(sessionsDirPath, sessionId);
  if (!sessionFile) {
    return [createJcodeHydrationDiagnosticMessage({
      reason: 'Jcode session file could not be read.',
      sessionId,
      sessionsDirPath,
    })];
  }

  const messages = Array.isArray(sessionFile.messages)
    ? sessionFile.messages
    : [];
  return mapJcodeMessages(messages, {
    reason: '',
    sessionId,
    sessionsDirPath,
  });
}

export async function loadJcodeSessionModel(
  sessionId: string,
  providerState?: JcodeProviderState,
): Promise<string | null> {
  const sessionsDirPath = resolveExistingJcodeSessionsDir(
    providerState?.sessionsDirPath,
  );
  if (!sessionsDirPath || !fs.existsSync(sessionsDirPath)) {
    return null;
  }

  const sessionFile = readJcodeSessionFile(sessionsDirPath, sessionId);
  const rawModelId = typeof sessionFile?.model === 'string'
    ? sessionFile.model.trim()
    : '';
  if (!rawModelId || rawModelId === 'unknown') {
    return null;
  }

  return encodeJcodeModelId(rawModelId);
}

export function mapJcodeMessages(
  rawMessages: unknown,
  context: JcodeHydrationDiagnosticContext = { reason: '' },
): ChatMessage[] {
  if (!Array.isArray(rawMessages)) {
    return [];
  }

  const storedMessages = rawMessages
    .map((entry): StoredMessage | null => {
      if (!isPlainObject(entry)) {
        return null;
      }
      return entry as unknown as StoredMessage;
    })
    .filter((entry): entry is StoredMessage => entry !== null);

  const toolResultsByUseId = collectJcodeToolResults(storedMessages);
  const mappedMessages: ChatMessage[] = [];

  for (const message of storedMessages) {
    try {
      const mapped = mapStoredMessage(message, context, toolResultsByUseId);
      if (mapped) {
        mappedMessages.push(mapped);
      }
    } catch (error) {
      mappedMessages.push(createJcodeHydrationDiagnosticMessage({
        ...context,
        messageId: typeof message.id === 'string' ? message.id : undefined,
        reason: formatUnknownError(error),
      }));
    }
  }

  return mergeAdjacentAssistantMessages(mappedMessages);
}

function collectJcodeToolResults(
  storedMessages: StoredMessage[],
): Map<string, { content: string; isError: boolean }> {
  const toolResultsByUseId = new Map<string, { content: string; isError: boolean }>();
  for (const message of storedMessages) {
    const blocks = Array.isArray(message.content) ? message.content : [];
    for (const block of blocks.filter(isJcodeToolResultBlock)) {
      const toolUseId = getString(block.tool_use_id);
      if (!toolUseId) continue;
      const content = typeof block.content === 'string' ? block.content : '';
      toolResultsByUseId.set(toolUseId, {
        content,
        isError: block.is_error === true,
      });
    }
  }
  return toolResultsByUseId;
}

function mapStoredMessage(
  message: StoredMessage,
  context: JcodeHydrationDiagnosticContext,
  toolResultsByUseId: Map<string, { content: string; isError: boolean }>,
): ChatMessage | null {
  const role = getString(message.role);
  const id = getString(message.id);
  if (!id) {
    return null;
  }
  const displayRole = getString(message.displayRole) ?? getString(message.display_role);
  if (displayRole === 'system') {
    return null;
  }
  if (role !== 'user' && role !== 'assistant') {
    return null;
  }

  const createdAt = parseJcodeTimestamp(message.timestamp) ?? Date.now();
  const blocks = Array.isArray(message.content) ? message.content : [];

  if (role === 'user') {
    const textBlocks = blocks.filter(isJcodeTextBlock);
    const isToolResultMessage = blocks.some(isJcodeToolResultBlock);
    if (isToolResultMessage) {
      for (const block of blocks.filter(isJcodeToolResultBlock)) {
        const toolUseId = getString(block.tool_use_id);
        if (!toolUseId) continue;
        const content = typeof block.content === 'string' ? block.content : '';
        toolResultsByUseId.set(toolUseId, {
          content,
          isError: block.is_error === true,
        });
      }
      return null;
    }

    const promptText = extractUserQuery(
      textBlocks.map((block) => block.text).join(''),
    );
    const images = buildUserImages(blocks, id);
    if (!promptText && images.length === 0) {
      return null;
    }
    return {
      assistantMessageId: undefined,
      content: promptText,
      id,
      ...(images.length > 0 ? { images } : {}),
      role: 'user',
      timestamp: createdAt,
      userMessageId: id,
    };
  }

  const contentBlocks = buildAssistantContentBlocks(blocks);
  const toolCalls = buildAssistantToolCalls(blocks, toolResultsByUseId);

  return {
    assistantMessageId: id,
    content: contentBlocks
      .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
      .map((block) => block.content)
      .join(''),
    contentBlocks: contentBlocks.length > 0 ? contentBlocks : undefined,
    id,
    role: 'assistant',
    timestamp: createdAt,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}

function mergeAdjacentAssistantMessages(messages: ChatMessage[]): ChatMessage[] {
  const merged: ChatMessage[] = [];

  for (const message of messages) {
    const previous = merged[merged.length - 1];
    if (
      message.role === 'assistant'
      && previous?.role === 'assistant'
      && !message.isInterrupt
      && !previous.isInterrupt
      && !isJcodeHydrationDiagnosticMessage(message)
      && !isJcodeHydrationDiagnosticMessage(previous)
    ) {
      previous.content += message.content;
      previous.assistantMessageId = message.assistantMessageId ?? previous.assistantMessageId;
      previous.durationFlavorWord = message.durationFlavorWord ?? previous.durationFlavorWord;
      previous.durationSeconds = message.durationSeconds ?? previous.durationSeconds;
      previous.toolCalls = mergeOptionalArrays(previous.toolCalls, message.toolCalls);
      previous.contentBlocks = mergeOptionalArrays(previous.contentBlocks, message.contentBlocks);
      continue;
    }

    merged.push(message);
  }

  return merged;
}

function mergeOptionalArrays<T>(left?: T[], right?: T[]): T[] | undefined {
  if (!left?.length && !right?.length) {
    return undefined;
  }

  return [
    ...(left ?? []),
    ...(right ?? []),
  ];
}

function createJcodeHydrationDiagnosticMessage(params: {
  messageId?: string;
  reason: string;
  sessionId?: string;
  sessionsDirPath?: string;
}): ChatMessage {
  const detailLines = [
    'Failed to hydrate Jcode session.',
    'provider: Jcode',
    ...(params.sessionId ? [`sessionId: ${params.sessionId}`] : []),
    ...(params.sessionsDirPath ? [`sessionsDirPath: ${params.sessionsDirPath}`] : []),
    ...(params.messageId ? [`messageId: ${params.messageId}`] : []),
    `reason: ${params.reason}`,
  ];
  const content = detailLines.join('\n');

  return {
    assistantMessageId: undefined,
    content,
    contentBlocks: [{ content, type: 'text' }],
    id: buildJcodeHydrationDiagnosticId(params),
    role: 'assistant',
    timestamp: Date.now(),
  };
}

function buildJcodeHydrationDiagnosticId(params: {
  messageId?: string;
  sessionId?: string;
}): string {
  const scope = params.messageId ? 'message' : 'session';
  const rawId = params.messageId ?? params.sessionId ?? String(Date.now());
  const safeId = rawId.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120) || String(Date.now());
  return `${JCODE_HYDRATION_DIAGNOSTIC_ID_PREFIX}-${scope}-${safeId}`;
}

export function isJcodeSessionHydrationDiagnosticMessage(message: ChatMessage): boolean {
  return message.id.startsWith(`${JCODE_HYDRATION_DIAGNOSTIC_ID_PREFIX}-session-`);
}

function isJcodeHydrationDiagnosticMessage(message: ChatMessage): boolean {
  return message.id.startsWith(JCODE_HYDRATION_DIAGNOSTIC_ID_PREFIX);
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readJcodeSessionFile(
  sessionsDirPath: string,
  sessionId: string,
): StoredSessionFile | null {
  const filePath = buildSessionFilePath(sessionsDirPath, sessionId);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!isPlainObject(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function buildSessionFilePath(sessionsDirPath: string, sessionId: string): string {
  const safeSessionId = sessionId.replace(/[^a-zA-Z0-9._-]/g, '-');
  return path.join(sessionsDirPath, `${safeSessionId}.json`);
}

function isJcodeTextBlock(
  block: unknown,
): block is { text: string; type: 'text' } {
  return isPlainObject(block) && block.type === 'text' && typeof block.text === 'string';
}

function isJcodeToolResultBlock(
  block: unknown,
): block is { content: unknown; is_error?: unknown; tool_use_id: unknown; type: 'tool_result' } {
  return isPlainObject(block) && block.type === 'tool_result';
}

function isJcodeToolUseBlock(
  block: unknown,
): block is { id: unknown; input: unknown; name: unknown; type: 'tool_use' } {
  return isPlainObject(block) && block.type === 'tool_use';
}

function isJcodeImageBlock(
  block: unknown,
): block is { data: unknown; media_type: unknown; type: 'image' } {
  return isPlainObject(block) && block.type === 'image';
}

function isJcodeReasoningBlock(
  block: unknown,
): block is { text: unknown; type: 'reasoning' } {
  return isPlainObject(block) && block.type === 'reasoning';
}

function buildAssistantContentBlocks(blocks: unknown[]): ContentBlock[] {
  const contentBlocks: ContentBlock[] = [];

  for (const block of blocks) {
    if (isJcodeReasoningBlock(block)) {
      const text = getString(block.text)?.trim();
      if (!text) {
        continue;
      }
      contentBlocks.push({
        content: text,
        type: 'thinking',
      });
      continue;
    }
    if (isJcodeTextBlock(block)) {
      const text = block.text;
      if (!text) {
        continue;
      }
      contentBlocks.push({
        content: text,
        type: 'text',
      });
      continue;
    }
    if (isJcodeToolUseBlock(block)) {
      const toolId = getString(block.id);
      if (!toolId) {
        continue;
      }
      contentBlocks.push({
        toolId,
        type: 'tool_use',
      });
    }
  }

  return contentBlocks;
}

function buildAssistantToolCalls(
  blocks: unknown[],
  toolResultsByUseId: Map<string, { content: string; isError: boolean }>,
): ToolCallInfo[] {
  return blocks.flatMap((block) => {
    if (!isJcodeToolUseBlock(block)) {
      return [];
    }

    const id = getString(block.id);
    const rawName = getString(block.name);
    const input = isPlainObject(block.input) ? block.input : {};
    if (!id || !rawName) {
      return [];
    }

    const toolResult = toolResultsByUseId.get(id);
    const name = normalizeJcodeToolName(rawName);
    const result = toolResult?.content ?? undefined;
    const status = toolResult
      ? (toolResult.isError ? 'error' as const : 'completed' as const)
      : 'running' as const;
    const toolUseResult = normalizeJcodeToolUseResult(rawName, input, {
      ...(result ? { output: result } : {}),
    });

    const toolCall: ToolCallInfo = {
      id,
      input: normalizeJcodeToolInput(rawName, input),
      name,
      result,
      status,
    };

    if (name === TOOL_ASK_USER_QUESTION) {
      toolCall.resolvedAnswers = toolUseResult?.answers as ToolCallInfo['resolvedAnswers']
        ?? extractResolvedAnswersFromResultText(result);
    }

    if (status === 'completed' && isWriteEditTool(name)) {
      const diffData = extractDiffData(toolUseResult, toolCall);
      if (diffData) {
        toolCall.diffData = diffData;
      }
    }

    return [toolCall];
  });
}

function buildUserImages(blocks: unknown[], messageId: string): ImageAttachment[] {
  const images: ImageAttachment[] = [];

  for (const block of blocks) {
    if (!isJcodeImageBlock(block)) {
      continue;
    }

    const mediaType = getString(block.media_type);
    const data = getString(block.data);
    if (!data || !mediaType) {
      continue;
    }

    const image = buildImageAttachmentFromBase64({
      data,
      id: `jcode-img-${messageId}-${images.length}`,
      mediaType,
      name: `image-${images.length + 1}.${String(mediaType).split('/')[1] ?? 'img'}`,
    });
    if (image) {
      images.push(image);
    }
  }

  return images;
}

function parseJcodeTimestamp(value: unknown): number | null {
  if (typeof value !== 'string') {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function getString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
