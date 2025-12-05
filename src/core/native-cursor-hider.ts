import { EditorView } from '@codemirror/view';

/**
 * Native cursor hider - directly manipulates native cursor elements
 * to prevent flash during focus transitions
 */
export class NativeCursorHider {
  private editorView: EditorView | null = null;
  private observer: MutationObserver | null = null;
  private isActive = false;

  /**
   * Attach to an EditorView and start hiding native cursors
   */
  attach(editorView: EditorView): void {
    this.detach();
    this.editorView = editorView;
    this.isActive = true;
    
    // Immediately hide any existing native cursors
    this.hideNativeCursors();
    
    // Set up MutationObserver to hide native cursors as they appear
    this.setupObserver();
  }

  /**
   * Detach from current editor
   */
  detach(): void {
    this.isActive = false;
    
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    
    // Restore native cursors when detaching
    if (this.editorView) {
      this.restoreNativeCursors();
    }
    
    this.editorView = null;
  }

  /**
   * Hide all native cursor elements in the editor
   */
  private hideNativeCursors(): void {
    if (!this.editorView) return;

    const editorDom = this.editorView.dom;
    const cursors = editorDom.querySelectorAll('.cm-cursor, .cm-cursor-primary, .cm-cursor-secondary');
    
    for (let i = 0; i < cursors.length; i++) {
      const el = cursors[i] as HTMLElement;
      // Use inline styles with !important to override any CSS
      el.style.setProperty('visibility', 'hidden', 'important');
      el.style.setProperty('opacity', '0', 'important');
      el.style.setProperty('border-left-color', 'transparent', 'important');
      el.style.setProperty('border-color', 'transparent', 'important');
      el.style.setProperty('background', 'transparent', 'important');
    }
    
    // Also hide caret
    const content = editorDom.querySelector('.cm-content');
    if (content) {
      (content as HTMLElement).style.setProperty('caret-color', 'transparent', 'important');
    }
  }

  /**
   * Restore native cursor elements (when detaching)
   */
  private restoreNativeCursors(): void {
    if (!this.editorView) return;

    const editorDom = this.editorView.dom;
    const cursors = editorDom.querySelectorAll('.cm-cursor, .cm-cursor-primary, .cm-cursor-secondary');
    
    for (let i = 0; i < cursors.length; i++) {
      const el = cursors[i] as HTMLElement;
      el.style.removeProperty('visibility');
      el.style.removeProperty('opacity');
      el.style.removeProperty('border-left-color');
      el.style.removeProperty('border-color');
      el.style.removeProperty('background');
    }
    
    const content = editorDom.querySelector('.cm-content');
    if (content) {
      (content as HTMLElement).style.removeProperty('caret-color');
    }
  }

  /**
   * Set up MutationObserver to monitor for new cursor elements
   */
  private setupObserver(): void {
    if (!this.editorView) return;

    this.observer = new MutationObserver((mutations) => {
      if (!this.isActive) return;

      let shouldHide = false;
      
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          // Check if any added nodes are cursor elements
          const addedNodes = mutation.addedNodes;
          for (let i = 0; i < addedNodes.length; i++) {
            const node = addedNodes[i];
            if (node.nodeType === Node.ELEMENT_NODE) {
              const el = node as HTMLElement;
              if (el.classList.contains('cm-cursor') || 
                  el.classList.contains('cm-cursor-primary') || 
                  el.classList.contains('cm-cursor-secondary') ||
                  el.querySelector('.cm-cursor, .cm-cursor-primary, .cm-cursor-secondary')) {
                shouldHide = true;
                break;
              }
            }
          }
        } else if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          // Check if class change made an element a cursor
          const target = mutation.target as HTMLElement;
          if (target.classList.contains('cm-cursor') || 
              target.classList.contains('cm-cursor-primary') || 
              target.classList.contains('cm-cursor-secondary')) {
            shouldHide = true;
          }
        }
        
        if (shouldHide) break;
      }
      
      if (shouldHide) {
        // Use requestAnimationFrame to ensure DOM is ready
        requestAnimationFrame(() => {
          if (this.isActive) {
            this.hideNativeCursors();
          }
        });
      }
    });

    // Observe the entire editor DOM for changes
    this.observer.observe(this.editorView.dom, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
    
    // Also periodically check (as a fallback)
    this.startPeriodicCheck();
  }

  /**
   * Start periodic check to ensure cursors stay hidden
   */
  private periodicCheckInterval: number | null = null;
  
  private startPeriodicCheck(): void {
    this.stopPeriodicCheck();
    
    this.periodicCheckInterval = window.setInterval(() => {
      if (this.isActive) {
        this.hideNativeCursors();
      } else {
        this.stopPeriodicCheck();
      }
    }, 100); // Check every 100ms
  }

  private stopPeriodicCheck(): void {
    if (this.periodicCheckInterval !== null) {
      clearInterval(this.periodicCheckInterval);
      this.periodicCheckInterval = null;
    }
  }

  /**
   * Force hide native cursors immediately
   */
  forceHide(): void {
    this.hideNativeCursors();
  }
}

