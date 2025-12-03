import { EditorView } from '@codemirror/view';
import type SmoothCursorPlugin from './main';
import type { VimMode } from './types';

/**
 * VimStateProvider - Detects vim mode changes via vim-mode-change event
 * Uses CodeMirror's native vim-mode-change event for reliable mode detection
 */
export class VimStateProvider {
  private plugin: SmoothCursorPlugin;
  private currentMode: VimMode = 'normal';
  private editorView: EditorView | null = null;
  private modeChangeCallbacks: Set<(mode: VimMode) => void> = new Set();

  constructor(plugin: SmoothCursorPlugin) {
    this.plugin = plugin;
  }

  /**
   * Attach to a specific EditorView
   */
  attach(editorView: EditorView) {
    this.editorView = editorView;
  }

  /**
   * Detach from current editor
   */
  detach() {
    this.editorView = null;
  }

  /**
   * Get current vim mode
   */
  getCurrentMode(): VimMode {
    return this.currentMode;
  }

  /**
   * Register callback for mode changes
   */
  onModeChange(callback: (mode: VimMode) => void): () => void {
    this.modeChangeCallbacks.add(callback);
    return () => this.modeChangeCallbacks.delete(callback);
  }

  /**
   * Clean up resources
   */
  destroy() {
    this.modeChangeCallbacks.clear();
  }

  private setMode(mode: VimMode) {
    if (mode !== this.currentMode) {
      this.plugin.debug('Vim mode changed:', this.currentMode, '->', mode);
      this.currentMode = mode;
      this.modeChangeCallbacks.forEach((cb) => cb(mode));
    }
  }

  /**
   * Handle vim-mode-change event from CodeMirror editor
   * This is the most reliable way to detect mode changes, as it works with custom key mappings
   * @param modeObj - The vim mode object from the event with 'mode' property (e.g., { mode: 'insert' })
   */
  onVimModeChanged = (modeObj: any) => {
    this.plugin.debug('vim-mode-change event received:', modeObj);
    
    // Check if modeObj is empty or invalid
    if (!modeObj || (typeof modeObj === 'object' && Object.keys(modeObj).length === 0)) {
      this.plugin.debug('Empty or invalid mode object, skipping');
      return;
    }
    
    let modeString: string;
    
    // Handle object format with 'mode' property (as used by im-select plugin)
    if (typeof modeObj === 'object' && modeObj !== null && 'mode' in modeObj) {
      modeString = modeObj.mode;
    } else if (typeof modeObj === 'string') {
      modeString = modeObj;
    } else {
      this.plugin.debug('Unknown mode format:', modeObj);
      return;
    }
    
    this.plugin.debug('Parsed mode string:', modeString);
    
    const normalizedMode = modeString.toLowerCase();
    let vimMode: VimMode;
    
    // Convert event mode string to internal VimMode type
    if (normalizedMode === 'insert' || normalizedMode.includes('insert')) {
      vimMode = 'insert';
    } else if (normalizedMode === 'visual' || normalizedMode.includes('visual')) {
      vimMode = 'visual';
    } else if (normalizedMode === 'replace' || normalizedMode.includes('replace')) {
      vimMode = 'replace';
    } else if (normalizedMode === 'command' || normalizedMode.includes('command') || normalizedMode.includes('ex')) {
      vimMode = 'command';
    } else {
      // Default to normal mode
      vimMode = 'normal';
    }
    
    this.plugin.debug('Converted to VimMode:', vimMode);
    this.setMode(vimMode);
  }
}
