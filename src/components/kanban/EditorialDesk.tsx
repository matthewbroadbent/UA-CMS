'use client';

import { useState, useEffect } from 'react';
import {
    ShieldAlertIcon,
    ShieldCheckIcon,
    ShieldIcon,
    SaveIcon,
    ZapIcon,
    CheckCircleIcon,
    AlertCircleIcon,
    AlertTriangleIcon,
    InfoIcon,
    ArrowRightIcon,
    XIcon,
    BookOpenIcon,
    SearchIcon,
    ExternalLinkIcon
} from 'lucide-react';

interface ValidationItem {
    code: string;
    message: string;
    severity: 'SYSTEM-BLOCK' | 'EDITOR-REVIEW' | 'ADVISORY';
    evidence?: string;
    line?: number;
}

interface ValidationReport {
    status: 'PASS' | 'SYSTEM-BLOCK' | 'EDITOR-REVIEW';
    items: ValidationItem[];
    metrics: {
        wordCount: number;
        sectionCount: number;
        citationCount: number;
    };
}

interface EditorialDeskProps {
    inquiry: {
        id: string;
        uaId: string;
        article: {
            id: string;
            draftContent: string;
            finalContent?: string;
            researchPackData?: string;
            validationReport?: string;
        }
    };
    onClose: () => void;
    onPublish: () => void;
    onSave?: () => void;
}

export default function EditorialDesk({ inquiry, onClose, onPublish, onSave }: EditorialDeskProps) {
    const parseReport = (reportStr?: string): ValidationReport | null => {
        if (!reportStr || reportStr.trim() === '') return null;
        try {
            return JSON.parse(reportStr);
        } catch (e) {
            console.error("Malformed validation report JSON:", e);
            return null;
        }
    };

    const [content, setContent] = useState(inquiry.article.finalContent || inquiry.article.draftContent || '');
    const [report, setReport] = useState<ValidationReport | null>(parseReport(inquiry.article.validationReport));
    const [isSaving, setIsSaving] = useState(false);
    const [isValidating, setIsValidating] = useState(false);
    const [isRefining, setIsRefining] = useState(false);
    const [lastSaved, setLastSaved] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'audit' | 'sources'>('audit');

    const sources = inquiry.article.researchPackData ? JSON.parse(inquiry.article.researchPackData).sources : [];

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const res = await fetch(`/api/editorial/${inquiry.id}/save`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content })
            });

            const text = await res.text();
            let data: any = {};
            try { data = text ? JSON.parse(text) : {}; } catch { data = { error: "Malformed JSON response" }; }

            if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`);
            if (data.validation) setReport(data.validation);

            setLastSaved(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
            setTimeout(() => setLastSaved(null), 3000);

            if (onSave) onSave();
        } catch (err: any) {
            console.error("Failed to save:", err);
            alert(`Save Error: ${err.message}`);
        } finally {
            setIsSaving(false);
        }
    };

    const handleApplyFixes = async () => {
        setIsRefining(true);
        try {
            const res = await fetch(`/api/editorial/${inquiry.id}/fix`, { method: 'POST' });
            const text = await res.text();
            let data: any = {};
            try { data = text ? JSON.parse(text) : {}; } catch { data = { error: "Malformed JSON response" }; }

            if (!res.ok) throw new Error(data.error || `Fix failed (${res.status})`);
            if (data.changed) {
                setContent(data.content);
                if (data.validation) setReport(data.validation);
            }
        } catch (err: any) {
            console.error("Failed to apply fixes:", err);
            alert(`Repair Error: ${err.message}`);
        } finally {
            setIsRefining(false);
        }
    };

    const handleValidate = async () => {
        setIsValidating(true);
        try {
            const res = await fetch(`/api/editorial/${inquiry.id}/validate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content })
            });

            const text = await res.text();
            let data: any = {};
            try { data = text ? JSON.parse(text) : {}; } catch { data = { error: "Malformed JSON response" }; }

            if (!res.ok) {
                const errorMsg = data.error || `Validation failed (${res.status})`;
                const details = data.details ? `\n\nDetails: ${data.details}` : '';
                const stack = data.stack ? `\n\nStack: ${data.stack.split('\n').slice(0, 5).join('\n')}` : '';
                throw new Error(`${errorMsg}${details}${stack}`);
            }
            setReport(data.validation);
        } catch (err: any) {
            console.error("Failed to validate:", err);
            alert(`Validation Error: ${err.message}`);
        } finally {
            setIsValidating(false);
        }
    };

    const getSeverityIcon = (severity: string) => {
        switch (severity) {
            case 'SYSTEM-BLOCK': return <AlertCircleIcon className="text-red-500" size={16} />;
            case 'EDITOR-REVIEW': return <AlertTriangleIcon className="text-amber-500" size={16} />;
            case 'ADVISORY': return <InfoIcon className="text-blue-500" size={16} />;
            default: return <ShieldIcon size={16} />;
        }
    };

    const isPass = report?.status === 'PASS';

    return (
        <div className="fixed inset-0 z-50 flex flex-col bg-slate-50 dark:bg-slate-900 animate-in fade-in duration-300">
            {/* Top Navigation Bar */}
            <header className="h-20 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 flex items-center justify-between px-8 shrink-0">
                <div className="flex items-center gap-6">
                    <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors text-slate-400">
                        <XIcon size={20} />
                    </button>
                    <div>
                        <h1 className="text-sm font-black uppercase tracking-[0.3em] text-slate-900 dark:text-white">Editorial Desk</h1>
                        <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-widest">
                            Asset: <span className="text-indigo-500">{inquiry.uaId}</span> — Publication Authority Check
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <button
                        onClick={handleApplyFixes}
                        disabled={isRefining}
                        className="flex items-center gap-2 px-5 py-2.5 rounded-xl border-2 border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 text-[11px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-400 hover:border-indigo-500 hover:text-indigo-500 transition-all active:scale-95 disabled:opacity-50"
                    >
                        <ZapIcon size={14} className={isRefining ? "animate-pulse" : ""} />
                        {isRefining ? 'Applying Repairs...' : 'Apply System Fixes'}
                    </button>

                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="flex items-center gap-2 px-6 py-2.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl text-[11px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all active:scale-95 disabled:opacity-50"
                    >
                        <SaveIcon size={14} />
                        {isSaving ? 'Saving...' : lastSaved ? `Saved! ${lastSaved}` : 'Save Draft'}
                    </button>

                    <div className="w-[1px] h-8 bg-slate-200 dark:bg-slate-800 mx-2" />

                    <button
                        onClick={onPublish}
                        disabled={!isPass}
                        className={`flex items-center gap-2 px-8 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all active:scale-95 shadow-xl ${isPass
                            ? 'bg-green-600 text-white hover:bg-green-700 shadow-green-500/20'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                            }`}
                    >
                        <ShieldCheckIcon size={14} />
                        Release to Media
                    </button>
                </div>
            </header>

            {/* Main Split Layout */}
            <main className="flex-1 flex overflow-hidden">
                {/* Left Panel: Validation Report */}
                <aside className="w-[450px] border-r border-slate-200 dark:border-slate-800 flex flex-col shrink-0 bg-white/50 dark:bg-slate-950/20">
                    <div className="p-6 border-b border-slate-100 dark:border-slate-800 space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <ShieldIcon size={18} className="text-indigo-500" />
                                <h3 className="text-[12px] font-black uppercase tracking-widest text-slate-500">Validation & Audit</h3>
                            </div>
                            <button
                                onClick={handleValidate}
                                disabled={isValidating}
                                className="text-[10px] font-black uppercase tracking-widest text-indigo-500 hover:underline"
                            >
                                {isValidating ? 'Validating...' : 'Refresh Audit'}
                            </button>
                        </div>

                        <div className="flex bg-slate-100 dark:bg-slate-900 p-1 rounded-xl">
                            <button
                                onClick={() => setActiveTab('audit')}
                                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'audit' ? 'bg-white dark:bg-slate-800 text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                            >
                                <BookOpenIcon size={14} />
                                Audit
                            </button>
                            <button
                                onClick={() => setActiveTab('sources')}
                                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'sources' ? 'bg-white dark:bg-slate-800 text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                            >
                                <SearchIcon size={14} />
                                Sources ({sources.length})
                            </button>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-6 space-y-6">
                        {activeTab === 'audit' ? (
                            <>
                                {/* Status Summary */}
                                <div className={`p-4 rounded-2xl border-2 flex items-center gap-4 ${report?.status === 'PASS'
                                    ? 'bg-green-50/50 border-green-100 dark:bg-green-500/10 dark:border-green-500/20'
                                    : report?.status === 'SYSTEM-BLOCK'
                                        ? 'bg-red-50/50 border-red-100 dark:bg-red-500/10 dark:border-red-500/20'
                                        : 'bg-amber-50/50 border-amber-100 dark:bg-amber-500/10 dark:border-amber-500/20'
                                    }`}>
                                    {report?.status === 'PASS' ? (
                                        <CheckCircleIcon size={24} className="text-green-500" />
                                    ) : (
                                        <ShieldAlertIcon size={24} className={report?.status === 'SYSTEM-BLOCK' ? "text-red-500" : "text-amber-500"} />
                                    )}
                                    <div>
                                        <h4 className={`text-[12px] font-black uppercase tracking-widest ${report?.status === 'PASS' ? 'text-green-600' : report?.status === 'SYSTEM-BLOCK' ? 'text-red-600' : 'text-amber-600'
                                            }`}>
                                            Status: {report?.status || 'PENDING'}
                                        </h4>
                                        <p className="text-[10px] text-slate-400 font-medium mt-1">
                                            {report?.status === 'PASS'
                                                ? 'All structural and quality gates cleared.'
                                                : `${report?.items.length || 0} violations require attention.`}
                                        </p>
                                    </div>
                                </div>

                                {/* List Items */}
                                <div className="space-y-4">
                                    {report?.items.map((item, idx) => (
                                        <div key={idx} className="group p-4 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl hover:border-slate-300 dark:hover:border-slate-700 transition-all cursor-pointer">
                                            <div className="flex items-start gap-4">
                                                <div className="mt-1 shrink-0">{getSeverityIcon(item.severity)}</div>
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">{item.code}</span>
                                                        <span className={`text-[8px] font-black px-1.5 py-0.5 rounded uppercase ${item.severity === 'SYSTEM-BLOCK' ? 'bg-red-100 text-red-600 dark:bg-red-500/20'
                                                            : item.severity === 'EDITOR-REVIEW' ? 'bg-amber-100 text-amber-600 dark:bg-amber-500/20'
                                                                : 'bg-blue-100 text-blue-600 dark:bg-blue-500/20'
                                                            }`}>
                                                            {item.severity.split('-').join(' ')}
                                                        </span>
                                                    </div>
                                                    <p className="text-[12px] font-medium text-slate-700 dark:text-slate-300 mt-2 leading-relaxed">
                                                        {item.message}
                                                    </p>
                                                    {item.evidence && (
                                                        <code className="block mt-2 p-2 bg-slate-50 dark:bg-slate-950 rounded-lg text-[10px] text-slate-400 break-all border border-slate-100 dark:border-slate-800">
                                                            {item.evidence}
                                                        </code>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ))}

                                    {(!report || report.items.length === 0) && (
                                        <div className="py-20 text-center animate-pulse">
                                            <ShieldCheckIcon size={40} className="mx-auto text-slate-200 dark:text-slate-800 mb-4" />
                                            <p className="text-[11px] font-black text-slate-300 uppercase tracking-widest">No issues detected</p>
                                        </div>
                                    )}
                                </div>
                            </>
                        ) : (
                            <div className="space-y-6">
                                {sources.map((source: any, idx: number) => (
                                    <div key={idx} className="p-4 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl space-y-3">
                                        <div className="flex items-start justify-between gap-4">
                                            <div className="space-y-1">
                                                <span className="text-[9px] font-black uppercase tracking-[0.2em] text-indigo-500 bg-indigo-50 dark:bg-indigo-500/10 px-2 py-0.5 rounded-full">{source.id}</span>
                                                <h4 className="text-[12px] font-bold text-slate-900 dark:text-white leading-tight mt-1">{source.title}</h4>
                                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{source.publisher}</p>
                                            </div>
                                            <a
                                                href={source.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="p-2 bg-slate-50 dark:bg-slate-950 text-slate-400 hover:text-indigo-500 rounded-lg border border-slate-100 dark:border-slate-800 transition-colors"
                                            >
                                                <ExternalLinkIcon size={16} />
                                            </a>
                                        </div>

                                        {source.grounding_excerpt && (
                                            <div className="p-3 bg-slate-50 dark:bg-slate-950 rounded-xl border border-dashed border-slate-200 dark:border-slate-800">
                                                <p className="text-[11px] text-slate-500 italic leading-relaxed">
                                                    "{source.grounding_excerpt}"
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                ))}

                                {sources.length === 0 && (
                                    <div className="py-20 text-center opacity-40">
                                        <SearchIcon size={40} className="mx-auto text-slate-400 mb-4" />
                                        <p className="text-[11px] font-black text-slate-300 uppercase tracking-widest">No source data attached</p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Metrics Footer */}
                    <div className="p-6 bg-slate-50 dark:bg-slate-900/50 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
                        <div className="text-center">
                            <span className="block text-[14px] font-black text-slate-900 dark:text-white">{report?.metrics.wordCount || 0}</span>
                            <span className="block text-[8px] font-black uppercase tracking-[0.2em] text-slate-400">Words</span>
                        </div>
                        <div className="text-center">
                            <span className="block text-[14px] font-black text-slate-900 dark:text-white">{report?.metrics.sectionCount || 0}</span>
                            <span className="block text-[8px] font-black uppercase tracking-[0.2em] text-slate-400">Sections</span>
                        </div>
                        <div className="text-center">
                            <span className="block text-[14px] font-black text-slate-900 dark:text-white">{report?.metrics.citationCount || 0}</span>
                            <span className="block text-[8px] font-black uppercase tracking-[0.2em] text-slate-400">Citations</span>
                        </div>
                    </div>
                </aside>

                {/* Right Panel: Editor */}
                <section className="flex-1 bg-white dark:bg-slate-900 flex flex-col overflow-hidden shadow-inner">
                    <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between px-8 bg-slate-50/50 dark:bg-slate-950/20">
                        <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Article Markdown Editor</h3>
                    </div>

                    <div className="flex-1 overflow-hidden flex relative">
                        {/* Line Numbers Fake */}
                        <div className="w-12 bg-slate-50 dark:bg-slate-950/50 border-r border-slate-100 dark:border-slate-800 flex flex-col p-8 text-[10px] font-mono text-slate-300 select-none text-right gap-[2px]">
                            {Array.from({ length: content.split('\n').length + 5 }).map((_, i) => (
                                <div key={i}>{i + 1}</div>
                            ))}
                        </div>

                        <textarea
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                            spellCheck={false}
                            className="flex-1 p-10 bg-transparent resize-none focus:ring-0 focus:outline-none text-[15px] leading-[1.8] font-mono text-slate-600 dark:text-slate-300 overflow-y-auto"
                            placeholder="Drafting in silence..."
                        />
                    </div>
                </section>
            </main>
        </div>
    );
}
