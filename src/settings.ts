import { App, PluginSettingTab, Setting } from 'obsidian';
import type SmoothCursorPlugin from './main';
import type { CursorShape, VimMode } from './types';

export class SmoothCursorSettingTab extends PluginSettingTab {
  plugin: SmoothCursorPlugin;

  constructor(app: App, plugin: SmoothCursorPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Smooth Cursor - 平滑光标设置' });

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

    // Insert mode animation section
    containerEl.createEl('h3', { text: '输入模式动画' });

    // Enable insert mode animation
    new Setting(containerEl)
      .setName('启用输入模式平滑动画')
      .setDesc('在输入文字时启用光标平滑移动效果')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableInsertModeAnimation)
          .onChange(async (value) => {
            this.plugin.settings.enableInsertModeAnimation = value;
            await this.plugin.saveSettings();
          })
      );

    // Insert mode animation duration
    new Setting(containerEl)
      .setName('输入模式动画时长')
      .setDesc('输入时光标移动动画的持续时间（毫秒），建议设置较短以保持流畅')
      .addSlider((slider) =>
        slider
          .setLimits(20, 150, 10)
          .setValue(this.plugin.settings.insertModeAnimationDuration)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.insertModeAnimationDuration = value;
            await this.plugin.saveSettings();
          })
      );

    // Transform animation mode
    new Setting(containerEl)
      .setName('使用 Transform 动画')
      .setDesc('使用 CSS transform 进行动画（GPU加速更流畅，但光标可能略显模糊）')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.useTransformAnimation)
          .onChange(async (value) => {
            this.plugin.settings.useTransformAnimation = value;
            await this.plugin.saveSettings();
          })
      );

    // Cursor color
    new Setting(containerEl)
      .setName('光标颜色')
      .setDesc('自定义光标的颜色')
      .addColorPicker((colorPicker) =>
        colorPicker
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

    // Breathing animation section
    containerEl.createEl('h3', { text: '呼吸动画' });

    // Enable breathing animation
    new Setting(containerEl)
      .setName('启用呼吸动画')
      .setDesc('为光标添加平滑的呼吸效果（在所有模式下生效）')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableBreathingAnimation)
          .onChange(async (value) => {
            this.plugin.settings.enableBreathingAnimation = value;
            await this.plugin.saveSettings();
            this.plugin.updateCursorStyle();
          })
      );

    // Breathing animation duration
    new Setting(containerEl)
      .setName('呼吸动画时长')
      .setDesc('呼吸动画一个完整周期的时长（秒）')
      .addSlider((slider) =>
        slider
          .setLimits(0.5, 5, 0.1)
          .setValue(this.plugin.settings.breathingAnimationDuration)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.breathingAnimationDuration = value;
            await this.plugin.saveSettings();
            this.plugin.updateCursorStyle();
          })
      );

    // Breathing minimum opacity
    new Setting(containerEl)
      .setName('呼吸最小透明度')
      .setDesc('呼吸动画时光标淡出到的最小透明度（0-1）')
      .addSlider((slider) =>
        slider
          .setLimits(0.1, 0.9, 0.1)
          .setValue(this.plugin.settings.breathingMinOpacity)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.breathingMinOpacity = value;
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

