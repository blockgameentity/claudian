import type { ProviderHost } from '@/core/providers/ProviderHost';
import type {
  AcpSessionConfigOption,
  AcpSessionModelState,
  AcpSessionModeState,
} from '@/providers/acp';
import {
  extractAcpSessionModelState,
  extractAcpSessionThoughtLevelState,
} from '@/providers/acp';

import {
  normalizeJcodeDiscoveredModels,
  normalizeJcodeModelVariants,
  resolveJcodeBaseModelRawId,
} from '../models';
import {
  getJcodeProviderSettings,
  updateJcodeProviderSettings,
} from '../settings';

export interface JcodeMetadataProjectionInput {
  readonly configOptions?: AcpSessionConfigOption[] | null;
  readonly models?: AcpSessionModelState | null;
  readonly modes?: AcpSessionModeState | null;
  readonly selectedRawModelId?: string | null;
}

export async function projectJcodeMetadata(
  plugin: ProviderHost,
  input: JcodeMetadataProjectionInput,
): Promise<boolean> {
  const modelState = extractAcpSessionModelState({
    configOptions: input.configOptions,
    models: input.models,
  });
  const discoveredModels = normalizeJcodeDiscoveredModels(
    modelState.availableModels.map((model) => ({
      ...(model.description ? { description: model.description } : {}),
      label: model.name,
      rawId: model.id,
    })),
  );
  const thoughtState = extractAcpSessionThoughtLevelState({
    configOptions: input.configOptions,
  });
  const thinkingOptions = normalizeJcodeModelVariants(
    thoughtState.availableLevels.map((level) => ({
      ...(level.description ? { description: level.description } : {}),
      label: level.name,
      value: level.id,
    })),
  );
  const current = getJcodeProviderSettings(plugin.settings);
  const rawModelId = input.selectedRawModelId
    ?? modelState.currentModelId
    ?? null;
  const baseRawModelId = rawModelId
    ? resolveJcodeBaseModelRawId(
      rawModelId,
      discoveredModels.length > 0 ? discoveredModels : current.discoveredModels,
    )
    : null;
  const nextThinking = { ...current.thinkingOptionsByModel };
  if (baseRawModelId && thinkingOptions.length > 0) {
    nextThinking[baseRawModelId] = thinkingOptions;
  }
  const hasUpdate = discoveredModels.length > 0
    || (baseRawModelId !== null && thinkingOptions.length > 0);
  if (!hasUpdate) return false;

  await plugin.mutateSettings((settings) => {
    updateJcodeProviderSettings(settings, {
      ...(discoveredModels.length > 0 ? { discoveredModels } : {}),
      ...(baseRawModelId && thinkingOptions.length > 0
        ? { thinkingOptionsByModel: nextThinking }
        : {}),
    });
  });
  plugin.notifyProviderChatOptionsChanged('jcode');
  return true;
}
