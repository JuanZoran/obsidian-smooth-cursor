import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import type SmoothCursorPlugin from './main';
import type { AnimationEngine } from './animation';
import type { CursorPosition, CursorShape, VimMode } from './types';
import { calculateCursorDimensions } from './cursor-utils';
import { CoordinateService } from './services/coordinate-service';
import { CharacterMeasurementService } from './services/character-measurement-service';
import { CursorElementManager } from './core/cursor-element-manager';
import { EditorStateManager } from './core/editor-state-manager';
import { EventManager } from './core/event-manager';
import { getDefaultLineHeight } from './utils/editor-utils';
import { isElementConnected } from './utils/dom-utils';

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
  private rafId: number | null = null;
  private isDestroyed = false;
  private isScrolling = false;
  private scrollTimeout: number | null = null;
  private lastScrollUpdateTime = 0;
  private scrollThrottleInterval = 16; // ~60fps during scroll
  
  // Services and managers
  private coordinateService: CoordinateService;
  private characterMeasurementService: CharacterMeasurementService;
  private cursorElementManager: CursorElementManager;
  private editorStateManager: EditorStateManager;
  private eventManager: EventManager;
  
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
    this.cursorElementManager = new CursorElementManager(plugin.settings);
    this.editorStateManager = new EditorStateManager();
    this.eventManager = new EventManager();
    
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
    
    // Create cursor elements
    const editorId = CursorElementManager.generateEditorId();
    this.cursorElementManager.create(editorId);
    
    // Setup transaction listener for immediate cursor tracking during typing
    this.setupTransactionListener();
    
    // Setup scroll event listener for immediate position updates during scroll
    this.setupScrollListener();
    
    // Setup focus event listener for immediate response to focus changes
    this.setupFocusListener();
    
    this.isAttached = true;
    
    // Force initial health check and class setup
    this.editorStateManager.ensureHealth(true);
    
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
        this.coordinateService.clearCache();
        
        // Update cursor immediately with typing context
        this.updateCursorPositionWithContext(this.lastUpdateWasTyping);
      }
    });

    this.plugin.debug('Transaction listener created');
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

    const sel = this.editorView.state.selection.main;
    const pos = sel.head;

    try {
      const coords = this.coordinateService.getCursorCoordsCached(pos);
      
      if (!coords) {
        return;
      }

      const charWidth = this.characterMeasurementService.measureCharacterWidthCached(pos);
      const lineHeight = getDefaultLineHeight(this.editorView);

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
        this.cursorElementManager.hide();
        return;
      }

      this.cursorElementManager.show();
      
      // Get current shape to calculate target dimensions
      const shape = (cursorEl.dataset.shape || 'block') as CursorShape;
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
        const yOffset = shape === 'underline' ? lineHeight - targetHeight : 0;
        this.cursorElementManager.updatePosition(
          targetPosition.x,
          targetPosition.y,
          targetWidth,
          targetHeight,
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
        if (this.editorStateManager.isFocused()) {
          this.updatePositionImmediate();
        }
      }
      
      // Set timeout to mark end of scroll
      this.scrollTimeout = window.setTimeout(() => {
        this.isScrolling = false;
        if (this.editorStateManager.isFocused()) {
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
        // Immediately add smooth-cursor-active class to hide native cursor
        this.editorStateManager.ensureHealth(true);
        
        // Immediately update cursor position
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
        // Small delay to check if focus moved to another part of editor
        setTimeout(() => {
          if (this.editorView) {
            const isStillFocused = this.editorStateManager.isFocused(true);
            
            if (!isStillFocused) {
              this.cursorElementManager.hide();
            }
          }
        }, 10);
      }
    };

    // Use capture phase to catch focus events early
    this.eventManager.addEventListener(document, 'focusin', focusHandler, true);
    this.eventManager.addEventListener(document, 'focusout', blurHandler, true);
  }

  /**
   * Update cursor position immediately (no animation) - used during scroll
   */
  private updatePositionImmediate() {
    if (!this.editorView) return;

    const sel = this.editorView.state.selection.main;
    const pos = sel.head;

    try {
      const coords = this.coordinateService.getCursorCoordsCached(pos);
      if (!coords) {
        this.cursorElementManager.hide();
        return;
      }

      const charWidth = this.characterMeasurementService.measureCharacterWidthCached(pos);
      const lineHeight = getDefaultLineHeight(this.editorView);

      if (isNaN(coords.left) || isNaN(coords.top)) {
        this.cursorElementManager.hide();
        return;
      }
      
      this.cursorElementManager.show();
      
      const cursorEl = this.cursorElementManager.getElement();
      if (!cursorEl) return;
      
      const shape = (cursorEl.dataset.shape || 'block') as CursorShape;
      const { width: targetWidth, height: targetHeight } = calculateCursorDimensions(
        { x: coords.left, y: coords.top, width: charWidth, height: lineHeight },
        shape
      );
      const yOffset = shape === 'underline' ? lineHeight - targetHeight : 0;
      
      this.cursorElementManager.updatePosition(
        coords.left,
        coords.top,
        targetWidth,
        targetHeight,
        this.plugin.settings.useTransformAnimation,
        yOffset
      );
      
      this.animationEngine.setImmediate({
        x: coords.left,
        y: coords.top,
        width: targetWidth,
        height: targetHeight,
      });
    } catch (e) {
      this.cursorElementManager.hide();
    }
  }

  /**
   * Detach from current editor
   */
  detach() {
    // Remove all event listeners
    this.eventManager.removeAll();
    
    // Clear timeouts
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
    this.editorStateManager.detach();
    
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
    this.coordinateService.clearCache(); // Clear cache on force update
    // Also update shape/animation to apply any setting changes
    const cursorEl = this.cursorElementManager.getElement();
    if (cursorEl && this.editorView) {
      this.updateCursorShape(this.plugin.getVimMode());
    }
    this.scheduleUpdate();
  }

  /**
   * Optimized polling mechanism - reduces CPU usage by:
   * 1. Throttling focus checks
   * 2. Reducing health check frequency
   * 3. Only updating on actual position changes
   */
  private setupCursorTracking() {
    if (!this.editorView) return;

    this.editorStateManager.ensureHealth(true);

    const pollCursor = () => {
      if (!this.isAttached || !this.editorView) {
        this.rafId = null;
        return;
      }
      
      // Throttled focus check (handled by EditorStateManager)
      const isFocused = this.editorStateManager.isFocused();
      
      // Reduced health check frequency (handled by EditorStateManager)
      this.editorStateManager.ensureHealth();
      
      // Hide cursor if not focused
      if (!isFocused) {
        this.cursorElementManager.hide();
        this.rafId = requestAnimationFrame(pollCursor);
        return;
      }
      
      // Check for position changes
      const sel = this.editorView.state.selection.main;
      const cursorPos = sel.head;
      
      const cursorEl = this.cursorElementManager.getElement();
      const needsUpdate = (
        this.lastCursorPos === -1 || 
        cursorPos !== this.lastCursorPos ||
        (cursorEl && cursorEl.style.display === 'none')
      );
      
      if (needsUpdate) {
        this.lastCursorPos = cursorPos;
        this.scheduleUpdate();
      }
      
      this.rafId = requestAnimationFrame(pollCursor);
    };
    
    this.rafId = requestAnimationFrame(pollCursor);
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
