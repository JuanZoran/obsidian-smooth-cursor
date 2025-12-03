import { EditorView } from '@codemirror/view';

/**
 * Callback function type for DOM change events
 */
export type DOMChangeCallback = () => void;

/**
 * DOM change detector service for Live Preview mode
 * Detects DOM structure changes that affect cursor position (e.g., line mode switches)
 * Uses MutationObserver with debouncing to efficiently detect changes
 */
export class DOMChangeDetectorService {
  private editorView: EditorView | null = null;
  private observer: MutationObserver | null = null;
  private isActive = false;
  private changeCallback: DOMChangeCallback | null = null;
  
  // Debounce configuration
  private debounceTimeout: number | null = null;
  private debounceDelay = 250; // 250ms debounce delay (balance between responsiveness and performance)
  
  // Track if we're currently processing a change (avoid recursive triggers)
  private isProcessing = false;
  
  /**
   * Attach to an EditorView and start detecting DOM changes
   * @param editorView - The CodeMirror EditorView to monitor
   * @param onChange - Callback to invoke when DOM changes are detected
   */
  attach(editorView: EditorView, onChange: DOMChangeCallback): void {
    this.detach();
    this.editorView = editorView;
    this.changeCallback = onChange;
    this.isActive = true;
    
    // Set up MutationObserver to detect DOM structure changes
    this.setupObserver();
  }

  /**
   * Detach from current editor
   */
  detach(): void {
    this.isActive = false;
    
    // Clear any pending debounce timeout
    if (this.debounceTimeout !== null) {
      clearTimeout(this.debounceTimeout);
      this.debounceTimeout = null;
    }
    
    // Disconnect observer
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    
    this.editorView = null;
    this.changeCallback = null;
    this.isProcessing = false;
  }

  /**
   * Set up MutationObserver to monitor for DOM structure changes
   * This detects changes that might affect cursor position, such as:
   * - Live Preview mode line switches (rendered -> source)
   * - DOM structure changes in the editor content
   * - Layout-affecting changes
   */
  private setupObserver(): void {
    if (!this.editorView) return;

    this.observer = new MutationObserver((mutations) => {
      if (!this.isActive || this.isProcessing) return;

      // Check if any mutations indicate structural changes that could affect cursor position
      let hasStructuralChange = false;
      
      for (const mutation of mutations) {
        // Detect child list changes (nodes added/removed)
        if (mutation.type === 'childList') {
          // Only consider changes within the content area
          const target = mutation.target as HTMLElement;
          
          // Check if this is a significant structural change
          // In Live Preview mode, line switches cause childList mutations
          if (this.isSignificantChange(mutation, target)) {
            hasStructuralChange = true;
            break;
          }
        }
        // Detect attribute changes that might affect layout (class, style)
        else if (mutation.type === 'attributes') {
          const target = mutation.target as HTMLElement;
          
          // Check for class changes that might indicate mode switches
          if (mutation.attributeName === 'class' || mutation.attributeName === 'style') {
            // In Live Preview mode, line mode switches often involve class changes
            if (this.isLayoutAffectingChange(target)) {
              hasStructuralChange = true;
              break;
            }
          }
        }
      }
      
      if (hasStructuralChange) {
        this.handleChange();
      }
    });

    // Observe the editor DOM for structural changes
    // Focus on changes that could affect cursor position calculation
    this.observer.observe(this.editorView.dom, {
      childList: true,        // Detect node additions/removals
      subtree: true,          // Monitor all descendants
      attributes: true,       // Detect attribute changes (class, style)
      attributeFilter: ['class', 'style'], // Only watch class and style attributes
    });
  }

  /**
   * Check if a mutation represents a significant structural change
   * Filters out insignificant changes like text node updates
   */
  private isSignificantChange(mutation: MutationRecord, target: HTMLElement): boolean {
    // Check if this is within the content area (where cursor position matters)
    if (!target.closest('.cm-content')) {
      return false;
    }
    
    // If nodes were added or removed (not just text changes), it's significant
    if (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0) {
      // Check if any added/removed nodes are element nodes (not just text)
      for (let i = 0; i < mutation.addedNodes.length; i++) {
        if (mutation.addedNodes[i].nodeType === Node.ELEMENT_NODE) {
          return true;
        }
      }
      for (let i = 0; i < mutation.removedNodes.length; i++) {
        if (mutation.removedNodes[i].nodeType === Node.ELEMENT_NODE) {
          return true;
        }
      }
    }
    
    return false;
  }

  /**
   * Check if an attribute change affects layout/positioning
   */
  private isLayoutAffectingChange(target: HTMLElement): boolean {
    // Check if this element is part of the editor content structure
    if (!target.closest('.cm-content')) {
      return false;
    }
    
    // Check for class changes that might indicate mode switches
    // In Live Preview mode, lines might have classes like 'cm-line' that change
    if (target.classList.contains('cm-line') || 
        target.classList.contains('cm-content') ||
        target.closest('.cm-line')) {
      return true;
    }
    
    return false;
  }

  /**
   * Handle detected DOM change with debouncing
   */
  private handleChange(): void {
    // Clear existing timeout
    if (this.debounceTimeout !== null) {
      clearTimeout(this.debounceTimeout);
      this.debounceTimeout = null;
    }
    
    // Set new timeout for debounced callback
    this.debounceTimeout = window.setTimeout(() => {
      this.debounceTimeout = null;
      
      if (!this.isActive || !this.changeCallback) return;
      
      // Mark as processing to avoid recursive triggers
      this.isProcessing = true;
      
      try {
        // Invoke callback to clear cache and update cursor
        this.changeCallback();
      } finally {
        // Reset processing flag after a short delay to allow DOM to settle
        requestAnimationFrame(() => {
          this.isProcessing = false;
        });
      }
    }, this.debounceDelay);
  }

  /**
   * Force immediate change detection (bypasses debounce)
   * Useful when we know a change has occurred and need immediate response
   */
  forceCheck(): void {
    if (this.debounceTimeout !== null) {
      clearTimeout(this.debounceTimeout);
      this.debounceTimeout = null;
    }
    
    if (!this.isActive || !this.changeCallback) return;
    
    this.isProcessing = true;
    
    try {
      this.changeCallback();
    } finally {
      requestAnimationFrame(() => {
        this.isProcessing = false;
      });
    }
  }

  /**
   * Get current debounce delay
   */
  getDebounceDelay(): number {
    return this.debounceDelay;
  }

  /**
   * Set debounce delay (useful for testing or tuning)
   */
  setDebounceDelay(delay: number): void {
    this.debounceDelay = Math.max(0, Math.min(1000, delay)); // Clamp between 0-1000ms
  }
}
