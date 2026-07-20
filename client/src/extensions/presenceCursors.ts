/**
 * presenceCursors — CodeMirror 6 extension for live cursor/selection rendering.
 *
 * Exports:
 *  - PresenceState         interface for per-user cursor data
 *  - updatePresenceEffect  StateEffect to update the presence map
 *  - presenceField         StateField holding ReadonlyMap<userId, PresenceState>
 *  - presenceCursors       Extension bundle (field + plugin); include in EditorView
 */

import {
  ViewPlugin,
  Decoration,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
  type EditorView,
} from '@codemirror/view';
import { StateField, StateEffect, type Extension, type Range } from '@codemirror/state';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PresenceState {
  cursor: { from: number; to: number };
  name: string;
  color: string;
}

// ─── StateEffect ──────────────────────────────────────────────────────────────

/**
 * Dispatch this effect to add/update (state !== null) or remove (state === null)
 * a remote user's cursor from the editor.
 */
export const updatePresenceEffect = StateEffect.define<{
  userId: string;
  state: PresenceState | null;
}>();

// ─── StateField ───────────────────────────────────────────────────────────────

/**
 * Holds the current presence map. Only creates a new Map instance when an
 * updatePresenceEffect is present, to avoid unnecessary recomputations.
 */
export const presenceField = StateField.define<ReadonlyMap<string, PresenceState>>({
  create: () => new Map<string, PresenceState>(),

  update(value, tr) {
    const effects = tr.effects.filter((e) => e.is(updatePresenceEffect));
    if (effects.length === 0) return value;

    const next = new Map(value);
    for (const effect of effects) {
      if (effect.value.state === null) {
        next.delete(effect.value.userId);
      } else {
        next.set(effect.value.userId, effect.value.state);
      }
    }
    return next;
  },
});

// ─── Cursor widget ────────────────────────────────────────────────────────────

class CursorWidget extends WidgetType {
  constructor(
    readonly userId: string,
    readonly color: string,
    readonly name: string,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement('span');
    wrapper.setAttribute('data-presence-user', this.userId);
    wrapper.style.cssText =
      'position: relative; display: inline-block; width: 0; overflow: visible; pointer-events: none; user-select: none;';

    const caret = document.createElement('span');
    caret.style.cssText = [
      'position: absolute',
      `border-left: 2px solid ${this.color}`,
      'height: 1.15em',
      'top: 0',
      'left: -1px',
    ].join(';');

    const label = document.createElement('span');
    label.textContent = this.name;
    label.style.cssText = [
      'position: absolute',
      'top: -1.5em',
      'left: -1px',
      `background: ${this.color}`,
      'color: #fff',
      'font-size: 0.68em',
      'font-family: ui-sans-serif, system-ui, sans-serif',
      'padding: 1px 5px',
      'border-radius: 3px 3px 3px 0',
      'white-space: nowrap',
      'user-select: none',
      'pointer-events: none',
      'line-height: 1.4',
    ].join(';');

    wrapper.appendChild(caret);
    wrapper.appendChild(label);
    return wrapper;
  }

  eq(other: CursorWidget): boolean {
    return (
      other.userId === this.userId &&
      other.color === this.color &&
      other.name === this.name
    );
  }

  ignoreEvent(): boolean {
    return true;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return `rgba(128,128,128,${alpha})`;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ─── Decoration builder ───────────────────────────────────────────────────────

function buildDecorations(view: EditorView): DecorationSet {
  const map = view.state.field(presenceField);
  const docLength = view.state.doc.length;
  const widgets: Range<Decoration>[] = [];

  for (const [userId, state] of map) {
    const rawFrom = state.cursor.from;
    const rawTo = state.cursor.to;

    // Clamp to valid document range
    const safeFrom = Math.max(0, Math.min(rawFrom, docLength));
    const safeTo = Math.max(0, Math.min(rawTo, docLength));

    if (safeFrom !== safeTo) {
      // Selection range highlight — Decoration.mark requires lo < hi
      const lo = Math.min(safeFrom, safeTo);
      const hi = Math.max(safeFrom, safeTo);
      widgets.push(
        Decoration.mark({
          attributes: {
            style: [
              `background: ${hexToRgba(state.color, 0.25)}`,
              `border-bottom: 2px solid ${hexToRgba(state.color, 0.6)}`,
            ].join('; '),
          },
          class: 'cm-presence-selection',
        }).range(lo, hi),
      );
    }

    // Caret at the cursor head (safeTo)
    widgets.push(
      Decoration.widget({
        widget: new CursorWidget(userId, state.color, state.name),
        side: 1,
      }).range(safeTo),
    );
  }

  // DecorationSet.set requires ranges sorted by from position
  widgets.sort((a, b) => a.from - b.from);

  try {
    return Decoration.set(widgets, true /* assume sorted */);
  } catch {
    // Defensive: malformed ranges (e.g. overlapping marks) — return nothing
    return Decoration.none;
  }
}

// ─── ViewPlugin ───────────────────────────────────────────────────────────────

const presencePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate): void {
      const presenceChanged = update.transactions.some((tr) =>
        tr.effects.some((e) => e.is(updatePresenceEffect)),
      );
      if (update.docChanged || presenceChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

// ─── Public extension bundle ──────────────────────────────────────────────────

/**
 * Include in your EditorView's extensions array.
 * Use `updatePresenceEffect` to update presence state from outside the editor.
 */
export const presenceCursors: Extension = [presenceField, presencePlugin];
