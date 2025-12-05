import { EditorView } from '@codemirror/view';
import type ObVidePlugin from './main';
import type { VimMode } from './types';

/**
 * VimStateProvider - Abstracts vim mode detection from different sources
 * Supports both Obsidian's built-in vim mode and community plugins
 */
export class VimStateProvider {
  private plugin: ObVidePlugin;
  private currentMode: VimMode = 'normal';
  private editorView: EditorView | null = null;
  private modeChangeCallbacks: Set<(mode: VimMode) => void> = new Set();
  private observer: MutationObserver | null = null;
  private pollInterval: number | null = null;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(plugin: ObVidePlugin) {
    this.plugin = plugin;
    this.setupGlobalModeDetection();
    this.setupKeyboardDetection();
  }

  /**
   * Attach to a specific EditorView
   */
  attach(editorView: EditorView) {
    this.editorView = editorView;
    this.detectModeFromEditor();
    this.setupEditorModeListener();
  }

  /**
   * Detach from current editor
   */
  detach() {
    this.editorView = null;
    this.stopPolling();
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
    this.observer?.disconnect();
    this.stopPolling();
    this.modeChangeCallbacks.clear();
    if (this.keydownHandler) {
      document.removeEventListener('keydown', this.keydownHandler, true);
    }
  }

  private setMode(mode: VimMode) {
    if (mode !== this.currentMode) {
      this.plugin.debug('Vim mode changed:', this.currentMode, '->', mode);
      this.currentMode = mode;
      this.modeChangeCallbacks.forEach((cb) => cb(mode));
    }
  }

  /**
   * Setup global mode detection via DOM observation
   * This catches mode changes indicated by CSS classes on the body or editor
   */
  private setupGlobalModeDetection() {
    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          this.detectModeFromDOM(mutation.target as Element);
        }
      }
    });

    // Observe body for class changes (some vim plugins add mode classes there)
    this.observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
      subtree: true,
    });
  }

  /**
   * Detect vim mode from DOM classes
   * Different vim plugins use different class naming conventions
   */
  private detectModeFromDOM(element: Element) {
    const classList = element.classList;
    
    // Check for common vim mode class patterns
    const modePatterns: [RegExp | string, VimMode][] = [
      [/vim-mode-normal/, 'normal'],
      [/vim-mode-insert/, 'insert'],
      [/vim-mode-visual/, 'visual'],
      [/vim-mode-replace/, 'replace'],
      [/vim-mode-command/, 'command'],
      ['is-vim-mode-normal', 'normal'],
      ['is-vim-mode-insert', 'insert'],
      ['is-vim-mode-visual', 'visual'],
      ['cm-vim-normal', 'normal'],
      ['cm-vim-insert', 'insert'],
      ['cm-vim-visual', 'visual'],
    ];

    for (const [pattern, mode] of modePatterns) {
      if (typeof pattern === 'string') {
        if (classList.contains(pattern)) {
          this.setMode(mode);
          return;
        }
      } else {
        for (let i = 0; i < classList.length; i++) {
          const cls = classList[i];
          if (pattern.test(cls)) {
            this.setMode(mode);
            return;
          }
        }
      }
    }
  }

  /**
   * Detect mode from CodeMirror's internal vim state
   */
  private detectModeFromEditor() {
    if (!this.editorView) return;

    try {
      // Try to access CodeMirror vim state
      // @ts-expect-error - accessing internal vim state
      const cm = this.editorView.cm ?? this.editorView;
      
      // Check for vim state in various locations
      // @ts-expect-error - accessing internal API
      const vimState = cm?.state?.vim ?? cm?.vim ?? this.editorView.state?.field?.(this.getVimStateField());
      
      if (vimState) {
        const mode = this.parseVimState(vimState);
        if (mode) {
          this.setMode(mode);
          return;
        }
      }

      // Fallback: check DOM classes on editor element
      const editorDom = this.editorView.dom;
      this.detectModeFromDOM(editorDom);
      
      // Also check parent elements
      let parent = editorDom.parentElement;
      while (parent && parent !== document.body) {
        this.detectModeFromDOM(parent);
        parent = parent.parentElement;
      }
    } catch (e) {
      this.plugin.debug('Error detecting vim mode from editor:', e);
    }
  }

  /**
   * Try to get vim state field from CodeMirror extensions
   */
  private getVimStateField() {
    // This is a placeholder - actual implementation depends on how vim mode is implemented
    return null;
  }

  /**
   * Parse vim state object to determine current mode
   */
  private parseVimState(vimState: unknown): VimMode | null {
    if (!vimState || typeof vimState !== 'object') return null;

    const state = vimState as Record<string, unknown>;
    
    // Different vim implementations store mode differently
    const modeValue = state.mode ?? state.currentMode ?? state.insertMode;
    
    if (typeof modeValue === 'string') {
      const normalizedMode = modeValue.toLowerCase();
      if (normalizedMode.includes('insert')) return 'insert';
      if (normalizedMode.includes('visual')) return 'visual';
      if (normalizedMode.includes('replace')) return 'replace';
      if (normalizedMode.includes('command') || normalizedMode.includes('ex')) return 'command';
      if (normalizedMode.includes('normal')) return 'normal';
    }
    
    // Check for insertMode boolean flag (common pattern)
    if (typeof state.insertMode === 'boolean') {
      return state.insertMode ? 'insert' : 'normal';
    }

    return null;
  }

  /**
   * Setup listener for mode changes within the editor
   */
  private setupEditorModeListener() {
    // Start polling for mode changes
    // This is a fallback when event-based detection isn't available
    this.startPolling();
  }

  private startPolling() {
    this.stopPolling();
    this.pollInterval = window.setInterval(() => {
      this.detectModeFromEditor();
    }, 100);
  }

  private stopPolling() {
    if (this.pollInterval !== null) {
      window.clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /**
   * Setup keyboard-based mode detection
   * Detects common vim mode-switching keys
   */
  private setupKeyboardDetection() {
    this.keydownHandler = (e: KeyboardEvent) => {
      // Only process if we have an active editor
      if (!this.editorView) return;
      
      // Check if we're in an editor context
      const target = e.target as HTMLElement;
      if (!target.closest('.cm-editor')) return;

      // Detect mode changes based on key presses
      // Note: This is a heuristic and may not be 100% accurate
      // It's meant to supplement DOM/state-based detection
      
      const key = e.key;
      const currentMode = this.currentMode;

      // Escape key typically returns to normal mode
      if (key === 'Escape') {
        // Small delay to let vim plugins process the key first
        setTimeout(() => this.detectModeFromEditor(), 10);
        return;
      }

      // In normal mode, certain keys switch to insert mode
      if (currentMode === 'normal') {
        if (['i', 'I', 'a', 'A', 'o', 'O', 's', 'S', 'c', 'C'].includes(key) && !e.ctrlKey && !e.metaKey) {
          // These keys typically enter insert mode
          setTimeout(() => this.detectModeFromEditor(), 10);
        } else if (key === 'v' && !e.ctrlKey && !e.metaKey) {
          // v enters visual mode
          setTimeout(() => this.detectModeFromEditor(), 10);
        } else if (key === 'V' && !e.ctrlKey && !e.metaKey) {
          // V enters visual line mode
          setTimeout(() => this.detectModeFromEditor(), 10);
        } else if (key === ':') {
          // : enters command mode
          setTimeout(() => this.detectModeFromEditor(), 10);
        } else if (key === 'R' && !e.ctrlKey && !e.metaKey) {
          // R enters replace mode
          setTimeout(() => this.detectModeFromEditor(), 10);
        }
      }
    };

    document.addEventListener('keydown', this.keydownHandler, true);
  }
}

