/**
 * Shared types, split by domain and re-exported here.
 *
 * Everything imports `@shared/types`, so this stays the single entry point —
 * the split is about keeping any one file readable, not about churning 40
 * import statements.
 */

export * from './types/providers'
export * from './types/scripting'
export * from './types/media'
export * from './types/canvas'
export * from './types/timeline'
export * from './types/connectors'
export * from './types/chatrealty'
export * from './types/character'
