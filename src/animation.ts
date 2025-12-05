import type ObVidePlugin from './main';
import type { CursorPosition } from './types';

/**
 * Easing functions for smooth animations
 */
const easings = {
  linear: (t: number) => t,
  easeOutQuad: (t: number) => t * (2 - t),
  easeOutCubic: (t: number) => --t * t * t + 1,
  easeOutExpo: (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
};

/**
 * AnimationEngine - Handles smooth cursor movement animations
 * Optimized for rapid key presses (vim j/k navigation)
 */
export class AnimationEngine {
  private plugin: ObVidePlugin;
  private currentPos: CursorPosition = { x: 0, y: 0, width: 0, height: 0 };
  private targetPos: CursorPosition = { x: 0, y: 0, width: 0, height: 0 };
  private rafId: number | null = null;
  private onFrameCallback: ((position: CursorPosition) => void) | null = null;
  private lastUpdateTime = 0;
  private isAnimating = false;

  constructor(plugin: ObVidePlugin) {
    this.plugin = plugin;
  }

  /**
   * Set callback for animation frame updates
   */
  setOnFrame(callback: (position: CursorPosition) => void) {
    this.onFrameCallback = callback;
  }

  /**
   * Animate cursor to a new position
   */
  animateTo(target: CursorPosition) {
    const { enableAnimation, animationDuration } = this.plugin.settings;
    const now = performance.now();
    
    // Calculate time since last update
    const timeSinceLastUpdate = now - this.lastUpdateTime;
    this.lastUpdateTime = now;

    // If animation is disabled, jump directly
    if (!enableAnimation) {
      this.currentPos = { ...target };
      this.targetPos = { ...target };
      this.onFrameCallback?.(target);
      return;
    }

    // Calculate distance to new target
    const distance = Math.sqrt(
      Math.pow(target.x - this.currentPos.x, 2) + 
      Math.pow(target.y - this.currentPos.y, 2)
    );

    // If very close, just jump
    if (distance < 2) {
      this.currentPos = { ...target };
      this.targetPos = { ...target };
      this.onFrameCallback?.(target);
      return;
    }

    // Detect rapid movement (updates faster than 50ms apart)
    // Use faster animation or instant jump for rapid movements
    const isRapidMovement = timeSinceLastUpdate < 50;
    
    // For rapid movement, use much shorter animation or instant
    if (isRapidMovement && distance < 100) {
      // Very rapid small movements - just jump to target
      this.currentPos = { ...target };
      this.targetPos = { ...target };
      this.onFrameCallback?.(target);
      return;
    }

    // Update target position
    this.targetPos = { ...target };
    
    // Start animation if not already running
    if (!this.isAnimating) {
      this.isAnimating = true;
      this.startAnimationLoop();
    }
  }

  /**
   * Immediately set cursor position without animation
   */
  setImmediate(position: CursorPosition) {
    this.stop();
    this.currentPos = { ...position };
    this.targetPos = { ...position };
    this.onFrameCallback?.(position);
  }

  /**
   * Get current position
   */
  getCurrentPosition(): CursorPosition {
    return { ...this.currentPos };
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
  }

  private startAnimationLoop() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
    }
    this.rafId = requestAnimationFrame(() => this.animate());
  }

  private animate() {
    if (!this.isAnimating) {
      this.rafId = null;
      return;
    }

    // Use a simple chase/lerp approach - cursor chases target
    // This naturally handles interrupted animations
    const { animationDuration } = this.plugin.settings;
    
    // Calculate lerp factor based on animation duration
    // Shorter duration = faster chase
    // Using a frame-rate independent lerp
    const lerpFactor = Math.min(1, 16 / Math.max(animationDuration, 16));
    
    // Lerp towards target
    this.currentPos = {
      x: this.lerp(this.currentPos.x, this.targetPos.x, lerpFactor),
      y: this.lerp(this.currentPos.y, this.targetPos.y, lerpFactor),
      width: this.lerp(this.currentPos.width, this.targetPos.width, lerpFactor),
      height: this.lerp(this.currentPos.height, this.targetPos.height, lerpFactor),
    };

    // Notify callback
    this.onFrameCallback?.(this.currentPos);

    // Check if we're close enough to target
    const distance = Math.sqrt(
      Math.pow(this.targetPos.x - this.currentPos.x, 2) + 
      Math.pow(this.targetPos.y - this.currentPos.y, 2)
    );

    if (distance < 0.5) {
      // Snap to target and stop
      this.currentPos = { ...this.targetPos };
      this.onFrameCallback?.(this.currentPos);
      this.isAnimating = false;
      this.rafId = null;
    } else {
      // Continue animation
      this.rafId = requestAnimationFrame(() => this.animate());
    }
  }

  /**
   * Linear interpolation
   */
  private lerp(start: number, end: number, t: number): number {
    return start + (end - start) * t;
  }
}
