import type SmoothCursorPlugin from './main';
import type { VimMode, CursorPosition, CursorShape } from './types';
import { calculateCursorDimensions } from './cursor-utils';

/**
 * NonEditorCursor - Handles cursor styling in non-CodeMirror areas
 * (title bar, search boxes, etc.)
 * Optimized with reusable measurement element
 */
export class NonEditorCursor {
  private plugin: SmoothCursorPlugin;
  private cursorEl: HTMLDivElement | null = null;
  private measureSpan: HTMLSpanElement | null = null; // Reusable measurement element
  private activeInput: HTMLElement | null = null;
  private focusHandler: ((e: FocusEvent) => void) | null = null;
  private blurHandler: ((e: FocusEvent) => void) | null = null;
  private inputHandler: ((e: Event) => void) | null = null;
  private selectionHandler: (() => void) | null = null;
  private rafId: number | null = null;
  private isActive = false;
  private lastMeasuredFont = '';

  constructor(plugin: SmoothCursorPlugin) {
    this.plugin = plugin;
    this.setupEventListeners();
    this.createCursorElement();
    this.createMeasureElement();
  }

  /**
   * Clean up resources
   */
  destroy() {
    this.stopTracking();
    this.removeEventListeners();
    this.cursorEl?.remove();
    this.cursorEl = null;
    this.measureSpan?.remove();
    this.measureSpan = null;
  }

  private createCursorElement() {
    this.cursorEl = document.createElement('div');
    this.cursorEl.className = 'smooth-cursor-non-editor';
    // Non-editor cursor should not use breathing animation to avoid flickering
    // due to frequent position updates
    this.cursorEl.style.cssText = `
      position: fixed;
      pointer-events: none;
      z-index: 10000;
      display: none;
      background-color: ${this.plugin.settings.cursorColor};
      opacity: ${this.plugin.settings.cursorOpacity};
      border-radius: 1px;
      transition: opacity 0.15s ease;
      animation: none !important;
    `;
    document.body.appendChild(this.cursorEl);
  }

  /**
   * Create reusable measurement element (avoids DOM churn)
   */
  private createMeasureElement() {
    this.measureSpan = document.createElement('span');
    this.measureSpan.style.cssText = `
      position: absolute;
      visibility: hidden;
      white-space: pre;
      pointer-events: none;
      left: -9999px;
      top: -9999px;
    `;
    document.body.appendChild(this.measureSpan);
  }

  private setupEventListeners() {
    this.focusHandler = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (this.isEditableElement(target) && !this.isCodeMirrorElement(target)) {
        this.startTracking(target);
      }
    };

    this.blurHandler = () => {
      this.stopTracking();
    };

    this.inputHandler = () => {
      this.scheduleUpdate();
    };

    this.selectionHandler = () => {
      if (this.isActive) {
        this.scheduleUpdate();
      }
    };

    document.addEventListener('focusin', this.focusHandler, true);
    document.addEventListener('focusout', this.blurHandler, true);
    document.addEventListener('selectionchange', this.selectionHandler);
  }

  private removeEventListeners() {
    if (this.focusHandler) {
      document.removeEventListener('focusin', this.focusHandler, true);
    }
    if (this.blurHandler) {
      document.removeEventListener('focusout', this.blurHandler, true);
    }
    if (this.selectionHandler) {
      document.removeEventListener('selectionchange', this.selectionHandler);
    }
  }

  private isEditableElement(el: HTMLElement): boolean {
    return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.contentEditable === 'true';
  }

  private isCodeMirrorElement(el: HTMLElement): boolean {
    return el.closest('.cm-editor') !== null;
  }

  private startTracking(element: HTMLElement) {
    if (!this.plugin.settings.enableInNonEditor) {
      return;
    }

    this.activeInput = element;
    this.isActive = true;

    if (this.inputHandler) {
      element.addEventListener('input', this.inputHandler);
      element.addEventListener('keyup', this.inputHandler);
    }

    if (this.cursorEl) {
      this.cursorEl.style.display = 'block';
    }

    this.scheduleUpdate();
  }

  private stopTracking() {
    if (this.activeInput && this.inputHandler) {
      this.activeInput.removeEventListener('input', this.inputHandler);
      this.activeInput.removeEventListener('keyup', this.inputHandler);
    }

    this.activeInput = null;
    this.isActive = false;

    if (this.cursorEl) {
      this.cursorEl.style.display = 'none';
    }

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private scheduleUpdate() {
    if (this.rafId !== null) return;

    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.updateCursorPosition();
    });
  }

  private updateCursorPosition() {
    if (!this.activeInput || !this.cursorEl) return;

    const position = this.getCursorPosition();
    if (!position) return;

    const mode = this.plugin.getVimMode();
    const shape = this.plugin.settings.cursorShapes[mode];
    
    this.applyCursorStyle(position, shape);
  }

  private getCursorPosition(): CursorPosition | null {
    if (!this.activeInput) return null;

    if (this.activeInput.tagName === 'INPUT' || this.activeInput.tagName === 'TEXTAREA') {
      return this.getInputCursorPosition(this.activeInput as HTMLInputElement | HTMLTextAreaElement);
    }

    if (this.activeInput.contentEditable === 'true') {
      return this.getContentEditableCursorPosition();
    }

    return null;
  }

  /**
   * Get cursor position in input/textarea using reusable measurement element
   */
  private getInputCursorPosition(input: HTMLInputElement | HTMLTextAreaElement): CursorPosition | null {
    if (!this.measureSpan) return null;
    
    const selectionStart = input.selectionStart ?? 0;
    const computedStyle = window.getComputedStyle(input);
    const font = computedStyle.font;
    
    // Only update font if changed (avoid triggering reflow)
    if (font !== this.lastMeasuredFont) {
      this.measureSpan.style.font = font;
      this.lastMeasuredFont = font;
    }
    
    // Measure text before cursor
    const textBeforeCursor = input.value.substring(0, selectionStart);
    this.measureSpan.textContent = textBeforeCursor || ' ';
    const textWidth = this.measureSpan.offsetWidth;
    
    // Measure character at cursor
    const charAtCursor = input.value[selectionStart] || ' ';
    this.measureSpan.textContent = charAtCursor;
    const charWidth = this.measureSpan.offsetWidth;
    
    // Get input element position
    const inputRect = input.getBoundingClientRect();
    const paddingLeft = parseFloat(computedStyle.paddingLeft) || 0;
    const paddingTop = parseFloat(computedStyle.paddingTop) || 0;
    const borderLeft = parseFloat(computedStyle.borderLeftWidth) || 0;
    const borderTop = parseFloat(computedStyle.borderTopWidth) || 0;
    const scrollLeft = input.scrollLeft || 0;
    const lineHeight = parseFloat(computedStyle.lineHeight) || parseFloat(computedStyle.fontSize) * 1.2;
    
    return {
      x: inputRect.left + paddingLeft + borderLeft + textWidth - scrollLeft,
      y: inputRect.top + paddingTop + borderTop,
      width: charWidth || 8,
      height: lineHeight,
    };
  }

  /**
   * Get cursor position in contentEditable element
   */
  private getContentEditableCursorPosition(): CursorPosition | null {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;

    const range = selection.getRangeAt(0);
    const rects = range.getClientRects();
    
    if (rects.length === 0) {
      // Fallback: use range's bounding rect
      const rangeRect = range.getBoundingClientRect();
      if (rangeRect.width === 0 && rangeRect.height === 0) {
        // Last resort: use parent element position
        const container = range.commonAncestorContainer;
        const parent = container.nodeType === Node.TEXT_NODE ? container.parentElement : container as HTMLElement;
        if (parent) {
          const parentRect = parent.getBoundingClientRect();
          const style = window.getComputedStyle(parent);
          const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
          return {
            x: parentRect.left,
            y: parentRect.top,
            width: 8,
            height: lineHeight || 20,
          };
        }
      }
      return {
        x: rangeRect.left,
        y: rangeRect.top,
        width: 8,
        height: rangeRect.height || 20,
      };
    }

    const rect = rects[0];
    let charWidth = 8;
    if (!range.collapsed) {
      charWidth = rect.width;
    }

    return {
      x: rect.left,
      y: rect.top,
      width: charWidth,
      height: rect.height || 20,
    };
  }

  private applyCursorStyle(pos: CursorPosition, shape: CursorShape) {
    if (!this.cursorEl) return;

    const { width, height, yOffset } = calculateCursorDimensions(pos, shape);

    this.cursorEl.style.left = `${pos.x}px`;
    this.cursorEl.style.top = `${pos.y + yOffset}px`;
    this.cursorEl.style.width = `${width}px`;
    this.cursorEl.style.height = `${height}px`;
    this.cursorEl.style.backgroundColor = this.plugin.settings.cursorColor;
    // Non-editor cursor always uses static opacity to avoid flickering
    // Breathing animation is disabled for non-editor cursors due to frequent updates
    this.cursorEl.style.opacity = String(this.plugin.settings.cursorOpacity);
    // Ensure animation is disabled
    this.cursorEl.style.animation = 'none';
  }
}
