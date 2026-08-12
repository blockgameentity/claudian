import type { ProviderCommandCatalog } from '../../../core/providers/commands/ProviderCommandCatalog';
import type { ProviderHost } from '../../../core/providers/ProviderHost';
import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderTabWarmupPolicy,
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../core/providers/types';
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import { JcodeCommandCatalog } from '../commands/JcodeCommandCatalog';
import { JcodeMetadataService } from '../metadata/JcodeMetadataService';
import { JcodeCliResolver } from '../runtime/JcodeCliResolver';
import { jcodeSettingsTabRenderer } from '../ui/JcodeSettingsTab';
import { JcodeCommandLoader } from './JcodeCommandLoader';

export interface JcodeWorkspaceServices extends ProviderWorkspaceServices {
  commandCatalog: ProviderCommandCatalog;
  metadataService: JcodeMetadataService;
}

const jcodeTabWarmupPolicy: ProviderTabWarmupPolicy = {
  resolveMode() {
    return 'commands';
  },
};

export async function createJcodeWorkspaceServices(
  vaultAdapter: VaultFileAdapter,
  plugin: ProviderHost,
): Promise<JcodeWorkspaceServices> {
  const commandCatalog = new JcodeCommandCatalog();
  const metadataService = new JcodeMetadataService(plugin, { commandCatalog });

  return {
    commandCatalog,
    cliResolver: new JcodeCliResolver(),
    metadataService,
    commandLoader: new JcodeCommandLoader(metadataService),
    settingsTabRenderer: jcodeSettingsTabRenderer,
    tabWarmupPolicy: jcodeTabWarmupPolicy,
    prepareSettings: async () => undefined,
    dispose: async () => metadataService.dispose(),
  };
}

export const jcodeWorkspaceRegistration: ProviderWorkspaceRegistration<JcodeWorkspaceServices> = {
  initialize: async ({ plugin, vaultAdapter }) => (
    createJcodeWorkspaceServices(vaultAdapter, plugin)
  ),
};

export function maybeGetJcodeWorkspaceServices(): JcodeWorkspaceServices | null {
  return ProviderWorkspaceRegistry.getServices('jcode') as JcodeWorkspaceServices | null;
}

export function getJcodeWorkspaceServices(): JcodeWorkspaceServices {
  return ProviderWorkspaceRegistry.requireServices('jcode') as JcodeWorkspaceServices;
}
