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

  scriptingTurn: 'scripting:turn',
  scriptingStream: 'scripting:stream',
  scriptingBreakdown: 'scripting:breakdown',
  scriptingImprove: 'scripting:improve',

  mediaPickFile: 'media:pick-file',
  mediaPickFiles: 'media:pick-files',
  mediaImport: 'media:import',
  mediaImportUrl: 'media:import-url',
  mediaSaveDataUrl: 'media:save-data-url',
  mediaIsolateAudio: 'media:isolate-audio',
  mediaKeyAlpha: 'media:key-alpha',
  mediaCombineLocal: 'media:combine-local',

  audioVoices: 'audio:voices',
  audioPreview: 'audio:preview',
  audioTts: 'audio:tts',
  audioMusic: 'audio:music',
  audioSfx: 'audio:sfx',
  audioClone: 'audio:clone',
  audioYapperTts: 'audio:yapper-tts',
  audioYapperVoices: 'audio:yapper-voices',

  loraTrain: 'lora:train',
  loraList: 'lora:list',
  loraDelete: 'lora:delete',
  loraSetVoice: 'lora:set-voice',
  loraSetTone: 'lora:set-tone',

  generateRun: 'generate:run',

  cutRoomExport: 'cutroom:export',

  chatRealtyStatus: 'chatrealty:status',
  chatRealtyPull: 'chatrealty:pull',
  chatRealtyCover: 'chatrealty:create-cover',
  chatRealtyListingContext: 'chatrealty:listing-context',
  chatRealtyCarouselSlide: 'chatrealty:create-carousel-slide',
  chatRealtyStage: 'chatrealty:stage-listing',

  connectorsList: 'connectors:list',
  connectorsSave: 'connectors:save',
  connectorsDelete: 'connectors:delete',
  connectorsTest: 'connectors:test',
  connectorsSuggestions: 'connectors:suggestions',
  connectorsAddSuggestion: 'connectors:add-suggestion',
  connectorsOpenKeyPage: 'connectors:open-key-page',
  connectorsOauthConnect: 'connectors:oauth-connect',

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
