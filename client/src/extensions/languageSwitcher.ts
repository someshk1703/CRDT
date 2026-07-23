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
