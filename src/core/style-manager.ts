import type { SmoothCursorSettings } from '../types';

/**
 * Style manager for cursor CSS styles
 */
export class StyleManager {
  private styleEl: HTMLStyleElement | null = null;

  /**
   * Inject styles into document head
   */
  injectStyles(settings: SmoothCursorSettings): void {
    if (this.styleEl) {
      this.styleEl.remove();
    }

    this.styleEl = document.createElement('style');
    this.styleEl.id = 'smooth-cursor-styles';
    this.styleEl.textContent = this.generateStyles(settings);
    document.head.appendChild(this.styleEl);
  }

  /**
   * Update styles when settings change
   */
  updateStyles(settings: SmoothCursorSettings): void {
    if (this.styleEl) {
      this.styleEl.textContent = this.generateStyles(settings);
    }
  }

  /**
   * Remove styles from document
   */
  removeStyles(): void {
    if (this.styleEl) {
      this.styleEl.remove();
      this.styleEl = null;
    }
  }

  /**
   * Generate CSS styles from settings
   */
  private generateStyles(settings: SmoothCursorSettings): string {
    const { cursorColor, cursorOpacity, animationDuration, enableBreathingAnimation, breathingAnimationDuration, breathingMinOpacity } = settings;
    // Convert animation duration from ms to seconds for CSS
    const transitionDuration = animationDuration / 1000;
    
    return `
      /* Hide native cursor when Smooth Cursor is active - CodeMirror 6 */
      /* Use visibility:hidden instead of display:none so we can still read position from DOM */
      .smooth-cursor-active .cm-cursor,
      .smooth-cursor-active .cm-cursor-primary,
      .smooth-cursor-active .cm-cursor-secondary {
        visibility: hidden !important;
        opacity: 0 !important;
        border-left-color: transparent !important;
        border-color: transparent !important;
        background: transparent !important;
      }
      
      /* Keep cursor layer in DOM but make cursors invisible */
      .smooth-cursor-active .cm-cursorLayer {
        /* Don't use display:none - keep in DOM for position reference */
        pointer-events: none;
      }
      
      .smooth-cursor-active .cm-content {
        caret-color: transparent !important;
      }
      
      /* Ensure text selection is still visible but cursor is hidden */
      .smooth-cursor-active .cm-selectionBackground {
        /* Keep selection visible */
      }

      /* Smooth Cursor cursor container */
      .smooth-cursor {
        position: absolute;
        pointer-events: none;
        z-index: 100;
        background-color: ${cursorColor};
        border-radius: 1px;
        will-change: transform, width, height, opacity;
        transition: background-color 0.15s ease;
        /* Note: opacity is set dynamically to allow animation override */
        /* Note: width/height transitions removed - handled by JavaScript animation engine */
      }
      
      /* Set default opacity only when not breathing */
      .smooth-cursor:not(.breathing) {
        opacity: ${cursorOpacity};
      }

      .smooth-cursor.block {
        /* Block cursor - full character width */
      }

      .smooth-cursor.line {
        width: 2px !important;
      }

      .smooth-cursor.underline {
        height: 2px !important;
        bottom: 0;
      }

      /* Cursor blink animation */
      @keyframes smooth-cursor-blink {
        0%, 100% { opacity: ${cursorOpacity}; }
        50% { opacity: ${cursorOpacity * 0.3}; }
      }

      .smooth-cursor.blink {
        animation: smooth-cursor-blink 1s ease-in-out infinite;
      }

      /* Breathing animation - smooth pulse effect */
      @keyframes smooth-cursor-breathe {
        0%, 100% { 
          opacity: ${cursorOpacity}; 
        }
        50% { 
          opacity: ${Math.max(breathingMinOpacity, 0.1)}; 
        }
      }

      .smooth-cursor.breathing {
        animation: smooth-cursor-breathe ${breathingAnimationDuration}s ease-in-out infinite !important;
      }
      
      /* Ensure .moving class overrides .breathing animation - higher specificity */
      .smooth-cursor.breathing.moving {
        animation: none !important;
        opacity: var(--smooth-cursor-opacity, ${cursorOpacity}) !important;
      }

      /* Non-editor cursor styles */
      /* Breathing animation is disabled for non-editor cursors to prevent flickering */
      .smooth-cursor-non-editor {
        position: absolute;
        pointer-events: none;
        z-index: 1000;
        background-color: ${cursorColor};
        opacity: ${cursorOpacity};
        animation: none !important;
      }
    `;
  }
}

