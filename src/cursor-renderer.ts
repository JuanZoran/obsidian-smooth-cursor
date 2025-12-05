import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import type SmoothCursorPlugin from './main';
import type { AnimationEngine } from './animation';
import type { CursorPosition, CursorShape, VimMode } from './types';
import { calculateCursorDimensions, isCursorInView } from './cursor-utils';

/**
 * Create a ViewPlugin that listens for cursor position changes
 * This provides immediate detection of cursor movement during typing
 */
function createCursorUpdatePlugin(onUpdate: (update: ViewUpdate) => void) {
  return ViewPlugin.fromClass(class {
    update(update: ViewUpdate) {
      // Trigger callback when document changes or selection changes
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        onUpdate(update);
      }
    }
  });
}

/**
 * CursorRenderer - Manages custom cursor rendering in CodeMirror editors
 * Optimized for performance with caching and throttled updates
 */
export class CursorRenderer {
  private plugin: SmoothCursorPlugin;
  private animationEngine: AnimationEngine;
  private editorView: EditorView | null = null;
  private cursorEl: HTMLDivElement | null = null;
  private isAttached = false;
  private updateScheduled = false;
  private lastCursorPos = -1;
  private modeUnsubscribe: (() => void) | null = null;
  private rafId: number | null = null;
  private lastSuccessfulCoords: { left: number; top: number } | null = null;
  private scrollHandler: (() => void) | null = null;
  private isScrolling = false;
  private scrollTimeout: number | null = null;
  private lastHealthCheckTime = 0;
  private isDestroyed = false;
  
  // Performance optimization: cached states
  private cachedEditorHasActiveClass = false;
  private cachedIsFocused = false;
  private lastFocusCheckTime = 0;
  private focusCheckInterval = 100; // Check focus every 100ms max
  private healthCheckInterval = 1000; // Reduced from 300ms to 1000ms
  private lastScrollUpdateTime = 0;
  private scrollThrottleInterval = 16; // ~60fps during scroll
  
  // Coordinate caching
  private coordsCache: Map<number, { coords: { left: number; top: number }; timestamp: number }> = new Map();
  private coordsCacheMaxAge = 50; // Cache valid for 50ms
  private coordsCacheMaxSize = 10;
  
  // Character width caching  
  private charWidthCache: Map<string, number> = new Map();
  
  // Transaction-based cursor tracking
  private cursorUpdatePlugin: ReturnType<typeof createCursorUpdatePlugin> | null = null;
  private lastDocChangeTime = 0;
  private isTyping = false;
  private typingTimeout: number | null = null;
  private lastUpdateWasTyping = false;

  constructor(plugin: SmoothCursorPlugin, animationEngine: AnimationEngine) {
    this.plugin = plugin;
    this.animationEngine = animationEngine;
    
    // Set up animation frame callback
    this.animationEngine.setOnFrame((pos) => this.applyCursorPosition(pos));
    
    // Set up movement callback for blink pause
    this.animationEngine.setOnMovement((isMoving) => this.handleMovementState(isMoving));
    
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
      return;
    }

    this.detach();
    this.editorView = editorView;
    
    // Create cursor elements
    this.createCursorElements();
    
    // Setup transaction listener for immediate cursor tracking during typing
    this.setupTransactionListener();
    
    // Setup scroll event listener for immediate position updates during scroll
    this.setupScrollListener();
    
    this.isAttached = true;
    
    // Force initial health check and class setup
    this.ensureCursorHealth();
    
    // Cache initial states
    this.cachedEditorHasActiveClass = true;
    this.cachedIsFocused = this.checkEditorFocused();
    
    // Setup cursor position tracking (optimized polling as fallback)
    this.setupCursorTracking();
    
    this.plugin.debug('CursorRenderer attached');
    
    // Initial cursor position update
    requestAnimationFrame(() => {
      if (this.isAttached && this.editorView) {
        this.scheduleUpdate();
      }
    });
  }

  /**
   * Setup CodeMirror transaction listener for immediate cursor tracking
   * This replaces polling for cursor position updates during typing
   */
  private setupTransactionListener() {
    if (!this.editorView) return;

    // Create the update plugin
    this.cursorUpdatePlugin = createCursorUpdatePlugin((update: ViewUpdate) => {
      if (!this.isAttached || !this.editorView) return;
      
      const now = performance.now();
      
      // Track if this is a typing action (document changed)
      if (update.docChanged) {
        this.lastDocChangeTime = now;
        this.isTyping = true;
        this.lastUpdateWasTyping = true;
        
        // Clear existing typing timeout
        if (this.typingTimeout !== null) {
          clearTimeout(this.typingTimeout);
        }
        
        // Set timeout to mark end of typing
        this.typingTimeout = window.setTimeout(() => {
          this.isTyping = false;
        }, 150);
      } else {
        this.lastUpdateWasTyping = false;
      }
      
      // Check if cursor position changed
      const sel = update.state.selection.main;
      const cursorPos = sel.head;
      
      if (cursorPos !== this.lastCursorPos) {
        this.lastCursorPos = cursorPos;
        
        // Clear coordinate cache on position change
        this.coordsCache.clear();
        
        // Update cursor immediately with typing context
        this.updateCursorPositionWithContext(this.lastUpdateWasTyping);
      }
    });

    // Note: We can't dynamically add extensions to an existing EditorView in CM6
    // The plugin is created but we still use the polling mechanism as fallback
    // The transaction listener is primarily for detecting typing vs movement
    this.plugin.debug('Transaction listener created');
  }

  /**
   * Update cursor position with typing context for animation optimization
   * Ensures smooth dimension transitions when cursor shape changes
   */
  private updateCursorPositionWithContext(isTyping: boolean) {
    if (!this.editorView || !this.cursorEl || !this.cursorEl.isConnected) {
      if (!this.cursorEl?.isConnected) {
        this.ensureCursorHealth();
      }
      return;
    }

    const sel = this.editorView.state.selection.main;
    const pos = sel.head;

    try {
      const coords = this.getCursorCoordsCached(pos);
      
      if (!coords) {
        return;
      }

      const charWidth = this.measureCharacterWidthCached(pos);
      const lineHeight = this.editorView.defaultLineHeight;

      if (isNaN(coords.left) || isNaN(coords.top) || !isFinite(coords.left) || !isFinite(coords.top)) {
        return;
      }

      // Base position with character dimensions
      const basePosition: CursorPosition = {
        x: coords.left,
        y: coords.top,
        width: charWidth,
        height: lineHeight,
      };

      if (isNaN(basePosition.x) || isNaN(basePosition.y)) {
        this.hideCursor();
        return;
      }

      if (this.cursorEl) {
        this.showCursor();
        
        // Get current shape to calculate target dimensions
        const shape = (this.cursorEl.dataset.shape || 'block') as CursorShape;
        const { width: targetWidth, height: targetHeight } = calculateCursorDimensions(basePosition, shape);
        
        // Create target position with shape-adjusted dimensions for smooth animation
        const targetPosition: CursorPosition = {
          x: basePosition.x,
          y: basePosition.y,
          width: targetWidth,
          height: targetHeight,
        };
        
        if (this.isScrolling) {
          // Use immediate positioning during scroll
          if (this.plugin.settings.useTransformAnimation) {
            this.cursorEl.style.transform = `translate(${targetPosition.x}px, ${targetPosition.y}px)`;
            this.cursorEl.style.left = '0';
            this.cursorEl.style.top = '0';
          } else {
            this.cursorEl.style.transform = 'none';
            this.cursorEl.style.left = `${targetPosition.x}px`;
            this.cursorEl.style.top = `${targetPosition.y}px`;
          }
          this.cursorEl.style.width = `${targetWidth}px`;
          this.cursorEl.style.height = `${targetHeight}px`;
          this.animationEngine.setImmediate(targetPosition);
        } else {
          const currentLeft = parseFloat(this.cursorEl.style.left || '0');
          const currentTop = parseFloat(this.cursorEl.style.top || '0');
          const wasHidden = (currentLeft <= -1000 || currentTop <= -1000) || 
                           this.cursorEl.style.display === 'none';
          
          if (wasHidden) {
            this.animationEngine.setImmediate(targetPosition);
            this.applyCursorPosition(targetPosition);
          } else {
            // Pass typing context to animation engine for adaptive lerp
            // Animation engine will smoothly interpolate dimensions
            this.animationEngine.animateTo(targetPosition, isTyping);
          }
        }
      }
      
    } catch (e) {
      this.hideCursor();
    }
  }

  /**
   * Setup scroll event listener with throttling
   */
  private setupScrollListener() {
    if (!this.editorView) return;
    
    this.scrollHandler = () => {
      this.isScrolling = true;
      
      // Clear previous timeout
      if (this.scrollTimeout !== null) {
        clearTimeout(this.scrollTimeout);
      }
      
      // Throttle scroll updates
      const now = performance.now();
      if (now - this.lastScrollUpdateTime >= this.scrollThrottleInterval) {
        this.lastScrollUpdateTime = now;
        if (this.cachedIsFocused) {
          this.updatePositionImmediate();
        }
      }
      
      // Set timeout to mark end of scroll
      this.scrollTimeout = window.setTimeout(() => {
        this.isScrolling = false;
        if (this.cachedIsFocused) {
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

    const sel = this.editorView.state.selection.main;
    const pos = sel.head;

    try {
      const coords = this.getCursorCoordsCached(pos);
      if (!coords) {
        this.hideCursor();
        return;
      }

      const charWidth = this.measureCharacterWidthCached(pos);
      const lineHeight = this.editorView.defaultLineHeight;

      if (isNaN(coords.left) || isNaN(coords.top)) {
        this.hideCursor();
        return;
      }
      
      this.showCursor();
      
      // Handle transform vs left/top positioning
      if (this.plugin.settings.useTransformAnimation) {
        this.cursorEl.style.transform = `translate(${coords.left}px, ${coords.top}px)`;
        this.cursorEl.style.left = '0';
        this.cursorEl.style.top = '0';
      } else {
        this.cursorEl.style.transform = 'none';
        this.cursorEl.style.left = `${coords.left}px`;
        this.cursorEl.style.top = `${coords.top}px`;
      }
      
      this.cursorEl.style.width = `${charWidth}px`;
      this.cursorEl.style.height = `${lineHeight}px`;
      
      this.animationEngine.setImmediate({
        x: coords.left,
        y: coords.top,
        width: charWidth,
        height: lineHeight,
      });
    } catch (e) {
      this.hideCursor();
    }
  }

  /**
   * Detach from current editor
   */
  detach() {
    if (this.editorView && this.scrollHandler) {
      this.editorView.scrollDOM.removeEventListener('scroll', this.scrollHandler);
      this.scrollHandler = null;
    }
    
    this.setEditorActiveClass(false);
    
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.scrollTimeout !== null) {
      clearTimeout(this.scrollTimeout);
      this.scrollTimeout = null;
    }
    if (this.typingTimeout !== null) {
      clearTimeout(this.typingTimeout);
      this.typingTimeout = null;
    }
    
    this.hideCursor();
    
    this.editorView = null;
    this.isAttached = false;
    this.lastCursorPos = -1;
    this.lastSuccessfulCoords = null;
    this.isScrolling = false;
    this.isTyping = false;
    this.lastUpdateWasTyping = false;
    this.cachedEditorHasActiveClass = false;
    this.cachedIsFocused = false;
    this.cursorUpdatePlugin = null;
    
    // Clear caches
    this.coordsCache.clear();
  }

  /**
   * Hide the cursor element
   */
  private hideCursor() {
    if (this.cursorEl) {
      this.cursorEl.style.display = 'none';
      this.cursorEl.style.left = '-9999px';
      this.cursorEl.style.top = '-9999px';
    }
  }

  /**
   * Show the cursor element
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
    this.isDestroyed = true;
    this.modeUnsubscribe?.();
    this.modeUnsubscribe = null;
    if (this.typingTimeout !== null) {
      clearTimeout(this.typingTimeout);
      this.typingTimeout = null;
    }
    this.detach();
    this.charWidthCache.clear();
  }

  /**
   * Force an update of cursor position
   */
  forceUpdate() {
    this.lastCursorPos = -1;
    this.coordsCache.clear(); // Clear cache on force update
    this.scheduleUpdate();
  }

  private createCursorElements() {
    if (!this.editorView) return;

    if (this.cursorEl) {
      this.cursorEl.remove();
      this.cursorEl = null;
    }

    document.querySelectorAll('.smooth-cursor').forEach(el => el.remove());

    this.setEditorActiveClass(true);
    this.cachedEditorHasActiveClass = true;

    this.cursorEl = document.createElement('div');
    this.cursorEl.className = 'smooth-cursor';
    this.cursorEl.dataset.editorId = this.getEditorId();
    
    // Add transform-mode class if enabled
    if (this.plugin.settings.useTransformAnimation) {
      this.cursorEl.classList.add('transform-mode');
    }
    
    this.cursorEl.style.cssText = `
      position: fixed !important;
      display: none !important;
      pointer-events: none !important;
      z-index: 10000 !important;
      background-color: ${this.plugin.settings.cursorColor} !important;
      opacity: ${this.plugin.settings.cursorOpacity} !important;
      border-radius: 1px;
      --smooth-cursor-opacity: ${this.plugin.settings.cursorOpacity};
    `;
    
    this.updateCursorShape(this.plugin.getVimMode());
    document.body.appendChild(this.cursorEl);
    
    this.plugin.debug('Cursor element created');
  }

  private getEditorId(): string {
    return `obvide-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private removeCursorElements() {
    this.cursorEl?.remove();
    this.cursorEl = null;
  }

  /**
   * Optimized polling mechanism - reduces CPU usage by:
   * 1. Throttling focus checks
   * 2. Reducing health check frequency
   * 3. Only updating on actual position changes
   */
  private setupCursorTracking() {
    if (!this.editorView) return;

    this.ensureCursorHealth();

    const pollCursor = () => {
      if (!this.isAttached || !this.editorView) {
        this.rafId = null;
        return;
      }
      
      const now = performance.now();
      
      // Throttled focus check (every 100ms instead of every frame)
      if (now - this.lastFocusCheckTime > this.focusCheckInterval) {
        this.lastFocusCheckTime = now;
        this.cachedIsFocused = this.checkEditorFocused();
      }
      
      // Reduced health check frequency (every 1000ms instead of 300ms)
      if (now - this.lastHealthCheckTime > this.healthCheckInterval) {
        this.lastHealthCheckTime = now;
        this.ensureCursorHealth();
      }
      
      // Hide cursor if not focused
      if (!this.cachedIsFocused) {
        this.hideCursor();
        this.rafId = requestAnimationFrame(pollCursor);
        return;
      }
      
      // Check for position changes
      const sel = this.editorView.state.selection.main;
      const cursorPos = sel.head;
      
      const needsUpdate = (
        this.lastCursorPos === -1 || 
        cursorPos !== this.lastCursorPos ||
        (this.cursorEl && this.cursorEl.style.display === 'none')
      );
      
      if (needsUpdate) {
        this.lastCursorPos = cursorPos;
        this.scheduleUpdate();
      }
      
      this.rafId = requestAnimationFrame(pollCursor);
    };
    
    this.rafId = requestAnimationFrame(pollCursor);
  }

  /**
   * Check if editor has focus (actual DOM check)
   */
  private checkEditorFocused(): boolean {
    if (!this.editorView) return false;
    
    const editorDom = this.editorView.dom;
    const activeElement = document.activeElement;
    
    if (!activeElement) return false;
    
    return editorDom.contains(activeElement) || editorDom === activeElement;
  }

  /**
   * Get cached focus state
   */
  private isEditorFocused(): boolean {
    return this.cachedIsFocused;
  }

  /**
   * Optimized health check - only checks when issues are likely
   */
  private ensureCursorHealth() {
    if (this.isScrolling) return;
    
    // Check and fix active class only if cached state says it should be there
    if (this.editorView && !this.cachedEditorHasActiveClass) {
      this.setEditorActiveClass(true);
      this.cachedEditorHasActiveClass = true;
    }
    
    // Verify class is actually present (DOM check)
    if (this.editorView && !this.editorView.dom.classList.contains('smooth-cursor-active')) {
      this.editorView.dom.classList.add('smooth-cursor-active');
      this.cachedEditorHasActiveClass = true;
    }
    
    // Check cursor element
    if (!this.cursorEl || !this.cursorEl.isConnected) {
      this.plugin.debug('Cursor element missing, recreating...');
      this.createCursorElements();
    }
  }

  /**
   * Set or remove 'obvide-active' class on editor
   */
  private setEditorActiveClass(active: boolean) {
    if (!this.editorView || !this.editorView.dom) return;
    
    try {
      if (active) {
        if (!this.editorView.dom.classList.contains('smooth-cursor-active')) {
          this.editorView.dom.classList.add('smooth-cursor-active');
          this.cachedEditorHasActiveClass = true;
        }
      } else {
        if (this.editorView.dom.classList.contains('smooth-cursor-active')) {
          this.editorView.dom.classList.remove('smooth-cursor-active');
          this.cachedEditorHasActiveClass = false;
        }
      }
    } catch (e) {
      // Silently handle errors
    }
  }

  private scheduleUpdate() {
    if (this.updateScheduled || this.isDestroyed) return;
    this.updateScheduled = true;
    
    requestAnimationFrame(() => {
      this.updateScheduled = false;
      if (!this.isDestroyed) {
        this.updateCursorPosition();
      }
    });
  }

  private updateCursorPosition() {
    // Delegate to context-aware method with current typing state
    this.updateCursorPositionWithContext(this.isTyping);
  }

  /**
   * Get cursor coordinates with caching to avoid expensive coordsAtPos calls
   */
  private getCursorCoordsCached(pos: number): { left: number; top: number } | null {
    const now = performance.now();
    
    // Check cache
    const cached = this.coordsCache.get(pos);
    if (cached && (now - cached.timestamp) < this.coordsCacheMaxAge) {
      return cached.coords;
    }
    
    // Get fresh coords
    const coords = this.getCursorCoords(pos);
    
    if (coords) {
      // Update cache
      this.coordsCache.set(pos, { coords, timestamp: now });
      
      // Limit cache size
      if (this.coordsCache.size > this.coordsCacheMaxSize) {
        const firstKey = this.coordsCache.keys().next().value;
        if (firstKey !== undefined) {
          this.coordsCache.delete(firstKey);
        }
      }
    }
    
    return coords;
  }

  /**
   * Get cursor coordinates with optimized fallback strategies
   */
  private getCursorCoords(pos: number): { left: number; top: number } | null {
    if (!this.editorView) return null;

    const saveAndReturn = (coords: { left: number; top: number }) => {
      this.lastSuccessfulCoords = coords;
      return coords;
    };

    // Strategy 1: Try with side: 1 (most common case)
    let coords = this.editorView.coordsAtPos(pos, 1);
    if (coords) {
      return saveAndReturn(coords);
    }

    // Strategy 2: Try with side: -1
    coords = this.editorView.coordsAtPos(pos, -1);
    if (coords) {
      return saveAndReturn(coords);
    }

    // Strategy 3: Use native CM cursor position (avoid style modification)
    const nativeCursorCoords = this.getNativeCursorPositionFast();
    if (nativeCursorCoords) {
      return saveAndReturn(nativeCursorCoords);
    }

    // Strategy 4: Use last successful coordinates
    if (this.lastSuccessfulCoords) {
      return this.lastSuccessfulCoords;
    }

    return null;
  }

  /**
   * Get native cursor position without style modification (faster)
   */
  private getNativeCursorPositionFast(): { left: number; top: number } | null {
    if (!this.editorView) return null;

    try {
      const nativeCursor = this.editorView.dom.querySelector('.cm-cursor, .cm-cursor-primary');
      if (nativeCursor) {
        const rect = nativeCursor.getBoundingClientRect();
        // Check if visible (not hidden by visibility:hidden)
        if (rect.width > 0 || rect.height > 0) {
          return { left: rect.left, top: rect.top };
        }
      }
    } catch (e) {
      // Silently handle errors
    }

    return null;
  }

  /**
   * Measure character width with caching
   */
  private measureCharacterWidthCached(pos: number): number {
    if (!this.editorView) return 8;

    const doc = this.editorView.state.doc;
    const docLength = doc.length;
    
    if (pos >= docLength) {
      return this.getDefaultCharWidth();
    }
    
    const line = doc.lineAt(pos);
    const offsetInLine = pos - line.from;
    const char = line.text[offsetInLine];
    
    if (!char || line.text.length === 0) {
      return this.getDefaultCharWidth();
    }

    // Check char width cache
    const cachedWidth = this.charWidthCache.get(char);
    if (cachedWidth !== undefined) {
      return cachedWidth;
    }

    // Measure width
    const width = this.measureCharacterWidth(pos);
    
    // Cache for common characters
    if (char.charCodeAt(0) < 256) {
      this.charWidthCache.set(char, width);
    }
    
    return width;
  }

  /**
   * Measure the width of the character at the given position
   */
  private measureCharacterWidth(pos: number): number {
    if (!this.editorView) return 8;

    const doc = this.editorView.state.doc;
    const docLength = doc.length;
    
    if (pos >= docLength) {
      return this.getDefaultCharWidth();
    }
    
    const line = doc.lineAt(pos);
    const offsetInLine = pos - line.from;
    const char = line.text[offsetInLine];
    
    if (!char || line.text.length === 0) {
      return this.getDefaultCharWidth();
    }

    try {
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
      // Fallback
    }

    return this.estimateCharWidth(char);
  }

  /**
   * Estimate character width based on character type
   */
  private estimateCharWidth(char: string): number {
    const defaultWidth = this.getDefaultCharWidth();
    
    const code = char.charCodeAt(0);
    
    // Quick check for CJK ranges
    if ((code >= 0x4E00 && code <= 0x9FFF) ||
        (code >= 0x3400 && code <= 0x4DBF) ||
        (code >= 0x3000 && code <= 0x303F) ||
        (code >= 0xFF00 && code <= 0xFFEF) ||
        (code >= 0xAC00 && code <= 0xD7AF) ||
        (code >= 0x3040 && code <= 0x30FF) ||
        (code > 0x1F000)) {
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
   * Ensures smooth transition of dimensions when shape changes
   */
  private updateCursorShape(mode: VimMode) {
    if (!this.cursorEl) return;

    const shape = this.plugin.settings.cursorShapes[mode];
    const oldShape = (this.cursorEl.dataset.shape || 'block') as CursorShape;
    
    // If shape is changing, ensure smooth transition
    if (oldShape !== shape && this.animationEngine && this.editorView) {
      // Get current position from animation engine
      const currentPos = this.animationEngine.getCurrentPosition();
      
      // Read actual displayed dimensions from DOM (most accurate)
      const displayedWidth = parseFloat(this.cursorEl.style.width || '0');
      const displayedHeight = parseFloat(this.cursorEl.style.height || '0');
      
      // If we have valid displayed dimensions, use them as the starting point
      // Otherwise, calculate from current animation state based on old shape
      let startWidth = currentPos.width;
      let startHeight = currentPos.height;
      
      if (displayedWidth > 0 && displayedHeight > 0) {
        // Use actual displayed dimensions
        startWidth = displayedWidth;
        startHeight = displayedHeight;
      } else {
        // Calculate displayed dimensions from animation state based on old shape
        const currentDisplayedDims = calculateCursorDimensions(currentPos, oldShape);
        startWidth = currentDisplayedDims.width;
        startHeight = currentDisplayedDims.height;
      }
      
      // Update animation engine's current state to match displayed dimensions
      // This ensures smooth transition from old shape to new shape
      const currentDisplayedPos: CursorPosition = {
        x: currentPos.x,
        y: currentPos.y,
        width: startWidth,
        height: startHeight,
      };
      
      // Update animation engine's current state to match displayed dimensions
      this.animationEngine.setImmediate(currentDisplayedPos);
      
      // Update shape attribute
      this.cursorEl.dataset.shape = shape;
      
      // Trigger update which will calculate new dimensions based on new shape
      // The animation engine will smoothly interpolate from current displayed dimensions to new ones
      requestAnimationFrame(() => {
        this.forceUpdate();
      });
    } else {
      // Shape not changing, just update attributes
      this.cursorEl.dataset.shape = shape;
    }
    
    this.cursorEl.style.display = 'block';
    this.cursorEl.style.visibility = 'visible';
    
    if (mode === 'insert') {
      this.cursorEl.style.animation = 'smooth-cursor-blink 1s ease-in-out infinite';
    } else {
      this.cursorEl.style.animation = 'none';
    }

    // Always trigger update to ensure dimensions are recalculated
    if (oldShape === shape) {
      requestAnimationFrame(() => {
        this.forceUpdate();
      });
    }
  }

  /**
   * Apply cursor position from animation
   * Uses either transform (GPU-accelerated) or left/top based on settings
   * The position passed here already has shape-adjusted dimensions for smooth transitions
   */
  private applyCursorPosition(pos: CursorPosition) {
    if (!this.cursorEl) return;

    const shape = (this.cursorEl.dataset.shape || 'block') as CursorShape;
    
    // Calculate yOffset based on shape (for underline cursor)
    // For underline, we need the original line height to calculate offset
    let yOffset = 0;
    if (shape === 'underline' && this.editorView) {
      const originalLineHeight = this.editorView.defaultLineHeight;
      yOffset = originalLineHeight - pos.height; // pos.height is 2 for underline
    }

    // Check if transform animation mode is enabled
    if (this.plugin.settings.useTransformAnimation) {
      // Use transform for GPU-accelerated animation (may appear slightly blurry)
      this.cursorEl.style.transform = `translate(${pos.x}px, ${pos.y + yOffset}px)`;
      this.cursorEl.style.left = '0';
      this.cursorEl.style.top = '0';
    } else {
      // Use left/top for sharper cursor
      this.cursorEl.style.transform = 'none';
      this.cursorEl.style.left = `${pos.x}px`;
      this.cursorEl.style.top = `${pos.y + yOffset}px`;
    }
    
    // Use dimensions directly from animation engine (already shape-adjusted)
    this.cursorEl.style.width = `${pos.width}px`;
    this.cursorEl.style.height = `${pos.height}px`;
  }

  /**
   * Handle movement state changes for blink pause
   * Pauses blink animation while cursor is moving, resumes when stopped
   */
  private handleMovementState(isMoving: boolean) {
    if (!this.cursorEl) return;
    
    if (isMoving) {
      // Pause blink by adding 'moving' class
      this.cursorEl.classList.add('moving');
    } else {
      // Resume blink by removing 'moving' class
      this.cursorEl.classList.remove('moving');
    }
  }
}

// Access to VimStateProvider from main plugin
declare module './main' {
  interface SmoothCursorPlugin {
    vimState: import('./vim-state').VimStateProvider | null;
  }
}
