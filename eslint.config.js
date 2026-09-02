import js from "@eslint/js"
import {jsdoc} from "eslint-plugin-jsdoc"
import jsdocInlineTypeCastsPlugin from "eslint-plugin-jsdoc-inline-type-casts"
import jsdocTagLinesPlugin from "eslint-plugin-jsdoc-tag-lines"
import globals from "globals"
import {defineConfig} from "eslint/config"

export default defineConfig([
  {
    name: "global ignores",
    ignores: ["build/**", "coverage/**", "node_modules/**"]
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    extends: ["js/recommended"],
    languageOptions: {
      globals: {...globals.node}
    },
    plugins: {
      js,
      "jsdoc-inline-type-casts": jsdocInlineTypeCastsPlugin
    },
    rules: {
      "jsdoc-inline-type-casts/jsdoc-inline-type-casts": "error",
      "no-unused-vars": ["error", {argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_", varsIgnorePattern: "^_"}]
    }
  },
  {
    files: ["src/**/*.js", "index.js"],
    plugins: {
      "jsdoc-tag-lines": jsdocTagLinesPlugin
    },
    rules: {
      "jsdoc-tag-lines/jsdoc-tag-lines": "error"
    }
  },
  jsdoc({
    config: "flat/recommended",
    files: ["src/**/*.js", "index.js"],
    rules: {
      "jsdoc/no-multi-asterisks": "off",
      "jsdoc/reject-any-type": "error",
      "jsdoc/require-description": "error"
    }
  })
])
