import { EditorView } from '@codemirror/view';
import type ObVidePlugin from './main';
import type { AnimationEngine } from './animation';
import type { CursorPosition, CursorShape, VimMode } from './types';

/**
 * CursorRenderer - Manages custom cursor rendering in CodeMirror editors
 */
export class CursorRenderer {
  private plugin: ObVidePlugin;
  private animationEngine: AnimationEngine;
  private editorView: EditorView | null = null;
  private cursorEl: HTMLDivElement | null = null;
  private containerEl: HTMLDivElement | null = null;
  private isAttached = false;
  private updateScheduled = false;
  private lastCursorPos = -1;
  private modeUnsubscribe: (() => void) | null = null;
  private rafId: number | null = null;
  private refreshIntervalId: number | null = null;
  private lastSuccessfulCoords: { left: number; top: number } | null = null;
  private scrollHandler: (() => void) | null = null;
  private isScrolling = false;
  private scrollTimeout: number | null = null;

  constructor(plugin: ObVidePlugin, animationEngine: AnimationEngine) {
    this.plugin = plugin;
    this.animationEngine = animationEngine;
    
    // Set up animation frame callback
    this.animationEngine.setOnFrame((pos) => this.applyCursorPosition(pos));
    
    // Listen for vim mode changes
    this.modeUnsubscribe = this.plugin.vimState?.onModeChange((mode) => {
      this.updateCursorShape(mode);
    }) ?? null;
  }

  /**
   * Attach cursor renderer to an EditorView
   */
  attach(editorView: EditorView) {
    if (this.editorView === editorView && this.isAttached && this.cursorEl?.isConnected) {
      // Already attached to this editor and cursor exists
      return;
    }

    this.detach();
    this.editorView = editorView;
    
    // Create cursor elements
    this.createCursorElements();
    
    // Add active class to editor (for hiding native cursor)
    editorView.dom.classList.add('obvide-active');
    
    // Setup cursor position tracking
    this.setupCursorTracking();
    
    // Setup scroll event listener for immediate position updates during scroll
    this.setupScrollListener();
    
    this.isAttached = true;
    this.plugin.debug('CursorRenderer attached, cursor element:', !!this.cursorEl);
    
    // Initial cursor position update
    this.scheduleUpdate();
  }

  /**
   * Setup scroll event listener
   */
  private setupScrollListener() {
    if (!this.editorView) return;
    
    this.scrollHandler = () => {
      // Mark as scrolling
      this.isScrolling = true;
      
      // Clear previous timeout
      if (this.scrollTimeout !== null) {
        clearTimeout(this.scrollTimeout);
      }
      
      // During scroll, update position immediately without animation
      // Only if editor is focused
      if (this.isEditorFocused()) {
        this.updatePositionImmediate();
      }
      
      // Set timeout to mark end of scroll
      this.scrollTimeout = window.setTimeout(() => {
        this.isScrolling = false;
        // Final position update after scroll ends
        if (this.isEditorFocused()) {
          this.scheduleUpdate();
        }
      }, 150);
    };
    
    this.editorView.scrollDOM.addEventListener('scroll', this.scrollHandler, { passive: true });
  }

  /**
   * Update cursor position immediately (no animation) - used during scroll
   */
  private updatePositionImmediate() {
    if (!this.editorView || !this.cursorEl) return;
    
    // Don't update if editor not focused
    if (!this.isEditorFocused()) {
      this.hideCursor();
      return;
    }

    const sel = this.editorView.state.selection.main;
    const pos = sel.head;

    try {
      const coords = this.getCursorCoords(pos);
      if (!coords) {
        this.hideCursor();
        return;
      }

      const charWidth = this.measureCharacterWidth(pos);
      const lineHeight = this.editorView.defaultLineHeight;

      // Check bounds - cursor must be within visible scroll area
      const scrollRect = this.editorView.scrollDOM.getBoundingClientRect();
      
      // If coords are outside visible area, hide cursor completely
      if (coords.top < scrollRect.top || 
          coords.top > scrollRect.bottom - lineHeight ||
          coords.left < scrollRect.left ||
          coords.left > scrollRect.right - charWidth) {
        this.hideCursor();
        return;
      }

      // Position is valid - show and update
      this.cursorEl.style.left = `${coords.left}px`;
      this.cursorEl.style.top = `${coords.top}px`;
      this.cursorEl.style.width = `${charWidth}px`;
      this.cursorEl.style.height = `${lineHeight}px`;
      this.showCursor();
      
      // Sync animation engine
      this.animationEngine.setImmediate({
        x: coords.left,
        y: coords.top,
        width: charWidth,
        height: lineHeight,
      });
    } catch {
      this.hideCursor();
    }
  }

  /**
   * Detach from current editor
   */
  detach() {
    // Remove scroll listener
    if (this.editorView && this.scrollHandler) {
      this.editorView.scrollDOM.removeEventListener('scroll', this.scrollHandler);
      this.scrollHandler = null;
    }
    
    if (this.editorView) {
      this.editorView.dom.classList.remove('obvide-active');
    }
    
    // Clean up RAF and intervals
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.refreshIntervalId !== null) {
      clearInterval(this.refreshIntervalId);
      this.refreshIntervalId = null;
    }
    if (this.scrollTimeout !== null) {
      clearTimeout(this.scrollTimeout);
      this.scrollTimeout = null;
    }
    
    // Hide cursor instead of removing it (faster re-attach)
    this.hideCursor();
    
    this.editorView = null;
    this.isAttached = false;
    this.lastCursorPos = -1;
    this.lastSuccessfulCoords = null;
    this.isScrolling = false;
  }

  /**
   * Hide the cursor element
   */
  private hideCursor() {
    if (this.cursorEl) {
      this.cursorEl.style.display = 'none';
      // Move cursor off-screen to prevent any flash when showing again
      this.cursorEl.style.left = '-9999px';
      this.cursorEl.style.top = '-9999px';
    }
  }

  /**
   * Show the cursor element (position must be set before calling this)
   */
  private showCursor() {
    if (this.cursorEl) {
      this.cursorEl.style.display = 'block';
    }
  }

  /**
   * Clean up all resources
   */
  destroy() {
    this.modeUnsubscribe?.();
    this.modeUnsubscribe = null;
    this.detach();
  }

  /**
   * Force an update of cursor position
   */
  forceUpdate() {
    this.lastCursorPos = -1;
    this.scheduleUpdate();
  }

  private createCursorElements() {
    if (!this.editorView) return;

    // Remove any existing cursor element first
    if (this.cursorEl) {
      this.cursorEl.remove();
      this.cursorEl = null;
    }

    // Also remove any orphaned cursor elements in body
    document.querySelectorAll('.obvide-cursor').forEach(el => el.remove());

    // Create cursor element directly - no container needed
    // Attach to document.body with fixed positioning for simplest calculation
    this.cursorEl = document.createElement('div');
    this.cursorEl.className = 'obvide-cursor';
    this.cursorEl.dataset.editorId = this.getEditorId();
    this.cursorEl.style.cssText = `
      position: fixed !important;
      display: block !important;
      pointer-events: none !important;
      z-index: 10000 !important;
      background-color: ${this.plugin.settings.cursorColor} !important;
      opacity: ${this.plugin.settings.cursorOpacity} !important;
      border-radius: 1px;
    `;
    
    // Set initial shape based on current mode
    this.updateCursorShape(this.plugin.getVimMode());
    
    // Append directly to body - completely outside editor DOM
    document.body.appendChild(this.cursorEl);
    
    // Mark editor as active (for hiding native cursor)
    this.editorView.dom.classList.add('obvide-active');
    
    this.plugin.debug('Cursor element created and appended to body');
  }

  /**
   * Get a unique identifier for the current editor
   */
  private getEditorId(): string {
    return `obvide-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private removeCursorElements() {
    this.cursorEl?.remove();
    this.cursorEl = null;
    this.containerEl?.remove();
    this.containerEl = null;
  }

  private setupCursorTracking() {
    if (!this.editorView) return;

    // Watch for selection changes using EditorView's update mechanism
    // We'll poll for changes since we can't easily add an extension
    const pollCursor = () => {
      if (!this.isAttached || !this.editorView) {
        this.plugin.debug('Poll stopped: isAttached=', this.isAttached, 'editorView=', !!this.editorView);
        this.rafId = null;
        return;
      }
      
      // Check if editor has focus - hide cursor if not focused
      if (!this.isEditorFocused()) {
        this.hideCursor();
        this.rafId = requestAnimationFrame(pollCursor);
        return;
      }
      
      // Ensure editor has active class (to hide native cursor)
      if (!this.editorView.dom.classList.contains('obvide-active')) {
        this.editorView.dom.classList.add('obvide-active');
      }
      
      // Check if cursor element still exists in DOM
      if (!this.cursorEl || !this.cursorEl.isConnected) {
        this.plugin.debug('Cursor element missing or disconnected, recreating...');
        this.createCursorElements();
      }
      
      const sel = this.editorView.state.selection.main;
      const cursorPos = sel.head;
      
      // Always update if lastCursorPos is -1 (forced update) or position changed
      if (this.lastCursorPos === -1 || cursorPos !== this.lastCursorPos) {
        this.lastCursorPos = cursorPos;
        this.scheduleUpdate();
      }
      
      this.rafId = requestAnimationFrame(pollCursor);
    };
    
    this.rafId = requestAnimationFrame(pollCursor);
    
    // Also set up a periodic refresh to catch any edge cases
    // This runs less frequently to avoid interference with scroll
    this.refreshIntervalId = window.setInterval(() => {
      if (this.isAttached && this.editorView) {
        // Skip during scrolling - scroll handler takes care of updates
        if (this.isScrolling) {
          return;
        }
        
        // Only process if editor is focused
        if (!this.isEditorFocused()) {
          this.hideCursor();
          return;
        }
        
        // Ensure editor has active class (to hide native cursor)
        if (!this.editorView.dom.classList.contains('obvide-active')) {
          this.editorView.dom.classList.add('obvide-active');
        }
        
        // Check cursor element health and recreate if needed
        if (!this.cursorEl || !this.cursorEl.isConnected) {
          this.plugin.debug('Interval check: cursor element missing, recreating...');
          this.createCursorElements();
        }
        
        // Force a position recalculation
        this.scheduleUpdate();
      }
    }, 300);
  }

  /**
   * Check if the editor has focus
   */
  private isEditorFocused(): boolean {
    if (!this.editorView) return false;
    
    // Check if the editor DOM or any of its children has focus
    const editorDom = this.editorView.dom;
    const activeElement = document.activeElement;
    
    if (!activeElement) return false;
    
    // Check if active element is within the editor
    return editorDom.contains(activeElement) || editorDom === activeElement;
  }

  /**
   * Recreate cursor element if it was removed from DOM
   */
  private recreateCursorElement() {
    if (!this.editorView) return;
    
    // Remove old elements if they exist
    this.removeCursorElements();
    
    // Recreate
    this.createCursorElements();
    this.plugin.debug('Cursor element recreated');
  }

  /**
   * Ensure cursor element exists and editor has active class
   * Does NOT force cursor visible - that's handled by position update
   */
  private ensureCursorHealth() {
    if (!this.cursorEl || !this.cursorEl.isConnected) {
      this.recreateCursorElement();
      return;
    }
    
    // Ensure editor has active class (to hide native cursor)
    if (this.editorView && !this.editorView.dom.classList.contains('obvide-active')) {
      this.editorView.dom.classList.add('obvide-active');
    }
  }

  private scheduleUpdate() {
    if (this.updateScheduled) return;
    this.updateScheduled = true;
    
    requestAnimationFrame(() => {
      this.updateScheduled = false;
      this.updateCursorPosition();
    });
  }

  private updateCursorPosition() {
    // Detailed logging for debugging
    if (!this.editorView) {
      this.plugin.debug('updateCursorPosition: no editorView');
      return;
    }
    if (!this.cursorEl) {
      this.plugin.debug('updateCursorPosition: no cursorEl');
      return;
    }
    if (!this.cursorEl.isConnected) {
      this.plugin.debug('updateCursorPosition: cursorEl not connected to DOM');
      this.recreateCursorElement();
      return;
    }

    // Ensure editor has active class (to hide native cursor)
    if (!this.editorView.dom.classList.contains('obvide-active')) {
      this.editorView.dom.classList.add('obvide-active');
    }

    const sel = this.editorView.state.selection.main;
    const pos = sel.head;
    const line = this.editorView.state.doc.lineAt(pos);

    try {
      // Get cursor coordinates from CodeMirror (these are screen coordinates)
      let coords = this.getCursorCoords(pos);
      
      if (!coords) {
        this.plugin.debug('Could not get coords for position:', pos, 'line:', line.number);
        this.hideCursor();
        return;
      }

      // Calculate character width at cursor position
      const charWidth = this.measureCharacterWidth(pos);
      
      // Get line height
      const lineHeight = this.editorView.defaultLineHeight;

      // Check if cursor is within visible editor bounds
      const scrollRect = this.editorView.scrollDOM.getBoundingClientRect();

      // Cursor must be fully within visible scroll area
      const isOutsideView = 
        coords.top < scrollRect.top ||
        coords.top > scrollRect.bottom - lineHeight ||
        coords.left < scrollRect.left ||
        coords.left > scrollRect.right - charWidth;

      if (isOutsideView) {
        this.hideCursor();
        return;
      }

      // Use screen coordinates directly (cursor uses position: fixed)
      const targetPosition: CursorPosition = {
        x: coords.left,
        y: coords.top,
        width: charWidth,
        height: lineHeight,
      };

      // Validate position
      if (isNaN(targetPosition.x) || isNaN(targetPosition.y)) {
        this.plugin.debug('Invalid position calculated:', targetPosition);
        this.hideCursor();
        return;
      }

      // During scrolling, set position immediately without animation
      if (this.isScrolling) {
        // Set position first, then show
        if (this.cursorEl) {
          this.cursorEl.style.left = `${targetPosition.x}px`;
          this.cursorEl.style.top = `${targetPosition.y}px`;
          this.cursorEl.style.width = `${targetPosition.width}px`;
          this.cursorEl.style.height = `${targetPosition.height}px`;
        }
        this.animationEngine.setImmediate(targetPosition);
        this.showCursor();
      } else {
        this.showCursor();
        this.animationEngine.animateTo(targetPosition);
      }
      
    } catch (e) {
      this.plugin.debug('Error updating cursor position:', e, 'at pos:', pos, 'line:', line.number);
      this.hideCursor();
    }
  }

  /**
   * Get cursor coordinates with multiple fallback strategies
   */
  private getCursorCoords(pos: number): { left: number; top: number } | null {
    if (!this.editorView) return null;

    // Helper to save successful coordinates
    const saveAndReturn = (coords: { left: number; top: number }, strategyName: string) => {
      this.lastSuccessfulCoords = coords;
      this.plugin.debug(`${strategyName} succeeded at pos ${pos}`);
      return coords;
    };

    // Strategy 1: Try with side: 1 (after character)
    let coords = this.editorView.coordsAtPos(pos, 1);
    if (coords) {
      return saveAndReturn(coords, 'Strategy 1 (side:1)');
    }

    // Strategy 2: Try with side: -1 (before character)
    coords = this.editorView.coordsAtPos(pos, -1);
    if (coords) {
      return saveAndReturn(coords, 'Strategy 2 (side:-1)');
    }

    // Strategy 3: No side parameter
    coords = this.editorView.coordsAtPos(pos);
    if (coords) {
      return saveAndReturn(coords, 'Strategy 3 (no side)');
    }

    // Strategy 4: Use native CM cursor position (most reliable fallback)
    const nativeCursorCoords = this.getNativeCursorPosition();
    if (nativeCursorCoords) {
      return saveAndReturn(nativeCursorCoords, 'Strategy 4 (native cursor)');
    }

    // Strategy 5: For empty lines, try to get the line block's position
    try {
      const lineBlock = this.editorView.lineBlockAt(pos);
      
      if (lineBlock) {
        // Get the content area
        const contentRect = this.editorView.contentDOM.getBoundingClientRect();
        const scrollTop = this.editorView.scrollDOM.scrollTop;
        
        // lineBlock.top is in document coordinates (pixels from top of document)
        // Convert to screen coordinates
        return saveAndReturn({
          left: contentRect.left,
          top: contentRect.top + lineBlock.top - scrollTop,
        }, 'Strategy 5 (lineBlock)');
      }
    } catch {
      // Fallback failed
    }

    // Strategy 6: Try to find the line element in DOM and get its position
    try {
      const line = this.editorView.state.doc.lineAt(pos);
      const lineEl = this.editorView.domAtPos(line.from);
      
      if (lineEl && lineEl.node) {
        let element: Element | null = null;
        
        if (lineEl.node instanceof Element) {
          element = lineEl.node;
        } else if (lineEl.node.parentElement) {
          element = lineEl.node.parentElement;
        }
        
        if (element) {
          const rect = element.getBoundingClientRect();
          return saveAndReturn({
            left: rect.left,
            top: rect.top,
          }, 'Strategy 6 (domAtPos)');
        }
      }
    } catch {
      // Fallback failed
    }

    // Strategy 7: Use last known position from animation state
    // (these are already screen coordinates since we use fixed positioning)
    const lastPos = this.animationEngine.getCurrentPosition();
    if (lastPos.x > 0 || lastPos.y > 0) {
      this.plugin.debug('Strategy 7 (last animation position) used');
      return {
        left: lastPos.x,
        top: lastPos.y,
      };
    }

    // Strategy 8: Use last successful coordinates if available
    if (this.lastSuccessfulCoords) {
      this.plugin.debug('Strategy 8 (last successful coords) used');
      return this.lastSuccessfulCoords;
    }

    this.plugin.debug('All strategies failed for pos:', pos);
    return null;
  }

  /**
   * Get the native CodeMirror cursor position from DOM
   * This is reliable because CM's cursor always renders correctly
   */
  private getNativeCursorPosition(): { left: number; top: number } | null {
    if (!this.editorView) return null;

    try {
      // Find the native cursor element (it's hidden by CSS but still in DOM)
      const cursorLayer = this.editorView.dom.querySelector('.cm-cursorLayer');
      if (cursorLayer) {
        const nativeCursor = cursorLayer.querySelector('.cm-cursor, .cm-cursor-primary');
        if (nativeCursor) {
          // Temporarily make it visible to get accurate position
          const originalStyle = (nativeCursor as HTMLElement).style.cssText;
          (nativeCursor as HTMLElement).style.cssText = 'visibility: visible !important; opacity: 0 !important;';
          
          const rect = nativeCursor.getBoundingClientRect();
          
          // Restore original style
          (nativeCursor as HTMLElement).style.cssText = originalStyle;
          
          if (rect.width > 0 || rect.height > 0) {
            return {
              left: rect.left,
              top: rect.top,
            };
          }
        }
      }
    } catch (e) {
      this.plugin.debug('Error getting native cursor position:', e);
    }

    return null;
  }

  /**
   * Measure the width of the character at the given position
   * This correctly handles CJK characters and other wide characters
   */
  private measureCharacterWidth(pos: number): number {
    if (!this.editorView) return 8; // fallback width

    const doc = this.editorView.state.doc;
    const docLength = doc.length;
    
    // Handle edge case: position at or beyond document end
    if (pos >= docLength) {
      return this.getDefaultCharWidth();
    }
    
    const line = doc.lineAt(pos);
    const lineText = line.text;
    const offsetInLine = pos - line.from;
    
    // Get the character at cursor position
    const char = lineText[offsetInLine];
    
    // Empty line or at end of line
    if (!char || lineText.length === 0) {
      return this.getDefaultCharWidth();
    }

    try {
      // Use coordsAtPos to measure actual rendered width
      // Make sure we don't go beyond the document
      const nextPos = Math.min(pos + 1, docLength);
      
      if (nextPos > pos) {
        const startCoords = this.editorView.coordsAtPos(pos, 1);
        const endCoords = this.editorView.coordsAtPos(nextPos, -1);
        
        if (startCoords && endCoords) {
          const width = endCoords.left - startCoords.left;
          if (width > 0) {
            return width;
          }
        }
      }
    } catch {
      // Fallback if coords measurement fails
    }

    // Fallback: estimate based on character type
    return this.estimateCharWidth(char);
  }

  /**
   * Estimate character width based on character type
   */
  private estimateCharWidth(char: string): number {
    const defaultWidth = this.getDefaultCharWidth();
    
    // Check if it's a CJK character (Chinese, Japanese, Korean)
    const cjkRanges = [
      [0x4E00, 0x9FFF],   // CJK Unified Ideographs
      [0x3400, 0x4DBF],   // CJK Unified Ideographs Extension A
      [0x3000, 0x303F],   // CJK Symbols and Punctuation
      [0xFF00, 0xFFEF],   // Halfwidth and Fullwidth Forms
      [0xAC00, 0xD7AF],   // Korean Hangul Syllables
      [0x3040, 0x309F],   // Hiragana
      [0x30A0, 0x30FF],   // Katakana
    ];

    const code = char.charCodeAt(0);
    for (const [start, end] of cjkRanges) {
      if (code >= start && code <= end) {
        return defaultWidth * 2; // CJK characters are typically double-width
      }
    }

    // Check for emoji (basic detection)
    if (code > 0x1F000) {
      return defaultWidth * 2;
    }

    return defaultWidth;
  }

  /**
   * Get default character width from the editor
   */
  private getDefaultCharWidth(): number {
    if (!this.editorView) return 8;
    return this.editorView.defaultCharacterWidth || 8;
  }

  /**
   * Update cursor shape based on vim mode
   */
  private updateCursorShape(mode: VimMode) {
    if (!this.cursorEl) return;

    const shape = this.plugin.settings.cursorShapes[mode];
    
    // Ensure cursor is visible
    this.cursorEl.style.display = 'block';
    this.cursorEl.style.visibility = 'visible';
    
    // Store current shape for use in applyCursorPosition
    this.cursorEl.dataset.shape = shape;
    
    // Update blink state (only blink in insert mode)
    if (mode === 'insert') {
      this.cursorEl.style.animation = 'obvide-blink 1s ease-in-out infinite';
    } else {
      this.cursorEl.style.animation = 'none';
    }

    this.plugin.debug('Cursor shape updated to:', shape, 'for mode:', mode);
    
    // Force position update to apply new dimensions
    setTimeout(() => {
      this.forceUpdate();
    }, 0);
  }

  /**
   * Apply cursor position from animation
   */
  private applyCursorPosition(pos: CursorPosition) {
    if (!this.cursorEl) return;

    const shape = (this.cursorEl.dataset.shape || 'block') as CursorShape;
    
    // Calculate actual dimensions based on shape
    let width = pos.width;
    let height = pos.height;
    let yOffset = 0;
    
    switch (shape) {
      case 'line':
        width = 2;
        break;
      case 'underline':
        height = 2;
        yOffset = pos.height - 2;
        break;
      case 'block':
      default:
        // Use full character width and height
        break;
    }

    // Use left/top for fixed positioning (screen coordinates)
    this.cursorEl.style.left = `${pos.x}px`;
    this.cursorEl.style.top = `${pos.y + yOffset}px`;
    this.cursorEl.style.width = `${width}px`;
    this.cursorEl.style.height = `${height}px`;
  }
}

// Access to VimStateProvider from main plugin
declare module './main' {
  interface ObVidePlugin {
    vimState: import('./vim-state').VimStateProvider | null;
  }
}

