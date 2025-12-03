import type { VimMode } from '../types';
import type SmoothCursorPlugin from '../main';

/**
 * Status bar manager for displaying cursor mode information
 */
export class StatusBarManager {
  private plugin: SmoothCursorPlugin;
  private statusBarEl: HTMLElement | null = null;
  private modeUnsubscribe: (() => void) | null = null;

  constructor(plugin: SmoothCursorPlugin) {
    this.plugin = plugin;
  }

  /**
   * Setup status bar item
   */
  setup(): void {
    this.statusBarEl = this.plugin.addStatusBarItem();
    this.statusBarEl.addClass('smooth-cursor-status');
    this.update();
    
    // Listen for mode changes to update status bar
    this.modeUnsubscribe = this.plugin.vimState?.onModeChange(() => {
      this.update();
    }) ?? null;
  }

  /**
   * Update status bar content
   */
  update(): void {
    if (!this.statusBarEl || !this.plugin.settings.debug) {
      if (this.statusBarEl) {
        this.statusBarEl.empty();
      }
      return;
    }

    const mode = this.plugin.getVimMode();
    this.statusBarEl.empty();
    
    const indicator = this.statusBarEl.createEl('span', {
      cls: `smooth-cursor-mode-indicator ${mode}`,
      text: mode.toUpperCase(),
    });
    indicator.setAttribute('aria-label', `Smooth Cursor: ${mode} mode`);
  }

  /**
   * Remove status bar item
   */
  remove(): void {
    this.modeUnsubscribe?.();
    this.modeUnsubscribe = null;
    this.statusBarEl?.remove();
    this.statusBarEl = null;
  }
}

