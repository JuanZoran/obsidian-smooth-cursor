import type ObVidePlugin from './main';
import type { VimMode, CursorPosition, CursorShape } from './types';

/**
 * NonEditorCursor - Handles cursor styling in non-CodeMirror areas
 * (title bar, search boxes, etc.)
 */
export class NonEditorCursor {
  private plugin: ObVidePlugin;
  private cursorEl: HTMLDivElement | null = null;
  private activeInput: HTMLElement | null = null;
  private observer: MutationObserver | null = null;
  private focusHandler: ((e: FocusEvent) => void) | null = null;
  private blurHandler: ((e: FocusEvent) => void) | null = null;
  private inputHandler: ((e: Event) => void) | null = null;
  private selectionHandler: (() => void) | null = null;
  private rafId: number | null = null;
  private isActive = false;

  constructor(plugin: ObVidePlugin) {
    this.plugin = plugin;
    this.setupEventListeners();
    this.createCursorElement();
  }

  /**
   * Clean up resources
   */
  destroy() {
    this.stopTracking();
    this.removeEventListeners();
    this.cursorEl?.remove();
    this.cursorEl = null;
  }

  private createCursorElement() {
    this.cursorEl = document.createElement('div');
    this.cursorEl.className = 'obvide-non-editor-cursor';
    this.cursorEl.style.cssText = `
      position: fixed;
      pointer-events: none;
      z-index: 10000;
      display: none;
      background-color: ${this.plugin.settings.cursorColor};
      opacity: ${this.plugin.settings.cursorOpacity};
      border-radius: 1px;
      transition: opacity 0.15s ease;
    `;
    document.body.appendChild(this.cursorEl);
  }

  private setupEventListeners() {
    // Focus handler for input elements
    this.focusHandler = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (this.isEditableElement(target) && !this.isCodeMirrorElement(target)) {
        this.startTracking(target);
      }
    };

    // Blur handler
    this.blurHandler = () => {
      this.stopTracking();
    };

    // Input handler for cursor position updates
    this.inputHandler = () => {
      this.scheduleUpdate();
    };

    // Selection change handler
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
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      return true;
    }
    if (el.contentEditable === 'true') {
      return true;
    }
    return false;
  }

  private isCodeMirrorElement(el: HTMLElement): boolean {
    // Check if element is inside a CodeMirror editor
    return el.closest('.cm-editor') !== null;
  }

  private startTracking(element: HTMLElement) {
    if (!this.plugin.settings.enableInNonEditor) {
      return;
    }

    this.activeInput = element;
    this.isActive = true;

    // Add input event listener
    if (this.inputHandler) {
      element.addEventListener('input', this.inputHandler);
      element.addEventListener('keyup', this.inputHandler);
    }

    // Show cursor
    if (this.cursorEl) {
      this.cursorEl.style.display = 'block';
    }

    this.scheduleUpdate();
    this.plugin.debug('NonEditorCursor: started tracking', element.tagName);
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

  private getInputCursorPosition(input: HTMLInputElement | HTMLTextAreaElement): CursorPosition | null {
    const selectionStart = input.selectionStart ?? 0;
    
    // Create a temporary span to measure text width
    const measureSpan = document.createElement('span');
    measureSpan.style.cssText = `
      position: absolute;
      visibility: hidden;
      white-space: pre;
      font: ${window.getComputedStyle(input).font};
    `;
    
    const textBeforeCursor = input.value.substring(0, selectionStart);
    measureSpan.textContent = textBeforeCursor || ' ';
    document.body.appendChild(measureSpan);
    
    const textWidth = measureSpan.offsetWidth;
    
    // Get character at cursor for width measurement
    const charAtCursor = input.value[selectionStart] || ' ';
    measureSpan.textContent = charAtCursor;
    const charWidth = measureSpan.offsetWidth;
    
    document.body.removeChild(measureSpan);
    
    // Get input element position
    const inputRect = input.getBoundingClientRect();
    const computedStyle = window.getComputedStyle(input);
    const paddingLeft = parseFloat(computedStyle.paddingLeft) || 0;
    const paddingTop = parseFloat(computedStyle.paddingTop) || 0;
    const borderLeft = parseFloat(computedStyle.borderLeftWidth) || 0;
    const borderTop = parseFloat(computedStyle.borderTopWidth) || 0;
    
    // Calculate scroll offset for scrollable inputs
    const scrollLeft = input.scrollLeft || 0;
    
    // Get line height
    const lineHeight = parseFloat(computedStyle.lineHeight) || parseFloat(computedStyle.fontSize) * 1.2;
    
    return {
      x: inputRect.left + paddingLeft + borderLeft + textWidth - scrollLeft,
      y: inputRect.top + paddingTop + borderTop,
      width: charWidth || 8,
      height: lineHeight,
    };
  }

  private getContentEditableCursorPosition(): CursorPosition | null {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;

    const range = selection.getRangeAt(0);
    
    // Get the bounding rect of the cursor position
    const rects = range.getClientRects();
    if (rects.length === 0) {
      // Fallback: create a temporary element at cursor position
      const tempSpan = document.createElement('span');
      tempSpan.textContent = '\u200B'; // Zero-width space
      range.insertNode(tempSpan);
      const rect = tempSpan.getBoundingClientRect();
      tempSpan.remove();
      
      // Normalize the range after modification
      if (selection.rangeCount > 0) {
        const newRange = selection.getRangeAt(0);
        newRange.collapse(true);
      }
      
      return {
        x: rect.left,
        y: rect.top,
        width: 8,
        height: rect.height || 20,
      };
    }

    const rect = rects[0];
    
    // Try to get character width
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

    let width = pos.width;
    let height = pos.height;
    let x = pos.x;
    let y = pos.y;

    switch (shape) {
      case 'line':
        width = 2;
        break;
      case 'underline':
        height = 2;
        y = pos.y + pos.height - 2;
        break;
      case 'block':
      default:
        break;
    }

    this.cursorEl.style.left = `${x}px`;
    this.cursorEl.style.top = `${y}px`;
    this.cursorEl.style.width = `${width}px`;
    this.cursorEl.style.height = `${height}px`;
    this.cursorEl.style.backgroundColor = this.plugin.settings.cursorColor;
    this.cursorEl.style.opacity = String(this.plugin.settings.cursorOpacity);
  }
}

