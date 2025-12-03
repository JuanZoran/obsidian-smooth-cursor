import type { CursorShape, SmoothCursorSettings } from '../types';
import { addClass, removeClass } from '../utils/dom-utils';

/**
 * Cursor element manager for DOM element lifecycle
 */
export class CursorElementManager {
  private cursorEl: HTMLDivElement | null = null;
  private settings: SmoothCursorSettings;

  constructor(settings: SmoothCursorSettings) {
    this.settings = settings;
  }

  /**
   * Create cursor element
   */
  create(editorId: string): HTMLDivElement {
    // Remove any existing cursor elements
    if (this.cursorEl) {
      this.cursorEl.remove();
      this.cursorEl = null;
    }

    document.querySelectorAll('.smooth-cursor').forEach(el => el.remove());

    this.cursorEl = document.createElement('div');
    this.cursorEl.className = 'smooth-cursor';
    this.cursorEl.dataset.editorId = editorId;
    
    // Add transform-mode class if enabled
    if (this.settings.useTransformAnimation) {
      this.cursorEl.classList.add('transform-mode');
    }
    
    this.cursorEl.style.cssText = `
      position: fixed !important;
      display: none !important;
      pointer-events: none !important;
      z-index: 10000 !important;
      background-color: ${this.settings.cursorColor} !important;
      border-radius: 1px;
      --smooth-cursor-opacity: ${this.settings.cursorOpacity};
    `;
    // Set initial opacity without !important to allow animation to override
    this.cursorEl.style.opacity = String(this.settings.cursorOpacity);
    
    document.body.appendChild(this.cursorEl);
    
    return this.cursorEl;
  }

  /**
   * Get cursor element
   */
  getElement(): HTMLDivElement | null {
    return this.cursorEl;
  }

  /**
   * Update cursor shape
   */
  updateShape(shape: CursorShape): void {
    if (!this.cursorEl) return;

    // Remove all shape classes
    this.cursorEl.classList.remove('block', 'line', 'underline');
    
    // Add new shape class
    this.cursorEl.dataset.shape = shape;
  }

  /**
   * Update cursor position
   */
  updatePosition(x: number, y: number, width: number, height: number, useTransform: boolean, yOffset: number = 0): void {
    if (!this.cursorEl) return;

    if (useTransform) {
      this.cursorEl.style.transform = `translate(${x}px, ${y + yOffset}px)`;
      this.cursorEl.style.left = '0';
      this.cursorEl.style.top = '0';
    } else {
      this.cursorEl.style.transform = 'none';
      this.cursorEl.style.left = `${x}px`;
      this.cursorEl.style.top = `${y + yOffset}px`;
    }
    
    this.cursorEl.style.width = `${width}px`;
    this.cursorEl.style.height = `${height}px`;
  }

  /**
   * Show cursor element
   */
  show(): void {
    if (this.cursorEl) {
      this.cursorEl.style.display = 'block';
    }
  }

  /**
   * Hide cursor element
   */
  hide(): void {
    if (this.cursorEl) {
      this.cursorEl.style.display = 'none';
      this.cursorEl.style.left = '-9999px';
      this.cursorEl.style.top = '-9999px';
    }
  }

  /**
   * Update breathing animation state
   */
  setBreathing(enabled: boolean, opacity: number): void {
    if (!this.cursorEl) return;

    if (enabled) {
      this.cursorEl.classList.add('breathing');
      this.cursorEl.style.animation = '';
      // Clear inline opacity to allow animation to control it
      if (!this.cursorEl.classList.contains('moving')) {
        this.cursorEl.style.opacity = '';
      }
    } else {
      this.cursorEl.classList.remove('breathing');
      this.cursorEl.style.animation = 'none';
      this.cursorEl.style.opacity = String(opacity);
    }
  }

  /**
   * Set moving state (pauses breathing animation)
   */
  setMoving(isMoving: boolean, opacity: number): void {
    if (!this.cursorEl) return;

    if (isMoving) {
      this.cursorEl.classList.add('moving');
      this.cursorEl.style.opacity = String(opacity);
    } else {
      this.cursorEl.classList.remove('moving');
      // Clear inline opacity to allow animation to control it
      if (this.cursorEl.classList.contains('breathing')) {
        this.cursorEl.style.opacity = '';
      }
    }
  }

  /**
   * Update settings
   */
  updateSettings(settings: SmoothCursorSettings): void {
    this.settings = settings;
    if (this.cursorEl) {
      this.cursorEl.style.backgroundColor = settings.cursorColor;
      this.cursorEl.style.setProperty('--smooth-cursor-opacity', String(settings.cursorOpacity));
    }
  }

  /**
   * Remove cursor element
   */
  remove(): void {
    if (this.cursorEl) {
      this.cursorEl.remove();
      this.cursorEl = null;
    }
  }

  /**
   * Generate unique editor ID
   */
  static generateEditorId(): string {
    return `obvide-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

