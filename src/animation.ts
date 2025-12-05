import type ObVidePlugin from './main';
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
  private plugin: ObVidePlugin;
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

  constructor(plugin: ObVidePlugin) {
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
  }

  /**
   * Animate cursor to a new position
   */
  animateTo(target: CursorPosition) {
    const { enableAnimation } = this.plugin.settings;
    const now = performance.now();
    
    // Calculate time since last update
    const timeSinceLastUpdate = now - this.lastUpdateTime;
    this.lastUpdateTime = now;

    // If animation is disabled, jump directly
    if (!enableAnimation) {
      this.setPositionDirect(target);
      return;
    }

    // Calculate squared distance (avoid sqrt for performance)
    const dx = target.x - this.currentPos.x;
    const dy = target.y - this.currentPos.y;
    const distanceSquared = dx * dx + dy * dy;

    // If very close, just jump (threshold: 2^2 = 4)
    if (distanceSquared < 4) {
      this.setPositionDirect(target);
      return;
    }

    // Detect rapid movement (updates faster than 50ms apart)
    // For rapid small movements, skip animation (threshold: 100^2 = 10000)
    if (timeSinceLastUpdate < 50 && distanceSquared < 10000) {
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
      return;
    }

    const lerpFactor = this.cachedLerpFactor;
    
    // Lerp towards target (inline calculation for performance)
    this.currentPos.x += (this.targetPos.x - this.currentPos.x) * lerpFactor;
    this.currentPos.y += (this.targetPos.y - this.currentPos.y) * lerpFactor;
    this.currentPos.width += (this.targetPos.width - this.currentPos.width) * lerpFactor;
    this.currentPos.height += (this.targetPos.height - this.currentPos.height) * lerpFactor;

    // Notify callback
    this.onFrameCallback?.(this.currentPos);

    // Check if we're close enough to target (squared distance, threshold: 0.5^2 = 0.25)
    const dx = this.targetPos.x - this.currentPos.x;
    const dy = this.targetPos.y - this.currentPos.y;
    const distanceSquared = dx * dx + dy * dy;

    if (distanceSquared < 0.25) {
      // Snap to target and stop
      this.currentPos.x = this.targetPos.x;
      this.currentPos.y = this.targetPos.y;
      this.currentPos.width = this.targetPos.width;
      this.currentPos.height = this.targetPos.height;
      this.onFrameCallback?.(this.currentPos);
      this.isAnimating = false;
      this.rafId = null;
    } else {
      // Continue animation
      this.rafId = requestAnimationFrame(() => this.animate());
    }
  }
}
