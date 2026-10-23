import { useEffect, useId, useRef, useState } from 'react';
import { Button } from 'antd';
import { Annotation, Compartment, EditorState, Prec } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, placeholder as editorPlaceholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentLess, indentMore } from '@codemirror/commands';
import { bracketMatching, defaultHighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { python } from '@codemirror/lang-python';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { search, searchKeymap } from '@codemirror/search';
import './code-editor.css';

type EditorMode = 'python' | 'drill-code' | 'text';
type CodeEditorProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  mode: EditorMode;
  readOnly?: boolean;
  disabled?: boolean;
  placeholder?: string;
  describedBy?: string;
};
const externalValue = Annotation.define<boolean>();

export function CodeEditor({ id, label, value, onChange, maxLength, mode, readOnly = false, disabled = false, placeholder = '', describedBy }: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const callback = useRef(onChange);
  callback.current = onChange;
  const currentValue = useRef(value);
  currentValue.current = value;
  const pendingExternalValue = useRef<string | null>(null);
  const limit = useRef(maxLength);
  limit.current = maxLength;
  const behavior = useRef({ mode, disabled, readOnly });
  behavior.current = { mode, disabled, readOnly };
  const [configuration] = useState(() => new Compartment());
  const [focused, setFocused] = useState(false);
  const [lengthWarning, setLengthWarning] = useState(false);
  const helpId = `code-editor-help-${useId()}`;

  useEffect(() => {
    if (!host.current) return;
    let escapedTab = false;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: currentValue.current,
        extensions: [
          configuration.of([]),
          lineNumbers(), highlightActiveLineGutter(), drawSelection(), highlightActiveLine(),
          history(), indentUnit.of('    '), search({ top: true }),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          EditorView.contentAttributes.of({ id, role: 'textbox', 'aria-multiline': 'true', tabindex: '0', 'aria-label': label, 'aria-describedby': [describedBy, helpId].filter(Boolean).join(' '), spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off' }),
          Prec.highest(EditorView.domEventHandlers({
            keydown(event) {
              if (event.isComposing) return false;
              if (event.key === 'Escape') escapedTab = true;
              else if (event.key !== 'Tab') escapedTab = false;
              return false;
            },
            compositionend() {
              // React may receive an imported value during IME composition. Apply it afterwards.
              queueMicrotask(() => {
                const pending = pendingExternalValue.current;
                pendingExternalValue.current = null;
                if (editor.current === view && pending !== null && view.state.doc.toString() !== pending) syncValue(view, pending);
              });
              return false;
            },
          })),
          keymap.of([
            { key: 'Tab', run: active => {
              if (escapedTab || behavior.current.mode === 'text' || active.composing) { escapedTab = false; return false; }
              return indentMore(active);
            } },
            { key: 'Shift-Tab', run: active => {
              if (escapedTab || behavior.current.mode === 'text' || active.composing) { escapedTab = false; return false; }
              return indentLess(active);
            } },
            { key: 'Enter', run: active => {
              if (behavior.current.mode !== 'drill-code') return false;
              active.dispatch(active.state.replaceSelection('\n'), { scrollIntoView: true, userEvent: 'input' });
              return true;
            } },
            ...defaultKeymap, ...historyKeymap, ...searchKeymap,
          ]),
          EditorState.transactionFilter.of(transaction => {
            if (!transaction.docChanged || transaction.annotation(externalValue)) return transaction;
            if (transaction.newDoc.length <= limit.current) return transaction;
            setLengthWarning(true);
            return [];
          }),
          EditorView.updateListener.of(update => {
            if (update.docChanged && !update.transactions.some(transaction => transaction.annotation(externalValue))) {
              setLengthWarning(false);
              callback.current(update.state.doc.toString());
            }
          }),
        ],
      }),
    });
    editor.current = view;
    return () => { editor.current = null; view.destroy(); };
  }, [configuration, describedBy, helpId, id, label]);

  useEffect(() => {
    const view = editor.current;
    if (!view) return;
    view.dispatch({ effects: configuration.reconfigure([
      EditorState.readOnly.of(readOnly || disabled), EditorView.editable.of(!readOnly && !disabled),
      EditorView.contentAttributes.of({ 'aria-disabled': String(disabled), 'aria-readonly': String(readOnly || disabled) }),
      editorPlaceholder(placeholder),
      ...(mode === 'text' ? [EditorView.lineWrapping] : [python(), bracketMatching()]),
      ...(mode === 'python' ? [indentOnInput(), closeBrackets(), keymap.of(closeBracketsKeymap)] : []),
    ]) });
  }, [configuration, disabled, mode, placeholder, readOnly]);

  useEffect(() => {
    const view = editor.current;
    if (!view) return;
    if (view.state.doc.toString() === value) { pendingExternalValue.current = null; return; }
    if (view.composing) pendingExternalValue.current = value;
    else syncValue(view, value);
  }, [value]);

  useEffect(() => {
    if (!focused) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    editor.current?.focus();
    return () => { document.body.style.overflow = previous; };
  }, [focused]);

  return <div className={`code-editor${focused ? ' is-focused' : ''}${disabled ? ' is-disabled' : ''}`} role={focused ? 'dialog' : 'region'} aria-modal={focused || undefined} aria-label={`${label}编辑器`} onKeyDown={event => {
    if (!focused || event.key !== 'Tab' || event.defaultPrevented) return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]),[tabindex="0"],input:not([disabled])')).filter(element => element.getClientRects().length > 0);
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first && last) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last && first) { event.preventDefault(); first.focus(); }
  }}>
    <div className="code-editor-toolbar"><span>{mode === 'text' ? '文本跟打' : 'Python'}{readOnly ? ' · 只读' : mode === 'drill-code' ? ' · 跟打模式' : ''}</span><Button size="small" onClick={() => setFocused(current => !current)} aria-pressed={focused}>{focused ? '退出专注' : '专注编辑'}</Button></div>
    <div className="code-editor-host" ref={host} />
    <div className="code-editor-footer"><span id={helpId}>{mode === 'text' ? 'Tab 移到下一个控件。' : 'Tab 缩进；先按 Esc 再按 Tab 移出编辑器。'} Ctrl/⌘ + F 搜索。</span><span>{value.length} / {maxLength}</span></div>
    {lengthWarning ? <p className="code-editor-limit" role="status">已达到 {maxLength} 字符上限，未添加超出的内容。</p> : null}
  </div>;
}

function syncValue(view: EditorView, value: string) {
  const selection = view.state.selection.main;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: value },
    selection: { anchor: Math.min(selection.anchor, value.length), head: Math.min(selection.head, value.length) },
    annotations: externalValue.of(true),
  });
}
