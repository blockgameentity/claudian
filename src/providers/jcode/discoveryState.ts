import { sameDiscoveredModels, sameThinkingOptionsByModel } from './internal/compareCollections';
import {
  type JcodeDiscoveredModel,
  type JcodeThinkingOptionsByModel,
  normalizeJcodeDiscoveredModels,
  normalizeJcodeThinkingOptionsByModel,
} from './models';

const JCODE_DISCOVERY_STATE = Symbol('jcodeDiscoveryState');

interface JcodeDiscoveryState {
  discoveredModels: JcodeDiscoveredModel[];
  thinkingOptionsByModel: JcodeThinkingOptionsByModel;
}

type SettingsBag = Record<string | symbol, unknown>;

function ensureDiscoveryState(settings: Record<string, unknown>): JcodeDiscoveryState {
  const bag = settings as SettingsBag;
  const existing = bag[JCODE_DISCOVERY_STATE];
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    const state = existing as Partial<JcodeDiscoveryState>;
    state.discoveredModels ??= [];
    state.thinkingOptionsByModel ??= {};
    return state as JcodeDiscoveryState;
  }

  const next: JcodeDiscoveryState = {
    discoveredModels: [],
    thinkingOptionsByModel: {},
  };
  bag[JCODE_DISCOVERY_STATE] = next;
  return next;
}

function cloneDiscoveredModels(models: JcodeDiscoveredModel[]): JcodeDiscoveredModel[] {
  return models.map((model) => ({ ...model }));
}

function cloneThinkingOptionsByModel(
  optionsByModel: JcodeThinkingOptionsByModel,
): JcodeThinkingOptionsByModel {
  return Object.fromEntries(
    Object.entries(optionsByModel).map(([rawId, options]) => [
      rawId,
      options.map((option) => ({ ...option })),
    ]),
  );
}

export function getJcodeDiscoveryState(settings: Record<string, unknown>): JcodeDiscoveryState {
  const state = ensureDiscoveryState(settings);
  return {
    discoveredModels: cloneDiscoveredModels(state.discoveredModels),
    thinkingOptionsByModel: cloneThinkingOptionsByModel(state.thinkingOptionsByModel),
  };
}

export function updateJcodeDiscoveryState(
  settings: Record<string, unknown>,
  updates: Partial<JcodeDiscoveryState>,
): boolean {
  const state = ensureDiscoveryState(settings);
  const nextDiscoveredModels = 'discoveredModels' in updates
    ? normalizeJcodeDiscoveredModels(updates.discoveredModels)
    : state.discoveredModels;
  const nextThinkingOptionsByModel = 'thinkingOptionsByModel' in updates
    ? normalizeJcodeThinkingOptionsByModel(updates.thinkingOptionsByModel, nextDiscoveredModels)
    : state.thinkingOptionsByModel;
  const changed = !sameDiscoveredModels(state.discoveredModels, nextDiscoveredModels)
    || !sameThinkingOptionsByModel(state.thinkingOptionsByModel, nextThinkingOptionsByModel);

  if (!changed) {
    return false;
  }

  state.discoveredModels = cloneDiscoveredModels(nextDiscoveredModels);
  state.thinkingOptionsByModel = cloneThinkingOptionsByModel(nextThinkingOptionsByModel);
  return true;
}

export function clearJcodeDiscoveryState(settings: Record<string, unknown>): boolean {
  const state = ensureDiscoveryState(settings);
  if (
    state.discoveredModels.length === 0
    && Object.keys(state.thinkingOptionsByModel).length === 0
  ) {
    return false;
  }

  state.discoveredModels = [];
  state.thinkingOptionsByModel = {};
  return true;
}

export function seedJcodeDiscoveryStateFromLegacyConfig(
  settings: Record<string, unknown>,
  legacyConfig: Record<string, unknown>,
): boolean {
  const state = ensureDiscoveryState(settings);
  const nextDiscoveredModels = state.discoveredModels.length > 0
    ? state.discoveredModels
    : normalizeJcodeDiscoveredModels(legacyConfig.discoveredModels);
  const nextThinkingOptionsByModel = Object.keys(state.thinkingOptionsByModel).length > 0
    ? state.thinkingOptionsByModel
    : normalizeJcodeThinkingOptionsByModel(legacyConfig.thinkingOptionsByModel, nextDiscoveredModels);

  return updateJcodeDiscoveryState(settings, {
    discoveredModels: nextDiscoveredModels,
    thinkingOptionsByModel: nextThinkingOptionsByModel,
  });
}
