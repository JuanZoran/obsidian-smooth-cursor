import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import type SmoothCursorPlugin from './main';
import type { AnimationEngine } from './animation';
import type { CursorPosition, CursorShape, VimMode } from './types';
import { calculateCursorDimensions } from './cursor-utils';
import { CoordinateService } from './services/coordinate-service';
import { CharacterMeasurementService } from './services/character-measurement-service';
import { DOMChangeDetectorService } from './services/dom-change-detector-service';
import { CursorElementManager } from './core/cursor-element-manager';
import { EditorStateManager } from './core/editor-state-manager';
import { EventManager } from './core/event-manager';
import { NativeCursorHider } from './core/native-cursor-hider';
import { getDefaultLineHeight } from './utils/editor-utils';
import { isElementConnected } from './utils/dom-utils';
import { hasOriginalDispatch } from './utils/type-guards';

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
  private isAttached = false;
  private updateScheduled = false;
  private lastCursorPos = -1;
  private modeUnsubscribe: (() => void) | null = null;
  private isDestroyed = false;
  private isScrolling = false;
  private scrollTimeout: number | null = null;
  private lastScrollUpdateTime = 0;
  private scrollThrottleInterval = 16; // ~60fps during scroll
  
  // Services and managers
  private coordinateService: CoordinateService;
  private characterMeasurementService: CharacterMeasurementService;
  private domChangeDetector: DOMChangeDetectorService;
  private cursorElementManager: CursorElementManager;
  private editorStateManager: EditorStateManager;
  private eventManager: EventManager;
  private nativeCursorHider: NativeCursorHider;
  
  // Transaction-based cursor tracking
  private cursorUpdatePlugin: ReturnType<typeof createCursorUpdatePlugin> | null = null;
  private lastDocChangeTime = 0;
  private isTyping = false;
  private typingTimeout: number | null = null;
  private lastUpdateWasTyping = false;
  
  // Movement debounce for breathing animation
  private movementResumeTimeout: number | null = null;
  private movementDebounceDelay = 300; // Delay before resuming animation after movement stops (ms)
  private isCurrentlyMoving = false; // Track if cursor is currently moving

  constructor(plugin: SmoothCursorPlugin, animationEngine: AnimationEngine) {
    this.plugin = plugin;
    this.animationEngine = animationEngine;
    
    // Initialize services and managers
    this.coordinateService = new CoordinateService();
    this.characterMeasurementService = new CharacterMeasurementService();
    this.domChangeDetector = new DOMChangeDetectorService();
    this.cursorElementManager = new CursorElementManager(plugin.settings);
    this.editorStateManager = new EditorStateManager();
    this.eventManager = new EventManager();
    this.nativeCursorHider = new NativeCursorHider();
    
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
    const cursorEl = this.cursorElementManager.getElement();
    if (this.editorView === editorView && this.isAttached && cursorEl && isElementConnected(cursorEl)) {
      return;
    }

    this.detach();
    this.editorView = editorView;
    
    // Attach services and managers
    this.coordinateService.attach(editorView);
    this.characterMeasurementService.attach(editorView);
    this.editorStateManager.attach(editorView);
    this.nativeCursorHider.attach(editorView);
    
    // Create cursor elements
    const editorId = CursorElementManager.generateEditorId();
    this.cursorElementManager.create(editorId);
    
    // Setup transaction listener for immediate cursor tracking during typing
    this.setupTransactionListener();
    
    // Setup scroll event listener for immediate position updates during scroll
    this.setupScrollListener();
    
    // Setup focus event listener for immediate response to focus changes
    this.setupFocusListener();
    
    // Setup mouse and keyboard event listeners for cursor position changes
    this.setupMouseKeyboardListeners();
    
    // Setup DOM change detector for Live Preview mode compatibility
    this.setupDOMChangeDetector();
    
    this.isAttached = true;
    
    // smooth-cursor-active class is already added by editorStateManager.attach()
    // which ensures native cursor is always hidden while editor is attached
    // This prevents native cursor flash when focus switches between editor and non-editor areas
    
    // Perform initial health check
    this.editorStateManager.ensureHealth(true);
    
    // Initialize cursor shape and breathing animation
    this.updateCursorShape(this.plugin.getVimMode());
    
    this.plugin.debug('CursorRenderer attached');
    
    // Initial cursor position update - use immediate update to prevent native cursor flash
    if (this.editorView) {
      this.updatePositionImmediate();
      // Also schedule a normal update for smooth animation after immediate positioning
      this.scheduleUpdate();
    }
  }

  /**
   * Setup CodeMirror transaction listener by intercepting EditorView.dispatch
   * This is a workaround since we can't add ViewPlugin to extensions in Obsidian
   * WARNING: This approach may conflict with other plugins that also intercept dispatch
   */
  private setupTransactionListener() {
    if (!this.editorView) return;

    // Intercept EditorView.dispatch to listen to all transactions
    // Store original dispatch for cleanup
    // WARNING: Using internal property __originalDispatch which may conflict with other plugins
    if (!hasOriginalDispatch(this.editorView)) {
      this.editorView.__originalDispatch = this.editorView.dispatch.bind(this.editorView);
    }
    
    // At this point, __originalDispatch must be defined
    if (!hasOriginalDispatch(this.editorView)) {
      this.plugin.debug('Failed to store original dispatch');
      return;
    }
    
    const originalDispatch = this.editorView.__originalDispatch;
    const self = this;
    
    this.editorView.dispatch = function(tr: any) {
      // Call original dispatch first
      const result = originalDispatch(tr);
      
      // Then check for cursor position changes (use requestAnimationFrame to avoid blocking)
      if (self.isAttached && self.editorView) {
        requestAnimationFrame(() => {
          if (self.isAttached && self.editorView) {
            self.handleEditorUpdate(tr);
          }
        });
      }
      
      return result;
    };

    // Also try to use ViewPlugin if possible (may not work without being in extensions)
    this.cursorUpdatePlugin = createCursorUpdatePlugin((update: ViewUpdate) => {
      if (!this.isAttached || !this.editorView) return;
      this.handleEditorUpdateFromView(update);
    });

    this.plugin.debug('Transaction listener created (dispatch interception)');
  }

  /**
   * Unified handler for editor updates from different sources
   * @param docChanged - Whether the document changed (typing)
   * @param cursorPos - Current cursor position
   */
  private handleEditorUpdateInternal(docChanged: boolean, cursorPos: number) {
    if (!this.editorView) return;
    
    const now = performance.now();
    
    // Track if this is a typing action (document changed)
    if (docChanged) {
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
    if (cursorPos !== this.lastCursorPos) {
      this.lastCursorPos = cursorPos;
      
      // Clear coordinate cache on position change
      this.coordinateService.clearCache();
      
      // Update cursor immediately with typing context
      this.updateCursorPositionWithContext(this.lastUpdateWasTyping);
    }
  }

  /**
   * Handle editor update from intercepted dispatch
   */
  private handleEditorUpdate(tr: any) {
    if (!this.editorView) return;
    
    const state = this.editorView.state;
    const docChanged = tr.docChanged || false;
    const sel = state.selection.main;
    const cursorPos = sel.head;
    
    this.handleEditorUpdateInternal(docChanged, cursorPos);
  }

  /**
   * Handle editor update from ViewPlugin (if it works)
   */
  private handleEditorUpdateFromView(update: ViewUpdate) {
    if (!this.isAttached || !this.editorView) return;
    
    const docChanged = update.docChanged;
    const sel = update.state.selection.main;
    const cursorPos = sel.head;
    
    this.handleEditorUpdateInternal(docChanged, cursorPos);
  }

  /**
   * Clear all caches (coordinates and character measurements)
   */
  private clearAllCaches(): void {
    this.coordinateService.clearCache();
    this.characterMeasurementService.clearCache();
  }

  /**
   * Check if editor is focused, hide cursor if not
   * @returns true if focused, false otherwise
   */
  private checkFocusAndHideIfNeeded(): boolean {
    if (!this.editorStateManager.isFocused()) {
      this.cursorElementManager.hide();
      return false;
    }
    return true;
  }

  /**
   * Calculate cursor position from current editor state
   * @returns CursorPosition or null if invalid
   */
  private calculateCursorPosition(): CursorPosition | null {
    if (!this.editorView) return null;

    const sel = this.editorView.state.selection.main;
    const pos = sel.head;
    const coords = this.coordinateService.getCursorCoordsCached(pos);
    
    if (!coords || isNaN(coords.left) || isNaN(coords.top) || !isFinite(coords.left) || !isFinite(coords.top)) {
      return null;
    }

    const charWidth = this.characterMeasurementService.measureCharacterWidthCached(pos);
    const lineHeight = getDefaultLineHeight(this.editorView);
    
    return {
      x: coords.left,
      y: coords.top,
      width: charWidth,
      height: lineHeight,
    };
  }

  /**
   * Calculate target cursor position with shape-adjusted dimensions
   * @param basePosition - Base cursor position
   * @param shape - Cursor shape
   * @returns Target position with adjusted dimensions
   */
  private calculateTargetPosition(basePosition: CursorPosition, shape: CursorShape): CursorPosition {
    const { width: targetWidth, height: targetHeight } = calculateCursorDimensions(basePosition, shape);
    
    return {
      x: basePosition.x,
      y: basePosition.y,
      width: targetWidth,
      height: targetHeight,
    };
  }

  /**
   * Handle cursor position change (clear cache and schedule update)
   * @param cursorPos - New cursor position
   */
  private handleCursorPositionChange(cursorPos: number): void {
    if (cursorPos !== this.lastCursorPos) {
      this.lastCursorPos = cursorPos;
      this.clearAllCaches();
      this.scheduleUpdate();
    }
  }

  /**
   * Update cursor position with typing context for animation optimization
   * Ensures smooth dimension transitions when cursor shape changes
   */
  private updateCursorPositionWithContext(isTyping: boolean) {
    const cursorEl = this.cursorElementManager.getElement();
    if (!this.editorView || !cursorEl || !isElementConnected(cursorEl)) {
      if (!isElementConnected(cursorEl)) {
        this.editorStateManager.ensureHealth(true);
      }
      return;
    }

    // Check if editor is focused - if not, hide cursor and return
    if (!this.checkFocusAndHideIfNeeded()) {
      return;
    }

    const basePosition = this.calculateCursorPosition();
    if (!basePosition) {
      this.cursorElementManager.hide();
      return;
    }

    try {
      this.cursorElementManager.show();
      
      // Get current shape to calculate target dimensions
      const shape = (cursorEl.dataset.shape || 'block') as CursorShape;
      const targetPosition = this.calculateTargetPosition(basePosition, shape);
      
      if (this.isScrolling) {
        // Use immediate positioning during scroll
        const yOffset = shape === 'underline' ? basePosition.height - targetPosition.height : 0;
        this.cursorElementManager.updatePosition(
          targetPosition.x,
          targetPosition.y,
          targetPosition.width,
          targetPosition.height,
          this.plugin.settings.useTransformAnimation,
          yOffset
        );
        this.animationEngine.setImmediate(targetPosition);
      } else {
        const currentLeft = parseFloat(cursorEl.style.left || '0');
        const currentTop = parseFloat(cursorEl.style.top || '0');
        const wasHidden = (currentLeft <= -1000 || currentTop <= -1000) || 
                         cursorEl.style.display === 'none';
        
        if (wasHidden) {
          this.animationEngine.setImmediate(targetPosition);
          this.applyCursorPosition(targetPosition);
        } else {
          // Pass typing context to animation engine for adaptive lerp
          // Animation engine will smoothly interpolate dimensions
          this.animationEngine.animateTo(targetPosition, isTyping);
        }
      }
      
    } catch (e) {
      this.cursorElementManager.hide();
    }
  }

  /**
   * Setup scroll event listener with throttling
   */
  private setupScrollListener() {
    if (!this.editorView) return;
    
    const scrollHandler = () => {
      this.isScrolling = true;
      
      // Clear previous timeout
      if (this.scrollTimeout !== null) {
        clearTimeout(this.scrollTimeout);
      }
      
      // Throttle scroll updates
      const now = performance.now();
      if (now - this.lastScrollUpdateTime >= this.scrollThrottleInterval) {
        this.lastScrollUpdateTime = now;
        if (this.checkFocusAndHideIfNeeded()) {
          this.updatePositionImmediate();
        }
      }
      
      // Set timeout to mark end of scroll
      this.scrollTimeout = window.setTimeout(() => {
        this.isScrolling = false;
        if (this.checkFocusAndHideIfNeeded()) {
          this.scheduleUpdate();
        }
      }, 150);
    };
    
    this.eventManager.addEventListener(
      this.editorView.scrollDOM,
      'scroll',
      scrollHandler,
      { passive: true }
    );
  }

  /**
   * Setup mouse and keyboard event listeners to catch cursor movements
   * that might not trigger transactions (e.g., mouse clicks, arrow keys)
   */
  private setupMouseKeyboardListeners() {
    if (!this.editorView) return;

    // Listen for mouse clicks in the editor
    const clickHandler = (e: MouseEvent) => {
      if (!this.editorView || !this.isAttached) return;
      
      const target = e.target as HTMLElement;
      if (target.closest('.cm-editor')) {
        // Small delay to allow selection to update
        requestAnimationFrame(() => {
          if (this.editorView && this.isAttached) {
            const sel = this.editorView.state.selection.main;
            const cursorPos = sel.head;
            
            this.handleCursorPositionChange(cursorPos);
          }
        });
      }
    };

    // Listen for keyboard navigation (arrow keys, home, end, etc.)
    const keydownHandler = (e: KeyboardEvent) => {
      if (!this.editorView || !this.isAttached) return;
      
      const target = e.target as HTMLElement;
      if (!target.closest('.cm-editor')) return;

      // Check for navigation keys
      const navigationKeys = [
        'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
        'Home', 'End', 'PageUp', 'PageDown'
      ];
      
      if (navigationKeys.includes(e.key) || 
          (e.key === 'Home' || e.key === 'End') ||
          (e.ctrlKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight'))) {
        // Small delay to allow selection to update
        requestAnimationFrame(() => {
          if (this.editorView && this.isAttached) {
            const sel = this.editorView.state.selection.main;
            const cursorPos = sel.head;
            
            this.handleCursorPositionChange(cursorPos);
          }
        });
      }
    };

    this.eventManager.addEventListener(this.editorView.dom, 'click', clickHandler);
    this.eventManager.addEventListener(this.editorView.dom, 'keydown', keydownHandler, true);
  }

  /**
   * Setup DOM change detector for Live Preview mode compatibility
   * Detects when Obsidian switches line display mode (rendered -> source) and updates cursor position
   */
  private setupDOMChangeDetector() {
    if (!this.editorView) return;

    // Set up callback to handle DOM structure changes
    this.domChangeDetector.attach(this.editorView, () => {
      if (!this.isAttached || !this.editorView) return;

      // Check focus state first - if editor is not focused, hide cursor
      if (!this.checkFocusAndHideIfNeeded()) {
        this.plugin.debug('DOM structure change detected but editor not focused, hiding cursor');
        return;
      }

      this.plugin.debug('DOM structure change detected, clearing cache and updating cursor');

      // Clear all caches to force recalculation with new DOM structure
      this.clearAllCaches();
      
      // Reset last cursor position to force position update
      this.lastCursorPos = -1;
      
      // Immediately update cursor position to reflect new DOM structure
      // Use immediate update since DOM has already changed
      this.updatePositionImmediate();
    });
  }

  /**
   * Setup focus event listener for immediate response to focus changes
   * This prevents native cursor flash when focus returns to editor
   */
  private setupFocusListener() {
    if (!this.editorView) return;

    const focusHandler = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (!target || !this.editorView) return;

      // Check if focus is entering the editor
      const editorDom = this.editorView.dom;
      if (editorDom.contains(target) || editorDom === target) {
        // Ensure smooth-cursor-active class is present (should already be there from attach)
        // Force immediate application to prevent any native cursor flash
        this.editorStateManager.setEditorActiveClass(true);
        
        // Perform health check on focus
        this.editorStateManager.ensureHealth(true);
        
        // Force hide native cursors immediately (direct DOM manipulation)
        this.nativeCursorHider.forceHide();
        
        // Immediately update cursor position synchronously to prevent native cursor flash
        // Use immediate update instead of scheduleUpdate to avoid requestAnimationFrame delay
        this.updatePositionImmediate();
        
        // Also schedule a normal update for smooth animation after immediate positioning
        this.scheduleUpdate();
        
        this.plugin.debug('Focus returned to editor, cursor updated immediately');
      }
    };

    const blurHandler = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (!target || !this.editorView) return;

      // Check if focus is leaving the editor
      const editorDom = this.editorView.dom;
      if (editorDom.contains(target) || editorDom === target) {
        // Small delay (10ms) to check if focus moved to another part of editor
        // This is necessary because focus events are asynchronous - the focusout event
        // fires before the new focus target is actually focused. The delay allows
        // us to check the actual focus state after the browser has updated it.
        // Note: We keep smooth-cursor-active class even when blurred to prevent
        // native cursor flash when focus returns quickly
        setTimeout(() => {
          if (this.editorView) {
            const isStillFocused = this.editorStateManager.isFocused(true);
            
            if (!isStillFocused) {
              // Hide custom cursor but keep smooth-cursor-active class
              // This ensures native cursor stays hidden when focus returns
              this.cursorElementManager.hide();
              this.plugin.debug('Editor lost focus, cursor hidden');
            }
          }
        }, 10);
      }
    };

    // Also listen to mousedown to add class before focus event
    // This prevents native cursor flash when clicking to focus editor
    const mousedownHandler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target || !this.editorView) return;

      const editorDom = this.editorView.dom;
      if (editorDom.contains(target) || editorDom === target) {
        // Add class immediately on mousedown, before focus event
        // This ensures native cursor is hidden before browser renders focus state
        this.editorStateManager.setEditorActiveClass(true);
        
        // Perform health check on mousedown
        this.editorStateManager.ensureHealth(true);
      }
    };

    // Use capture phase to catch events early
    this.eventManager.addEventListener(document, 'mousedown', mousedownHandler, true);
    this.eventManager.addEventListener(document, 'focusin', focusHandler, true);
    this.eventManager.addEventListener(document, 'focusout', blurHandler, true);
  }

  /**
   * Update cursor position immediately (no animation) - used during scroll
   */
  private updatePositionImmediate() {
    if (!this.editorView) return;

    // Check if editor is focused - if not, hide cursor and return
    if (!this.checkFocusAndHideIfNeeded()) {
      return;
    }

    const cursorEl = this.cursorElementManager.getElement();
    if (!cursorEl) return;

    const basePosition = this.calculateCursorPosition();
    if (!basePosition) {
      this.cursorElementManager.hide();
      return;
    }

    try {
      this.cursorElementManager.show();
      
      const shape = (cursorEl.dataset.shape || 'block') as CursorShape;
      const targetPosition = this.calculateTargetPosition(basePosition, shape);
      const lineHeight = getDefaultLineHeight(this.editorView);
      const yOffset = shape === 'underline' ? lineHeight - targetPosition.height : 0;
      
      this.cursorElementManager.updatePosition(
        targetPosition.x,
        targetPosition.y,
        targetPosition.width,
        targetPosition.height,
        this.plugin.settings.useTransformAnimation,
        yOffset
      );
      
      this.animationEngine.setImmediate(targetPosition);
    } catch (e) {
      this.cursorElementManager.hide();
    }
  }

  /**
   * Detach from current editor
   */
  detach() {
    // Restore original dispatch if we intercepted it
    if (this.editorView && hasOriginalDispatch(this.editorView)) {
      this.editorView.dispatch = this.editorView.__originalDispatch;
      // Use type assertion for delete since we know it exists
      delete (this.editorView as { __originalDispatch?: (tr: any) => void }).__originalDispatch;
    }
    
    // Remove all event listeners
    this.eventManager.removeAll();
    
    // Clear timeouts
    if (this.scrollTimeout !== null) {
      clearTimeout(this.scrollTimeout);
      this.scrollTimeout = null;
    }
    if (this.typingTimeout !== null) {
      clearTimeout(this.typingTimeout);
      this.typingTimeout = null;
    }
    if (this.movementResumeTimeout !== null) {
      clearTimeout(this.movementResumeTimeout);
      this.movementResumeTimeout = null;
    }
    
    // Remove moving class to ensure clean state
    const cursorEl = this.cursorElementManager.getElement();
    if (cursorEl) {
      cursorEl.classList.remove('moving');
    }
    this.isCurrentlyMoving = false;
    
    this.cursorElementManager.hide();
    
    // Detach services and managers
    this.coordinateService.detach();
    this.characterMeasurementService.detach();
    this.domChangeDetector.detach();
    this.editorStateManager.detach();
    this.nativeCursorHider.detach();
    
    this.editorView = null;
    this.isAttached = false;
    this.lastCursorPos = -1;
    this.isScrolling = false;
    this.isTyping = false;
    this.lastUpdateWasTyping = false;
    this.cursorUpdatePlugin = null;
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
    if (this.movementResumeTimeout !== null) {
      clearTimeout(this.movementResumeTimeout);
      this.movementResumeTimeout = null;
    }
    this.detach();
    this.cursorElementManager.remove();
  }

  /**
   * Force an update of cursor position
   */
  forceUpdate() {
    this.lastCursorPos = -1;
    this.clearAllCaches(); // Clear cache on force update
    // Also update shape/animation to apply any setting changes
    const cursorEl = this.cursorElementManager.getElement();
    if (cursorEl && this.editorView) {
      this.updateCursorShape(this.plugin.getVimMode());
    }
    this.scheduleUpdate();
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
   * Update cursor shape based on vim mode
   * Ensures smooth transition of dimensions when shape changes
   */
  private updateCursorShape(mode: VimMode) {
    const cursorEl = this.cursorElementManager.getElement();
    if (!cursorEl) return;

    const shape = this.plugin.settings.cursorShapes[mode];
    const oldShape = (cursorEl.dataset.shape || 'block') as CursorShape;
    
    // If shape is changing, ensure smooth transition
    if (oldShape !== shape && this.animationEngine && this.editorView) {
      // Get current position from animation engine
      const currentPos = this.animationEngine.getCurrentPosition();
      
      // Read actual displayed dimensions from DOM (most accurate)
      const displayedWidth = parseFloat(cursorEl.style.width || '0');
      const displayedHeight = parseFloat(cursorEl.style.height || '0');
      
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
      
      // Update shape
      this.cursorElementManager.updateShape(shape);
      
      // Trigger update which will calculate new dimensions based on new shape
      // The animation engine will smoothly interpolate from current displayed dimensions to new ones
      // Use scheduleUpdate instead of forceUpdate to avoid recursive calls
      this.scheduleUpdate();
    } else {
      // Shape not changing, just update shape
      this.cursorElementManager.updateShape(shape);
    }
    
    // Apply breathing animation if enabled
    this.cursorElementManager.setBreathing(
      this.plugin.settings.enableBreathingAnimation,
      this.plugin.settings.cursorOpacity
    );
    
    // Ensure moving state is properly set
    if (!this.isCurrentlyMoving && this.plugin.settings.enableBreathingAnimation) {
      const cursorEl = this.cursorElementManager.getElement();
      if (cursorEl) {
        cursorEl.classList.remove('moving');
      }
    }
  }

  /**
   * Apply cursor position from animation
   * Uses either transform (GPU-accelerated) or left/top based on settings
   * The position passed here already has shape-adjusted dimensions for smooth transitions
   */
  private applyCursorPosition(pos: CursorPosition) {
    const cursorEl = this.cursorElementManager.getElement();
    if (!cursorEl) return;

    const shape = (cursorEl.dataset.shape || 'block') as CursorShape;
    
    // Calculate yOffset based on shape (for underline cursor)
    let yOffset = 0;
    if (shape === 'underline' && this.editorView) {
      const originalLineHeight = getDefaultLineHeight(this.editorView);
      yOffset = originalLineHeight - pos.height; // pos.height is 2 for underline
    }

    this.cursorElementManager.updatePosition(
      pos.x,
      pos.y,
      pos.width,
      pos.height,
      this.plugin.settings.useTransformAnimation,
      yOffset
    );
  }

  /**
   * Handle movement state changes for breathing animation pause
   * Pauses breathing animation while cursor is moving, resumes after debounce when stopped
   */
  private handleMovementState(isMoving: boolean) {
    // Clear any pending resume timeout
    if (this.movementResumeTimeout !== null) {
      clearTimeout(this.movementResumeTimeout);
      this.movementResumeTimeout = null;
    }
    
    if (isMoving) {
      // Immediately pause animation and keep cursor fully visible
      this.isCurrentlyMoving = true;
      this.cursorElementManager.setMoving(true, this.plugin.settings.cursorOpacity);
    } else {
      // Debounce: wait before resuming animation to avoid flickering
      // This prevents animation from restarting too quickly if movement resumes
      this.movementResumeTimeout = window.setTimeout(() => {
        this.movementResumeTimeout = null;
        this.isCurrentlyMoving = false;
        // Resume animation by removing 'moving' class
        this.cursorElementManager.setMoving(false, this.plugin.settings.cursorOpacity);
      }, this.movementDebounceDelay);
    }
  }
}

// Access to VimStateProvider from main plugin
declare module './main' {
  interface SmoothCursorPlugin {
    vimState: import('./vim-state').VimStateProvider | null;
  }
}
