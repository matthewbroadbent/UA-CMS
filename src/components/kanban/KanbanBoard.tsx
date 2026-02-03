'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    PlusIcon,
    ChevronRightIcon,
    FileTextIcon,
    MicIcon,
    PlayIcon,
    CheckCircleIcon,
    AlertCircleIcon
} from 'lucide-react';

const STAGES = [
    { id: 'PENDING', title: 'Input/Reminder', icon: PlusIcon, color: 'bg-slate-500' },
    { id: 'EDITORIAL', title: 'Editorial (A)', icon: FileTextIcon, color: 'bg-blue-500' },
    { id: 'VOICE', title: 'Voice (B)', icon: MicIcon, color: 'bg-purple-500' },
    { id: 'MEDIA', title: 'Media Generation (C)', icon: PlayIcon, color: 'bg-orange-500' },
    { id: 'FINAL_RENDER', title: 'Final Render', icon: CheckCircleIcon, color: 'bg-indigo-500' },
    { id: 'PUBLISHED', title: 'Published', icon: CheckCircleIcon, color: 'bg-emerald-500' },
];

export default function KanbanBoard() {
    const [items, setItems] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedItem, setSelectedItem] = useState<any>(null);

    useEffect(() => {
        fetchItems();
    }, []);

    const fetchItems = async () => {
        try {
            const res = await fetch('/api/kanban');
            const data = await res.json();
            setItems(data);
            if (selectedItem) {
                setSelectedItem(data.find((i: any) => i.id === selectedItem.id));
            }
        } catch (e) {
            console.error('Failed to fetch items', e);
        } finally {
            setLoading(false);
        }
    };

    const moveStage = async (id: string, currentStatus: string) => {
        const nextStatus = getNextStatus(currentStatus);
        if (!nextStatus) return;

        try {
            await fetch('/api/kanban/move', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, status: nextStatus }),
            });
            fetchItems();
        } catch (e) {
            console.error('Failed to move stage', e);
        }
    };

    const getNextStatus = (status: string) => {
        const currentIndex = STAGES.findIndex(s => s.id === status);
        if (currentIndex < STAGES.length - 1) {
            return STAGES[currentIndex + 1].id;
        }
        return null;
    };

    if (loading) return <div className="p-8 text-center">Loading Content Pipeline...</div>;

    return (
        <div className="flex h-[calc(100vh-120px)] overflow-x-auto gap-4 p-4 bg-slate-50 dark:bg-slate-900">
            {STAGES.map((stage) => (
                <div key={stage.id} className="flex-shrink-0 w-80 flex flex-col glass appearance-none rounded-xl border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm overflow-hidden">
                    <div className={`p-3 border-b border-inherit flex items-center justify-between ${stage.color} bg-opacity-10 text-slate-900 dark:text-white`}>
                        <div className="flex items-center gap-2">
                            <stage.icon size={18} className="text-inherit opacity-70" />
                            <h2 className="font-semibold text-sm uppercase tracking-wider">{stage.title}</h2>
                        </div>
                        <span className="bg-slate-200 dark:bg-slate-800 px-2 py-0.5 rounded-full text-xs font-medium">
                            {items.filter(item => item.status === stage.id).length}
                        </span>
                    </div>

                    <div className="flex-1 overflow-y-auto p-3 space-y-3">
                        <AnimatePresence>
                            {items
                                .filter(item => item.status === stage.id)
                                .map((item) => (
                                    <KanbanCard
                                        key={item.id}
                                        item={item}
                                        onAction={() => moveStage(item.id, item.status)}
                                        onClick={() => setSelectedItem(item)}
                                    />
                                ))}
                        </AnimatePresence>
                    </div>
                </div>
            ))}

            {/* Detail Overlay */}
            <AnimatePresence>
                {selectedItem && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-end bg-slate-900/40 backdrop-blur-sm"
                        onClick={() => setSelectedItem(null)}
                    >
                        <motion.div
                            initial={{ x: '100%' }}
                            animate={{ x: 0 }}
                            exit={{ x: '100%' }}
                            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                            className="w-full max-w-2xl h-full bg-white dark:bg-slate-900 shadow-2xl overflow-y-auto"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <ItemDetail item={selectedItem} onClose={() => setSelectedItem(null)} onMove={() => moveStage(selectedItem.id, selectedItem.status)} />
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

function ItemDetail({ item, onClose, onMove }: { item: any, onClose: () => void, onMove: () => void }) {
    return (
        <div className="flex flex-col h-full">
            <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between sticky top-0 bg-white dark:bg-slate-900 z-10">
                <div>
                    <span className="text-xs font-mono text-slate-400">{item.uaId}</span>
                    <h2 className="text-xl font-bold dark:text-white">{item.theme}</h2>
                </div>
                <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors">
                    <PlusIcon size={24} className="rotate-45 text-slate-400" />
                </button>
            </div>

            <div className="p-6 space-y-8">
                <section>
                    <h4 className="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-4">Pipeline Status</h4>
                    <div className="flex items-center gap-4">
                        <div className="px-3 py-1.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full text-sm font-bold">
                            {item.status}
                        </div>
                        <button
                            onClick={onMove}
                            className="flex items-center gap-2 px-6 py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-lg text-sm font-bold hover:scale-[1.02] transition-transform"
                        >
                            Advance to Next Stage <ChevronRightIcon size={16} />
                        </button>
                    </div>
                </section>

                {item.article && (
                    <section>
                        <div className="flex items-center justify-between mb-4">
                            <h4 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Substack Article</h4>
                            <button className="text-xs text-blue-500 hover:underline">Edit Original</button>
                        </div>
                        <div className="prose prose-sm dark:prose-invert max-w-none p-4 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 line-clamp-6 whitespace-pre-wrap">
                            {item.article.draftContent}
                        </div>
                    </section>
                )}

                {item.scripts?.length > 0 && (
                    <section>
                        <h4 className="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-4">Video Scripts ({item.scripts.length})</h4>
                        <div className="space-y-4">
                            {item.scripts.map((script: any) => (
                                <div key={script.id} className="p-4 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800">
                                    <div className="flex justify-between items-center mb-2">
                                        <span className="text-xs font-bold px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded">{script.durationType}</span>
                                        <span className="text-[10px] uppercase text-slate-400 font-bold">{script.status}</span>
                                    </div>
                                    <p className="text-sm text-slate-700 dark:text-slate-300 font-medium italic mb-2">"{script.hook}"</p>
                                    <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-3">{script.script}</p>
                                </div>
                            ))}
                        </div>
                    </section>
                )}
            </div>
        </div>
    );
}

function KanbanCard({ item, onAction, onClick }: { item: any, onAction: () => void, onClick: () => void }) {
    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            whileHover={{ y: -2 }}
            onClick={onClick}
            className="p-4 bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 cursor-pointer group"
        >
            <div className="flex justify-between items-start mb-2">
                <span className="text-xs font-mono text-slate-400">{item.uaId}</span>
                {item.status === 'FAILED' && <AlertCircleIcon size={14} className="text-red-500" />}
            </div>
            <h3 className="text-sm font-semibold mb-2 line-clamp-2 leading-tight dark:text-slate-200">
                {item.theme || 'Untitiled Topic'}
            </h3>
            <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-700 mt-2">
                <div className="flex -space-x-1">
                    {/* Icons for generated parts */}
                    {item.article && <FileTextIcon size={14} className="text-blue-500" />}
                    {item.scripts?.length > 0 && <MicIcon size={14} className="text-purple-500 ml-1" />}
                </div>
                <button
                    onClick={(e) => { e.stopPropagation(); onAction(); }}
                    className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-colors opacity-0 group-hover:opacity-100"
                >
                    <ChevronRightIcon size={16} className="text-slate-400" />
                </button>
            </div>
        </motion.div>
    );
}
