"use client";

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    PlusIcon,
    ChevronRightIcon,
    CheckCircleIcon,
    EditIcon,
    Trash2Icon,
    AlertCircleIcon,
    RefreshCwIcon,
    FileTextIcon,
    MicIcon,
    VideoIcon,
    SparklesIcon,
    Edit3Icon,
    CheckIcon,
    ClockIcon,
    SettingsIcon,
    ExternalLinkIcon,
    ZapIcon,
    LayersIcon,
    DownloadIcon,
    CopyIcon,
    Share2Icon
} from 'lucide-react';
import StageEditor from '../editor/StageEditor';
import ScriptEditor from '../editor/ScriptEditor';

const STAGES = [
    { id: 'PENDING', name: 'Ideation', color: 'bg-slate-500', lightColor: 'bg-slate-50', darkColor: 'dark:bg-slate-900/30', accent: 'border-slate-200' },
    { id: 'EDITORIAL', name: 'Editorial', color: 'bg-blue-500', lightColor: 'bg-blue-50/50', darkColor: 'dark:bg-blue-900/10', accent: 'border-blue-100' },
    { id: 'VOICE', name: 'Voiceover', color: 'bg-purple-500', lightColor: 'bg-purple-50/50', darkColor: 'dark:bg-purple-900/10', accent: 'border-purple-100' },
    { id: 'MEDIA', name: 'Media Arch', color: 'bg-indigo-500', lightColor: 'bg-indigo-50/50', darkColor: 'dark:bg-indigo-900/10', accent: 'border-indigo-100' },
    { id: 'FINAL_RENDER', name: 'Production', color: 'bg-emerald-500', lightColor: 'bg-emerald-50/50', darkColor: 'dark:bg-emerald-900/10', accent: 'border-emerald-100' },
    { id: 'PUBLISHED', name: 'Published', color: 'bg-green-500', lightColor: 'bg-green-50/50', darkColor: 'dark:bg-green-900/10', accent: 'border-green-100' }
];

export default function KanbanBoard() {
    const [items, setItems] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedItem, setSelectedItem] = useState<any>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [pipelineConfig, setPipelineConfig] = useState({
        mode: 'STANDARD',
        stage1Model: 'gemini-2.0-flash-exp',
        stage1Provider: 'GEMINI',
        stage2Models: [{ model: 'claude-3-5-sonnet-20241022', provider: 'ANTHROPIC' }]
    });

    useEffect(() => {
        fetchItems();
    }, []);

    // Add polling for rendering items
    useEffect(() => {
        const hasRendering = items.some(item =>
            item.scripts?.some((s: any) => s.status === 'RENDERING')
        );

        if (hasRendering || isProcessing) {
            const interval = setInterval(fetchItems, 5000);
            return () => clearInterval(interval);
        }
    }, [items, isProcessing]);

    const [pendingMoves, setPendingMoves] = useState<Set<string>>(new Set());

    const fetchItems = async () => {
        try {
            const res = await fetch('/api/kanban');
            const data = await res.json();

            // Only update items that aren't currently in a pending move transition
            setItems(prev => {
                const pendingIds = new Set(pendingMoves);
                return data.map((newItem: any) => {
                    if (pendingIds.has(newItem.id)) {
                        const existing = prev.find(p => p.id === newItem.id);
                        return existing || newItem;
                    }
                    return newItem;
                });
            });

            if (selectedItem) {
                const refreshedItem = data.find((i: any) => i.id === selectedItem.id);
                if (refreshedItem && !pendingMoves.has(selectedItem.id)) {
                    setSelectedItem(refreshedItem);
                }
            }
        } catch (e) {
            console.error('Failed to fetch items', e);
        } finally {
            setLoading(false);
        }
    };

    const moveStage = async (id: string, currentStatus: string, config?: any, targetStatus?: string) => {
        let nextStatus = targetStatus;
        if (!nextStatus) {
            const nextIdx = STAGES.findIndex(s => s.id === currentStatus) + 1;
            if (nextIdx >= STAGES.length) return;
            nextStatus = STAGES[nextIdx].id;
        }

        // Optimistic UI update
        const originalItems = [...items];
        const originalSelectedItem = selectedItem ? { ...selectedItem } : null;

        setPendingMoves(prev => new Set(prev).add(id));
        setItems(prev => prev.map(item => item.id === id ? { ...item, status: nextStatus } : item));
        if (selectedItem && selectedItem.id === id) {
            setSelectedItem((prev: any) => ({ ...prev, status: nextStatus }));
        }

        setIsProcessing(true);

        try {
            const res = await fetch('/api/kanban/move', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, status: nextStatus, config }),
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || 'Failed to move stage');
            }

            // Move is complete, but we keep it in pending until the next fetch confirms it
            await fetchItems();
        } catch (e: any) {
            console.error('Failed to move stage', e);
            setItems(originalItems);
            if (originalSelectedItem) setSelectedItem(originalSelectedItem);
            alert(`Movement failed: ${e.message}`);
        } finally {
            setPendingMoves(prev => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
            setIsProcessing(false);
        }
    };

    const moveBack = async (id: string, currentStatus: string) => {
        const prevIdx = STAGES.findIndex(s => s.id === currentStatus) - 1;
        if (prevIdx < 0) return;

        const nextStatus = STAGES[prevIdx].id;

        // Optimistic UI update
        const originalItems = [...items];
        setItems(prev => prev.map(item => item.id === id ? { ...item, status: nextStatus } : item));

        setIsProcessing(true);
        try {
            const res = await fetch('/api/kanban/move', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, status: nextStatus }),
            });

            if (!res.ok) {
                throw new Error('Failed to roll back');
            }

            await fetchItems();
            if (selectedItem?.id === id) {
                // Refresh the modal item instead of closing it
                const updatedItem = items.find(i => i.id === id);
                if (updatedItem) setSelectedItem({ ...updatedItem, status: nextStatus });
            }
        } catch (e: any) {
            console.error('Failed to move back', e);
            setItems(originalItems);
            alert(`Rollback failed: ${e.message}`);
        } finally {
            setIsProcessing(false);
        }
    };

    const toggleApproval = async (id: string, type: 'article' | 'script', approved: boolean) => {
        // Optimistic UI update
        if (selectedItem) {
            if (type === 'article' && selectedItem.article?.id === id) {
                setSelectedItem((prev: any) => ({
                    ...prev,
                    article: { ...prev.article, approved }
                }));
            } else if (type === 'script' && selectedItem.scripts) {
                setSelectedItem((prev: any) => ({
                    ...prev,
                    scripts: prev.scripts.map((s: any) => s.id === id ? { ...s, approved } : s)
                }));
            }
        }

        try {
            const res = await fetch('/api/kanban/approve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, type, approved }),
            });

            if (!res.ok) {
                throw new Error('Failed to toggle approval');
            }

            fetchItems();
        } catch (e) {
            console.error('Failed to approve', e);
            // Rollback on failure if needed, but fetchItems() usually handles it
            fetchItems();
        }
    };

    if (loading) {
        return (
            <div className="flex h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
                <div className="flex flex-col items-center gap-4">
                    <RefreshCwIcon className="animate-spin text-indigo-500" size={40} />
                    <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">Synchronizing Production Library...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="p-8 h-screen overflow-x-auto bg-white dark:bg-slate-950 flex flex-col gap-8 font-sans">
            <header className="flex justify-between items-center shrink-0">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-black dark:bg-white rounded-2xl flex items-center justify-center shadow-2xl shadow-black/20">
                        <ZapIcon className="text-white dark:text-black" size={24} fill="currentColor" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-black tracking-tighter dark:text-white uppercase leading-none">The Unemployable Advisor</h1>
                        <p className="text-slate-400 font-bold font-mono text-[9px] uppercase tracking-[0.3em] mt-2 flex items-center gap-2">
                            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
                            Intelligence Engine Alpha
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <button className="flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-bold hover:bg-slate-200 transition-all border border-slate-200 dark:border-slate-700">
                        <SettingsIcon size={14} />
                        Pipeline Config
                    </button>
                    <button className="flex items-center gap-2 px-6 py-2 bg-black dark:bg-white text-white dark:text-black rounded-xl text-xs font-black uppercase tracking-widest hover:scale-105 transition-all shadow-xl shadow-black/10">
                        <PlusIcon size={18} />
                        New Strategy
                    </button>
                </div>
            </header>

            <div className="flex gap-6 flex-1 min-h-0">
                {STAGES.map(stage => {
                    const stageItems = items.filter(item => item.status === stage.id);
                    return (
                        <div key={stage.id} className="flex flex-col gap-4 w-80 shrink-0 group/column">
                            <div className="flex items-center justify-between px-2">
                                <h2 className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 flex items-center gap-2">
                                    <span className={`w-2.5 h-2.5 rounded-full ${stage.color} shadow-lg shadow-${stage.color.split('-')[1]}-500/20`}></span>
                                    {stage.name}
                                    <span className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full text-[9px] text-slate-500 font-mono">{stageItems.length}</span>
                                </h2>
                                <button className="p-1.5 opacity-0 group-hover/column:opacity-100 transition-opacity hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg">
                                    <PlusIcon size={14} className="text-slate-400" />
                                </button>
                            </div>

                            <div className={`flex-1 ${stage.lightColor} ${stage.darkColor} rounded-[2.5rem] p-4 flex flex-col gap-4 overflow-y-auto custom-scrollbar border-2 border-dashed ${stage.accent} transition-colors group-hover/column:border-slate-300 dark:group-hover/column:border-slate-700`}>
                                {stageItems.map(item => (
                                    <KanbanCard
                                        key={item.id}
                                        item={item}
                                        onClick={() => setSelectedItem(item)}
                                        draggable
                                        onDragEnd={(e: any, info: any) => {
                                            if (info.offset.x > 150) moveStage(item.id, item.status);
                                            else if (info.offset.x < -150) moveBack(item.id, item.status);
                                        }}
                                    />
                                ))}
                                {stageItems.length === 0 && (
                                    <div className="flex-1 flex flex-col items-center justify-center opacity-20 text-center p-8 grayscale">
                                        <LayersIcon size={32} className="mb-2 text-slate-400" />
                                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Queue Empty</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            <AnimatePresence>
                {isProcessing && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed bottom-8 right-8 bg-black dark:bg-white text-white dark:text-black px-6 py-4 rounded-2xl shadow-2xl z-50 flex items-center gap-4 border border-white/20"
                    >
                        <RefreshCwIcon className="animate-spin text-indigo-500" size={20} />
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-widest">System Processing</p>
                            <p className="text-[9px] opacity-60 font-medium">Intelligence Engine is active. Stand by.</p>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence mode="wait">
                {selectedItem && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-50 flex items-center justify-end p-4"
                        onClick={() => setSelectedItem(null)}
                    >
                        <motion.div
                            initial={{ x: '100%', opacity: 0 }}
                            animate={{ x: 0, opacity: 1 }}
                            exit={{ x: '100%', opacity: 0 }}
                            transition={{ type: 'spring', damping: 30, stiffness: 200 }}
                            className="bg-slate-50 dark:bg-slate-900 w-full max-w-2xl h-full rounded-[3rem] shadow-[0_0_100px_rgba(0,0,0,0.4)] flex flex-col overflow-hidden border border-white/20 dark:border-slate-800"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <ItemDetail
                                item={selectedItem}
                                onClose={() => setSelectedItem(null)}
                                onMove={(config, targetId) => moveStage(selectedItem.id, selectedItem.status, config, targetId)}
                                onMoveBack={() => moveBack(selectedItem.id, selectedItem.status)}
                                onApprove={toggleApproval}
                                onRefresh={fetchItems}
                                pipelineConfig={pipelineConfig}
                                setPipelineConfig={setPipelineConfig}
                                onRegenerate={(config) => moveStage(selectedItem.id, 'PENDING', config)}
                                isProcessing={isProcessing}
                            />
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

interface ItemDetailProps {
    item: any;
    onClose: () => void;
    onMove: (config?: any, targetStatus?: string) => void;
    onMoveBack: () => void;
    onApprove: (id: string, type: 'article' | 'script', approved: boolean) => void;
    onRefresh: () => void;
    pipelineConfig: any;
    setPipelineConfig: (config: any) => void;
    onRegenerate: (config: any) => void;
    isProcessing: boolean;
}

function ItemDetail({
    item, onClose, onMove, onMoveBack, onApprove, onRefresh,
    pipelineConfig, setPipelineConfig, onRegenerate, isProcessing
}: ItemDetailProps) {
    const statusInfo = STAGES.find(s => s.id === item.status);
    const [editingPart, setEditingPart] = useState<{ type: 'article' | 'script' | 'inquiry' | 'full_script', id: string, content: any, field?: string } | null>(null);
    const [isMoving, setIsMoving] = useState(false);
    const [isScribing, setIsScribing] = useState(false);
    const [isRendering, setIsRendering] = useState<Record<string, boolean>>({});
    const [aspectRatios, setAspectRatios] = useState<Record<string, string>>(
        item.scripts ? Object.fromEntries(item.scripts.map((s: any) => [s.id, s.aspectRatio || "1:1"])) : {}
    );
    const [selectedScripts, setSelectedScripts] = useState<string[]>(
        item.scripts ? item.scripts.filter((s: any) => ['30s', '60s'].includes(s.durationType)).map((s: any) => s.id) : []
    );

    const toggleScriptSelection = (id: string) => {
        setSelectedScripts(prev =>
            prev.includes(id) ? prev.filter(sid => sid !== id) : [...prev, id]
        );
    };

    const handleScribe = async () => {
        if (selectedScripts.length === 0) {
            return;
        }

        setIsScribing(true);
        try {
            const res = await fetch('/api/kanban/scribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: item.id,
                    scriptIds: selectedScripts
                }),
            });
            if (!res.ok) {
                const err = await res.json();
                console.error(`Scribing failed: ${err.error}`);
            }
            onRefresh();
        } catch (e) {
            console.error('Scribe failed', e);
        } finally {
            setIsScribing(false);
        }
    };

    const handleRender = async (scriptId: string) => {
        setIsRendering(prev => ({ ...prev, [scriptId]: true }));
        try {
            const res = await fetch('/api/kanban/render', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ scriptId, aspectRatio: aspectRatios[scriptId] }),
            });
            if (!res.ok) {
                const err = await res.json();
                console.error(`Rendering failed: ${err.error}`);
            }
            onRefresh();
        } catch (e) {
            console.error('Render failed', e);
        } finally {
            setIsRendering(prev => ({ ...prev, [scriptId]: false }));
            // Add a temporary "Sent" state if it was successful
            setIsRendering(prev => ({ ...prev, [`${scriptId}_success`]: true }));
            setTimeout(() => {
                setIsRendering(prev => ({ ...prev, [`${scriptId}_success`]: false }));
            }, 2000);
        }
    };

    const handleMove = async () => {
        setIsMoving(true);
        try {
            await onMove(pipelineConfig);
        } finally {
            setIsMoving(false);
        }
    };

    const handleGenerateVoice = async () => {
        setIsMoving(true);
        try {
            await onMove(pipelineConfig, 'VOICE');
        } finally {
            setIsMoving(false);
        }
    };

    const handleSaveInquiry = async (content: string, field: string = 'thinking') => {
        try {
            await fetch('/api/inquiry/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: item.id,
                    [field]: content
                }),
            });
            setEditingPart(null);
            onRefresh();
        } catch (e) {
            console.error('Failed to save inquiry', e);
        }
    };

    const handleSaveEdit = async (content: any) => {
        if (!editingPart) return;

        if (editingPart.type === 'inquiry') {
            return handleSaveInquiry(content, editingPart.field);
        }

        const type = editingPart.type === 'full_script' ? 'script' : editingPart.type;

        try {
            await fetch('/api/content/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type,
                    id: editingPart.id,
                    content,
                    field: editingPart.field
                }),
            });
            setEditingPart(null);
            onRefresh();
        } catch (e) {
            console.error('Failed to save content', e);
        }
    };

    if (editingPart) {
        return (
            <div className="flex flex-col h-full bg-white dark:bg-slate-900">
                <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                    <button
                        onClick={() => setEditingPart(null)}
                        className="flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-black dark:hover:text-white transition-colors uppercase tracking-widest text-[10px]"
                    >
                        <ChevronRightIcon size={16} className="rotate-180" /> Exit Editor
                    </button>
                    <div className="px-3 py-1 bg-slate-100 dark:bg-slate-800 rounded-full text-[10px] font-black uppercase tracking-widest text-slate-400">
                        {editingPart.type} Mode
                    </div>
                </div>
                <div className="flex-1 p-8 overflow-y-auto">
                    {editingPart.type === 'full_script' ? (
                        <ScriptEditor
                            script={editingPart.content}
                            onSave={handleSaveEdit}
                            onCancel={() => setEditingPart(null)}
                        />
                    ) : (
                        <StageEditor
                            initialContent={editingPart.content}
                            onSave={handleSaveEdit}
                            title={`Editing ${editingPart.type === 'article' ? 'Substack Article' : editingPart.type === 'script' ? 'Video Script' : (editingPart.field || 'Raw Data')}`}
                        />
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-900 overflow-y-auto custom-scrollbar">
            <div className="p-8 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between sticky top-0 bg-slate-50/80 dark:bg-slate-900/80 backdrop-blur-xl z-10">
                <div className="max-w-[80%]">
                    <span className="text-[10px] font-black font-mono text-slate-400 uppercase tracking-widest block mb-2">{item.uaId}</span>
                    <h2 className="text-xl font-black dark:text-white tracking-tighter uppercase leading-tight line-clamp-2">{item.theme}</h2>
                </div>
                <button onClick={onClose} className="p-3 bg-white dark:bg-slate-800 shadow-xl shadow-black/5 hover:scale-110 rounded-2xl transition-all shrink-0">
                    <PlusIcon size={24} className="rotate-45 text-slate-400" />
                </button>
            </div>

            <div className="p-10 space-y-16">
                {/* Status Tracker */}
                <div className="bg-white dark:bg-slate-800/50 rounded-[2.5rem] p-8 border border-white dark:border-slate-700 shadow-2xl shadow-black/5">
                    <div className="flex items-center justify-between mb-8">
                        <div className="flex items-center gap-4">
                            <div className={`w-14 h-14 rounded-3xl ${statusInfo?.color} flex items-center justify-center shadow-xl shadow-${statusInfo?.color.split('-')[1]}-500/20 text-white`}>
                                <ClockIcon size={28} />
                            </div>
                            <div>
                                <h3 className="text-lg font-black dark:text-white uppercase tracking-tighter leading-tight">{statusInfo?.name} Stage</h3>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mt-1 italic">Phase synchronized & active</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={onMoveBack}
                                className="px-6 py-3 text-[11px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                            >
                                Roll Back
                            </button>
                            <button
                                onClick={handleMove}
                                disabled={isMoving}
                                className="px-8 py-4 bg-black dark:bg-white text-white dark:text-black text-[11px] font-black uppercase tracking-[0.2em] rounded-2xl transition-all shadow-2xl shadow-black/20 flex items-center gap-3 hover:scale-105 active:scale-95"
                            >
                                {isMoving ? <RefreshCwIcon size={16} className="animate-spin" /> : <ChevronRightIcon size={16} strokeWidth={3} />}
                                Progress to {STAGES[STAGES.findIndex(s => s.id === item.status) + 1]?.name || 'End'}
                            </button>
                        </div>
                    </div>

                    {(item.status === 'VOICE' || item.status === 'MEDIA') && item.scripts?.some((s: any) => s.approved && !s.audioUrl) && (
                        <div className="mt-8 p-6 bg-indigo-50 dark:bg-indigo-900/10 border border-indigo-100 dark:border-indigo-800 rounded-[2rem] flex items-center justify-between">
                            <div>
                                <h4 className="text-[12px] font-black uppercase tracking-[0.3em] text-indigo-500">Voiceover Pipeline</h4>
                                <p className="text-[10px] text-slate-400 mt-1 font-medium tracking-wide">Ready to transform approved scripts into cinematic audio.</p>
                            </div>
                            <button
                                onClick={handleGenerateVoice}
                                disabled={isMoving}
                                className="px-6 py-2.5 bg-indigo-500 text-white text-[11px] font-black uppercase tracking-widest rounded-xl hover:scale-105 transition-all flex items-center gap-2 shadow-lg shadow-indigo-500/20"
                            >
                                {isMoving ? <RefreshCwIcon size={14} className="animate-spin" /> : <MicIcon size={14} />}
                                Generate Audio
                            </button>
                        </div>
                    )}

                    {['MEDIA', 'FINAL_RENDER', 'PUBLISHED'].includes(item.status) && (
                        <div className="mt-8 p-6 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-[2rem]">
                            <div className="flex items-center justify-between mb-6">
                                <div>
                                    <h4 className="text-[12px] font-black uppercase tracking-[0.3em] text-indigo-500">Grounded Media Pipeline</h4>
                                    <p className="text-[10px] text-slate-400 mt-1 font-medium tracking-wide">Select authority scripts for cinematic visualization.</p>
                                </div>
                                <button
                                    onClick={handleScribe}
                                    disabled={isScribing}
                                    className="px-6 py-2.5 bg-indigo-500 text-white text-[11px] font-black uppercase tracking-widest rounded-xl hover:scale-105 transition-all flex items-center gap-2 shadow-lg shadow-indigo-500/20"
                                >
                                    {isScribing ? <RefreshCwIcon size={14} className="animate-spin" /> : <SparklesIcon size={14} />}
                                    Re-Scribe
                                </button>
                            </div>
                            <div className="flex flex-wrap gap-3">
                                {item.scripts?.map((s: any) => (
                                    <button
                                        key={s.id}
                                        onClick={() => toggleScriptSelection(s.id)}
                                        className={`px-5 py-3 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all border-2 ${selectedScripts.includes(s.id)
                                            ? 'bg-indigo-600 border-indigo-600 text-white shadow-xl shadow-indigo-600/20'
                                            : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400'
                                            }`}
                                    >
                                        {s.durationType} {selectedScripts.includes(s.id) && '✓'}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Raw Interrogation Section */}
                <div className="space-y-6">
                    <div className="flex items-center justify-between px-2">
                        <div className="flex items-center gap-3">
                            <MicIcon className="text-slate-400" size={20} />
                            <h3 className="text-sm font-black uppercase tracking-[0.3em] text-slate-400">Sunday Interrogation Data</h3>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="bg-white dark:bg-slate-800/20 p-6 rounded-[2rem] border border-white dark:border-slate-800 shadow-sm group">
                            <div className="flex items-center justify-between mb-3">
                                <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Thinking</h4>
                                <button
                                    onClick={() => setEditingPart({ type: 'inquiry', id: item.id, content: item.thinking || '', field: 'thinking' })}
                                    className="opacity-0 group-hover:opacity-100 p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-all"
                                >
                                    <Edit3Icon size={14} className="text-slate-400" />
                                </button>
                            </div>
                            <p className="text-[13px] text-slate-600 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">{item.thinking || 'No thinking provided.'}</p>
                        </div>
                        <div className="bg-white dark:bg-slate-800/20 p-6 rounded-[2rem] border border-white dark:border-slate-800 shadow-sm group">
                            <div className="flex items-center justify-between mb-3">
                                <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Reality</h4>
                                <button
                                    onClick={() => setEditingPart({ type: 'inquiry', id: item.id, content: item.reality || '', field: 'reality' })}
                                    className="opacity-0 group-hover:opacity-100 p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-all"
                                >
                                    <Edit3Icon size={14} className="text-slate-400" />
                                </button>
                            </div>
                            <p className="text-[13px] text-slate-600 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">{item.reality || 'No reality provided.'}</p>
                        </div>
                        <div className="bg-white dark:bg-slate-800/20 p-6 rounded-[2rem] border border-white dark:border-slate-800 shadow-sm group">
                            <div className="flex items-center justify-between mb-3">
                                <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Rant</h4>
                                <button
                                    onClick={() => setEditingPart({ type: 'inquiry', id: item.id, content: item.rant || '', field: 'rant' })}
                                    className="opacity-0 group-hover:opacity-100 p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-all"
                                >
                                    <Edit3Icon size={14} className="text-slate-400" />
                                </button>
                            </div>
                            <p className="text-[13px] text-slate-600 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">{item.rant || 'No rant provided.'}</p>
                        </div>
                        <div className="bg-red-50/30 dark:bg-red-900/5 p-6 rounded-[2rem] border border-red-100 dark:border-red-900/10 shadow-sm group">
                            <div className="flex items-center justify-between mb-3">
                                <h4 className="text-[10px] font-black uppercase tracking-widest text-red-400 ml-1">Nuclear</h4>
                                <button
                                    onClick={() => setEditingPart({ type: 'inquiry', id: item.id, content: item.nuclear || '', field: 'nuclear' })}
                                    className="opacity-0 group-hover:opacity-100 p-2 hover:bg-red-100/50 dark:hover:bg-red-900/20 rounded-lg transition-all"
                                >
                                    <Edit3Icon size={14} className="text-red-400" />
                                </button>
                            </div>
                            <p className="text-[13px] text-red-600 dark:text-red-300 whitespace-pre-wrap leading-relaxed">{item.nuclear || 'No nuclear option.'}</p>
                        </div>
                    </div>
                </div>

                {/* Article View */}
                {item.article && (
                    <div className="space-y-6">
                        <div className="flex items-center justify-between px-2">
                            <div className="flex items-center gap-3">
                                <FileTextIcon className="text-blue-500" size={20} />
                                <h3 className="text-sm font-black uppercase tracking-[0.3em] text-slate-400">Editorial Manuscript</h3>
                            </div>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => onApprove(item.article.id, 'article', !item.article.approved)}
                                    className={`flex items-center gap-3 px-5 py-2.5 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all ${item.article.approved
                                        ? 'bg-emerald-500 text-white shadow-xl shadow-emerald-500/20'
                                        : 'bg-white dark:bg-slate-800 text-slate-400 border border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                                        }`}
                                >
                                    <CheckCircleIcon size={16} />
                                    {item.article.approved ? 'Approved' : 'Grant Approval'}
                                </button>
                                <button
                                    onClick={() => setEditingPart({ type: 'article', id: item.article.id, content: item.article.draftContent })}
                                    className="p-3 bg-white dark:bg-slate-800 text-slate-400 rounded-2xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 transition-all shadow-sm"
                                >
                                    <Edit3Icon size={20} />
                                </button>
                            </div>
                        </div>
                        <div className="bg-white dark:bg-slate-800/30 p-10 rounded-[2.5rem] border border-white dark:border-slate-800 shadow-xl shadow-black-[0.02] prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap leading-relaxed opacity-90 font-serif text-[15px]">
                            {item.article.draftContent}
                        </div>
                    </div>
                )}

                {/* Scripts View */}
                {item.scripts && item.scripts.length > 0 && (
                    <div className="space-y-8">
                        <div className="flex items-center gap-3 px-2">
                            <VideoIcon className="text-emerald-500" size={20} />
                            <h3 className="text-sm font-black uppercase tracking-[0.3em] text-slate-400">Cinematic Scripts</h3>
                        </div>
                        {item.scripts.map((script: any) => (
                            <div key={script.id} className={`p-8 rounded-[2.5rem] border-2 transition-all duration-500 ${script.approved ? 'border-emerald-500 bg-emerald-50/20 dark:bg-emerald-900/10 shadow-emerald-100 dark:shadow-none shadow-2xl' : 'border-white dark:border-slate-800 bg-white dark:bg-slate-800/40 shadow-xl shadow-black-[0.03]'}`}>
                                <div className="flex items-center justify-between mb-8">
                                    <div className="flex items-center gap-3">
                                        <span className="text-[10px] font-black px-4 py-1.5 bg-slate-100 dark:bg-slate-800 rounded-full text-slate-500 uppercase tracking-widest">
                                            {script.durationType} Authority
                                        </span>
                                        {script.approved && <span className="text-[9px] font-black text-emerald-500 uppercase tracking-widest flex items-center gap-1"><CheckIcon size={12} strokeWidth={4} /> Production Ready</span>}
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl gap-1">
                                            {["1:1", "9:16", "16:9"].map((ratio) => (
                                                <button
                                                    key={ratio}
                                                    onClick={() => setAspectRatios(prev => ({ ...prev, [script.id]: ratio }))}
                                                    className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${aspectRatios[script.id] === ratio ? 'bg-white dark:bg-slate-700 text-black dark:text-white shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                                                >
                                                    {ratio}
                                                </button>
                                            ))}
                                        </div>
                                        {script.audioUrl && (
                                            <button
                                                onClick={() => handleRender(script.id)}
                                                disabled={isRendering[script.id] || script.status === 'RENDERING'}
                                                className={`px-6 py-3 ${script.status === 'RENDERING' ? 'bg-indigo-500' : 'bg-emerald-500 hover:bg-emerald-600'} disabled:opacity-50 text-white text-[11px] font-black uppercase tracking-widest rounded-xl transition-all flex items-center gap-2 shadow-lg ${script.status === 'RENDERING' ? 'shadow-indigo-500/20' : 'shadow-emerald-500/20'}`}
                                            >
                                                {isRendering[`${script.id}_success`] ? <CheckIcon size={14} strokeWidth={4} /> : (isRendering[script.id] || script.status === 'RENDERING' ? <RefreshCwIcon size={14} className="animate-spin" /> : <ZapIcon size={14} fill="currentColor" />)}
                                                {isRendering[`${script.id}_success`] ? 'Sent ✓' : (isRendering[script.id] || script.status === 'RENDERING' ? 'Rendering...' : 'Render Master')}
                                            </button>
                                        )}
                                        {!script.audioUrl && script.approved && (
                                            <div className="px-4 py-2 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-500 text-[9px] font-black uppercase tracking-widest rounded-lg border border-indigo-100 dark:border-indigo-800 flex items-center gap-2">
                                                <RefreshCwIcon size={10} className="animate-spin" /> {(isProcessing && (item.status === 'VOICE' || item.status === 'MEDIA')) ? 'Processing...' : 'Queued for Voice'}
                                            </div>
                                        )}
                                        <button
                                            onClick={() => onApprove(script.id, 'script', !script.approved)}
                                            className={`p-3 rounded-xl transition-all ${script.approved
                                                ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'
                                                : 'bg-slate-100 dark:bg-slate-800 text-slate-400 border border-slate-200 dark:border-slate-700'
                                                }`}
                                        >
                                            <CheckCircleIcon size={20} />
                                        </button>
                                        <button
                                            onClick={() => setEditingPart({ type: 'full_script', id: script.id, content: script })}
                                            className="p-3 rounded-xl transition-all bg-slate-100 dark:bg-slate-800 text-slate-400 border border-slate-200 dark:border-slate-700 hover:bg-slate-200"
                                        >
                                            <Edit3Icon size={20} />
                                        </button>
                                    </div>
                                </div>
                                <div className="flex items-center justify-between mb-4">
                                    <div className="text-xl font-black text-slate-900 dark:text-white leading-tight tracking-tight">
                                        "{script.hook}"
                                    </div>
                                </div>
                                <div className="text-[14px] text-slate-500 dark:text-slate-400 leading-relaxed font-medium mb-6">
                                    {script.script}
                                </div>
                                <div className="flex items-center justify-between mt-4 py-3 border-t border-slate-100 dark:border-slate-800">
                                    <div className="text-[12px] text-slate-400 italic font-medium">
                                        <span className="font-black uppercase tracking-widest text-[9px] not-italic mr-2">Outro:</span>
                                        {script.closingLine || 'No closing line.'}
                                    </div>
                                </div>
                                {script.videoUrl && (
                                    <div className="mt-8 overflow-hidden rounded-[2rem] border-4 border-white dark:border-slate-700 shadow-2xl relative group">
                                        <video
                                            key={`${script.videoUrl}-${aspectRatios[script.id] || script.aspectRatio}`}
                                            controls
                                            className={`w-full bg-black shadow-inner ${(aspectRatios[script.id] || script.aspectRatio) === '9:16' ? 'aspect-[9/16]' : (aspectRatios[script.id] || script.aspectRatio) === '16:9' ? 'aspect-video' : 'aspect-square'}`}
                                            poster={script.scenes?.[0]?.assetUrl}
                                        >
                                            <source src={script.videoUrl} type="video/mp4" />
                                            Your browser does not support the video tag.
                                        </video>
                                        <div className="absolute top-4 left-4 pointer-events-none">
                                            <div className="bg-black/40 backdrop-blur-md px-3 py-1 rounded-full text-[9px] font-black text-white uppercase tracking-[0.2em] border border-white/20 flex items-center gap-2">
                                                <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></div>
                                                Authoritative Master
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {script.audioUrl && (
                                    <div className="mt-6 p-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-200 dark:border-slate-700 flex items-center gap-4">
                                        <MicIcon className="text-purple-500" size={20} />
                                        <audio controls className="h-8 flex-1 opacity-80">
                                            <source src={script.audioUrl} type="audio/mpeg" />
                                        </audio>
                                    </div>
                                )}

                                {script.scenes && script.scenes.length > 0 && (
                                    <div className="mt-10 space-y-4">
                                        <h4 className="text-[11px] font-black uppercase tracking-[0.3em] text-indigo-500 flex items-center gap-2 px-2">
                                            <SparklesIcon size={16} /> Production Storyboard
                                        </h4>
                                        <div className="grid grid-cols-2 gap-4">
                                            {script.scenes.map((scene: any) => (
                                                <div key={scene.id} className="p-5 bg-white dark:bg-slate-900/30 rounded-[2rem] border border-slate-100 dark:border-slate-800 flex flex-col gap-3 shadow-sm hover:border-indigo-200 dark:hover:border-indigo-900 transition-colors">
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">Scene {scene.index} • {scene.duration}s</span>
                                                        <span className={`text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-tighter ${scene.type === 'VIDEO' ? 'bg-indigo-500 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
                                                            {scene.type}
                                                        </span>
                                                    </div>
                                                    {scene.scriptSegment && (
                                                        <p className="text-[12px] text-slate-600 dark:text-slate-300 font-bold italic leading-tight">
                                                            "{scene.scriptSegment}"
                                                        </p>
                                                    )}
                                                    <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed">
                                                        <span className="font-black text-indigo-300 uppercase text-[8px] block mb-1 tracking-widest">Visual Direction:</span>
                                                        {scene.prompt}
                                                    </p>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {script.videoUrl && (
                                    <div className="mt-12 p-8 bg-slate-900 rounded-[3rem] border border-white/10 shadow-2xl overflow-hidden relative group">
                                        <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity">
                                            <Share2Icon size={120} className="text-white" strokeWidth={1} />
                                        </div>
                                        <div className="relative z-10">
                                            <div className="flex items-center justify-between mb-8">
                                                <div>
                                                    <h4 className="text-[12px] font-black uppercase tracking-[0.4em] text-indigo-400">Global Distribution Hub</h4>
                                                    <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-widest">Multi-Platform Readiness Active</p>
                                                </div>
                                                <a
                                                    href={script.videoUrl}
                                                    download={`ua_${script.durationType}_${(script.aspectRatio || '1:1').replace(':', 'x')}.mp4`}
                                                    className="px-6 py-3 bg-indigo-500 text-white text-[11px] font-black uppercase tracking-[0.3em] rounded-2xl hover:scale-105 transition-all flex items-center gap-3 shadow-xl shadow-indigo-500/20"
                                                >
                                                    <DownloadIcon size={16} /> Download MP4
                                                </a>
                                            </div>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                {[
                                                    { name: 'LinkedIn', prefix: '[LI] ' },
                                                    { name: 'Instagram', prefix: '[IG] ' },
                                                    { name: 'Facebook', prefix: '[FB] ' },
                                                    { name: 'X / Twitter', prefix: '[X] ' }
                                                ].map(platform => (
                                                    <div key={platform.name} className="p-5 bg-white/5 rounded-[2rem] border border-white/5 hover:border-indigo-500/30 transition-all flex flex-col justify-between">
                                                        <div className="flex items-center justify-between mb-4">
                                                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">{platform.name}</span>
                                                            <button
                                                                onClick={() => {
                                                                    const caption = `${platform.name === 'LinkedIn' ? 'Authority Content: ' : ''}${script.hook}\n\n${script.script}\n\n#UnemployableAdvisor #BusinessValue`;
                                                                    navigator.clipboard.writeText(caption);
                                                                    alert(`${platform.name} caption copied!`);
                                                                }}
                                                                className="p-2.5 bg-white/5 hover:bg-white/10 rounded-xl transition-all text-slate-400 hover:text-white"
                                                                title="Copy Caption"
                                                            >
                                                                <CopyIcon size={16} />
                                                            </button>
                                                        </div>
                                                        <p className="text-[12px] text-slate-400 font-medium leading-relaxed line-clamp-2 italic opacity-60">
                                                            "{script.hook}..."
                                                        </p>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function KanbanCard({ item, onClick, draggable, onDragEnd }: { item: any, onClick: () => void, draggable?: boolean, onDragEnd?: (e: any, info: any) => void }) {
    const stage = STAGES.find(s => s.id === item.status);

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            whileHover={{ y: -5, scale: 1.02 }}
            whileDrag={{
                scale: 1.1,
                zIndex: 99999,
                boxShadow: "0 40px 100px rgba(0,0,0,0.5)",
                pointerEvents: 'none'
            }}
            drag={draggable ? "x" : false}
            dragConstraints={{ left: -300, right: 300 }}
            dragElastic={0.1}
            onDragEnd={onDragEnd}
            onClick={onClick}
            className="p-5 bg-white dark:bg-slate-800 rounded-[2rem] shadow-[0_10px_30px_rgba(0,0,0,0.05)] border border-white dark:border-slate-700 cursor-pointer group mb-2 active:cursor-grabbing relative z-10"
        >
            <div className="flex justify-between items-start mb-4">
                <span className="text-[9px] font-black font-mono text-slate-300 uppercase tracking-[0.2em]">{item.uaId}</span>
                <div className="flex items-center gap-2">
                    {item.status === 'FAILED' && <AlertCircleIcon size={14} className="text-red-500" />}
                    {(item.status === 'VOICE' && !item.scripts?.every((s: any) => s.audioUrl)) && (
                        <RefreshCwIcon size={14} className="text-purple-500 animate-spin" />
                    )}
                    {(item.status === 'MEDIA' && !item.scripts?.every((s: any) => s.visualPrompt)) && (
                        <RefreshCwIcon size={14} className="text-indigo-500 animate-spin" />
                    )}
                </div>
            </div>
            <h3 className="text-[14px] font-black mb-4 line-clamp-3 leading-[1.3] dark:text-slate-100 uppercase tracking-tight">
                {item.theme || 'Untreated inquiry'}
            </h3>
            <div className="flex items-center justify-between pt-4 border-t border-slate-50 dark:border-slate-700/50 mt-2">
                <div className="flex gap-2">
                    {item.article && <div className="p-1.5 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-blue-500"><FileTextIcon size={12} /></div>}
                    {item.scripts?.length > 0 && item.scripts.some((s: any) => s.audioUrl) && <div className="p-1.5 bg-purple-50 dark:bg-purple-900/20 rounded-lg text-purple-500"><MicIcon size={12} /></div>}
                    {item.scripts?.length > 0 && item.scripts.some((s: any) => s.videoUrl) && <div className="p-1.5 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg text-emerald-500"><VideoIcon size={12} /></div>}
                </div>
                <div className={`px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${stage?.color} text-white shadow-lg shadow-black/10`}>
                    {stage?.name}
                </div>
            </div>
        </motion.div>
    );
}
