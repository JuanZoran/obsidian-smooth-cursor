import { EditorView } from '@codemirror/view';
import { isEditorFocused } from '../utils/editor-utils';
import { addClass, hasClass } from '../utils/dom-utils';

/**
 * Editor state manager for focus and health checks
 */
export class EditorStateManager {
  private editorView: EditorView | null = null;
  private cachedIsFocused = false;
  private cachedEditorHasActiveClass = false;
  private lastFocusCheckTime = 0;
  private lastHealthCheckTime = 0;
  private focusCheckInterval = 100; // Check focus every 100ms max
  private healthCheckInterval = 1000; // Health check every 1000ms

  /**
   * Attach to an EditorView
   */
  attach(editorView: EditorView): void {
    this.editorView = editorView;
    this.cachedIsFocused = isEditorFocused(editorView);
    this.cachedEditorHasActiveClass = false;
    this.ensureHealth();
  }

  /**
   * Detach from current editor
   */
  detach(): void {
    this.setEditorActiveClass(false);
    this.editorView = null;
    this.cachedIsFocused = false;
    this.cachedEditorHasActiveClass = false;
  }

  /**
   * Check if editor is focused (with throttling)
   */
  isFocused(forceCheck: boolean = false): boolean {
    if (!this.editorView) return false;

    const now = performance.now();
    if (forceCheck || (now - this.lastFocusCheckTime) > this.focusCheckInterval) {
      this.lastFocusCheckTime = now;
      this.cachedIsFocused = isEditorFocused(this.editorView);
    }

    return this.cachedIsFocused;
  }

  /**
   * Ensure editor health (active class, etc.)
   */
  ensureHealth(forceCheck: boolean = false): void {
    if (!this.editorView) return;

    const now = performance.now();
    if (!forceCheck && (now - this.lastHealthCheckTime) < this.healthCheckInterval) {
      return;
    }

    this.lastHealthCheckTime = now;

    // Check and fix active class
    if (!this.cachedEditorHasActiveClass) {
      this.setEditorActiveClass(true);
      this.cachedEditorHasActiveClass = true;
    }
    
    // Verify class is actually present (DOM check)
    if (!hasClass(this.editorView.dom, 'smooth-cursor-active')) {
      addClass(this.editorView.dom, 'smooth-cursor-active');
      this.cachedEditorHasActiveClass = true;
    }
  }

  /**
   * Set or remove 'smooth-cursor-active' class on editor
   */
  setEditorActiveClass(active: boolean): void {
    if (!this.editorView || !this.editorView.dom) return;
    
    try {
      if (active) {
        if (!hasClass(this.editorView.dom, 'smooth-cursor-active')) {
          addClass(this.editorView.dom, 'smooth-cursor-active');
          this.cachedEditorHasActiveClass = true;
        }
      } else {
        if (hasClass(this.editorView.dom, 'smooth-cursor-active')) {
          this.editorView.dom.classList.remove('smooth-cursor-active');
          this.cachedEditorHasActiveClass = false;
        }
      }
    } catch (e) {
      // Silently handle errors
    }
  }

  /**
   * Get current editor view
   */
  getEditorView(): EditorView | null {
    return this.editorView;
  }
}

