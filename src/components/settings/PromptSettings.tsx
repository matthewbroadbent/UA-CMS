'use client';

import { useState, useEffect } from 'react';
import { SaveIcon, CheckIcon, Loader2Icon, LayersIcon, TypeIcon, SparklesIcon } from 'lucide-react';

export default function PromptSettings() {
    const [prompts, setPrompts] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState<string | null>(null);
    const [saved, setSaved] = useState<string | null>(null);

    useEffect(() => {
        fetchPrompts();
    }, []);

    const fetchPrompts = async () => {
        try {
            const res = await fetch('/api/settings/prompts');
            const data = await res.json();
            setPrompts(data);
        } catch (e) {
            console.error('Failed to fetch prompts', e);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async (key: string) => {
        setSaving(key);
        try {
            await fetch('/api/settings/prompts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key, content: prompts[key] }),
            });
            setSaved(key);
            setTimeout(() => setSaved(null), 2000);
        } catch (e) {
            console.error('Failed to save prompt', e);
        } finally {
            setSaving(null);
        }
    };

    if (loading) return <div className="p-8 text-center text-slate-500">Loading AI Prompts...</div>;

    const sections = [
        {
            title: "Stage 1: Control (Article Spine)",
            icon: <LayersIcon size={18} />,
            description: "Derive structural logic, extract facts, and enforce constraints from raw inputs.",
            keys: ['SUBSTACK_STAGE_1']
        },
        {
            title: "Stage 2: Prose (The Article)",
            icon: <TypeIcon size={18} />,
            description: "Write the final markdown output using the Spine and raw inputs.",
            keys: ['SUBSTACK_STAGE_2']
        },
        {
            title: "Supporting Content",
            icon: <SparklesIcon size={18} />,
            description: "Prompts for video scripts and other auxiliary formats.",
            keys: ['VIDEO_SCRIPTS']
        }
    ];

    return (
        <div className="space-y-12 max-w-4xl mx-auto p-4">
            <header className="mb-4">
                <h2 className="text-2xl font-bold dark:text-white">AI Prompt Engineering</h2>
                <p className="text-sm text-slate-500 mt-1">Refine the multi-stage "thinking surface" logic for your content pipeline.</p>
            </header>

            {sections.map((section, sIdx) => (
                <div key={sIdx} className="space-y-6">
                    <div className="flex items-center gap-3 border-b border-slate-200 dark:border-slate-800 pb-2">
                        <div className="p-2 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-lg">
                            {section.icon}
                        </div>
                        <div>
                            <h3 className="font-bold text-lg dark:text-slate-100">{section.title}</h3>
                            <p className="text-xs text-slate-500">{section.description}</p>
                        </div>
                    </div>

                    <div className="space-y-8">
                        {section.keys.map((key) => {
                            if (!prompts[key]) return null;
                            return (
                                <section key={key} className="glass appearance-none rounded-xl border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm overflow-hidden shadow-sm">
                                    <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/30 flex items-center justify-between">
                                        <div>
                                            <h3 className="font-semibold text-sm uppercase tracking-wider dark:text-slate-200">{key.replace('SUBSTACK_', '').replace('_', ' ')}</h3>
                                            <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                                                Tokens: {
                                                    key === 'SUBSTACK_STAGE_1' ? '{{theme}}, {{thinking}}, {{reality}}, {{rant}}, {{nuclear}}, {{anythingElse}}' :
                                                        key === 'SUBSTACK_STAGE_2' ? '{{article_spine_json}}, {{thinking}}, {{reality}}, {{rant}}, {{nuclear}}, {{anythingElse}}' :
                                                            '{{article}}'
                                                }
                                            </p>
                                        </div>
                                        <button
                                            onClick={() => handleSave(key)}
                                            disabled={saving === key}
                                            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${saved === key
                                                ? 'bg-emerald-500 text-white'
                                                : 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:scale-[1.02]'
                                                }`}
                                        >
                                            {saving === key ? <Loader2Icon size={14} className="animate-spin" /> : saved === key ? <CheckIcon size={14} /> : <SaveIcon size={14} />}
                                            {saved === key ? 'Saved' : 'Update Template'}
                                        </button>
                                    </div>
                                    <div className="p-4">
                                        <textarea
                                            value={prompts[key]}
                                            onChange={(e) => setPrompts({ ...prompts, [key]: e.target.value })}
                                            className="w-full h-96 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-4 text-xs font-mono text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all resize-y leading-relaxed"
                                            spellCheck={false}
                                        />
                                    </div>
                                </section>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
}
