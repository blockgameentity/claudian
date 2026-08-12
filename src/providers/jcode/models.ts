import {
  DEFAULT_REASONING_VALUE,
  formatReasoningValueLabel,
  resolvePreferredReasoningDefault,
} from '../../core/providers/reasoning';

export interface JcodeDiscoveredModel {
  description?: string;
  label: string;
  rawId: string;
}

export interface JcodeModelVariant {
  description?: string;
  label: string;
  value: string;
}

export type JcodeThinkingOptionsByModel = Record<string, JcodeModelVariant[]>;

export interface JcodeBaseModel {
  description?: string;
  label: string;
  rawId: string;
  variants: JcodeModelVariant[];
}

export interface JcodeDiscoveredModelGroup {
  models: JcodeDiscoveredModel[];
  providerKey: string;
  providerLabel: string;
}

export const JCODE_DEFAULT_THINKING_LEVEL = 'default';

const JCODE_MODEL_PREFIX = 'jcode:';
const JCODE_VARIANT_ASCENDING_ORDER = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'max',
  'xhigh',
] as const;
const JCODE_VARIANT_ASCENDING_RANK = new Map<string, number>(
  JCODE_VARIANT_ASCENDING_ORDER.map((value, index) => [value, index] as const),
);

export function resolveJcodeDefaultThinkingLevel(
  options: JcodeModelVariant[],
  preferredValue?: string,
  fallbackValue: string = DEFAULT_REASONING_VALUE,
): string {
  const values = options.map(option => option.value);
  if (preferredValue && (values.length === 0 || values.includes(preferredValue))) {
    return preferredValue;
  }

  return resolvePreferredReasoningDefault(values, fallbackValue);
}

export function isJcodeModelSelectionId(model: string): boolean {
  return decodeJcodeModelId(model) !== null;
}

export function encodeJcodeModelId(rawModelId: string): string {
  const normalized = rawModelId.trim();
  return normalized ? `${JCODE_MODEL_PREFIX}${normalized}` : '';
}

export function decodeJcodeModelId(model: string): string | null {
  if (!model.startsWith(JCODE_MODEL_PREFIX)) {
    return null;
  }

  const rawModelId = model.slice(JCODE_MODEL_PREFIX.length).trim();
  return rawModelId || null;
}

export function normalizeJcodeDiscoveredModels(value: unknown): JcodeDiscoveredModel[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: JcodeDiscoveredModel[] = [];
  const seen = new Set<string>();
  for (const entry of value as unknown[]) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;

    const rawId = typeof record.rawId === 'string' ? record.rawId.trim() : '';
    const label = typeof record.label === 'string' ? record.label.trim() : rawId;
    const description = typeof record.description === 'string'
      ? record.description.trim()
      : '';

    if (!rawId || seen.has(rawId)) {
      continue;
    }

    seen.add(rawId);
    normalized.push({
      ...(description ? { description } : {}),
      label: label || rawId,
      rawId,
    });
  }

  return normalized;
}

export function normalizeJcodeModelVariants(value: unknown): JcodeModelVariant[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const variants: JcodeModelVariant[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const rawValue = typeof record.value === 'string' ? record.value.trim() : '';
    if (!rawValue) {
      continue;
    }

    let rawLabel = '';
    if (typeof record.label === 'string') {
      rawLabel = record.label.trim();
    } else if (typeof record.name === 'string') {
      rawLabel = record.name.trim();
    }
    const description = typeof record.description === 'string'
      ? record.description.trim()
      : '';

    variants.push({
      ...(description ? { description } : {}),
      label: rawLabel || formatReasoningValueLabel(rawValue),
      value: rawValue,
    });
  }

  return dedupeJcodeVariants(variants);
}

export function normalizeJcodeThinkingOptionsByModel(
  value: unknown,
  discoveredModels: JcodeDiscoveredModel[] = [],
): JcodeThinkingOptionsByModel {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const normalized: JcodeThinkingOptionsByModel = {};
  for (const [rawId, variants] of Object.entries(value as Record<string, unknown>)) {
    const normalizedRawId = resolveJcodeBaseModelRawId(rawId.trim(), discoveredModels);
    const normalizedVariants = normalizeJcodeModelVariants(variants);
    if (!normalizedRawId || normalizedVariants.length === 0) {
      continue;
    }

    normalized[normalizedRawId] = normalizedVariants;
  }

  return normalized;
}

export function resolveJcodeBaseModelRawId(
  rawId: string,
  discoveredModels: JcodeDiscoveredModel[] | Set<string>,
): string {
  const normalizedRawId = rawId.trim();
  if (!normalizedRawId) {
    return '';
  }

  const discoveredRawIds = discoveredModels instanceof Set
    ? discoveredModels
    : new Set(discoveredModels.map((model) => model.rawId));
  const slashIndex = normalizedRawId.lastIndexOf('/');
  if (slashIndex <= 0) {
    return normalizedRawId;
  }

  const candidate = normalizedRawId.slice(0, slashIndex);
  if (discoveredRawIds.has(candidate)) {
    return candidate;
  }

  const variant = normalizedRawId.slice(slashIndex + 1).trim().toLowerCase();
  return JCODE_VARIANT_ASCENDING_RANK.has(variant)
    ? candidate
    : normalizedRawId;
}

export function extractJcodeModelVariantValue(
  rawId: string,
  discoveredModels: JcodeDiscoveredModel[] | Set<string>,
): string | null {
  const normalizedRawId = rawId.trim();
  if (!normalizedRawId) {
    return null;
  }

  const baseRawId = resolveJcodeBaseModelRawId(normalizedRawId, discoveredModels);
  if (baseRawId === normalizedRawId || baseRawId.length >= normalizedRawId.length) {
    return null;
  }

  const variant = normalizedRawId.slice(baseRawId.length + 1).trim();
  return variant || null;
}

export function combineJcodeRawModelSelection(
  baseRawId: string | null | undefined,
  thinkingLevel: string | null | undefined,
  discoveredModels: JcodeDiscoveredModel[],
): string | null {
  const normalizedBaseRawId = baseRawId?.trim();
  if (!normalizedBaseRawId) {
    return null;
  }

  const variant = thinkingLevel?.trim();
  if (!variant || variant === JCODE_DEFAULT_THINKING_LEVEL) {
    return normalizedBaseRawId;
  }

  const supportedVariants = new Set(
    getJcodeModelVariants(normalizedBaseRawId, discoveredModels).map((entry) => entry.value),
  );
  return supportedVariants.has(variant)
    ? `${normalizedBaseRawId}/${variant}`
    : normalizedBaseRawId;
}

export function splitJcodeModelLabel(label: string): {
  modelLabel: string;
  providerLabel: string;
} {
  const trimmed = label.trim();
  const slashIndex = trimmed.indexOf('/');
  if (slashIndex <= 0 || slashIndex >= trimmed.length - 1) {
    return {
      modelLabel: trimmed,
      providerLabel: 'Jcode',
    };
  }

  return {
    modelLabel: trimmed.slice(slashIndex + 1).trim(),
    providerLabel: trimmed.slice(0, slashIndex).trim(),
  };
}

export function buildJcodeBaseModels(
  models: JcodeDiscoveredModel[],
): JcodeBaseModel[] {
  const discoveredRawIds = new Set(models.map((model) => model.rawId));
  const discoveredByRawId = new Map(models.map((model) => [model.rawId, model] as const));
  const grouped = new Map<string, JcodeDiscoveredModel[]>();

  for (const model of models) {
    const baseRawId = resolveJcodeBaseModelRawId(model.rawId, discoveredRawIds);
    const existing = grouped.get(baseRawId);
    if (existing) {
      existing.push(model);
    } else {
      grouped.set(baseRawId, [model]);
    }
  }

  return Array.from(grouped.entries())
    .map(([baseRawId, entries]) => {
      const baseModel = discoveredByRawId.get(baseRawId) ?? entries[0];
      const variants = entries.flatMap((entry) => {
        if (entry.rawId === baseRawId) {
          return [];
        }

        const variant = extractJcodeModelVariantValue(entry.rawId, discoveredRawIds);
        if (!variant) {
          return [];
        }

        return [{
          ...(entry.description ? { description: entry.description } : {}),
          label: formatReasoningValueLabel(variant),
          value: variant,
        }];
      });

      return {
        ...(baseModel?.description ? { description: baseModel.description } : {}),
        label: baseModel?.label ?? baseRawId,
        rawId: baseRawId,
        variants: dedupeJcodeVariants(variants),
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function getJcodeModelVariants(
  rawId: string,
  models: JcodeDiscoveredModel[],
): JcodeModelVariant[] {
  const baseRawId = resolveJcodeBaseModelRawId(rawId, models);
  return buildJcodeBaseModels(models)
    .find((model) => model.rawId === baseRawId)?.variants ?? [];
}

export function groupJcodeDiscoveredModels(
  models: JcodeDiscoveredModel[],
): JcodeDiscoveredModelGroup[] {
  const groups = new Map<string, JcodeDiscoveredModelGroup>();
  for (const model of buildJcodeBaseModels(models)) {
    const { providerLabel } = splitJcodeModelLabel(model.label || model.rawId);
    const providerKey = providerLabel.toLowerCase();
    const existing = groups.get(providerKey);
    if (existing) {
      existing.models.push({
        ...(model.description ? { description: model.description } : {}),
        label: model.label,
        rawId: model.rawId,
      });
      continue;
    }

    groups.set(providerKey, {
      models: [{
        ...(model.description ? { description: model.description } : {}),
        label: model.label,
        rawId: model.rawId,
      }],
      providerKey,
      providerLabel,
    });
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      models: [...group.models].sort((left, right) => left.label.localeCompare(right.label)),
    }))
    .sort((left, right) => left.providerLabel.localeCompare(right.providerLabel));
}

function dedupeJcodeVariants(variants: JcodeModelVariant[]): JcodeModelVariant[] {
  const unique = new Map<string, JcodeModelVariant>();
  for (const variant of variants) {
    if (!unique.has(variant.value)) {
      unique.set(variant.value, variant);
    }
  }

  return Array.from(unique.values())
    .sort((left, right) => compareJcodeVariantValues(left.value, right.value));
}

function compareJcodeVariantValues(left: string, right: string): number {
  const leftRank = JCODE_VARIANT_ASCENDING_RANK.get(left.toLowerCase());
  const rightRank = JCODE_VARIANT_ASCENDING_RANK.get(right.toLowerCase());

  if (leftRank !== undefined && rightRank !== undefined) {
    return leftRank - rightRank;
  }

  if (leftRank !== undefined) {
    return -1;
  }

  if (rightRank !== undefined) {
    return 1;
  }

  return left.localeCompare(right);
}
