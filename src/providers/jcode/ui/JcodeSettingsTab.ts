import * as fs from 'fs';
import { Setting } from 'obsidian';

import { ProviderSettingsCoordinator } from '../../../core/providers/ProviderSettingsCoordinator';
import type {
  ProviderSettingsTabRenderer,
  ProviderSettingsTabRendererContext,
} from '../../../core/providers/types';
import { t } from '../../../i18n/i18n';
import { renderEnvironmentSettingsSection } from '../../../shared/settings/EnvironmentSettingsSection';
import { renderHostnameCliPathSetting } from '../../../shared/settings/HostnameCliPathSetting';
import { renderProviderEnablementSetting } from '../../../shared/settings/ProviderEnablementSetting';
import {
  renderLastEnabledProviderWarning,
  renderProviderModelEnablementWarning,
} from '../../../shared/settings/ProviderModelEnablementWarning';
import type {
  ProviderModelPickerModel,
  ProviderModelPickerState,
} from '../../../shared/settings/ProviderModelPicker';
import { renderProviderModelPicker } from '../../../shared/settings/ProviderModelPicker';
import { getHostnameKey } from '../../../utils/env';
import { expandHomePath } from '../../../utils/path';
import { maybeGetJcodeWorkspaceServices } from '../app/JcodeWorkspaceServices';
import { clearJcodeDiscoveryState } from '../discoveryState';
import { sameStringList } from '../internal/compareCollections';
import { JcodeMetadataService } from '../metadata/JcodeMetadataService';
import {
  buildJcodeBaseModels,
  encodeJcodeModelId,
  type JcodeDiscoveredModel,
  splitJcodeModelLabel,
} from '../models';
import {
  getJcodeProviderSettings,
  normalizeJcodeVisibleModels,
  updateJcodeProviderSettings,
} from '../settings';

export const jcodeSettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const jcodeWorkspace = maybeGetJcodeWorkspaceServices();
    const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
    const hostnameKey = getHostnameKey();

    new Setting(container).setName('Setup').setHeading();

    renderProviderEnablementSetting({
      container,
      description: t('settings.providerEnablement.desc', { provider: 'Jcode' }),
      getValue: () => getJcodeProviderSettings(settingsBag).enabled,
      name: t('settings.providerEnablement.name', { provider: 'Jcode' }),
      onChange: async (value) => {
        if (!ProviderSettingsCoordinator.canApplyProviderEnablement(
          settingsBag,
          'jcode',
          value,
        )) {
          lastProviderWarning.showFor();
          return;
        }

        let accepted = true;
        await context.plugin.runProviderExecutionTransition(['jcode'], async () => {
          await context.plugin.mutateSettings((settings) => {
            accepted = ProviderSettingsCoordinator.applyProviderEnablement(
              settings,
              'jcode',
              value,
            );
          });
        });
        if (accepted) {
          lastProviderWarning.hide();
        } else {
          lastProviderWarning.showFor();
        }
        modelWarning.context.notifyProviderModelOptionsChanged('jcode');
      },
    });

    const lastProviderWarning = renderLastEnabledProviderWarning(container);

    const modelWarning = renderProviderModelEnablementWarning(container, context, {
      getHasEnabledModels: () => getJcodeProviderSettings(settingsBag).visibleModels.length > 0,
      getIsEnabled: () => getJcodeProviderSettings(settingsBag).enabled,
      providerId: 'jcode',
      providerName: 'Jcode',
    });

    renderHostnameCliPathSetting({
      container,
      description: 'Optional absolute path to the Jcode CLI for this computer. Leave empty to use `jcode` from PATH.',
      getValue: () => getJcodeProviderSettings(settingsBag).cliPathsByHost[hostnameKey] || '',
      name: 'CLI path',
      onChange: async (value) => {
        const cliPathsByHost = {
          ...getJcodeProviderSettings(settingsBag).cliPathsByHost,
        };
        if (value) {
          cliPathsByHost[hostnameKey] = value;
        } else {
          delete cliPathsByHost[hostnameKey];
        }

        await context.plugin.applyProviderRuntimeSettings(
          ['jcode'],
          (settings) => {
            updateJcodeProviderSettings(settings, { cliPathsByHost });
            clearJcodeDiscoveryState(settings);
          },
          () => jcodeWorkspace?.cliResolver?.reset(),
        );
      },
      placeholder: process.platform === 'win32'
        ? 'C:\\Users\\you\\AppData\\Roaming\\npm\\jcode.cmd'
        : '/usr/local/bin/jcode',
      validate: validateCliPath,
    });

    new Setting(container).setName('Models').setHeading();
    renderJcodeModelPicker(container, modelWarning.context, settingsBag);

    new Setting(container).setName(t('settings.agentSkills.sectionTitle')).setHeading();
    context.renderAgentSkillSettings(container, 'jcode');

    new Setting(container).setName('Commands').setHeading();
    context.renderHiddenProviderCommandSetting(container, 'jcode', {
      name: 'Hidden Commands and Skills',
      desc: 'Hide specific Jcode commands and skills from the dropdown. Enter names without the leading slash, one per line.',
      placeholder: 'memory\ncompact\nplan',
    });

    renderEnvironmentSettingsSection({
      container,
      plugin: context.plugin,
      scope: 'provider:jcode',
      heading: 'Environment',
      name: 'Environment Variables',
      desc: 'Extra environment variables passed to Jcode.',
      placeholder: 'JCODE_BING_API_KEY=...',
      renderCustomContextLimits: (target) => context.renderCustomContextLimits(target, 'jcode'),
    });
  },
};

function renderJcodeModelPicker(
  container: HTMLElement,
  context: ProviderSettingsTabRendererContext,
  settingsBag: Record<string, unknown>,
): void {
  const getState = (): ProviderModelPickerState => {
    const current = getJcodeProviderSettings(settingsBag);
    return {
      aliases: current.modelAliases,
      discoveredCount: current.discoveredModels.length,
      models: buildJcodePickerModels(current.discoveredModels, current.visibleModels),
      selectedIds: current.visibleModels,
    };
  };

  const warmModelMetadata = async (rawId: string): Promise<void> => {
    const workspaceService = maybeGetJcodeWorkspaceServices()?.metadataService;
    const metadataService = workspaceService
      ?? new JcodeMetadataService(context.plugin);
    try {
      if (
        await metadataService.warmModelMetadata(encodeJcodeModelId(rawId))
      ) {
        context.notifyProviderModelOptionsChanged('jcode');
      }
    } catch {
      // Metadata warmup is opportunistic; the first chat turn can still discover it.
    } finally {
      if (!workspaceService) await metadataService.dispose();
    }
  };

  renderProviderModelPicker({
    container,
    emptyCatalogText: 'Start Jcode once to load its model catalog. Claudian will then let you pick visible models.',
    failedCatalogText: 'Could not load the Jcode model catalog. Check the CLI path and login state, then try again.',
    getState,
    async loadCatalog() {
      const workspaceService = maybeGetJcodeWorkspaceServices()?.metadataService;
      const metadataService = workspaceService
        ?? new JcodeMetadataService(context.plugin);
      try {
        const loaded = await metadataService.loadCatalog();
        const discoveredCount = getJcodeProviderSettings(settingsBag).discoveredModels.length;
        if (!loaded) {
          return 'failed';
        }
        if (discoveredCount > 0) {
          context.notifyProviderModelOptionsChanged('jcode');
          return 'loaded';
        }
        return 'empty';
      } catch {
        return 'failed';
      } finally {
        if (!workspaceService) await metadataService.dispose();
      }
    },
    loadCatalogOnRender: true,
    loadingCatalogText: 'Loading Jcode model catalog...',
    modifier: 'jcode',
    async onAliasesChange(modelAliases) {
      await context.plugin.mutateSettings((settings) => {
        updateJcodeProviderSettings(settings, { modelAliases });
      });
      context.notifyProviderModelOptionsChanged('jcode');
    },
    onModelSelected: async (model) => warmModelMetadata(model.id),
    async onSelectedIdsChange(visibleModels) {
      const current = getJcodeProviderSettings(settingsBag);
      const normalized = normalizeJcodeVisibleModels(visibleModels, current.discoveredModels);
      if (sameStringList(current.visibleModels, normalized)) {
        return;
      }

      await context.plugin.mutateSettings((settings) => {
        updateJcodeProviderSettings(settings, { visibleModels: normalized });
      });
      context.notifyProviderModelOptionsChanged('jcode');
    },
    providerName: 'Jcode',
  });
}

function validateCliPath(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const expandedPath = expandHomePath(trimmed);
  if (!fs.existsSync(expandedPath)) {
    return 'Path does not exist';
  }
  if (!fs.statSync(expandedPath).isFile()) {
    return 'Path must point to a file';
  }
  return null;
}

function buildJcodePickerModels(
  discoveredModels: JcodeDiscoveredModel[],
  visibleModels: string[],
): ProviderModelPickerModel[] {
  const models: ProviderModelPickerModel[] = [];
  const discoveredIds = new Set<string>();

  for (const model of buildJcodeBaseModels(discoveredModels)) {
    const { modelLabel, providerLabel } = splitJcodeModelLabel(model.label || model.rawId);
    discoveredIds.add(model.rawId);
    models.push({
      description: model.description ?? '',
      id: model.rawId,
      isAvailable: true,
      name: modelLabel,
      providerKey: providerLabel.toLowerCase(),
      providerLabel,
    });
  }

  for (const rawId of visibleModels) {
    if (discoveredIds.has(rawId)) {
      continue;
    }

    const { modelLabel, providerLabel } = splitJcodeModelLabel(rawId);
    models.push({
      id: rawId,
      isAvailable: false,
      name: modelLabel,
      providerKey: providerLabel.toLowerCase(),
      providerLabel,
      unavailableMessage: 'Not currently reported by Jcode',
    });
  }

  return models.sort((left, right) => {
    const providerCmp = (left.providerLabel ?? '').localeCompare(right.providerLabel ?? '');
    if (providerCmp !== 0) {
      return providerCmp;
    }
    return left.name.localeCompare(right.name);
  });
}
