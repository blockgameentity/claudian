import { NOOP_TASK_RESULT_INTERPRETER } from '../../core/providers/NoopTaskResultInterpreter';
import { getProviderConfig } from '../../core/providers/providerConfig';
import { hasStoredConfigNormalization } from '../../core/providers/settings/storedSettings';
import type { ProviderModule } from '../../core/providers/types';
import {
  getJcodeWorkspaceServices,
  jcodeWorkspaceRegistration,
} from './app/JcodeWorkspaceServices';
import { JCODE_PROVIDER_CAPABILITIES } from './capabilities';
import { jcodeSettingsReconciler } from './env/JcodeSettingsReconciler';
import { JcodeExecutionBackend } from './execution/JcodeExecutionBackend';
import { JcodeConversationHistoryService } from './history/JcodeConversationHistoryService';
import { decodeJcodeModelId } from './models';
import { getJcodeProviderSettings, updateJcodeProviderSettings } from './settings';
import { jcodeChatUIConfig } from './ui/JcodeChatUIConfig';

export const jcodeProviderRegistration: ProviderModule = {
  id: 'jcode',
  blankTabOrder: 9,
  capabilities: JCODE_PROVIDER_CAPABILITIES,
  chatUIConfig: jcodeChatUIConfig,
  createExecutionBackend: (plugin) => {
    const workspace = getJcodeWorkspaceServices();
    return new JcodeExecutionBackend(plugin, {
      commandCatalog: workspace.commandCatalog,
    });
  },
  resolveTitleGenerationModel: (plugin) => {
    const settings = plugin.settings as unknown as Record<string, unknown>;
    const titleModel = typeof settings.titleGenerationModel === 'string'
      ? settings.titleGenerationModel
      : '';
    return jcodeChatUIConfig.ownsModel(titleModel, settings)
      ? decodeJcodeModelId(titleModel) ?? undefined
      : undefined;
  },
  displayName: 'Jcode',
  environmentKeyPatterns: [/^JCODE_/i],
  historyService: new JcodeConversationHistoryService(),
  isEnabled: (settings) => getJcodeProviderSettings(settings).enabled,
  setEnabled: (settings, enabled) => updateJcodeProviderSettings(settings, { enabled }),
  settingsReconciler: jcodeSettingsReconciler,
  settingsStorage: {
    hostScopedFields: ['cliPathsByHost'],
    normalizeStored(target, stored) {
      const storedConfig = getProviderConfig(stored, 'jcode');
      const normalized = getJcodeProviderSettings(stored);
      updateJcodeProviderSettings(target, {
        ...normalized,
      });
      return hasStoredConfigNormalization(
        storedConfig,
        getProviderConfig(target, 'jcode'),
      );
    },
  },
  taskResultInterpreter: NOOP_TASK_RESULT_INTERPRETER,
  workspace: jcodeWorkspaceRegistration,
};
