import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { java } from '@codemirror/lang-java';
import { go } from '@codemirror/lang-go';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import type { LanguageSupport } from '@codemirror/language';

// ─── Language registry ────────────────────────────────────────────────────────

export const SUPPORTED_LANGUAGES: Record<string, { label: string; extension: () => LanguageSupport }> = {
  javascript: { label: 'JavaScript', extension: () => javascript() },
  typescript: { label: 'TypeScript', extension: () => javascript({ typescript: true }) },
  python:     { label: 'Python',     extension: () => python() },
  java:       { label: 'Java',       extension: () => java() },
  go:         { label: 'Go',         extension: () => go() },
  html:       { label: 'HTML',       extension: () => html() },
  css:        { label: 'CSS',        extension: () => css() },
  json:       { label: 'JSON',       extension: () => json() },
};

/** Get the CodeMirror LanguageSupport for a language ID, falling back to JavaScript. */
export function getLanguageExtension(lang: string): LanguageSupport {
  return (SUPPORTED_LANGUAGES[lang] ?? SUPPORTED_LANGUAGES['javascript']).extension();
}

// ─── Boilerplate skeletons ────────────────────────────────────────────────────

/**
 * Starter syntactic scaffold inserted into a room's document when it is still
 * empty at the time a language is selected — so e.g. Java's mandatory
 * `public class Main { public static void main(String[] args) { } }` wrapper
 * never has to be typed by hand.
 */
const LANGUAGE_BOILERPLATE: Record<string, string> = {
  javascript: 'function main() {\n\n}\n\nmain();\n',
  typescript: 'function main(): void {\n\n}\n\nmain();\n',
  python: 'def main():\n    pass\n\n\nif __name__ == "__main__":\n    main()\n',
  java: 'public class Main {\n    public static void main(String[] args) {\n\n    }\n}\n',
  go: 'package main\n\nfunc main() {\n\n}\n',
  html: '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <title>Document</title>\n</head>\n<body>\n\n</body>\n</html>\n',
  css: 'body {\n\n}\n',
  json: '{\n\n}\n',
};

/** Get the starter scaffold for a language ID, falling back to the JavaScript one. */
export function getLanguageBoilerplate(lang: string): string {
  return LANGUAGE_BOILERPLATE[lang] ?? LANGUAGE_BOILERPLATE['javascript'];
}
