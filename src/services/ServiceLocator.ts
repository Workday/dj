/**
 * Service Locator with Lazy Resolution
 *
 * A lightweight service container that provides lazy instantiation of services.
 * This breaks circular dependencies by deferring service creation until first access.
 *
 * Key Features:
 * - Lazy instantiation: Services are created only when first requested
 * - Singleton pattern: Each service is instantiated once and cached
 * - Type-safe: Generic methods preserve type information
 * - Circular dependency safe: Factories are called lazily, not at registration time
 *
 * @example
 * const locator = new ServiceLocator();
 *
 * // Register services with factories (not instances)
 * locator.register('logger', () => new DJLogger());
 * locator.register('dbt', () => new Dbt(locator.get('logger')));
 *
 * // Get services (lazy - created on first access)
 * const logger = locator.get<DJLogger>('logger');
 * const dbt = locator.get<Dbt>('dbt');
 */
export class ServiceLocator {
  private factories = new Map<string, () => unknown>();
  private instances = new Map<string, unknown>();
  private resolving = new Set<string>();

  /**
   * Register a service factory.
   * The factory is NOT called immediately - only when the service is first requested.
   *
   * @param name Unique identifier for the service
   * @param factory Function that creates the service instance
   */
  register<T>(name: string, factory: () => T): void {
    if (this.factories.has(name)) {
      throw new Error(`Service '${name}' is already registered`);
    }
    this.factories.set(name, factory);
  }

  /**
   * Register an existing instance directly.
   * Use this for services that are created externally (e.g., vscode.ExtensionContext).
   *
   * @param name Unique identifier for the service
   * @param instance The pre-created service instance
   */
  registerInstance<T>(name: string, instance: T): void {
    if (this.factories.has(name) || this.instances.has(name)) {
      throw new Error(`Service '${name}' is already registered`);
    }
    this.instances.set(name, instance);
  }

  /**
   * Get a service by name. Creates the instance on first access (lazy).
   *
   * @param name The service identifier
   * @returns The service instance
   * @throws Error if service is not registered or circular dependency detected
   */
  get<T>(name: string): T {
    // Return cached instance if available
    if (this.instances.has(name)) {
      return this.instances.get(name) as T;
    }

    // Check for circular dependency during resolution
    if (this.resolving.has(name)) {
      throw new Error(
        `Circular dependency detected while resolving '${name}'. ` +
          `Resolution chain: ${Array.from(this.resolving).join(' -> ')} -> ${name}`,
      );
    }

    // Get the factory
    const factory = this.factories.get(name);
    if (!factory) {
      throw new Error(
        `Service '${name}' is not registered. ` +
          `Available services: ${this.getRegisteredServices().join(', ')}`,
      );
    }

    // Mark as resolving (for circular dependency detection)
    this.resolving.add(name);

    try {
      // Create and cache the instance
      const instance = factory() as T;
      this.instances.set(name, instance);
      return instance;
    } finally {
      // Always clean up resolving state
      this.resolving.delete(name);
    }
  }

  /**
   * Check if a service is registered (factory or instance).
   */
  has(name: string): boolean {
    return this.factories.has(name) || this.instances.has(name);
  }

  /**
   * Get list of all registered service names.
   */
  getRegisteredServices(): string[] {
    return [
      ...new Set([...this.factories.keys(), ...this.instances.keys()]),
    ].sort();
  }

  /**
   * Clear all cached instances (but keep factories).
   * Useful for testing or resetting state.
   */
  clearInstances(): void {
    this.instances.clear();
    this.resolving.clear();
  }

  /**
   * Clear everything (factories and instances).
   * Useful for complete reset or shutdown.
   */
  clear(): void {
    this.factories.clear();
    this.instances.clear();
    this.resolving.clear();
  }
}

/**
 * Service names as constants for type-safe access.
 * Use these instead of magic strings.
 */
export const SERVICE_NAMES = {
  // Core
  ExtensionContext: 'extensionContext',
  Logger: 'logger',
  FrameworkState: 'frameworkState',
  StateManager: 'stateManager',

  // Domain Services
  Dbt: 'dbt',
  Framework: 'framework',
  Trino: 'trino',
  DataExplorer: 'dataExplorer',
  ColumnLineage: 'columnLineage',

  // API Layer
  Api: 'api',
  Lightdash: 'lightdash',
  LightdashContent: 'lightdashContent',
} as const;

export type ServiceName = (typeof SERVICE_NAMES)[keyof typeof SERVICE_NAMES];
