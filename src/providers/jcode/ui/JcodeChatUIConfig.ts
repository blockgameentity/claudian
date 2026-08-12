import type {
  ProviderChatUIConfig,
  ProviderReasoningOption,
  ProviderUIOption,
} from '../../../core/providers/types';
import { JCODE_PROVIDER_ICON } from '../../../shared/icons';
import { maybeGetJcodeWorkspaceServices } from '../app/JcodeWorkspaceServices';
import { JcodeMetadataService } from '../metadata/JcodeMetadataService';
import {
  buildJcodeBaseModels,
  decodeJcodeModelId,
  encodeJcodeModelId,
  isJcodeModelSelectionId,
  JCODE_DEFAULT_THINKING_LEVEL,
  resolveJcodeBaseModelRawId,
  resolveJcodeDefaultThinkingLevel,
} from '../models';
import { getJcodeProviderSettings, updateJcodeProviderSettings } from '../settings';

const DEFAULT_CONTEXT_WINDOW = 200_000;

export const jcodeChatUIConfig: ProviderChatUIConfig = {
  getModelOptions(settings): ProviderUIOption[] {
    const jcodeSettings = getJcodeProviderSettings(settings);
    const applyAlias = (rawId: string, option: ProviderUIOption): ProviderUIOption => {
      const alias = jcodeSettings.modelAliases[rawId];
      return alias ? { ...option, label: alias } : option;
    };
    const discoveredModels = new Map(buildJcodeBaseModels(jcodeSettings.discoveredModels).map((model) => [
      encodeJcodeModelId(model.rawId),
      applyAlias(model.rawId, {
        description: model.description ?? 'Jcode runtime',
        label: model.label,
        value: encodeJcodeModelId(model.rawId),
      }),
    ]));
    const seenValues = new Set<string>();
    const options: ProviderUIOption[] = [];
    for (const rawModelId of [...jcodeSettings.visibleModels].reverse()) {
      const encodedModelId = encodeJcodeModelId(rawModelId);
      pushOption(
        options,
        seenValues,
        encodedModelId,
        discoveredModels.get(encodedModelId)
          ?? applyAlias(rawModelId, {
            description: 'Configured model',
            label: rawModelId,
            value: encodedModelId,
          }),
      );
    }

    return options;
  },

  getDefaultModel(settings: Record<string, unknown>): string | null {
    const rawModelId = getJcodeProviderSettings(settings).visibleModels[0];
    return rawModelId ? encodeJcodeModelId(rawModelId) : null;
  },

  ownsModel(model: string): boolean {
    return isJcodeModelSelectionId(model);
  },

  isAdaptiveReasoningModel(model: string, settings: Record<string, unknown>): boolean {
    return getJcodeThinkingOptions(model, settings).length > 0;
  },

  getReasoningOptions(model: string, settings: Record<string, unknown>): ProviderReasoningOption[] {
    return getJcodeThinkingOptions(model, settings)
      .map((variant) => ({
        description: variant.description,
        label: variant.label,
        value: variant.value,
      }));
  },

  getDefaultReasoningValue(model: string, settings: Record<string, unknown>): string {
    const rawModelId = decodeJcodeModelId(model);
    if (!rawModelId) {
      return JCODE_DEFAULT_THINKING_LEVEL;
    }

    const jcodeSettings = getJcodeProviderSettings(settings);
    const baseRawId = resolveJcodeBaseModelRawId(rawModelId, jcodeSettings.discoveredModels);
    return getDefaultThinkingLevelForModel(baseRawId, settings);
  },

  getContextWindowSize(model: string, customLimits?: Record<string, number>): number {
    return customLimits?.[model] ?? DEFAULT_CONTEXT_WINDOW;
  },

  isDefaultModel(model: string): boolean {
    return isJcodeModelSelectionId(model);
  },

  applyModelDefaults(model: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }

    const settingsBag = settings as Record<string, unknown>;
    const rawModelId = decodeJcodeModelId(model);
    if (!rawModelId) {
      settingsBag.effortLevel = JCODE_DEFAULT_THINKING_LEVEL;
      return;
    }

    const jcodeSettings = getJcodeProviderSettings(settingsBag);
    const baseRawId = resolveJcodeBaseModelRawId(rawModelId, jcodeSettings.discoveredModels);
    settingsBag.model = encodeJcodeModelId(baseRawId);
    settingsBag.effortLevel = getDefaultThinkingLevelForModel(baseRawId, settingsBag);
  },

  async prepareModelMetadata(model: string, _settings: Record<string, unknown>, context): Promise<void> {
    const rawModelId = decodeJcodeModelId(model);
    if (!rawModelId) {
      return;
    }

    const jcodeSettings = getJcodeProviderSettings(context.plugin.settings);
    const baseRawId = resolveJcodeBaseModelRawId(rawModelId, jcodeSettings.discoveredModels);
    if (baseRawId && jcodeSettings.thinkingOptionsByModel[baseRawId]) {
      return;
    }

    const workspaceService = maybeGetJcodeWorkspaceServices()?.metadataService;
    const metadataService = workspaceService
      ?? new JcodeMetadataService(context.plugin);
    try {
      await metadataService.warmModelMetadata(model);
    } catch {
      // Metadata warmup is opportunistic; the first real turn can still discover it.
    } finally {
      if (!workspaceService) await metadataService.dispose();
    }
  },

  applyReasoningSelection(model: string, value: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }

    const settingsBag = settings as Record<string, unknown>;
    const rawModelId = decodeJcodeModelId(model);
    if (!rawModelId) {
      return;
    }

    const jcodeSettings = getJcodeProviderSettings(settingsBag);
    const baseRawId = resolveJcodeBaseModelRawId(rawModelId, jcodeSettings.discoveredModels);
    const supportedValues = new Set(
      (jcodeSettings.thinkingOptionsByModel[baseRawId] ?? []).map((variant) => variant.value),
    );
    const nextPreferredThinkingByModel = {
      ...jcodeSettings.preferredThinkingByModel,
    };

    if (!value || value === JCODE_DEFAULT_THINKING_LEVEL || !supportedValues.has(value)) {
      delete nextPreferredThinkingByModel[baseRawId];
    } else {
      nextPreferredThinkingByModel[baseRawId] = value;
    }

    updateJcodeProviderSettings(settingsBag, {
      preferredThinkingByModel: nextPreferredThinkingByModel,
    });
  },

  normalizeModelVariant(model: string, settings: Record<string, unknown>): string {
    const rawModelId = decodeJcodeModelId(model);
    if (!rawModelId) {
      return model;
    }

    const jcodeSettings = getJcodeProviderSettings(settings);
    const baseRawId = resolveJcodeBaseModelRawId(rawModelId, jcodeSettings.discoveredModels);
    return encodeJcodeModelId(baseRawId);
  },

  getCustomModelIds(): Set<string> {
    return new Set<string>();
  },

  getModeSelector(): null {
    return null;
  },

  getPermissionModeToggle(): null {
    return null;
  },

  getProviderIcon() {
    return JCODE_PROVIDER_ICON;
  },
};

function getDefaultThinkingLevelForModel(
  baseRawId: string,
  settings: Record<string, unknown>,
): string {
  const jcodeSettings = getJcodeProviderSettings(settings);
  return resolveJcodeDefaultThinkingLevel(
    jcodeSettings.thinkingOptionsByModel[baseRawId] ?? [],
    jcodeSettings.preferredThinkingByModel[baseRawId],
  );
}

function getJcodeThinkingOptions(
  model: string,
  settings: Record<string, unknown>,
): ProviderReasoningOption[] {
  const rawModelId = decodeJcodeModelId(model);
  if (!rawModelId) {
    return [];
  }

  const jcodeSettings = getJcodeProviderSettings(settings);
  const baseRawId = resolveJcodeBaseModelRawId(rawModelId, jcodeSettings.discoveredModels);
  return jcodeSettings.thinkingOptionsByModel[baseRawId] ?? [];
}

function pushOption(
  target: ProviderUIOption[],
  seenValues: Set<string>,
  value: string,
  option: ProviderUIOption,
): void {
  if (seenValues.has(value)) {
    return;
  }

  seenValues.add(value);
  target.push(option);
}
