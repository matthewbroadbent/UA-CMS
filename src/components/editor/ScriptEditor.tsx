'use client';

import { useState } from 'react';
import {
    SaveIcon,
    XIcon,
    TypeIcon,
    AlignLeftIcon,
    LayoutIcon
} from 'lucide-react';

interface ScriptEditorProps {
    script: {
        id: string;
        hook: string;
        script: string;
        closingLine: string;
        durationType: string;
    };
    onSave: (data: { hook: string; script: string; closingLine: string }) => void;
    onCancel: () => void;
}

export default function ScriptEditor({ script, onSave, onCancel }: ScriptEditorProps) {
    const [hook, setHook] = useState(script.hook || '');
    const [body, setBody] = useState(script.script || '');
    const [outro, setOutro] = useState(script.closingLine || '');
    const [isSaving, setIsSaving] = useState(false);

    const handleSave = async () => {
        setIsSaving(true);
        await onSave({ hook, script: body, closingLine: outro });
        setIsSaving(false);
    };

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-900 overflow-hidden">
            {/* Header */}
            <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-white dark:bg-slate-900/50">
                <div>
                    <h2 className="text-sm font-black uppercase tracking-[0.3em] text-indigo-500">Master Script Refinement</h2>
                    <p className="text-[10px] text-slate-400 mt-1 font-medium">{script.durationType} Authority Variant</p>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 text-[11px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="flex items-center gap-2 px-6 py-2.5 bg-black dark:bg-white text-white dark:text-black rounded-xl text-[11px] font-black uppercase tracking-widest transition-all hover:scale-105 active:scale-95 shadow-xl shadow-black/10"
                    >
                        {isSaving ? 'Synchronizing...' : (
                            <><SaveIcon size={14} /> Save Master</>
                        )}
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-10 space-y-12 max-w-4xl mx-auto w-full">
                {/* Hook Section */}
                <div className="space-y-4">
                    <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">
                        <TypeIcon size={14} className="text-indigo-400" />
                        The Hook (Opener)
                    </label>
                    <textarea
                        value={hook}
                        onChange={(e) => setHook(e.target.value)}
                        className="w-full p-6 bg-white dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-[2rem] text-xl font-black text-slate-900 dark:text-white focus:border-indigo-500 focus:ring-0 transition-all placeholder:text-slate-300 min-h-[120px]"
                        placeholder="Lead with authority..."
                    />
                </div>

                {/* Body Section */}
                <div className="space-y-4">
                    <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">
                        <AlignLeftIcon size={14} className="text-indigo-400" />
                        Narrative Core (Body)
                    </label>
                    <textarea
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                        className="w-full p-8 bg-white dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-[2.5rem] text-[16px] leading-relaxed font-medium text-slate-600 dark:text-slate-300 focus:border-indigo-500 focus:ring-0 transition-all placeholder:text-slate-300 min-h-[400px]"
                        placeholder="Build the argument..."
                    />
                </div>

                {/* Outro Section */}
                <div className="space-y-4">
                    <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">
                        <LayoutIcon size={14} className="text-indigo-400" />
                        Closing Line (Outro)
                    </label>
                    <textarea
                        value={outro}
                        onChange={(e) => setOutro(e.target.value)}
                        className="w-full p-6 bg-white dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-[2rem] text-sm italic font-medium text-slate-500 dark:text-slate-400 focus:border-indigo-500 focus:ring-0 transition-all placeholder:text-slate-300 min-h-[100px]"
                        placeholder="End with impact..."
                    />
                </div>
            </div>
        </div>
    );
}
