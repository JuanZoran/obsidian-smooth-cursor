# Obsidian API 使用审查报告

## 已修复的问题

### 1. ✅ Vim 模式检测
- **问题**：使用硬编码键集合检测模式，不支持自定义键映射
- **修复**：使用 `view.sourceMode?.cmEditor?.cm?.cm` 获取 CodeMirror 5 编辑器实例，监听 `vim-mode-change` 事件
- **位置**：`src/main.ts:162`, `src/vim-state.ts:329`

## 潜在问题点

### 1. ⚠️ 获取 CodeMirror 6 EditorView（已改进类型安全）
- **当前实现**：`getEditorViewFromMarkdownView(view)` - 使用类型守卫函数
- **位置**：`src/main.ts:157`（已更新）
- **问题**：访问内部 API `view.editor.cm`，可能在未来 Obsidian 更新时失效
- **改进**：
  - 创建了类型定义扩展 `MarkdownView` 接口
  - 使用类型守卫函数 `getEditorViewFromMarkdownView()` 安全访问
  - 移除了 `@ts-expect-error`，改用类型安全的访问方式
- **状态**：类型安全性已改进，但仍依赖内部 API
- **风险**：中等 - 当前工作正常，但可能在 Obsidian 更新时失效

### 2. ⚠️ 拦截 EditorView.dispatch 方法（已改进类型安全）
- **当前实现**：直接替换 `editorView.dispatch` 方法
- **位置**：`src/cursor-renderer.ts:152-187`（已更新）
- **问题**：
  - 可能与其他插件冲突
  - 不是 Obsidian 推荐的方式
  - 使用 `__originalDispatch` 私有属性存储原始方法
- **改进**：
  - 创建了类型定义扩展 `EditorView` 接口，添加 `__originalDispatch` 属性
  - 使用类型守卫函数 `hasOriginalDispatch()` 安全访问
  - 移除了所有 `as any` 断言
- **研究结果**：
  - 网络搜索未找到 Obsidian 官方提供的 ViewPlugin 注册方式
  - CodeMirror 6 的 ViewPlugin 需要在编辑器创建时通过扩展系统注册
  - Obsidian 的编辑器扩展系统不对外暴露，无法动态注册 ViewPlugin
  - `EditorView.updateListener` 等 API 也需要通过扩展系统注册
- **状态**：类型安全性已改进，但仍使用拦截方案
- **风险**：高 - 可能与未来 Obsidian 更新或其他插件冲突
- **建议**：继续监控 Obsidian 官方 API 更新，寻找替代方案

### 3. ✅ 使用 `as any` 类型断言（已改进）
- **原位置**：
  - `src/main.ts:162` - 获取 CodeMirror 5 编辑器
  - `src/cursor-renderer.ts:157-161, 599-601` - dispatch 拦截
- **问题**：类型不安全，可能在未来 Obsidian 更新时失效
- **修复**：
  - 创建了 `src/types/obsidian-extensions.d.ts` 类型定义文件
  - 创建了 `src/utils/type-guards.ts` 类型守卫函数
  - 将所有 `as any` 替换为类型安全的访问方式
  - 使用类型守卫函数安全地访问内部 API
- **状态**：已改进，类型安全性显著提升

## 建议的改进方向

### 1. 研究 Obsidian 官方扩展机制
- 检查是否有官方方式注册 CodeMirror 6 ViewPlugin
- 查看 Obsidian 社区插件的最佳实践

### 2. 检查事件监听方式
- 当前使用 `active-leaf-change` 事件，这是官方 API
- 但获取 EditorView 的方式可能需要验证

### 3. 考虑使用 Obsidian 的编辑器扩展 API
- 如果有官方扩展机制，应该优先使用
- 减少对内部 API 的依赖

## 已实施的改进

### 1. ✅ 类型定义系统
- **文件**：`src/types/obsidian-extensions.d.ts`
  - 扩展了 `MarkdownView` 类型，添加 `editor.cm` 和 `sourceMode.cmEditor.cm.cm` 属性
  - 扩展了 `EditorView` 类型，添加 `__originalDispatch` 属性
  - 定义了 `CodeMirror5Editor` 接口
- **文件**：`src/utils/type-guards.ts`
  - 创建了类型守卫函数：`hasEditorView()`, `getEditorViewFromMarkdownView()`
  - 创建了类型守卫函数：`hasCodeMirror5Editor()`, `getCodeMirror5EditorFromMarkdownView()`
  - 创建了类型守卫函数：`hasOriginalDispatch()`

### 2. ✅ 代码改进
- **`src/main.ts`**：
  - 移除了 `@ts-expect-error` 注释
  - 使用 `getEditorViewFromMarkdownView()` 和 `getCodeMirror5EditorFromMarkdownView()` 函数
  - 将 `currentCodeMirrorEditor` 类型从 `any` 改为 `CodeMirror5Editor | null`
- **`src/cursor-renderer.ts`**：
  - 使用 `hasOriginalDispatch()` 类型守卫函数
  - 移除了所有 `as any` 断言
  - 添加了更详细的警告注释

## 需要进一步调查的问题

1. **是否有官方方式获取 EditorView？**
   - ✅ 已搜索 Obsidian 插件示例代码和官方文档
   - **结果**：未找到官方 API，`view.editor.cm` 是社区标准做法
   - **状态**：当前实现已改进类型安全，但仍依赖内部 API

2. **是否有更好的方式监听编辑器事务？**
   - ✅ 已研究 CodeMirror 6 的 ViewPlugin 机制
   - ✅ 已检查 Obsidian 是否提供了包装器
   - **结果**：Obsidian 不对外暴露扩展注册系统，无法动态注册 ViewPlugin
   - **状态**：当前拦截方案是唯一可行方案，已改进类型安全

