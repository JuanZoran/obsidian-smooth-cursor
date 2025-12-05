import type SmoothCursorPlugin from './main';
import type { CursorPosition } from './types';

/**
 * AnimationEngine - Handles smooth cursor movement animations
 * Optimized for rapid key presses (vim j/k navigation)
 * Performance improvements:
 * - Early exit conditions to avoid unnecessary calculations
 * - Reduced object allocations
 * - Optimized distance calculations
 */
export class AnimationEngine {
  private plugin: SmoothCursorPlugin;
  private currentPos: CursorPosition = { x: 0, y: 0, width: 0, height: 0 };
  private targetPos: CursorPosition = { x: 0, y: 0, width: 0, height: 0 };
  private rafId: number | null = null;
  private onFrameCallback: ((position: CursorPosition) => void) | null = null;
  private lastUpdateTime = 0;
  private isAnimating = false;
  private isStopped = false;
  
  // Cached lerp factor to avoid recalculation every frame
  private cachedLerpFactor = 0.16;
  private cachedAnimationDuration = 100;
  
  // Typing-specific animation parameters
  private cachedTypingLerpFactor = 0.35;
  private cachedTypingAnimationDuration = 50;
  private isCurrentlyTyping = false;
  
  // Movement callback for blink pause integration
  private onMovementCallback: ((isMoving: boolean) => void) | null = null;

  constructor(plugin: SmoothCursorPlugin) {
    this.plugin = plugin;
    this.updateLerpFactor();
  }

  /**
   * Set callback for animation frame updates
   */
  setOnFrame(callback: (position: CursorPosition) => void) {
    this.onFrameCallback = callback;
  }

  /**
   * Update cached lerp factor when settings change
   */
  private updateLerpFactor() {
    const duration = this.plugin.settings.animationDuration;
    if (duration !== this.cachedAnimationDuration) {
      this.cachedAnimationDuration = duration;
      this.cachedLerpFactor = Math.min(1, 16 / Math.max(duration, 16));
    }
    
    // Update typing lerp factor - faster animation for typing
    const typingDuration = this.plugin.settings.insertModeAnimationDuration ?? 50;
    if (typingDuration !== this.cachedTypingAnimationDuration) {
      this.cachedTypingAnimationDuration = typingDuration;
      this.cachedTypingLerpFactor = Math.min(1, 16 / Math.max(typingDuration, 16));
    }
  }

  /**
   * Set callback for movement state changes (for blink pause integration)
   */
  setOnMovement(callback: (isMoving: boolean) => void) {
    this.onMovementCallback = callback;
  }

  /**
   * Animate cursor to a new position
   * @param target - Target cursor position
   * @param isTyping - Whether this movement is from typing (enables faster animation)
   */
  animateTo(target: CursorPosition, isTyping = false) {
    const { enableAnimation, enableInsertModeAnimation } = this.plugin.settings;
    const now = performance.now();
    
    // Calculate time since last update
    const timeSinceLastUpdate = now - this.lastUpdateTime;
    this.lastUpdateTime = now;
    
    // Track typing state for lerp factor selection
    this.isCurrentlyTyping = isTyping;

    // If animation is disabled, jump directly
    if (!enableAnimation) {
      this.setPositionDirect(target);
      return;
    }
    
    // If insert mode animation is disabled and we're typing, jump directly
    if (isTyping && enableInsertModeAnimation === false) {
      this.setPositionDirect(target);
      return;
    }

    // Calculate squared distance (avoid sqrt for performance)
    const dx = target.x - this.currentPos.x;
    const dy = target.y - this.currentPos.y;
    const distanceSquared = dx * dx + dy * dy;
    
    // Calculate dimension differences to detect shape changes
    const dw = target.width - this.currentPos.width;
    const dh = target.height - this.currentPos.height;
    const dimensionDeltaSquared = dw * dw + dh * dh;

    // If very close in both position and dimensions, just jump (threshold: 2^2 = 4 for position, 0.1^2 = 0.01 for dimensions)
    // But if dimensions are changing (shape change), always animate for smooth transition
    if (distanceSquared < 4 && dimensionDeltaSquared < 0.01) {
      this.setPositionDirect(target);
      return;
    }

    // For typing, we want smooth animation even for rapid movements
    // Only skip animation for rapid movements when NOT typing and dimensions aren't changing
    if (!isTyping && timeSinceLastUpdate < 50 && distanceSquared < 10000 && dimensionDeltaSquared < 0.01) {
      this.setPositionDirect(target);
      return;
    }

    // Update target position (avoid spread operator)
    this.targetPos.x = target.x;
    this.targetPos.y = target.y;
    this.targetPos.width = target.width;
    this.targetPos.height = target.height;
    
    // Reset stopped flag when starting new animation
    this.isStopped = false;
    
    // Update lerp factor if settings changed
    this.updateLerpFactor();
    
    // Notify movement callback (for blink pause)
    this.onMovementCallback?.(true);
    
    // Start animation if not already running
    if (!this.isAnimating) {
      this.isAnimating = true;
      this.startAnimationLoop();
    }
  }

  /**
   * Set position directly without object spread
   */
  private setPositionDirect(pos: CursorPosition) {
    this.currentPos.x = pos.x;
    this.currentPos.y = pos.y;
    this.currentPos.width = pos.width;
    this.currentPos.height = pos.height;
    this.targetPos.x = pos.x;
    this.targetPos.y = pos.y;
    this.targetPos.width = pos.width;
    this.targetPos.height = pos.height;
    this.onFrameCallback?.(pos);
  }

  /**
   * Immediately set cursor position without animation
   */
  setImmediate(position: CursorPosition) {
    // Stop any running animation
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.isAnimating = false;
    
    // Update positions immediately
    this.setPositionDirect(position);
  }

  /**
   * Get current position
   */
  getCurrentPosition(): CursorPosition {
    return {
      x: this.currentPos.x,
      y: this.currentPos.y,
      width: this.currentPos.width,
      height: this.currentPos.height,
    };
  }

  /**
   * Check if animation is in progress
   */
  isRunning(): boolean {
    return this.isAnimating;
  }

  /**
   * Stop any running animation
   */
  stop() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.isAnimating = false;
    this.isStopped = true;
  }

  private startAnimationLoop() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
    }
    this.rafId = requestAnimationFrame(() => this.animate());
  }

  private animate() {
    // Early exit checks
    if (!this.isAnimating || this.isStopped) {
      this.rafId = null;
      // Notify that movement has stopped
      this.onMovementCallback?.(false);
      return;
    }

    // Use adaptive lerp factor based on typing state
    const lerpFactor = this.isCurrentlyTyping 
      ? this.cachedTypingLerpFactor 
      : this.cachedLerpFactor;
    
    // Lerp towards target (inline calculation for performance)
    this.currentPos.x += (this.targetPos.x - this.currentPos.x) * lerpFactor;
    this.currentPos.y += (this.targetPos.y - this.currentPos.y) * lerpFactor;
    this.currentPos.width += (this.targetPos.width - this.currentPos.width) * lerpFactor;
    this.currentPos.height += (this.targetPos.height - this.currentPos.height) * lerpFactor;

    // Notify callback
    this.onFrameCallback?.(this.currentPos);

    // Check if we're close enough to target
    // Check both position and dimensions to ensure smooth shape transitions
    const dx = this.targetPos.x - this.currentPos.x;
    const dy = this.targetPos.y - this.currentPos.y;
    const dw = this.targetPos.width - this.currentPos.width;
    const dh = this.targetPos.height - this.currentPos.height;
    const distanceSquared = dx * dx + dy * dy;
    const dimensionDeltaSquared = dw * dw + dh * dh;
    
    // Threshold for position: 0.5^2 = 0.25
    // Threshold for dimensions: 0.1^2 = 0.01 (smaller threshold for smoother dimension transitions)
    const positionThreshold = 0.25;
    const dimensionThreshold = 0.01;

    if (distanceSquared < positionThreshold && dimensionDeltaSquared < dimensionThreshold) {
      // Snap to target and stop
      this.currentPos.x = this.targetPos.x;
      this.currentPos.y = this.targetPos.y;
      this.currentPos.width = this.targetPos.width;
      this.currentPos.height = this.targetPos.height;
      this.onFrameCallback?.(this.currentPos);
      this.isAnimating = false;
      this.isCurrentlyTyping = false;
      this.rafId = null;
      // Notify that movement has stopped
      this.onMovementCallback?.(false);
    } else {
      // Continue animation
      this.rafId = requestAnimationFrame(() => this.animate());
    }
  }
}
