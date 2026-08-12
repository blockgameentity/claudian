import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';
import { getProviderEnvironmentVariables } from '../../core/providers/providerEnvironment';
import { normalizeHostnameStringMap } from '../../core/providers/settings/HostnameStringMap';
import {
  readStoredBoolean,
  readStoredString,
} from '../../core/providers/settings/storedSettings';
import type { HostnameCliPaths } from '../../core/types/settings';
import { getHostnameKey } from '../../utils/env';
import {
  getJcodeDiscoveryState,
  seedJcodeDiscoveryStateFromLegacyConfig,
  updateJcodeDiscoveryState,
} from './discoveryState';
import { ensureProviderProjectionMap } from './internal/providerProjection';
import {
  decodeJcodeModelId,
  encodeJcodeModelId,
  isJcodeModelSelectionId,
  type JcodeDiscoveredModel,
  type JcodeThinkingOptionsByModel,
  normalizeJcodeThinkingOptionsByModel,
  resolveJcodeBaseModelRawId,
  resolveJcodeDefaultThinkingLevel,
} from './models';

export interface PersistedJcodeProviderSettings {
  cliPath: string;
  cliPathsByHost: HostnameCliPaths;
  enabled: boolean;
  environmentHash: string;
  environmentVariables: string;
  modelAliases: Record<string, string>;
  preferredThinkingByModel: Record<string, string>;
  thinkingOptionsByModel: JcodeThinkingOptionsByModel;
  visibleModels: string[];
}

export interface JcodeProviderSettings extends PersistedJcodeProviderSettings {
  discoveredModels: JcodeDiscoveredModel[];
}

export const DEFAULT_JCODE_PROVIDER_SETTINGS: Readonly<PersistedJcodeProviderSettings> = Object.freeze({
  cliPath: '',
  cliPathsByHost: {},
  enabled: false,
  environmentHash: '',
  environmentVariables: '',
  modelAliases: {},
  preferredThinkingByModel: {},
  thinkingOptionsByModel: {},
  visibleModels: [],
});

export function normalizeJcodeVisibleModels(
  value: unknown,
  discoveredModels: JcodeDiscoveredModel[] = [],
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') {
      continue;
    }

    const trimmed = resolveJcodeBaseModelRawId(entry.trim(), discoveredModels);
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}

export function normalizeJcodeModelAliases(
  value: unknown,
  discoveredModels: JcodeDiscoveredModel[] = [],
): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [rawId, alias] of Object.entries(value as Record<string, unknown>)) {
    if (typeof alias !== 'string') {
      continue;
    }

    const normalizedRawId = resolveJcodeBaseModelRawId(rawId.trim(), discoveredModels);
    const normalizedAlias = alias.trim();
    if (!normalizedRawId || !normalizedAlias) {
      continue;
    }

    normalized[normalizedRawId] = normalizedAlias;
  }

  return normalized;
}

export function normalizeJcodePreferredThinkingByModel(
  value: unknown,
  discoveredModels: JcodeDiscoveredModel[] = [],
): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [rawId, thinkingLevel] of Object.entries(value as Record<string, unknown>)) {
    if (typeof thinkingLevel !== 'string') {
      continue;
    }

    const normalizedRawId = resolveJcodeBaseModelRawId(rawId.trim(), discoveredModels);
    const normalizedThinkingLevel = thinkingLevel.trim();
    if (!normalizedRawId || !normalizedThinkingLevel) {
      continue;
    }

    normalized[normalizedRawId] = normalizedThinkingLevel;
  }

  return normalized;
}

export function getJcodeProviderSettings(
  settings: Record<string, unknown>,
): JcodeProviderSettings {
  const config = getProviderConfig(settings, 'jcode');
  const cliPathsByHost = normalizeHostnameStringMap(config.cliPathsByHost);
  seedJcodeDiscoveryStateFromLegacyConfig(settings, config);
  const discoveryState = getJcodeDiscoveryState(settings);
  const discoveredModels = discoveryState.discoveredModels;
  const persistedThinkingOptionsByModel = normalizeJcodeThinkingOptionsByModel(
    config.thinkingOptionsByModel,
    discoveredModels,
  );
  const thinkingOptionsByModel = normalizeJcodeThinkingOptionsByModel({
    ...persistedThinkingOptionsByModel,
    ...discoveryState.thinkingOptionsByModel,
  }, discoveredModels);

  return {
    cliPath: readStoredString(config.cliPath, DEFAULT_JCODE_PROVIDER_SETTINGS.cliPath),
    cliPathsByHost,
    discoveredModels,
    enabled: readStoredBoolean(config.enabled, DEFAULT_JCODE_PROVIDER_SETTINGS.enabled),
    environmentHash: readStoredString(
      config.environmentHash,
      DEFAULT_JCODE_PROVIDER_SETTINGS.environmentHash,
    ),
    environmentVariables: readStoredString(
      config.environmentVariables,
      getProviderEnvironmentVariables(settings, 'jcode')
        ?? DEFAULT_JCODE_PROVIDER_SETTINGS.environmentVariables,
    ),
    modelAliases: normalizeJcodeModelAliases(config.modelAliases, discoveredModels),
    preferredThinkingByModel: normalizeJcodePreferredThinkingByModel(
      config.preferredThinkingByModel,
      discoveredModels,
    ),
    thinkingOptionsByModel,
    visibleModels: normalizeJcodeVisibleModels(config.visibleModels, discoveredModels),
  };
}

export function updateJcodeProviderSettings(
  settings: Record<string, unknown>,
  updates: Partial<JcodeProviderSettings>,
): JcodeProviderSettings {
  const current = getJcodeProviderSettings(settings);
  const hostnameKey = getHostnameKey();
  if ('discoveredModels' in updates || 'thinkingOptionsByModel' in updates) {
    updateJcodeDiscoveryState(settings, {
      ...(updates.discoveredModels !== undefined
        ? { discoveredModels: updates.discoveredModels }
        : {}),
      ...(updates.thinkingOptionsByModel !== undefined
        ? { thinkingOptionsByModel: updates.thinkingOptionsByModel }
        : {}),
    });
  }
  const discoveryState = getJcodeDiscoveryState(settings);
  const nextDiscoveredModels = discoveryState.discoveredModels;
  const nextThinkingOptionsByModel = updates.thinkingOptionsByModel !== undefined
    ? discoveryState.thinkingOptionsByModel
    : normalizeJcodeThinkingOptionsByModel(
      current.thinkingOptionsByModel,
      nextDiscoveredModels,
    );
  const nextVisibleModels = normalizeJcodeVisibleModels(
    updates.visibleModels ?? current.visibleModels,
    nextDiscoveredModels,
  );
  const nextModelAliases = pruneModelAliasesToVisible(
    normalizeJcodeModelAliases(
      updates.modelAliases ?? current.modelAliases,
      nextDiscoveredModels,
    ),
    nextVisibleModels,
  );
  const nextCliPathsByHost = 'cliPathsByHost' in updates
    ? normalizeHostnameStringMap(updates.cliPathsByHost)
    : { ...current.cliPathsByHost };
  let nextCliPath = 'cliPathsByHost' in updates
    ? (
      typeof updates.cliPath === 'string'
        ? updates.cliPath.trim()
        : DEFAULT_JCODE_PROVIDER_SETTINGS.cliPath
    )
    : current.cliPath.trim();

  if ('cliPath' in updates && !('cliPathsByHost' in updates)) {
    const trimmedCliPath = typeof updates.cliPath === 'string' ? updates.cliPath.trim() : '';
    if (trimmedCliPath) {
      nextCliPathsByHost[hostnameKey] = trimmedCliPath;
    } else {
      delete nextCliPathsByHost[hostnameKey];
    }
    nextCliPath = DEFAULT_JCODE_PROVIDER_SETTINGS.cliPath;
  }

  const next: JcodeProviderSettings = {
    ...current,
    ...updates,
    cliPath: nextCliPath,
    cliPathsByHost: nextCliPathsByHost,
    discoveredModels: nextDiscoveredModels,
    modelAliases: nextModelAliases,
    preferredThinkingByModel: normalizeJcodePreferredThinkingByModel(
      updates.preferredThinkingByModel ?? current.preferredThinkingByModel,
      nextDiscoveredModels,
    ),
    thinkingOptionsByModel: nextThinkingOptionsByModel,
    visibleModels: nextVisibleModels,
  };

  if (updates.visibleModels !== undefined) {
    retargetRemovedJcodeSelections(settings, next);
  }

  const persistedThinkingOptionsByModel = pruneThinkingOptionsToPersistedSelections(
    settings,
    next,
  );

  setProviderConfig(settings, 'jcode', {
    cliPath: next.cliPath,
    cliPathsByHost: next.cliPathsByHost,
    enabled: next.enabled,
    environmentHash: next.environmentHash,
    environmentVariables: next.environmentVariables,
    modelAliases: next.modelAliases,
    preferredThinkingByModel: next.preferredThinkingByModel,
    thinkingOptionsByModel: persistedThinkingOptionsByModel,
    visibleModels: next.visibleModels,
  });

  return next;
}

export function hasLegacyJcodeDiscoveryFields(settings: Record<string, unknown>): boolean {
  const config = getProviderConfig(settings, 'jcode');
  return 'discoveredModels' in config;
}

function pruneModelAliasesToVisible(
  aliases: Record<string, string>,
  visibleModels: string[],
): Record<string, string> {
  if (visibleModels.length === 0 || Object.keys(aliases).length === 0) {
    return {};
  }

  const visibleSet = new Set(visibleModels);
  const pruned: Record<string, string> = {};
  for (const [rawId, alias] of Object.entries(aliases)) {
    if (visibleSet.has(rawId)) {
      pruned[rawId] = alias;
    }
  }
  return pruned;
}

function pruneThinkingOptionsToPersistedSelections(
  settings: Record<string, unknown>,
  next: JcodeProviderSettings,
): JcodeThinkingOptionsByModel {
  const persistableRawIds = new Set(next.visibleModels);
  addPersistableSelection(persistableRawIds, settings.model, next.discoveredModels);
  addPersistableSelection(persistableRawIds, settings.titleGenerationModel, next.discoveredModels);

  const savedProviderModel = settings.savedProviderModel;
  if (savedProviderModel && typeof savedProviderModel === 'object' && !Array.isArray(savedProviderModel)) {
    addPersistableSelection(
      persistableRawIds,
      (savedProviderModel as Record<string, unknown>).jcode,
      next.discoveredModels,
    );
  }

  const pruned: JcodeThinkingOptionsByModel = {};
  for (const rawId of persistableRawIds) {
    const options = next.thinkingOptionsByModel[rawId];
    if (options?.length) {
      pruned[rawId] = options.map((option) => ({ ...option }));
    }
  }
  return pruned;
}

function addPersistableSelection(
  target: Set<string>,
  value: unknown,
  discoveredModels: JcodeDiscoveredModel[],
): void {
  if (typeof value !== 'string' || !isJcodeModelSelectionId(value)) {
    return;
  }

  const rawModelId = decodeJcodeModelId(value);
  if (!rawModelId) {
    return;
  }

  const baseRawId = resolveJcodeBaseModelRawId(rawModelId, discoveredModels);
  if (baseRawId) {
    target.add(baseRawId);
  }
}

function retargetRemovedJcodeSelections(
  settings: Record<string, unknown>,
  next: JcodeProviderSettings,
): void {
  if (next.visibleModels.length === 0) {
    if (
      typeof settings.titleGenerationModel === 'string'
      && isJcodeModelSelectionId(settings.titleGenerationModel)
    ) {
      settings.titleGenerationModel = '';
    }
    return;
  }

  const visibleSet = new Set(next.visibleModels);
  const fallbackRawId = next.visibleModels[0];
  const fallbackModelId = encodeJcodeModelId(fallbackRawId);
  const fallbackEffort = resolveJcodeDefaultThinkingLevel(
    next.thinkingOptionsByModel[fallbackRawId] ?? [],
    next.preferredThinkingByModel[fallbackRawId],
  );

  const maybeRetargetModel = (value: unknown): string | null => {
    if (typeof value !== 'string' || !isJcodeModelSelectionId(value)) {
      return null;
    }

    const rawModelId = decodeJcodeModelId(value);
    if (!rawModelId) return null;

    const baseRawId = resolveJcodeBaseModelRawId(rawModelId, next.discoveredModels);
    return visibleSet.has(baseRawId) ? null : fallbackModelId;
  };

  const savedProviderModel = ensureProviderProjectionMap(settings, 'savedProviderModel');
  const nextSavedModel = maybeRetargetModel(savedProviderModel.jcode);
  if (nextSavedModel) {
    savedProviderModel.jcode = nextSavedModel;
    ensureProviderProjectionMap(settings, 'savedProviderEffort').jcode = fallbackEffort;
  }

  const nextTopLevelModel = maybeRetargetModel(settings.model);
  if (nextTopLevelModel) {
    settings.model = nextTopLevelModel;
    settings.effortLevel = fallbackEffort;
  }

  const nextTitleGenerationModel = maybeRetargetModel(settings.titleGenerationModel);
  if (nextTitleGenerationModel) {
    settings.titleGenerationModel = nextTitleGenerationModel;
  }
}
