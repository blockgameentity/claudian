import type { ProviderCommandDiscoveryResult } from '@/core/providers/commands/ProviderCommandDiscoveryResult';
import { loadRuntimeCommands } from '@/core/providers/commands/RuntimeCommandLoader';
import type { ProviderHost } from '@/core/providers/ProviderHost';
import type {
  ProviderCommandLoader as ProviderCommandLoaderContract,
  ProviderCommandLoaderContext,
} from '@/core/providers/types';
import type { SlashCommand } from '@/core/types';

import { JcodeMetadataService } from '../metadata/JcodeMetadataService';
import { getJcodeProviderSettings } from '../settings';

type JcodeMetadataServiceFactory = (
  plugin: ProviderHost,
) => JcodeMetadataService;

const DEFAULT_METADATA_SERVICE_FACTORY: JcodeMetadataServiceFactory =
  plugin => new JcodeMetadataService(plugin);

export class JcodeCommandLoader implements ProviderCommandLoaderContract {
  constructor(
    private readonly metadataService?: JcodeMetadataService,
    private readonly createMetadataService: JcodeMetadataServiceFactory =
      DEFAULT_METADATA_SERVICE_FACTORY,
  ) {}

  getCacheFingerprint(settings: Record<string, unknown>): string {
    return `jcode:commands:v1:${getJcodeProviderSettings(settings).enabled ? 'enabled' : 'disabled'}`;
  }

  isAvailable(settings: Record<string, unknown>): boolean {
    return getJcodeProviderSettings(settings).enabled;
  }

  async loadCommands(
    context: ProviderCommandLoaderContext,
  ): Promise<ProviderCommandDiscoveryResult<SlashCommand>> {
    let ownedService: JcodeMetadataService | null = null;
    return loadRuntimeCommands({
      allowIsolatedMetadataCreation: context.allowIsolatedMetadataCreation,
      cleanup: async () => ownedService?.dispose(),
      discover: async (signal) => {
        const metadataService = this.metadataService
          ?? (ownedService = this.createMetadataService(context.plugin));
        return await metadataService.discoverCommands(signal);
      },
      errorMessage: 'Could not load Jcode commands.',
      projectItems: result => result.loaded ? result.commands : null,
      readyCommandSnapshot: context.readyCommandSnapshot,
      requiresSessionMessage: 'Jcode command metadata has not been loaded for this tab.',
      signal: context.signal,
    });
  }
}
