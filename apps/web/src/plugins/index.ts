import { loadWebPlugins } from '@dicorre/plugins/web'
import type { PluginConfig } from '@/types/plugins'

/**
 * Plugin loader - registers all available plugins with the registry
 */
export const loadPlugins = (config?: PluginConfig) =>
  loadWebPlugins(config)

/**
 * Initialize plugins with default configuration
 */
export const initializePlugins = () => loadPlugins()
