'use client';

// WYSIWYG editor for organizer-authored HTML (blog posts, excerpts, pages).
// Tiptap over ProseMirror; HTML in, HTML out — the backend sanitises on write.
// Loaded with next/dynamic (ssr: false) by RichTextEditorField so it never
// renders on the server.

import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import {
  Bold,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  Redo2,
  Strikethrough,
  Underline,
  Undo2,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  /** `compact` = excerpt-sized box without headings / images. */
  variant?: 'full' | 'compact';
  placeholder?: string;
  /** Opens the Files picker; resolves with the image to insert or null. */
  onInsertImage?: () => Promise<{ url: string; alt: string } | null>;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  testId?: string;
}

const ALLOWED_PROTOCOLS = ['http', 'https', 'mailto', 'tel'];

function isAllowedHref(href: string) {
  try {
    const url = new URL(href, 'https://placeholder.invalid');
    return ALLOWED_PROTOCOLS.includes(url.protocol.replace(':', ''));
  } catch {
    return false;
  }
}

function ToolbarButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`inline-flex h-8 w-8 items-center justify-center rounded text-gray-700 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-40 dark:text-slate-200 dark:hover:bg-slate-700 ${
        active ? 'bg-gray-200 dark:bg-slate-700' : ''
      }`}
    >
      {children}
    </button>
  );
}

function LinkPopover({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const current = editor.getAttributes('link') as { href?: string; target?: string };
  const [href, setHref] = useState(current.href ?? '');
  const [newTab, setNewTab] = useState(current.target === '_blank');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const apply = () => {
    const trimmed = href.trim();
    if (!trimmed) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      onClose();
      return;
    }
    const withProtocol = /^[a-z]+:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
    if (!isAllowedHref(withProtocol)) {
      setError('Enter a web, email or phone link');
      return;
    }
    editor
      .chain()
      .focus()
      .extendMarkRange('link')
      .setLink({ href: withProtocol, target: newTab ? '_blank' : null })
      .run();
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-label="Link"
      className="absolute left-0 top-full z-20 mt-1 w-72 rounded-md border border-gray-200 bg-white p-3 shadow-lg dark:border-slate-600 dark:bg-slate-800"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
          editor.commands.focus();
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          apply();
        }
      }}
    >
      <label
        htmlFor="editor-link-href"
        className="block text-xs font-medium text-gray-700 dark:text-slate-300"
      >
        Link URL
      </label>
      <input
        ref={inputRef}
        id="editor-link-href"
        value={href}
        onChange={(event) => setHref(event.target.value)}
        placeholder="https://"
        className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
      />
      <label className="mt-2 flex items-center gap-2 text-xs text-gray-700 dark:text-slate-300">
        <input
          type="checkbox"
          checked={newTab}
          onChange={(event) => setNewTab(event.target.checked)}
          className="h-3.5 w-3.5 rounded border-gray-300"
        />
        Open in new tab
      </label>
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="mt-3 flex justify-end gap-2">
        {current.href && (
          <button
            type="button"
            onClick={() => {
              editor.chain().focus().extendMarkRange('link').unsetLink().run();
              onClose();
            }}
            className="text-xs font-medium text-gray-600 hover:underline dark:text-slate-300"
          >
            Remove
          </button>
        )}
        <button
          type="button"
          onClick={apply}
          className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-500"
        >
          Apply
        </button>
      </div>
    </div>
  );
}

export default function RichTextEditor({
  value,
  onChange,
  variant = 'full',
  placeholder,
  onInsertImage,
  testId = 'rich-text-editor',
  ...aria
}: RichTextEditorProps) {
  const [linkOpen, setLinkOpen] = useState(false);
  const lastEmitted = useRef(value);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: variant === 'full' ? { levels: [2, 3] } : false,
        codeBlock: false,
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: 'https',
          protocols: ALLOWED_PROTOCOLS,
          HTMLAttributes: { rel: null, target: null },
          isAllowedUri: (url) => isAllowedHref(url),
        },
      }),
      ...(variant === 'full'
        ? [
            Image.configure({
              inline: false,
              allowBase64: false,
              HTMLAttributes: { loading: 'lazy' },
            }),
          ]
        : []),
    ],
    content: value,
    editorProps: {
      attributes: {
        class: 'px-3 py-2 text-sm text-gray-900 dark:text-white',
        'aria-multiline': 'true',
        role: 'textbox',
        ...(aria['aria-label'] ? { 'aria-label': aria['aria-label'] } : {}),
        ...(aria['aria-labelledby'] ? { 'aria-labelledby': aria['aria-labelledby'] } : {}),
      },
    },
    onUpdate: ({ editor: current }) => {
      const html = current.isEmpty ? '' : current.getHTML();
      lastEmitted.current = html;
      onChange(html);
    },
  });

  // External resets (Discard) push new HTML in; our own edits are skipped.
  useEffect(() => {
    if (!editor || value === lastEmitted.current) return;
    lastEmitted.current = value;
    editor.commands.setContent(value || '', { emitUpdate: false });
  }, [editor, value]);

  useEffect(() => {
    if (!editor || !placeholder) return;
    const dom = editor.view.dom as HTMLElement;
    const sync = () => {
      const first = dom.querySelector('p');
      if (editor.isEmpty && first) {
        first.classList.add('is-editor-empty');
        first.setAttribute('data-placeholder', placeholder);
      } else {
        dom
          .querySelectorAll('p.is-editor-empty')
          .forEach((el) => el.classList.remove('is-editor-empty'));
      }
    };
    sync();
    editor.on('update', sync);
    return () => {
      editor.off('update', sync);
    };
  }, [editor, placeholder]);

  if (!editor) {
    return (
      <div
        data-testid={testId}
        className="min-h-40 animate-pulse rounded-md border border-gray-300 bg-gray-50 dark:border-slate-600 dark:bg-slate-900"
      />
    );
  }

  const full = variant === 'full';

  return (
    <div
      data-testid={testId}
      className={`jump-prose jump-prose--editor ${full ? '' : 'jump-prose--compact'}`}
    >
      <div
        role="toolbar"
        aria-label="Text formatting"
        className="relative flex flex-wrap items-center gap-0.5 rounded-t-md border border-b-0 border-gray-300 bg-gray-50 p-1.5 dark:border-slate-600 dark:bg-slate-900"
      >
        {full && (
          <>
            <ToolbarButton
              label="Paragraph"
              active={editor.isActive('paragraph') && !editor.isActive('heading')}
              onClick={() => editor.chain().focus().setParagraph().run()}
            >
              <Pilcrow className="h-4 w-4" aria-hidden />
            </ToolbarButton>
            <ToolbarButton
              label="Heading 2"
              active={editor.isActive('heading', { level: 2 })}
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            >
              <Heading2 className="h-4 w-4" aria-hidden />
            </ToolbarButton>
            <ToolbarButton
              label="Heading 3"
              active={editor.isActive('heading', { level: 3 })}
              onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            >
              <Heading3 className="h-4 w-4" aria-hidden />
            </ToolbarButton>
            <span className="mx-1 h-5 w-px bg-gray-300 dark:bg-slate-600" aria-hidden />
          </>
        )}
        <ToolbarButton
          label="Bold"
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold className="h-4 w-4" aria-hidden />
        </ToolbarButton>
        <ToolbarButton
          label="Italic"
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic className="h-4 w-4" aria-hidden />
        </ToolbarButton>
        <ToolbarButton
          label="Underline"
          active={editor.isActive('underline')}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <Underline className="h-4 w-4" aria-hidden />
        </ToolbarButton>
        <ToolbarButton
          label="Strikethrough"
          active={editor.isActive('strike')}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          <Strikethrough className="h-4 w-4" aria-hidden />
        </ToolbarButton>
        <span className="mx-1 h-5 w-px bg-gray-300 dark:bg-slate-600" aria-hidden />
        <ToolbarButton
          label="Bulleted list"
          active={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List className="h-4 w-4" aria-hidden />
        </ToolbarButton>
        <ToolbarButton
          label="Numbered list"
          active={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered className="h-4 w-4" aria-hidden />
        </ToolbarButton>
        <ToolbarButton
          label="Quote"
          active={editor.isActive('blockquote')}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          <Quote className="h-4 w-4" aria-hidden />
        </ToolbarButton>
        <span className="mx-1 h-5 w-px bg-gray-300 dark:bg-slate-600" aria-hidden />
        <div className="relative">
          <ToolbarButton
            label="Link"
            active={editor.isActive('link') || linkOpen}
            onClick={() => setLinkOpen((open) => !open)}
          >
            <Link2 className="h-4 w-4" aria-hidden />
          </ToolbarButton>
          {linkOpen && <LinkPopover editor={editor} onClose={() => setLinkOpen(false)} />}
        </div>
        {full && onInsertImage && (
          <ToolbarButton
            label="Image"
            onClick={async () => {
              const picked = await onInsertImage();
              if (picked)
                editor.chain().focus().setImage({ src: picked.url, alt: picked.alt }).run();
            }}
          >
            <ImageIcon className="h-4 w-4" aria-hidden />
          </ToolbarButton>
        )}
        {full && (
          <ToolbarButton
            label="Divider"
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
          >
            <Minus className="h-4 w-4" aria-hidden />
          </ToolbarButton>
        )}
        <span className="mx-1 h-5 w-px bg-gray-300 dark:bg-slate-600" aria-hidden />
        <ToolbarButton
          label="Undo"
          disabled={!editor.can().undo()}
          onClick={() => editor.chain().focus().undo().run()}
        >
          <Undo2 className="h-4 w-4" aria-hidden />
        </ToolbarButton>
        <ToolbarButton
          label="Redo"
          disabled={!editor.can().redo()}
          onClick={() => editor.chain().focus().redo().run()}
        >
          <Redo2 className="h-4 w-4" aria-hidden />
        </ToolbarButton>
      </div>
      <EditorContent
        editor={editor}
        className="rounded-b-md border border-gray-300 bg-white focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/30 dark:border-slate-600 dark:bg-slate-900"
      />
    </div>
  );
}
