import { createTheme } from '@uiw/codemirror-themes';
import { tags as t } from '@lezer/highlight';
import { tokyoNight } from '@uiw/codemirror-theme-tokyo-night';
import { githubDark, githubLight } from '@uiw/codemirror-theme-github';

// GitHub Dark Dimmed — manually defined (not in @uiw/codemirror-theme-github)
const githubDarkDimmed = createTheme({
  theme: 'dark',
  settings: {
    background: '#22272e',
    foreground: '#adbac7',
    caret: '#adbac7',
    selection: '#2e4c77',
    selectionMatch: '#264055',
    lineHighlight: '#1c2128',
    gutterBackground: '#1c2128',
    gutterForeground: '#545d68',
  },
  styles: [
    { tag: t.comment,            color: '#768390' },
    { tag: t.keyword,            color: '#f47067' },
    { tag: t.operator,           color: '#f47067' },
    { tag: t.string,             color: '#96d0ff' },
    { tag: t.number,             color: '#6bc7f6' },
    { tag: t.bool,               color: '#6bc7f6' },
    { tag: t.null,               color: '#6bc7f6' },
    { tag: t.variableName,       color: '#adbac7' },
    { tag: t.definition(t.variableName), color: '#dcbdfb' },
    { tag: t.function(t.variableName),   color: '#dcbdfb' },
    { tag: t.typeName,           color: '#5cb8ff' },
    { tag: t.className,          color: '#5cb8ff' },
    { tag: t.propertyName,       color: '#6bc7f6' },
    { tag: t.attributeName,      color: '#6cb6ff' },
    { tag: t.tagName,            color: '#8ddb8c' },
    { tag: t.punctuation,        color: '#adbac7' },
    { tag: t.regexp,             color: '#96d0ff' },
  ],
});
import { solarizedDark, solarizedLight } from '@uiw/codemirror-theme-solarized';
import type { Extension } from '@codemirror/state';

// ─── Catppuccin themes (implemented via createTheme) ─────────────────────────
// Colors sourced from https://github.com/catppuccin/catppuccin

const catppuccinMocha = createTheme({
  theme: 'dark',
  settings: {
    background: '#1e1e2e',
    foreground: '#cdd6f4',
    caret: '#f5e0dc',
    selection: '#45475a',
    selectionMatch: '#313244',
    lineHighlight: '#181825',
    gutterBackground: '#181825',
    gutterForeground: '#585b70',
  },
  styles: [
    { tag: t.comment,            color: '#6c7086' },
    { tag: t.lineComment,        color: '#6c7086' },
    { tag: t.blockComment,       color: '#6c7086' },
    { tag: t.keyword,            color: '#cba6f7' },
    { tag: t.operator,           color: '#89dceb' },
    { tag: t.string,             color: '#a6e3a1' },
    { tag: t.number,             color: '#fab387' },
    { tag: t.bool,               color: '#fab387' },
    { tag: t.null,               color: '#fab387' },
    { tag: t.variableName,       color: '#cdd6f4' },
    { tag: t.definition(t.variableName), color: '#89b4fa' },
    { tag: t.function(t.variableName),   color: '#89b4fa' },
    { tag: t.typeName,           color: '#f9e2af' },
    { tag: t.className,          color: '#f9e2af' },
    { tag: t.propertyName,       color: '#89dceb' },
    { tag: t.attributeName,      color: '#89b4fa' },
    { tag: t.tagName,            color: '#f38ba8' },
    { tag: t.punctuation,        color: '#cdd6f4' },
    { tag: t.angleBracket,       color: '#cdd6f4' },
    { tag: t.regexp,             color: '#f2cdcd' },
  ],
});

const catppuccinMacchiato = createTheme({
  theme: 'dark',
  settings: {
    background: '#24273a',
    foreground: '#cad3f5',
    caret: '#f4dbd6',
    selection: '#363a4f',
    selectionMatch: '#2d3047',
    lineHighlight: '#1e2030',
    gutterBackground: '#1e2030',
    gutterForeground: '#5b6078',
  },
  styles: [
    { tag: t.comment,            color: '#6e738d' },
    { tag: t.keyword,            color: '#c6a0f6' },
    { tag: t.operator,           color: '#91d7e3' },
    { tag: t.string,             color: '#a6da95' },
    { tag: t.number,             color: '#f5a97f' },
    { tag: t.bool,               color: '#f5a97f' },
    { tag: t.null,               color: '#f5a97f' },
    { tag: t.variableName,       color: '#cad3f5' },
    { tag: t.definition(t.variableName), color: '#8aadf4' },
    { tag: t.function(t.variableName),   color: '#8aadf4' },
    { tag: t.typeName,           color: '#eed49f' },
    { tag: t.className,          color: '#eed49f' },
    { tag: t.propertyName,       color: '#91d7e3' },
    { tag: t.attributeName,      color: '#8aadf4' },
    { tag: t.tagName,            color: '#ed8796' },
    { tag: t.punctuation,        color: '#cad3f5' },
    { tag: t.regexp,             color: '#f0c6c6' },
  ],
});

const catppuccinFrappe = createTheme({
  theme: 'dark',
  settings: {
    background: '#303446',
    foreground: '#c6d0f5',
    caret: '#f2d5cf',
    selection: '#414559',
    selectionMatch: '#363a4f',
    lineHighlight: '#292c3c',
    gutterBackground: '#292c3c',
    gutterForeground: '#626880',
  },
  styles: [
    { tag: t.comment,            color: '#737994' },
    { tag: t.keyword,            color: '#ca9ee6' },
    { tag: t.operator,           color: '#99d1db' },
    { tag: t.string,             color: '#a6d189' },
    { tag: t.number,             color: '#ef9f76' },
    { tag: t.bool,               color: '#ef9f76' },
    { tag: t.null,               color: '#ef9f76' },
    { tag: t.variableName,       color: '#c6d0f5' },
    { tag: t.definition(t.variableName), color: '#8caaee' },
    { tag: t.function(t.variableName),   color: '#8caaee' },
    { tag: t.typeName,           color: '#e5c890' },
    { tag: t.className,          color: '#e5c890' },
    { tag: t.propertyName,       color: '#99d1db' },
    { tag: t.attributeName,      color: '#8caaee' },
    { tag: t.tagName,            color: '#e78284' },
    { tag: t.punctuation,        color: '#c6d0f5' },
    { tag: t.regexp,             color: '#eebebe' },
  ],
});

const catppuccinLatte = createTheme({
  theme: 'light',
  settings: {
    background: '#eff1f5',
    foreground: '#4c4f69',
    caret: '#dc8a78',
    selection: '#acb0be',
    selectionMatch: '#bcc0cc',
    lineHighlight: '#e6e9ef',
    gutterBackground: '#e6e9ef',
    gutterForeground: '#8c8fa1',
  },
  styles: [
    { tag: t.comment,            color: '#8c8fa1' },
    { tag: t.keyword,            color: '#8839ef' },
    { tag: t.operator,           color: '#179299' },
    { tag: t.string,             color: '#40a02b' },
    { tag: t.number,             color: '#fe640b' },
    { tag: t.bool,               color: '#fe640b' },
    { tag: t.null,               color: '#fe640b' },
    { tag: t.variableName,       color: '#4c4f69' },
    { tag: t.definition(t.variableName), color: '#1e66f5' },
    { tag: t.function(t.variableName),   color: '#1e66f5' },
    { tag: t.typeName,           color: '#df8e1d' },
    { tag: t.className,          color: '#df8e1d' },
    { tag: t.propertyName,       color: '#179299' },
    { tag: t.attributeName,      color: '#1e66f5' },
    { tag: t.tagName,            color: '#d20f39' },
    { tag: t.punctuation,        color: '#4c4f69' },
    { tag: t.regexp,             color: '#dd7878' },
  ],
});

// ─── Theme registry ───────────────────────────────────────────────────────────

export interface ThemeEntry {
  label: string;
  group: string;
  extension: Extension;
}

export const THEMES: Record<string, ThemeEntry> = {
  // Catppuccin
  'catppuccin-mocha':      { label: 'Mocha',       group: 'Catppuccin', extension: catppuccinMocha },
  'catppuccin-macchiato':  { label: 'Macchiato',   group: 'Catppuccin', extension: catppuccinMacchiato },
  'catppuccin-frappe':     { label: 'Frappé',      group: 'Catppuccin', extension: catppuccinFrappe },
  'catppuccin-latte':      { label: 'Latte',       group: 'Catppuccin', extension: catppuccinLatte },
  // Tokyo Night
  'tokyo-night':           { label: 'Tokyo Night', group: 'Tokyo Night', extension: tokyoNight },
  // GitHub
  'github-dark':           { label: 'Dark',        group: 'GitHub',     extension: githubDark },
  'github-dark-dimmed':    { label: 'Dark Dimmed', group: 'GitHub',     extension: githubDarkDimmed },
  'github-light':          { label: 'Light',       group: 'GitHub',     extension: githubLight },
  // Solarized
  'solarized-dark':        { label: 'Dark',        group: 'Solarized',  extension: solarizedDark },
  'solarized-light':       { label: 'Light',       group: 'Solarized',  extension: solarizedLight },
};

export const DEFAULT_THEME = 'catppuccin-mocha';

export function getThemeExtension(themeId: string): Extension {
  return (THEMES[themeId] ?? THEMES[DEFAULT_THEME]).extension;
}
