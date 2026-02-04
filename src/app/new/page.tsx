'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeftIcon, SendIcon } from 'lucide-react';

export default function NewInquiry() {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [form, setForm] = useState({
        uaId: `UA-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${new Date().toISOString().slice(11, 16).replace(/:/g, '')}`,
        theme: '',
        thinking: '',
        reality: '',
        rant: '',
        nuclear: '',
        anythingElse: '',
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const res = await fetch('/api/inquiry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(form),
            });

            if (res.ok) {
                const data = await res.json();
                console.log('Inquiry created:', data);
                // Small delay to ensure DB write completes
                await new Promise(resolve => setTimeout(resolve, 500));
                router.push('/');
            } else {
                const error = await res.json();
                console.error('Server error:', error);
                alert(`Failed to create inquiry: ${error.error || 'Unknown error'}`);
            }
        } catch (error) {
            console.error('Submit error:', error);
            alert('Network error: Could not submit inquiry');
        } finally {
            setLoading(false);
        }
    };

    return (
        <main className="min-h-screen bg-slate-50 dark:bg-slate-900 p-8">
            <div className="max-w-2xl mx-auto">
                <button
                    onClick={() => router.back()}
                    className="flex items-center gap-2 text-slate-500 hover:text-slate-900 dark:hover:text-white mb-8 transition-colors"
                >
                    <ChevronLeftIcon size={20} /> Back to Kanban
                </button>

                <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                    <div className="p-8 border-b border-slate-100 dark:border-slate-700">
                        <h1 className="text-3xl font-bold dark:text-white">Sunday Interrogation</h1>
                        <p className="text-slate-500 mt-2">Dump your weekly thinking here. Be blunt.</p>
                    </div>

                    <form onSubmit={handleSubmit} className="p-8 space-y-6">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">UA ID</label>
                                <input
                                    type="text"
                                    value={form.uaId}
                                    onChange={e => setForm({ ...form, uaId: e.target.value })}
                                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">A) This week’s theme</label>
                            <input
                                required
                                type="text"
                                value={form.theme}
                                onChange={e => setForm({ ...form, theme: e.target.value })}
                                placeholder="What is the central idea?"
                                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">B) Thinking</label>
                            <textarea
                                rows={3}
                                value={form.thinking}
                                onChange={e => setForm({ ...form, thinking: e.target.value })}
                                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">C) Reality</label>
                                <textarea
                                    rows={3}
                                    value={form.reality}
                                    onChange={e => setForm({ ...form, reality: e.target.value })}
                                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">D) Rant</label>
                                <textarea
                                    rows={3}
                                    value={form.rant}
                                    onChange={e => setForm({ ...form, rant: e.target.value })}
                                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-red-600 dark:text-red-400 mb-1 font-bold">E) Nuclear Option (Internal Only)</label>
                            <textarea
                                rows={2}
                                value={form.nuclear}
                                onChange={e => setForm({ ...form, nuclear: e.target.value })}
                                placeholder="What's the raw, unpolished, 'nuclear' version of this thought?"
                                className="w-full bg-red-50/30 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 rounded-lg p-2.5"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">F) Anything Else?</label>
                            <textarea
                                rows={2}
                                value={form.anythingElse}
                                onChange={e => setForm({ ...form, anythingElse: e.target.value })}
                                placeholder="Any specific facts, numbers, or contexts?"
                                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5"
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-xl shadow-lg shadow-blue-500/30 flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                        >
                            {loading ? 'Submitting...' : <><SendIcon size={20} /> Initiate Pipeline</>}
                        </button>
                    </form>
                </div>
            </div>
        </main>
    );
}
