/**
 * Editor for mail texts with {{placeholders}}, made for non-technical users:
 *  - every placeholder shows as a box holding its real value ([Mundra], [Ravi], …), or its name when
 *    there is no value yet;
 *  - "/" opens the list of all values, ↑ ↓ to choose, Enter to insert, Esc to close (typing filters it,
 *    "//" types a plain slash);
 *  - Backspace (or Delete) next to a box highlights it, a second press removes it;
 *  - one space is kept on each side of a box (double spaces become one).
 * The value stays a plain string with {{key}} placeholders, as the server expects.
 */
import { TEMPLATE_PLACEHOLDERS, templateParts, tidyTemplateSpacing } from '@rmm/shared';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';

type Vars = Record<string, string | null | undefined>;

const LABELS: Record<string, string> = Object.fromEntries(TEMPLATE_PLACEHOLDERS.map((p) => [p.key, p.label]));
const ZW = /​/g;
const isChip = (n: Node | null | undefined): n is HTMLElement => !!n && n instanceof HTMLElement && !!n.dataset.var;
const chipLen = (el: HTMLElement) => `{{${el.dataset.var}}}`.length;

function paintChip(el: HTMLElement, vars?: Vars) {
  const key = el.dataset.var!;
  const v = vars?.[key];
  el.textContent = v ? v : (LABELS[key] ?? key);
  el.className = `tpl-chip${v ? '' : ' tpl-chip-empty'}`;
  el.title = `${LABELS[key] ?? key}${v ? '' : ' (filled in for each mail)'} — press Backspace twice to remove`;
}

function makeChip(key: string, vars?: Vars) {
  const el = document.createElement('span');
  el.contentEditable = 'false';
  el.dataset.var = key;
  paintChip(el, vars);
  return el;
}

/** The DOM holds only text nodes and chips; a text node is kept at both ends so the caret can reach them. */
function build(root: HTMLElement, value: string, vars?: Vars) {
  const nodes: Node[] = templateParts(value).map((p) => ('key' in p ? makeChip(p.key, vars) : document.createTextNode(p.text)));
  if (!nodes.length || isChip(nodes[0])) nodes.unshift(document.createTextNode(''));
  if (isChip(nodes[nodes.length - 1])) nodes.push(document.createTextNode(''));
  root.replaceChildren(...nodes);
  ensureTail(root);
}

/** A newline at the very end is invisible in pre-wrap text unless something follows it. */
function ensureTail(root: HTMLElement) {
  const last = root.lastChild;
  if (last?.nodeType === Node.TEXT_NODE && /\n$/.test((last.textContent ?? '').replace(ZW, ''))) last.textContent = `${(last.textContent ?? '').replace(ZW, '')}​`;
}

function serialize(root: HTMLElement): string {
  let s = '';
  root.childNodes.forEach((n) => {
    if (n.nodeType === Node.TEXT_NODE) s += (n.textContent ?? '').replace(ZW, '').replace(/ /g, ' ');
    else if (isChip(n)) s += `{{${n.dataset.var}}}`;
    else if (n.nodeName === 'BR') s += n === root.lastChild ? '' : '\n';
    else s += (n.textContent ?? '').replace(ZW, '');
  });
  return s;
}

/** Caret position as an offset into the serialized text (chips count as their {{key}}). */
function caretOffset(root: HTMLElement): number | null {
  const sel = window.getSelection();
  if (!sel?.rangeCount) return null;
  const r = sel.getRangeAt(0);
  let acc = 0;
  for (const n of Array.from(root.childNodes)) {
    if (r.startContainer === root && root.childNodes[r.startOffset] === n) return acc;
    if (n === r.startContainer) return acc + (n.textContent ?? '').slice(0, r.startOffset).replace(ZW, '').length;
    acc += isChip(n) ? chipLen(n) : (n.textContent ?? '').replace(ZW, '').length;
  }
  return acc;
}

function placeCaret(root: HTMLElement, target: number) {
  const sel = window.getSelection();
  if (!sel) return;
  const r = document.createRange();
  let acc = 0;
  for (const n of Array.from(root.childNodes)) {
    if (isChip(n)) {
      if (target <= acc) {
        r.setStartBefore(n);
        break;
      }
      acc += chipLen(n);
      continue;
    }
    const len = (n.textContent ?? '').replace(ZW, '').length;
    if (target <= acc + len) {
      r.setStart(n, Math.max(0, target - acc));
      break;
    }
    acc += len;
    r.setStartAfter(n);
  }
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

/** The chip right before (dir -1) or after (dir 1) a collapsed caret, if any. */
function chipBeside(root: HTMLElement, dir: -1 | 1): HTMLElement | null {
  const sel = window.getSelection();
  if (!sel?.rangeCount || !sel.isCollapsed) return null;
  const { startContainer: c, startOffset: o } = sel.getRangeAt(0);
  if (c === root) return (dir < 0 ? root.childNodes[o - 1] : root.childNodes[o]) as HTMLElement | null;
  if (c.nodeType !== Node.TEXT_NODE || c.parentNode !== root) return null;
  const text = c.textContent ?? '';
  if (dir < 0 && text.slice(0, o).replace(ZW, '') === '') return isChip(c.previousSibling) ? c.previousSibling : null;
  if (dir > 0 && text.slice(o).replace(ZW, '') === '') return isChip(c.nextSibling) ? c.nextSibling : null;
  return null;
}

export function TemplateEditor({
  value,
  onChange,
  vars,
  multiline = false,
  rows = 8,
  ariaLabel,
  id,
  disabled,
  invalid,
  placeholder,
  nav,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Real values to show in the boxes (missing ones show the placeholder's name). */
  vars?: Vars;
  multiline?: boolean;
  rows?: number;
  ariaLabel?: string;
  id?: string;
  disabled?: boolean;
  invalid?: boolean;
  placeholder?: string;
  /** Take part in Enter-to-next-field form navigation (one-line editors only). */
  nav?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef<string | null>(null);
  const armed = useRef<HTMLElement | null>(null);
  const saved = useRef<Range | null>(null);
  const [menu, setMenu] = useState<{ filter: string; index: number; x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(!value);

  const options = useMemo(() => {
    const f = menu?.filter.toLowerCase() ?? '';
    return TEMPLATE_PLACEHOLDERS.filter((p) => !f || p.label.toLowerCase().includes(f) || p.key.includes(f) || (vars?.[p.key] ?? '').toLowerCase().includes(f));
  }, [menu?.filter, vars]);

  // value from outside (template picked, form loaded): redraw; our own edits are skipped
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || value === last.current) return;
    last.current = value;
    build(root, value, vars);
    setEmpty(!value);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    ref.current?.querySelectorAll<HTMLElement>('[data-var]').forEach((el) => paintChip(el, vars));
  }, [vars]);

  const emit = (v: string) => {
    last.current = v;
    setEmpty(!v);
    onChange(v);
  };

  /** Save a new value and redraw it, putting the caret at `caret` (serialized offset). */
  const commit = (v: string, caret: number | null) => {
    const root = ref.current!;
    emit(v);
    build(root, v, vars);
    if (caret !== null) placeCaret(root, caret);
  };

  const disarm = () => {
    armed.current?.classList.remove('tpl-chip-armed');
    armed.current = null;
  };

  const insertText = (text: string) => {
    const root = ref.current!;
    const sel = window.getSelection();
    if (!sel?.rangeCount) return;
    const r = sel.getRangeAt(0);
    r.deleteContents();
    const node = document.createTextNode(text);
    r.insertNode(node);
    r.setStartAfter(node);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    root.normalize();
    if (text.includes('{{')) {
      const at = caretOffset(root);
      const v = serialize(root);
      commit(v, at);
    } else {
      ensureTail(root);
      emit(serialize(root));
    }
  };

  const openMenu = () => {
    const root = ref.current!;
    const sel = window.getSelection();
    if (!sel?.rangeCount) return;
    saved.current = sel.getRangeAt(0).cloneRange();
    const rect = saved.current.getBoundingClientRect();
    const box = root.getBoundingClientRect();
    const x = (rect.left || box.left + 8) - box.left;
    const y = (rect.bottom || box.top + 22) - box.top + 4;
    setMenu({ filter: '', index: 0, x, y });
  };

  const closeMenu = () => {
    setMenu(null);
    const root = ref.current;
    if (root && saved.current) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(saved.current);
    }
    saved.current = null;
  };

  const insertVar = (key: string) => {
    const root = ref.current!;
    root.focus();
    const sel = window.getSelection()!;
    const r = saved.current ?? (sel.rangeCount ? sel.getRangeAt(0) : null);
    setMenu(null);
    saved.current = null;
    if (!r) return;
    r.deleteContents();
    const chip = makeChip(key, vars);
    r.insertNode(chip);
    chip.after(document.createTextNode(' '));
    const index = Array.from(root.querySelectorAll('[data-var]')).indexOf(chip);
    const v = tidyTemplateSpacing(serialize(root));
    // caret just after the inserted box and its space
    let seen = -1;
    let caret = v.length;
    for (const m of v.matchAll(/\{\{[a-z_]+\}\}/gi)) {
      if (++seen === index) {
        caret = m.index + m[0].length + (v[m.index + m[0].length] === ' ' ? 1 : 0);
        break;
      }
    }
    commit(v, caret);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (menu) {
      const stop = () => {
        e.preventDefault();
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
      };
      if (e.key === 'Escape') return stop(), closeMenu();
      if (e.key === 'ArrowDown') return stop(), setMenu({ ...menu, index: Math.min(options.length - 1, menu.index + 1) });
      if (e.key === 'ArrowUp') return stop(), setMenu({ ...menu, index: Math.max(0, menu.index - 1) });
      if (e.key === 'Enter' || e.key === 'Tab') {
        stop();
        if (options[menu.index]) insertVar(options[menu.index].key);
        else closeMenu();
        return;
      }
      if (e.key === 'Backspace') {
        stop();
        if (!menu.filter) closeMenu();
        else setMenu({ ...menu, filter: menu.filter.slice(0, -1), index: 0 });
        return;
      }
      if (e.key === '/' || (e.key === ' ' && !menu.filter)) {
        stop();
        closeMenu();
        insertText(e.key === '/' ? '/' : '/ ');
        return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        stop();
        setMenu({ ...menu, filter: menu.filter + e.key, index: 0 });
        return;
      }
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) setMenu(null);
      return;
    }

    if (e.key === 'Backspace' || e.key === 'Delete') {
      const chip = chipBeside(ref.current!, e.key === 'Backspace' ? -1 : 1) ?? (armed.current && ref.current!.contains(armed.current) ? armed.current : null);
      if (!chip) return disarm();
      e.preventDefault();
      if (armed.current === chip) {
        const root = ref.current!;
        const before = Array.from(root.childNodes).slice(0, Array.from(root.childNodes).indexOf(chip));
        const at = before.reduce((n, x) => n + (isChip(x) ? chipLen(x) : (x.textContent ?? '').replace(ZW, '').length), 0);
        chip.remove();
        armed.current = null;
        const raw = serialize(root);
        // close the gap the removed box leaves: exactly one space, none before punctuation or at a line edge
        const head = raw.slice(0, at).replace(/ +$/, '');
        const tail = raw.slice(at).replace(/^ +/, '');
        const sep = head && tail && !/\n$/.test(head) && !/^[\n.,;:!?)\]]/.test(tail) ? ' ' : '';
        const v = head + sep + tail;
        const caret = head.length;
        commit(v, caret);
      } else {
        disarm();
        armed.current = chip;
        chip.classList.add('tpl-chip-armed');
      }
      return;
    }
    disarm();
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      openMenu();
      return;
    }
    if (e.key === 'Enter') {
      if (!multiline) {
        e.preventDefault(); // one line: Enter moves to the next field (form navigation)
        return;
      }
      if (e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      insertText('\n');
    }
  };

  const minHeight = multiline ? `${rows * 1.45 + 0.8}em` : undefined;

  return (
    <div className="relative">
      <div
        ref={ref}
        id={id}
        role="textbox"
        aria-multiline={multiline}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        aria-disabled={disabled || undefined}
        data-nav={nav && !multiline ? '1' : undefined}
        data-combobox-open={menu ? '1' : undefined}
        data-empty={empty || undefined}
        data-placeholder={placeholder ?? 'Type here — press / to insert a value'}
        contentEditable={!disabled}
        suppressContentEditableWarning
        spellCheck
        tabIndex={disabled ? -1 : 0}
        className={`field-input tpl-editor ${multiline ? 'overflow-y-auto' : 'whitespace-nowrap! overflow-x-auto'}`}
        style={{ minHeight, maxHeight: multiline ? '28em' : undefined }}
        onKeyDown={onKeyDown}
        onInput={() => {
          disarm();
          emit(serialize(ref.current!));
        }}
        onPaste={(e) => {
          e.preventDefault();
          const t = e.clipboardData.getData('text/plain');
          insertText(multiline ? t.replace(/\r\n?/g, '\n') : t.replace(/\s*[\r\n]+\s*/g, ' '));
        }}
        onDrop={(e) => e.preventDefault()}
        onMouseDown={(e) => {
          const chip = (e.target as HTMLElement).closest?.('[data-var]') as HTMLElement | null;
          disarm();
          if (chip && ref.current?.contains(chip)) {
            armed.current = chip;
            chip.classList.add('tpl-chip-armed');
          }
        }}
        onBlur={() => {
          disarm();
          setTimeout(() => setMenu(null), 150);
          const root = ref.current;
          if (!root) return;
          const tidy = tidyTemplateSpacing(serialize(root)).replace(/[ \t]+$/gm, '');
          if (tidy !== serialize(root) || root.querySelector(':scope > :not([data-var])')) commit(tidy, null);
        }}
      />
      {menu && (
        <div
          role="listbox"
          aria-label="Insert a value"
          className="absolute z-50 max-h-64 w-72 overflow-auto rounded-md border border-slate-200 bg-white py-1 text-[13px] shadow-lg"
          style={{ left: Math.max(0, Math.min(menu.x, (ref.current?.clientWidth ?? 300) - 288)), top: menu.y }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="border-b border-slate-100 px-2.5 pb-1 text-[11.5px] text-slate-500">
            {menu.filter ? `Matching “${menu.filter}”` : 'Insert a value'} · ↑ ↓ Enter · Esc to close
          </div>
          {!options.length && <div className="px-2.5 py-1.5 text-slate-400">Nothing matches</div>}
          {options.map((p, i) => (
            <button
              key={p.key}
              type="button"
              role="option"
              aria-selected={i === menu.index}
              tabIndex={-1}
              ref={(el) => {
                if (i === menu.index) el?.scrollIntoView({ block: 'nearest' });
              }}
              onMouseEnter={() => setMenu((m) => (m ? { ...m, index: i } : m))}
              onClick={() => insertVar(p.key)}
              className={`flex w-full items-baseline justify-between gap-3 px-2.5 py-1 text-left ${i === menu.index ? 'bg-brand-50 text-brand-800' : 'text-slate-700'}`}
            >
              <span>{p.label}</span>
              <span className="truncate text-[12px] text-slate-400">{vars?.[p.key] ?? ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
