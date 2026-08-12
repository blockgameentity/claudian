import { mergePersistedProviderState } from '../../../core/providers/providerState';
import type {
  ProviderConversationHistoryService,
  ProviderHistoryPathContext,
} from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import { getJcodeState, type JcodeProviderState } from '../types';
import { resolveJcodeSessionsDirHint } from './JcodeHistoryPathResolver';
import {
  isJcodeSessionHydrationDiagnosticMessage,
  loadJcodeSessionMessages,
  loadJcodeSessionModel,
} from './JcodeHistoryStore';

const JCODE_PROVIDER_STATE_KEYS = [
  'nativeConversationContextEstablished',
  'sessionsDirPath',
] as const;

export class JcodeConversationHistoryService implements ProviderConversationHistoryService {
  private hydratedKeys = new Map<string, string>();

  hasConversationModelRecoverySource(conversation: Conversation): boolean {
    return !!conversation.sessionId;
  }

  async recoverConversationModelSelection(
    conversation: Conversation,
    _vaultPath: string | null,
    pathContext?: ProviderHistoryPathContext,
  ): Promise<string | null> {
    if (!conversation.sessionId) return null;
    const state = getJcodeState(conversation.providerState);
    const sessionsDirPath = resolveJcodeSessionsDirHint(state.sessionsDirPath, pathContext);
    if (!sessionsDirPath) return null;
    return loadJcodeSessionModel(conversation.sessionId, { sessionsDirPath });
  }

  async hydrateConversationHistory(
    conversation: Conversation,
    _vaultPath: string | null,
    pathContext?: ProviderHistoryPathContext,
  ): Promise<void> {
    const state = getJcodeState(conversation.providerState);
    const sessionsDirPath = resolveJcodeSessionsDirHint(state.sessionsDirPath, pathContext);
    if (state.sessionsDirPath && state.sessionsDirPath !== sessionsDirPath) {
      const providerState = { ...conversation.providerState };
      if (sessionsDirPath) {
        providerState.sessionsDirPath = sessionsDirPath;
      } else {
        delete providerState.sessionsDirPath;
      }
      conversation.providerState = Object.keys(providerState).length > 0
        ? providerState
        : undefined;
    }
    const sessionId = conversation.sessionId;
    if (!sessionId) {
      this.hydratedKeys.delete(conversation.id);
      return;
    }

    const hydrationKey = `${sessionId}::${sessionsDirPath ?? ''}`;
    if (
      conversation.messages.length > 0
      && this.hydratedKeys.get(conversation.id) === hydrationKey
    ) {
      this.markNativeConversationContextEstablished(conversation);
      return;
    }

    const messages = await loadJcodeSessionMessages(sessionId, {
      sessionsDirPath: sessionsDirPath ?? undefined,
    });
    if (messages.length === 0) {
      this.hydratedKeys.delete(conversation.id);
      return;
    }

    conversation.messages = messages;
    if (
      messages.length === 1
      && isJcodeSessionHydrationDiagnosticMessage(messages[0])
    ) {
      this.hydratedKeys.delete(conversation.id);
      return;
    }

    this.hydratedKeys.set(conversation.id, hydrationKey);
    this.markNativeConversationContextEstablished(conversation);
  }

  async resolveMissingConversationSession(
    conversation: Conversation,
    _vaultPath: string | null,
    missingProviderSessionId?: string,
  ): Promise<'delete' | 'reset' | 'preserve'> {
    if (
      !conversation.sessionId
      || !missingProviderSessionId
      || conversation.sessionId !== missingProviderSessionId
    ) {
      return 'preserve';
    }

    conversation.sessionId = null;
    conversation.providerState = {
      ...conversation.providerState,
      nativeConversationContextEstablished: false,
    };
    this.hydratedKeys.delete(conversation.id);
    return 'reset';
  }

  resolveSessionIdForConversation(conversation: Conversation | null): string | null {
    return conversation?.sessionId ?? null;
  }

  isPendingForkConversation(_conversation: Conversation): boolean {
    return false;
  }

  buildForkProviderState(
    _sourceSessionId: string,
    _resumeAt: string,
    _sourceProviderState?: Record<string, unknown>,
  ): Record<string, unknown> {
    return {};
  }

  buildPersistedProviderState(
    conversation: Conversation,
  ): Record<string, unknown> | undefined {
    const state = getJcodeState(conversation.providerState);
    const providerState: JcodeProviderState = {
      ...(state.sessionsDirPath ? { sessionsDirPath: state.sessionsDirPath } : {}),
      ...(typeof state.nativeConversationContextEstablished === 'boolean'
        ? {
            nativeConversationContextEstablished:
              state.nativeConversationContextEstablished,
          }
        : {}),
    };

    return mergePersistedProviderState(
      conversation.providerState,
      JCODE_PROVIDER_STATE_KEYS,
      providerState,
    );
  }

  private markNativeConversationContextEstablished(
    conversation: Conversation,
  ): void {
    const state = getJcodeState(conversation.providerState);
    if (state.nativeConversationContextEstablished !== false) return;
    conversation.providerState = {
      ...conversation.providerState,
      nativeConversationContextEstablished: true,
    };
  }
}
