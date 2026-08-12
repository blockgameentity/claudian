import {
  type CliPathFingerprintInputs,
  createCliPathFingerprintInputs,
  hasCliPathFingerprintInputs,
} from '../../../core/providers/cli/CliPathFingerprintInputs';
import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import { createRuntimeInputFingerprint } from '../../../core/providers/settings/RuntimeInputFingerprint';
import type { ProviderSettingsReconciler } from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import { getHostnameKey, parseEnvironmentVariables } from '../../../utils/env';
import { clearJcodeDiscoveryState } from '../discoveryState';
import { sameStringList, sameStringMap } from '../internal/compareCollections';
import { ensureProviderProjectionMap } from '../internal/providerProjection';
import {
  decodeJcodeModelId,
  encodeJcodeModelId,
  extractJcodeModelVariantValue,
  isJcodeModelSelectionId,
  JCODE_DEFAULT_THINKING_LEVEL,
  resolveJcodeBaseModelRawId,
} from '../models';
import {
  getJcodeProviderSettings,
  hasLegacyJcodeDiscoveryFields,
  normalizeJcodePreferredThinkingByModel,
  normalizeJcodeVisibleModels,
  updateJcodeProviderSettings,
} from '../settings';
import { getJcodeState } from '../types';

interface NormalizedSelection {
  baseModelId: string | null;
  variant: string | null;
}

const JCODE_ENV_HASH_KEYS = [
  'JCODE_HOME',
  'JCODE_RUNTIME_DIR',
  'PATH',
] as const;

function computeJcodeRuntimeFingerprint(
  environmentText: string,
  cliPathInputs: CliPathFingerprintInputs,
): string {
  return createRuntimeInputFingerprint({
    additionalInputs: cliPathInputs,
    environmentKeys: JCODE_ENV_HASH_KEYS,
    environmentText,
  });
}

function invalidateJcodeConversationSessions(conversations: Conversation[]): Conversation[] {
  const invalidatedConversations: Conversation[] = [];
  for (const conversation of conversations) {
    if (conversation.providerId !== 'jcode') {
      continue;
    }

    const state = getJcodeState(conversation.providerState);
    if (!conversation.sessionId && !state.sessionsDirPath) {
      continue;
    }

    conversation.sessionId = null;
    conversation.providerState = undefined;
    invalidatedConversations.push(conversation);
  }
  return invalidatedConversations;
}

export const jcodeSettingsReconciler: ProviderSettingsReconciler = {
  handleEnvironmentChange(settings: Record<string, unknown>): boolean {
    return clearJcodeDiscoveryState(settings);
  },

  invalidateConversationSessions: invalidateJcodeConversationSessions,

  reconcileModelWithEnvironment(
    settings: Record<string, unknown>,
    conversations: Conversation[],
  ): { changed: boolean; invalidatedConversations: Conversation[] } {
    const envText = getRuntimeEnvironmentText(settings, 'jcode');
    const jcodeSettings = getJcodeProviderSettings(settings);
    const cliPathInputs = createCliPathFingerprintInputs(
      jcodeSettings.cliPathsByHost[getHostnameKey()],
      jcodeSettings.cliPath,
    );
    const currentHash = computeJcodeRuntimeFingerprint(envText, cliPathInputs);
    const savedHash = jcodeSettings.environmentHash;

    const environment = parseEnvironmentVariables(envText);
    const hasFingerprintInputs = Boolean(
      hasCliPathFingerprintInputs(cliPathInputs)
      || JCODE_ENV_HASH_KEYS.some(
        key => Object.prototype.hasOwnProperty.call(environment, key),
      )
    );
    if (!savedHash && !hasFingerprintInputs) {
      return { changed: false, invalidatedConversations: [] };
    }
    if (currentHash === savedHash) {
      return { changed: false, invalidatedConversations: [] };
    }

    const invalidatedConversations = invalidateJcodeConversationSessions(conversations);

    updateJcodeProviderSettings(settings, { environmentHash: currentHash });
    return { changed: true, invalidatedConversations };
  },

  normalizeModelVariantSettings(settings: Record<string, unknown>): boolean {
    const hadLegacyDiscoveryFields = hasLegacyJcodeDiscoveryFields(settings);
    if (hadLegacyDiscoveryFields) {
      updateJcodeProviderSettings(settings, {});
    }

    const jcodeSettings = getJcodeProviderSettings(settings);
    let changed = hadLegacyDiscoveryFields;

    const normalizeSelection = (value: unknown): NormalizedSelection => {
      if (typeof value !== 'string' || !isJcodeModelSelectionId(value)) {
        return { baseModelId: null, variant: null };
      }

      const rawModelId = decodeJcodeModelId(value);
      if (!rawModelId) {
        return { baseModelId: value, variant: null };
      }

      const baseRawId = resolveJcodeBaseModelRawId(rawModelId, jcodeSettings.discoveredModels);
      return {
        baseModelId: encodeJcodeModelId(baseRawId),
        variant: extractJcodeModelVariantValue(rawModelId, jcodeSettings.discoveredModels),
      };
    };

    const modelSelection = normalizeSelection(settings.model);
    if (typeof settings.model === 'string' && modelSelection.baseModelId && settings.model !== modelSelection.baseModelId) {
      settings.model = modelSelection.baseModelId;
      changed = true;
    }
    if (
      modelSelection.variant
      && (typeof settings.effortLevel !== 'string' || settings.effortLevel.trim().length === 0)
    ) {
      settings.effortLevel = modelSelection.variant;
      changed = true;
    }

    const titleModelSelection = normalizeSelection(settings.titleGenerationModel);
    if (
      typeof settings.titleGenerationModel === 'string'
      && titleModelSelection.baseModelId
      && settings.titleGenerationModel !== titleModelSelection.baseModelId
    ) {
      settings.titleGenerationModel = titleModelSelection.baseModelId;
      changed = true;
    }

    const savedProviderModelRaw = settings.savedProviderModel;
    if (savedProviderModelRaw && typeof savedProviderModelRaw === 'object' && !Array.isArray(savedProviderModelRaw)) {
      const savedProviderModel = savedProviderModelRaw as Record<string, unknown>;
      const savedSelection = normalizeSelection(savedProviderModel.jcode);
      if (
        typeof savedProviderModel.jcode === 'string'
        && savedSelection.baseModelId
        && savedProviderModel.jcode !== savedSelection.baseModelId
      ) {
        savedProviderModel.jcode = savedSelection.baseModelId;
        changed = true;
      }
      if (savedSelection.variant) {
        const savedEffort = ensureProviderProjectionMap(settings, 'savedProviderEffort');
        if (typeof savedEffort.jcode !== 'string') {
          savedEffort.jcode = savedSelection.variant;
          changed = true;
        }
      }
    }

    const normalizedVisibleModels = normalizeJcodeVisibleModels(
      jcodeSettings.visibleModels,
      jcodeSettings.discoveredModels,
    );
    const normalizedPreferredThinking = normalizeJcodePreferredThinkingByModel(
      jcodeSettings.preferredThinkingByModel,
      jcodeSettings.discoveredModels,
    );
    const shouldUpdateProviderSettings = !sameStringList(normalizedVisibleModels, jcodeSettings.visibleModels)
      || !sameStringMap(normalizedPreferredThinking, jcodeSettings.preferredThinkingByModel);
    if (shouldUpdateProviderSettings) {
      updateJcodeProviderSettings(settings, {
        preferredThinkingByModel: normalizedPreferredThinking,
        visibleModels: normalizedVisibleModels,
      });
      changed = true;
    }

    if (typeof settings.effortLevel === 'string' && !settings.effortLevel.trim()) {
      settings.effortLevel = JCODE_DEFAULT_THINKING_LEVEL;
      changed = true;
    }

    return changed;
  },
};
