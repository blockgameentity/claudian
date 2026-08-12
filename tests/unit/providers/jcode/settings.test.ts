import {
  DEFAULT_JCODE_PROVIDER_SETTINGS,
  getJcodeProviderSettings,
  hasLegacyJcodeDiscoveryFields,
  updateJcodeProviderSettings,
} from '../../../../src/providers/jcode/settings';

function makeSettings(config: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    providerConfigs: {
      jcode: {
        ...DEFAULT_JCODE_PROVIDER_SETTINGS,
        ...config,
      },
    },
  };
}

describe('jcode settings', () => {
  it('applies defaults when nothing is persisted', () => {
    const settings = makeSettings();
    expect(getJcodeProviderSettings(settings)).toMatchObject({
      cliPath: '',
      cliPathsByHost: {},
      discoveredModels: [],
      enabled: false,
      environmentHash: '',
      environmentVariables: '',
      modelAliases: {},
      preferredThinkingByModel: {},
      thinkingOptionsByModel: {},
      visibleModels: [],
    });
  });

  it('fails closed on malformed persisted scalars', () => {
    const settings = makeSettings({
      cliPath: 7,
      cliPathsByHost: 'nope',
      enabled: 'false',
      environmentHash: false,
      environmentVariables: ['SECRET=not-a-string'],
      modelAliases: 'nope',
      preferredThinkingByModel: 5,
      thinkingOptionsByModel: 'nope',
      visibleModels: 'nope',
    });
    const decoded = getJcodeProviderSettings(settings);
    expect(decoded.cliPath).toBe('');
    expect(decoded.cliPathsByHost).toEqual({});
    expect(decoded.enabled).toBe(false);
    expect(decoded.environmentHash).toBe('');
    expect(decoded.environmentVariables).toBe('');
    expect(decoded.modelAliases).toEqual({});
    expect(decoded.preferredThinkingByModel).toEqual({});
    expect(decoded.thinkingOptionsByModel).toEqual({});
    expect(decoded.visibleModels).toEqual([]);
  });

  it('prunes visible model variants down to base models', () => {
    const settings = makeSettings({
      visibleModels: ['anthropic/claude-sonnet-4/high', 'anthropic/claude-sonnet-4'],
    });
    expect(getJcodeProviderSettings(settings).visibleModels)
      .toEqual(['anthropic/claude-sonnet-4']);
  });

  it('prunes aliases and preferred thinking to visible models', () => {
    const settings = makeSettings({
      modelAliases: {
        'anthropic/claude-sonnet-4': 'Sonnet',
        'openai/gpt-5': 'GPT-5',
      },
      preferredThinkingByModel: {
        'anthropic/claude-sonnet-4': 'high',
        'openai/gpt-5': 'low',
      },
      visibleModels: ['anthropic/claude-sonnet-4'],
    });
    updateJcodeProviderSettings(settings, { visibleModels: ['anthropic/claude-sonnet-4'] });
    const decoded = getJcodeProviderSettings(settings);
    expect(decoded.modelAliases).toEqual({ 'anthropic/claude-sonnet-4': 'Sonnet' });
    expect(decoded.preferredThinkingByModel).toEqual({
      'anthropic/claude-sonnet-4': 'high',
      'openai/gpt-5': 'low',
    });
  });

  it('migrates a legacy cliPath update into the host-scoped map', () => {
    const settings = makeSettings();
    updateJcodeProviderSettings(settings, { cliPath: 'C:\\tools\\jcode.cmd' });
    const decoded = getJcodeProviderSettings(settings);
    expect(decoded.cliPath).toBe('');
    expect(Object.values(decoded.cliPathsByHost)).toEqual(['C:\\tools\\jcode.cmd']);
  });

  it('retargets removed model selections to the first visible model', () => {
    const settings: Record<string, unknown> = {
      model: 'jcode:openai/gpt-5',
      effortLevel: 'high',
      titleGenerationModel: 'jcode:openai/gpt-5',
      savedProviderModel: { jcode: 'jcode:openai/gpt-5' },
      savedProviderEffort: { jcode: 'high' },
      providerConfigs: {
        jcode: {
          ...DEFAULT_JCODE_PROVIDER_SETTINGS,
          visibleModels: ['anthropic/claude-sonnet-4'],
        },
      },
    };
    updateJcodeProviderSettings(settings, { visibleModels: ['anthropic/claude-sonnet-4'] });
    expect(settings.model).toBe('jcode:anthropic/claude-sonnet-4');
    expect(settings.titleGenerationModel).toBe('jcode:anthropic/claude-sonnet-4');
    expect(settings.savedProviderModel).toEqual({ jcode: 'jcode:anthropic/claude-sonnet-4' });
    const savedProviderEffort = settings.savedProviderEffort as Record<string, unknown> | undefined;
    expect(typeof savedProviderEffort?.jcode).toBe('string');
  });

  it('flags legacy discovery fields on the provider config', () => {
    expect(hasLegacyJcodeDiscoveryFields(makeSettings({ discoveredModels: [] }))).toBe(true);
    expect(hasLegacyJcodeDiscoveryFields(makeSettings())).toBe(false);
  });

  it('keeps host-specific cli paths when updating unrelated fields', () => {
    const settings = makeSettings({
      cliPathsByHost: { 'my-host': 'C:\\tools\\jcode.cmd' },
    });
    updateJcodeProviderSettings(settings, { enabled: true });
    const decoded = getJcodeProviderSettings(settings);
    expect(decoded.enabled).toBe(true);
    expect(decoded.cliPathsByHost).toEqual({ 'my-host': 'C:\\tools\\jcode.cmd' });
  });
});
