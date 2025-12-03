/**
 * Event manager for unified event listener lifecycle management
 */
export class EventManager {
  private listeners: Array<{
    element: EventTarget;
    event: string;
    handler: EventListener;
    options?: boolean | AddEventListenerOptions;
  }> = [];

  /**
   * Add event listener and track it for cleanup
   */
  addEventListener(
    element: EventTarget,
    event: string,
    handler: EventListener,
    options?: boolean | AddEventListenerOptions
  ): void {
    element.addEventListener(event, handler, options);
    this.listeners.push({ element, event, handler, options });
  }

  /**
   * Remove specific event listener
   */
  removeEventListener(
    element: EventTarget,
    event: string,
    handler: EventListener,
    options?: boolean | EventListenerOptions
  ): void {
    element.removeEventListener(event, handler, options);
    this.listeners = this.listeners.filter(
      (l) => !(l.element === element && l.event === event && l.handler === handler)
    );
  }

  /**
   * Remove all tracked event listeners
   */
  removeAll(): void {
    for (const { element, event, handler, options } of this.listeners) {
      element.removeEventListener(event, handler, options);
    }
    this.listeners = [];
  }

  /**
   * Get count of tracked listeners
   */
  getListenerCount(): number {
    return this.listeners.length;
  }
}

