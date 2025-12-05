/**
 * Vim mode types that affect cursor shape
 */
export type VimMode = 'normal' | 'insert' | 'visual' | 'replace' | 'command';

/**
 * Cursor shape types
 */
export type CursorShape = 'block' | 'line' | 'underline';

/**
 * Cursor position in pixel coordinates
 */
export interface CursorPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Animation state for smooth cursor movement
 */
export interface AnimationState {
  current: CursorPosition;
  target: CursorPosition;
  startTime: number;
  duration: number;
  isAnimating: boolean;
}

/**
 * Configuration for cursor shape per mode
 */
export interface CursorShapeConfig {
  normal: CursorShape;
  insert: CursorShape;
  visual: CursorShape;
  replace: CursorShape;
  command: CursorShape;
}

/**
 * Plugin settings interface
 */
export interface ObVideSettings {
  enableAnimation: boolean;
  animationDuration: number;
  cursorColor: string;
  cursorOpacity: number;
  cursorShapes: CursorShapeConfig;
  enableInNonEditor: boolean;
  debug: boolean;
  
  // Insert mode (typing) animation settings
  enableInsertModeAnimation: boolean;
  insertModeAnimationDuration: number;
  
  // CSS transform mode for smoother animation (may appear slightly blurry)
  useTransformAnimation: boolean;
}

/**
 * Default plugin settings
 */
export const DEFAULT_SETTINGS: ObVideSettings = {
  enableAnimation: true,
  animationDuration: 100,
  cursorColor: '#528bff',
  cursorOpacity: 0.8,
  cursorShapes: {
    normal: 'block',
    insert: 'line',
    visual: 'block',
    replace: 'underline',
    command: 'block',
  },
  enableInNonEditor: true,
  debug: false,
  
  // Insert mode animation defaults
  enableInsertModeAnimation: true,
  insertModeAnimationDuration: 50,
  
  // Transform animation default (off for sharper cursor)
  useTransformAnimation: false,
};

