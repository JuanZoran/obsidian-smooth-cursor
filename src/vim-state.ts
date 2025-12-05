import { EditorView } from '@codemirror/view';
import type SmoothCursorPlugin from './main';
import type { VimMode } from './types';

/**
 * VimStateProvider - Abstracts vim mode detection from different sources
 * Supports both Obsidian's built-in vim mode and community plugins
 * Uses event-driven detection via MutationObserver, keyboard events, and focus events
 */
export class VimStateProvider {
  private plugin: SmoothCursorPlugin;
  private currentMode: VimMode = 'normal';
  private editorView: EditorView | null = null;
  private modeChangeCallbacks: Set<(mode: VimMode) => void> = new Set();
  private observer: MutationObserver | null = null;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private focusHandler: ((e: FocusEvent) => void) | null = null;
  private blurHandler: ((e: FocusEvent) => void) | null = null;
  private detectModeScheduled = false;
  private isEditorFocused = false;

  constructor(plugin: SmoothCursorPlugin) {
    this.plugin = plugin;
    this.setupGlobalModeDetection();
    this.setupKeyboardDetection();
    this.setupFocusDetection();
  }

  /**
   * Attach to a specific EditorView
   */
  attach(editorView: EditorView) {
    this.editorView = editorView;
    this.isEditorFocused = this.checkEditorFocused();
    this.detectModeFromEditor();
    this.setupEditorObserver();
  }

  /**
   * Setup MutationObserver for the specific editor
   * Observer is already created in setupGlobalModeDetection, we just reconfigure it
   */
  private setupEditorObserver() {
    if (!this.editorView || !this.observer) return;
    
    // Disconnect from previous observation
    this.observer.disconnect();
    
    // Observe both document.body (for global changes) and editor DOM (for editor-specific changes)
    this.observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
      subtree: false,
    });
    
    // Also observe editor DOM for editor-specific class changes
    this.observer.observe(this.editorView.dom, {
      attributes: true,
      attributeFilter: ['class'],
      subtree: false, // Only observe editor root for better performance
    });
  }

  /**
   * Detach from current editor
   */
  detach() {
    this.editorView = null;
    this.isEditorFocused = false;
    
    if (this.observer) {
      // Revert to observing only document.body when no editor is attached
      this.observer.disconnect();
      this.observer.observe(document.body, {
        attributes: true,
        attributeFilter: ['class'],
        subtree: false,
      });
    }
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
    this.modeChangeCallbacks.clear();
    if (this.keydownHandler) {
      document.removeEventListener('keydown', this.keydownHandler, true);
    }
    if (this.focusHandler) {
      document.removeEventListener('focusin', this.focusHandler, true);
    }
    if (this.blurHandler) {
      document.removeEventListener('focusout', this.blurHandler, true);
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
   * Check if editor has focus
   */
  private checkEditorFocused(): boolean {
    if (!this.editorView) return false;
    const activeElement = document.activeElement;
    if (!activeElement) return false;
    return this.editorView.dom.contains(activeElement) || this.editorView.dom === activeElement;
  }

  /**
   * Setup focus detection for immediate mode detection on focus
   */
  private setupFocusDetection() {
    this.focusHandler = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('.cm-editor')) {
        this.isEditorFocused = true;
        // Detect mode immediately on focus
        this.detectModeFromEditor();
      }
    };

    this.blurHandler = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('.cm-editor')) {
        // Small delay (10ms) to check if focus moved to another part of editor
        // This is necessary because focus events are asynchronous - the focusout event
        // fires before the new focus target is actually focused. The delay allows
        // us to check the actual focus state after the browser has updated it.
        setTimeout(() => {
          this.isEditorFocused = this.checkEditorFocused();
        }, 10);
      }
    };

    document.addEventListener('focusin', this.focusHandler, true);
    document.addEventListener('focusout', this.blurHandler, true);
  }

  /**
   * Setup global mode detection via DOM observation
   */
  private setupGlobalModeDetection() {
    this.observer = new MutationObserver((mutations) => {
      // Batch process mutations
      let shouldDetect = false;
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          const target = mutation.target as Element;
          if (target.closest('.cm-editor') || target === document.body) {
            shouldDetect = true;
            break;
          }
        }
      }
      
      if (shouldDetect) {
        this.detectModeFromDOMDebounced();
      }
    });

    this.observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
      subtree: false,
    });
  }

  /**
   * Debounced DOM mode detection
   * Uses requestAnimationFrame for debouncing to ensure DOM is ready and avoid
   * blocking the main thread. This is more efficient than setTimeout for DOM
   * operations as it aligns with the browser's rendering cycle.
   */
  private detectModeFromDOMDebounced() {
    if (this.detectModeScheduled) return;
    this.detectModeScheduled = true;
    
    requestAnimationFrame(() => {
      this.detectModeScheduled = false;
      if (this.editorView) {
        this.detectModeFromDOM(this.editorView.dom);
      }
    });
  }

  /**
   * Detect vim mode from DOM classes
   * Optimized with early exit and cached class list
   */
  private detectModeFromDOM(element: Element) {
    const classList = element.classList;
    
    // Check string patterns first (faster)
    const stringPatterns: [string, VimMode][] = [
      ['is-vim-mode-normal', 'normal'],
      ['is-vim-mode-insert', 'insert'],
      ['is-vim-mode-visual', 'visual'],
      ['cm-vim-normal', 'normal'],
      ['cm-vim-insert', 'insert'],
      ['cm-vim-visual', 'visual'],
    ];

    for (const [pattern, mode] of stringPatterns) {
      if (classList.contains(pattern)) {
        this.setMode(mode);
        return;
      }
    }

    // Check regex patterns (slower, do last)
    const regexPatterns: [RegExp, VimMode][] = [
      [/vim-mode-normal/, 'normal'],
      [/vim-mode-insert/, 'insert'],
      [/vim-mode-visual/, 'visual'],
      [/vim-mode-replace/, 'replace'],
      [/vim-mode-command/, 'command'],
    ];

    for (let i = 0; i < classList.length; i++) {
      const cls = classList[i];
      for (const [pattern, mode] of regexPatterns) {
        if (pattern.test(cls)) {
          this.setMode(mode);
          return;
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
      // @ts-expect-error - accessing internal vim state
      const cm = this.editorView.cm ?? this.editorView;
      
      // @ts-expect-error - accessing internal API
      const vimState = cm?.state?.vim ?? cm?.vim ?? this.editorView.state?.field?.(this.getVimStateField());
      
      if (vimState) {
        const mode = this.parseVimState(vimState);
        if (mode) {
          this.setMode(mode);
          return;
        }
      }

      // Fallback: check DOM classes on editor element only
      this.detectModeFromDOM(this.editorView.dom);
    } catch (e) {
      this.plugin.debug('Error detecting vim mode from editor:', e);
    }
  }

  /**
   * Try to get vim state field from CodeMirror extensions
   */
  private getVimStateField() {
    return null;
  }

  /**
   * Parse vim state object to determine current mode
   */
  private parseVimState(vimState: unknown): VimMode | null {
    if (!vimState || typeof vimState !== 'object') return null;

    const state = vimState as Record<string, unknown>;
    const modeValue = state.mode ?? state.currentMode ?? state.insertMode;
    
    if (typeof modeValue === 'string') {
      const normalizedMode = modeValue.toLowerCase();
      if (normalizedMode.includes('insert')) return 'insert';
      if (normalizedMode.includes('visual')) return 'visual';
      if (normalizedMode.includes('replace')) return 'replace';
      if (normalizedMode.includes('command') || normalizedMode.includes('ex')) return 'command';
      if (normalizedMode.includes('normal')) return 'normal';
    }
    
    if (typeof state.insertMode === 'boolean') {
      return state.insertMode ? 'insert' : 'normal';
    }

    return null;
  }


  /**
   * Setup keyboard-based mode detection
   * Detects common vim mode-switching keys
   */
  private setupKeyboardDetection() {
    // Pre-computed set for faster lookup
    const insertModeKeys = new Set(['i', 'I', 'a', 'A', 'o', 'O', 's', 'S', 'c', 'C']);
    const visualModeKeys = new Set(['v', 'V']);
    
    this.keydownHandler = (e: KeyboardEvent) => {
      if (!this.editorView) return;
      
      const target = e.target as HTMLElement;
      if (!target.closest('.cm-editor')) return;

      const key = e.key;

      // Debounce mode detection
      if (this.detectModeScheduled) return;
      this.detectModeScheduled = true;
      
      requestAnimationFrame(() => {
        this.detectModeScheduled = false;
        
        // Escape key typically returns to normal mode
        if (key === 'Escape') {
          this.detectModeFromEditor();
          return;
        }

        // Only check mode-switching keys in normal mode
        if (this.currentMode === 'normal' && !e.ctrlKey && !e.metaKey) {
          if (insertModeKeys.has(key) || visualModeKeys.has(key) || key === ':' || key === 'R') {
            this.detectModeFromEditor();
          }
        }
      });
    };

    document.addEventListener('keydown', this.keydownHandler, true);
  }
}
