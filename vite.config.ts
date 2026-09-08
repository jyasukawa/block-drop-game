import { defineConfig } from 'vitest/config'

// GitHub Pages はリポジトリ名のサブパス配下で配信される。
// base を設定しないと本番でだけ資産が 404 になる（開発中は気づけない）。
const REPO_NAME = 'block-drop-game'

export default defineConfig(({ command }) => ({
  base: command === 'build' ? `/${REPO_NAME}/` : '/',
  build: { target: 'es2022' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
}))
