import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * ESLint 扁平配置。
 *
 * 分工：这里的规则只管**容易被 review 漏掉**的问题（未使用变量、意外全局、
 * Vue 模板/组合式 API 的常见错误）；类型正确性由 `vue-tsc -b` 负责，
 * 代码风格由 Prettier 负责（末尾用 eslint-config-prettier 关掉冲突规则）。
 *
 * 刻意**不启用**类型感知规则（recommendedTypeChecked）：那会要求给每个文件
 * 配置 project service，且首轮会甩出大量历史告警；当前收益不抵成本。
 */
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '.npm-cache/**',
      // 内容是 JSON 文档，不是代码
      'src/game/data/dsl/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        // <script lang="ts"> 交给 typescript-eslint 解析
        parser: tseslint.parser,
      },
    },
  },
  {
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    // 测试与构建脚本跑在 Node 里（守卫测试会读文件系统）
    files: ['**/*.test.ts', 'vite.config.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    rules: {
      // 未使用参数允许用下划线前缀显式忽略
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  prettier,
)
