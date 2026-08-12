import {
  buildJcodeBaseModels,
  combineJcodeRawModelSelection,
  decodeJcodeModelId,
  encodeJcodeModelId,
  extractJcodeModelVariantValue,
  getJcodeModelVariants,
  groupJcodeDiscoveredModels,
  isJcodeModelSelectionId,
  JCODE_DEFAULT_THINKING_LEVEL,
  normalizeJcodeDiscoveredModels,
  normalizeJcodeModelVariants,
  resolveJcodeBaseModelRawId,
  resolveJcodeDefaultThinkingLevel,
  splitJcodeModelLabel,
} from '../../../../src/providers/jcode/models';
import { jcodeChatUIConfig } from '../../../../src/providers/jcode/ui/JcodeChatUIConfig';

describe('Jcode model identity', () => {
  it('namespaces provider-owned model ids for the shared selector', () => {
    expect(encodeJcodeModelId('anthropic/claude-sonnet-4')).toBe('jcode:anthropic/claude-sonnet-4');
    expect(decodeJcodeModelId('jcode:anthropic/claude-sonnet-4')).toBe('anthropic/claude-sonnet-4');
    expect(encodeJcodeModelId('')).toBe('');
    expect(isJcodeModelSelectionId('jcode:anthropic/claude-sonnet-4')).toBe(true);
    expect(isJcodeModelSelectionId('claude-sonnet-4')).toBe(false);
  });

  it('rejects empty namespaced ids', () => {
    expect(decodeJcodeModelId('jcode:')).toBeNull();
    expect(decodeJcodeModelId('jcode:   ')).toBeNull();
  });
});

describe('Jcode thinking defaults', () => {
  it('prefers the saved level when supported', () => {
    expect(resolveJcodeDefaultThinkingLevel(
      [
        { label: 'Low', value: 'low' },
        { label: 'High', value: 'high' },
      ],
      'high',
    )).toBe('high');
  });

  it('falls back when the saved level is unsupported', () => {
    expect(resolveJcodeDefaultThinkingLevel(
      [
        { label: 'Low', value: 'low' },
        { label: 'Medium', value: 'medium' },
      ],
      'xhigh',
    )).toBe('low');
  });

  it('falls back to the shared default when no options are known', () => {
    expect(resolveJcodeDefaultThinkingLevel([], undefined)).toBe('high');
  });
});

describe('Jcode base model derivation', () => {
  const discoveredModels = [
    { label: 'Anthropic/Claude Sonnet 4', rawId: 'anthropic/claude-sonnet-4' },
    { label: 'Anthropic/Claude Sonnet 4 (high)', rawId: 'anthropic/claude-sonnet-4/high' },
    { label: 'Anthropic/Claude Sonnet 4 (max)', rawId: 'anthropic/claude-sonnet-4/max' },
    { label: 'Google/Gemini 2.5 Pro', rawId: 'google/gemini-2.5-pro' },
  ];

  it('collapses discovered variants into base models', () => {
    expect(buildJcodeBaseModels(discoveredModels)).toEqual([
      {
        label: 'Anthropic/Claude Sonnet 4',
        rawId: 'anthropic/claude-sonnet-4',
        variants: [
          { label: 'High', value: 'high' },
          { label: 'Max', value: 'max' },
        ],
      },
      {
        label: 'Google/Gemini 2.5 Pro',
        rawId: 'google/gemini-2.5-pro',
        variants: [],
      },
    ]);
  });

  it('sorts thinking variants by semantic effort instead of alphabetically', () => {
    expect(buildJcodeBaseModels([
      { label: 'OpenAI/GPT-5', rawId: 'openai/gpt-5' },
      { label: 'OpenAI/GPT-5 (xhigh)', rawId: 'openai/gpt-5/xhigh' },
      { label: 'OpenAI/GPT-5 (medium)', rawId: 'openai/gpt-5/medium' },
      { label: 'OpenAI/GPT-5 (low)', rawId: 'openai/gpt-5/low' },
      { label: 'OpenAI/GPT-5 (high)', rawId: 'openai/gpt-5/high' },
      { label: 'OpenAI/GPT-5 (none)', rawId: 'openai/gpt-5/none' },
    ])).toEqual([
      {
        label: 'OpenAI/GPT-5',
        rawId: 'openai/gpt-5',
        variants: [
          { label: 'None', value: 'none' },
          { label: 'Low', value: 'low' },
          { label: 'Medium', value: 'medium' },
          { label: 'High', value: 'high' },
          { label: 'xHigh', value: 'xhigh' },
        ],
      },
    ]);
  });

  it('does not treat unknown suffixes as thinking variants', () => {
    expect(resolveJcodeBaseModelRawId('openai/gpt-5/other', discoveredModels))
      .toBe('openai/gpt-5/other');
    expect(resolveJcodeBaseModelRawId('openai/gpt-5/other', new Set([
      'openai/gpt-5',
      'openai/gpt-5/other',
    ]))).toBe('openai/gpt-5');
  });

  it('extracts and combines thinking variants from discovered model ids', () => {
    expect(resolveJcodeBaseModelRawId(
      'anthropic/claude-sonnet-4/high',
      discoveredModels,
    )).toBe('anthropic/claude-sonnet-4');
    expect(extractJcodeModelVariantValue(
      'anthropic/claude-sonnet-4/high',
      discoveredModels,
    )).toBe('high');
    expect(extractJcodeModelVariantValue(
      'anthropic/claude-sonnet-4',
      discoveredModels,
    )).toBeNull();
    expect(getJcodeModelVariants('anthropic/claude-sonnet-4', discoveredModels)).toEqual([
      { label: 'High', value: 'high' },
      { label: 'Max', value: 'max' },
    ]);
    expect(combineJcodeRawModelSelection(
      'anthropic/claude-sonnet-4',
      'high',
      discoveredModels,
    )).toBe('anthropic/claude-sonnet-4/high');
    expect(combineJcodeRawModelSelection(
      'anthropic/claude-sonnet-4',
      JCODE_DEFAULT_THINKING_LEVEL,
      discoveredModels,
    )).toBe('anthropic/claude-sonnet-4');
    expect(combineJcodeRawModelSelection(
      'anthropic/claude-sonnet-4',
      'unsupported-level',
      discoveredModels,
    )).toBe('anthropic/claude-sonnet-4');
  });
});

describe('Jcode label splitting', () => {
  it('splits provider/model labels', () => {
    expect(splitJcodeModelLabel('Anthropic/Claude Sonnet 4')).toEqual({
      modelLabel: 'Claude Sonnet 4',
      providerLabel: 'Anthropic',
    });
    expect(splitJcodeModelLabel('bare-model')).toEqual({
      modelLabel: 'bare-model',
      providerLabel: 'Jcode',
    });
  });
});

describe('Jcode discovered model normalization', () => {
  it('decodes malformed discovery payloads', () => {
    expect(normalizeJcodeDiscoveredModels([
      { rawId: ' a/b ', label: ' A/B ', description: 3 },
      { rawId: 'a/b', label: '' },
      7,
      'nope',
      null,
    ])).toEqual([
      { label: 'A/B', rawId: 'a/b' },
    ]);
  });

  it('dedupes and prunes invalid variant entries', () => {
    expect(normalizeJcodeModelVariants([
      { value: ' high ', name: 'High' },
      { value: 'high' },
      { value: '' },
      { value: 'low', label: 'Low', description: 5 },
    ])).toEqual([
      { label: 'Low', value: 'low' },
      { label: 'High', value: 'high' },
    ]);
  });

  it('groups discovered base models by provider', () => {
    expect(groupJcodeDiscoveredModels([
      { label: 'Anthropic/Claude Sonnet 4', rawId: 'anthropic/claude-sonnet-4' },
      { label: 'Anthropic/Claude Haiku', rawId: 'anthropic/claude-haiku' },
      { label: 'OpenAI/GPT-5', rawId: 'openai/gpt-5' },
    ])).toEqual([
      {
        models: [
          { label: 'Anthropic/Claude Haiku', rawId: 'anthropic/claude-haiku' },
          { label: 'Anthropic/Claude Sonnet 4', rawId: 'anthropic/claude-sonnet-4' },
        ],
        providerKey: 'anthropic',
        providerLabel: 'Anthropic',
      },
      {
        models: [{ label: 'OpenAI/GPT-5', rawId: 'openai/gpt-5' }],
        providerKey: 'openai',
        providerLabel: 'OpenAI',
      },
    ]);
  });
});

describe('jcodeChatUIConfig', () => {
  const settings = {
    providerConfigs: {
      jcode: {
        discoveredModels: [],
        modelAliases: {},
        preferredThinkingByModel: {},
        thinkingOptionsByModel: {},
        visibleModels: ['anthropic/claude-sonnet-4'],
      },
    },
  };

  it('namespaces visible models for the shared selector', () => {
    expect(jcodeChatUIConfig.getModelOptions(settings).map(option => option.value))
      .toEqual(['jcode:anthropic/claude-sonnet-4']);
    expect(jcodeChatUIConfig.getDefaultModel?.(settings))
      .toBe('jcode:anthropic/claude-sonnet-4');
    expect(jcodeChatUIConfig.ownsModel('jcode:anthropic/claude-sonnet-4', settings)).toBe(true);
    expect(jcodeChatUIConfig.ownsModel('claude-sonnet-4', settings)).toBe(false);
  });

  it('normalizes variant selections back to base models', () => {
    expect(jcodeChatUIConfig.normalizeModelVariant(
      'jcode:anthropic/claude-sonnet-4/high',
      settings,
    )).toBe('jcode:anthropic/claude-sonnet-4');
  });
});
