import { App, PluginSettingTab, Setting } from 'obsidian';
import type ObVidePlugin from './main';
import type { CursorShape, VimMode } from './types';

export class ObVideSettingTab extends PluginSettingTab {
  plugin: ObVidePlugin;

  constructor(app: App, plugin: ObVidePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'ObVide - Neovide风格光标设置' });

    // Animation toggle
    new Setting(containerEl)
      .setName('启用平滑动画')
      .setDesc('开启光标移动时的平滑过渡动画')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableAnimation)
          .onChange(async (value) => {
            this.plugin.settings.enableAnimation = value;
            await this.plugin.saveSettings();
          })
      );

    // Animation duration
    new Setting(containerEl)
      .setName('动画时长')
      .setDesc('光标移动动画的持续时间（毫秒）')
      .addSlider((slider) =>
        slider
          .setLimits(20, 300, 10)
          .setValue(this.plugin.settings.animationDuration)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.animationDuration = value;
            await this.plugin.saveSettings();
          })
      );

    // Cursor color
    new Setting(containerEl)
      .setName('光标颜色')
      .setDesc('自定义光标的颜色')
      .addText((text) =>
        text
          .setPlaceholder('#528bff')
          .setValue(this.plugin.settings.cursorColor)
          .onChange(async (value) => {
            this.plugin.settings.cursorColor = value;
            await this.plugin.saveSettings();
            this.plugin.updateCursorStyle();
          })
      );

    // Cursor opacity
    new Setting(containerEl)
      .setName('光标透明度')
      .setDesc('光标的不透明度（0-1）')
      .addSlider((slider) =>
        slider
          .setLimits(0.1, 1, 0.1)
          .setValue(this.plugin.settings.cursorOpacity)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.cursorOpacity = value;
            await this.plugin.saveSettings();
            this.plugin.updateCursorStyle();
          })
      );

    // Cursor shapes section
    containerEl.createEl('h3', { text: '各模式光标形状' });

    const shapeOptions: Record<string, CursorShape> = {
      '块状': 'block',
      '竖线': 'line',
      '下划线': 'underline',
    };

    const modeNames: Record<VimMode, string> = {
      normal: 'Normal 模式',
      insert: 'Insert 模式',
      visual: 'Visual 模式',
      replace: 'Replace 模式',
      command: 'Command 模式',
    };

    const modeKeys: VimMode[] = ['normal', 'insert', 'visual', 'replace', 'command'];
    for (const mode of modeKeys) {
      const label = modeNames[mode];
      new Setting(containerEl)
        .setName(label)
        .setDesc(`${label}下的光标形状`)
        .addDropdown((dropdown) => {
          for (const [name, value] of Object.entries(shapeOptions)) {
            dropdown.addOption(value, name);
          }
          dropdown
            .setValue(this.plugin.settings.cursorShapes[mode])
            .onChange(async (value) => {
              this.plugin.settings.cursorShapes[mode] = value as CursorShape;
              await this.plugin.saveSettings();
            });
        });
    }

    // Non-editor support
    new Setting(containerEl)
      .setName('非编辑器区域支持')
      .setDesc('在标题栏、搜索框等区域也启用自定义光标')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableInNonEditor)
          .onChange(async (value) => {
            this.plugin.settings.enableInNonEditor = value;
            await this.plugin.saveSettings();
          })
      );

    // Debug mode
    new Setting(containerEl)
      .setName('调试模式')
      .setDesc('在控制台输出调试信息')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.debug)
          .onChange(async (value) => {
            this.plugin.settings.debug = value;
            await this.plugin.saveSettings();
          })
      );
  }
}

