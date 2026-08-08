export const IPC = {
  windowMinimize: 'window:minimize',
  windowMaximize: 'window:maximize',
  windowClose: 'window:close',

  sessionsLoad: 'sessions:load',
  sessionsSave: 'sessions:save',
  sessionsSaveSync: 'sessions:save-sync',

  agentPing: 'agent:ping',
  agentStream: 'agent:stream',

  mediaPickFile: 'media:pick-file',

  secretRequest: 'secret:request',
  secretList: 'secret:list',
  secretDelete: 'secret:delete',

  /** Secure-credential modal <-> main only. Never exposed to the studio renderer. */
  secureInit: 'secure:init',
  secureSubmit: 'secure:submit',
  secureCancel: 'secure:cancel'
} as const
