'use client';

import { useState } from 'react';
import {
    BoldIcon,
    ItalicIcon,
    Heading1Icon,
    Heading2Icon,
    Heading3Icon,
    Trash2Icon,
    SaveIcon,
    CheckIcon
} from 'lucide-react';

interface StageEditorProps {
    initialContent: string;
    onSave: (content: string) => void;
    title: string;
}

export default function StageEditor({ initialContent, onSave, title }: StageEditorProps) {
    const [content, setContent] = useState(initialContent);
    const [isSaving, setIsSaving] = useState(false);

    const handleSave = async () => {
        setIsSaving(true);
        await onSave(content);
        setIsSaving(false);
    };

    const insertText = (before: string, after: string = '') => {
        const textarea = document.getElementById('editor-textarea') as HTMLTextAreaElement;
        if (!textarea) return;

        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = textarea.value;
        const selected = text.substring(start, end);
        const newText = text.substring(0, start) + before + selected + after + text.substring(end);

        setContent(newText);

        // Reset focus and selection
        setTimeout(() => {
            textarea.focus();
            textarea.setSelectionRange(start + before.length, end + before.length);
        }, 0);
    };

    return (
        <div className="flex flex-col h-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-2xl">
            {/* Toolbar */}
            <div className="flex items-center justify-between p-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
                <div className="flex items-center gap-1">
                    <ToolbarButton icon={Heading1Icon} onClick={() => insertText('# ')} label="H1" />
                    <ToolbarButton icon={Heading2Icon} onClick={() => insertText('## ')} label="H2" />
                    <ToolbarButton icon={Heading3Icon} onClick={() => insertText('### ')} label="H3" />
                    <div className="w-px h-4 bg-slate-300 dark:bg-slate-700 mx-1" />
                    <ToolbarButton icon={BoldIcon} onClick={() => insertText('**', '**')} label="Bold" />
                    <ToolbarButton icon={ItalicIcon} onClick={() => insertText('_', '_')} label="Italic" />
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="flex items-center gap-2 px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-md text-sm font-medium transition-colors"
                    >
                        {isSaving ? 'Saving...' : (
                            <><SaveIcon size={14} /> Save Draft</>
                        )}
                    </button>
                </div>
            </div>

            {/* Title Area */}
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800">
                <h2 className="text-xl font-bold dark:text-white">{title}</h2>
            </div>

            {/* Editor Main */}
            <div className="flex-1 p-6 overflow-hidden">
                <textarea
                    id="editor-textarea"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    className="w-full h-full resize-none bg-transparent border-none focus:ring-0 text-lg leading-relaxed dark:text-slate-300 font-serif"
                    placeholder="Start writing your UA transmission..."
                />
            </div>
        </div>
    );
}

function ToolbarButton({ icon: Icon, onClick, label }: { icon: any, onClick: () => void, label: string }) {
    return (
        <button
            onClick={onClick}
            className="p-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-md transition-colors text-slate-600 dark:text-slate-400"
            title={label}
        >
            <Icon size={18} />
        </button>
    );
}
