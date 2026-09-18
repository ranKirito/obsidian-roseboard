import type { BoardSession } from '../persistence/session';
/** How wheel events are interpreted. `auto` detects a mouse wheel from its notch-sized deltas. */
export type InputDevice = 'auto' | 'trackpad' | 'mouse';
export interface Preferences {
  minimap: boolean;
  snap: boolean;
  input: InputDevice;
  /** Viewport culling: render only cards inside the visible area. `auto` enables it on large boards. */
  culling: 'auto' | 'on' | 'off';
}
export type MenuItemSpec =
  | { separator: true }
  | {
      separator?: false;
      title: string;
      icon?: string;
      checked?: boolean;
      disabled?: boolean;
      warning?: boolean;
      /** A non-interactive heading line. */
      label?: boolean;
      action?: () => void;
    };
export interface BoardHost {
  session: BoardSession;
  openSource(): Promise<void>;
  exportJSON(): Promise<void>;
  openNote(path: string): void;
  noteExists(path: string): boolean;
  pickNote(): Promise<string | undefined>;
  confirm(title: string, description: string): Promise<boolean>;
  notify(message: string): void;
  /** Native context menu at a pointer position; items with `action` are clickable. */
  showMenu(at: { x: number; y: number }, items: MenuItemSpec[]): void;
  preferences: Preferences;
  savePreferences(preferences: Preferences): void;
  subscribeNotes(callback: () => void): () => void;
  platform: { touch: boolean; mac: boolean };
  /** Name recorded on this device's edits, or empty when stamps are off. */
  deviceName: string;
}
