export const IPC = {
  windowMinimize: 'window:minimize',
  windowMaximize: 'window:maximize',
  windowClose: 'window:close',

  sessionsLoad: 'sessions:load',
  sessionsSave: 'sessions:save',
  sessionsSaveSync: 'sessions:save-sync',

  agentPing: 'agent:ping',
  agentStream: 'agent:stream',
  claudeStatus: 'claude:status',

  mediaPickFile: 'media:pick-file',
  mediaImport: 'media:import',
  mediaImportUrl: 'media:import-url',

  generateRun: 'generate:run',

  cutRoomExport: 'cutroom:export',

  chatRealtyStatus: 'chatrealty:status',
  chatRealtyPull: 'chatrealty:pull',

  connectorsList: 'connectors:list',
  connectorsSave: 'connectors:save',
  connectorsDelete: 'connectors:delete',
  connectorsTest: 'connectors:test',
  connectorsSuggestions: 'connectors:suggestions',
  connectorsAddSuggestion: 'connectors:add-suggestion',
  connectorsOpenKeyPage: 'connectors:open-key-page',

  modelProvidersList: 'model-providers:list',
  modelProvidersSave: 'model-providers:save',
  modelProvidersDelete: 'model-providers:delete',
  modelProvidersSetActive: 'model-providers:set-active',

  secretRequest: 'secret:request',
  secretList: 'secret:list',
  secretDelete: 'secret:delete',

  /** Secure-credential modal <-> main only. Never exposed to the studio renderer. */
  secureInit: 'secure:init',
  secureSubmit: 'secure:submit',
  secureCancel: 'secure:cancel'
} as const
