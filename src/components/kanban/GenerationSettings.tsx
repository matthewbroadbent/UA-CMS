'use client';

import React from 'react';
import {
    Settings2Icon,
    CpuIcon,
    ChevronRightIcon,
    ZapIcon,
    LayersIcon,
    CheckCircleIcon,
    AlertTriangleIcon
} from 'lucide-react';

interface Model {
    provider: string;
    model: string;
    label: string;
}

interface GenerationSettingsProps {
    config: any;
    setConfig: (config: any) => void;
    availableModels: Model[];
}

export default function GenerationSettings({ config, setConfig, availableModels }: GenerationSettingsProps) {
    const handleModeToggle = () => {
        setConfig({
            ...config,
            mode: config.mode === 'STANDARD' ? 'COMPARE' : 'STANDARD'
        });
    };

    const updateStage1 = (modelId: string) => {
        const model = availableModels.find(m => m.model === modelId);
        if (model) {
            setConfig({
                ...config,
                stage1Model: model.model,
                stage1Provider: model.provider
            });
        }
    };

    const toggleStage2Model = (modelId: string) => {
        const model = availableModels.find(m => m.model === modelId);
        if (!model) return;

        const exists = config.stage2Models.find((m: any) => m.model === modelId);
        let newModels;

        if (exists) {
            if (config.stage2Models.length === 1) return; // Must have at least one
            newModels = config.stage2Models.filter((m: any) => m.model !== modelId);
        } else {
            if (config.mode === 'STANDARD') {
                newModels = [{ model: model.model, provider: model.provider }];
            } else {
                newModels = [...config.stage2Models, { model: model.model, provider: model.provider }];
            }
        }

        setConfig({ ...config, stage2Models: newModels });
    };

    return (
        <div className="space-y-6 bg-slate-50/50 dark:bg-slate-900/50 p-6 rounded-2xl border border-slate-200 dark:border-slate-800">
            <header className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-slate-900 dark:text-white font-bold">
                    <Settings2Icon size={20} className="text-blue-500" />
                    <span>Generation Cockpit</span>
                </div>
                <div className="flex items-center gap-2 bg-white dark:bg-slate-800 p-1 rounded-lg border border-slate-200 dark:border-slate-700">
                    <button
                        onClick={handleModeToggle}
                        className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${config.mode === 'STANDARD' ? 'bg-blue-500 text-white shadow-sm' : 'text-slate-500'}`}
                    >
                        Standard
                    </button>
                    <button
                        onClick={handleModeToggle}
                        className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${config.mode === 'COMPARE' ? 'bg-indigo-500 text-white shadow-sm' : 'text-slate-500'}`}
                    >
                        Compare
                    </button>
                </div>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Stage 1: Control */}
                <div className="space-y-3">
                    <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                        <LayersIcon size={14} /> Stage 1: Control (Spine)
                    </label>
                    <select
                        value={config.stage1Model}
                        onChange={(e) => updateStage1(e.target.value)}
                        className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        {availableModels.map(m => (
                            <option key={m.model} value={m.model}>{m.label}</option>
                        ))}
                    </select>
                </div>

                {/* Stage 2: Prose */}
                <div className="space-y-3">
                    <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                        <CpuIcon size={14} /> Stage 2: Prose (Writing)
                    </label>

                    {config.mode === 'STANDARD' ? (
                        <select
                            value={config.stage2Models[0]?.model}
                            onChange={(e) => toggleStage2Model(e.target.value)}
                            className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                            {availableModels.map(m => (
                                <option key={m.model} value={m.model}>{m.label}</option>
                            ))}
                        </select>
                    ) : (
                        <div className="flex flex-wrap gap-2">
                            {availableModels.map(m => {
                                const selected = config.stage2Models.find((sm: any) => sm.model === m.model);
                                return (
                                    <button
                                        key={m.model}
                                        onClick={() => toggleStage2Model(m.model)}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${selected
                                                ? 'bg-indigo-500 border-indigo-500 text-white'
                                                : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500'
                                            }`}
                                    >
                                        {m.label}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between mb-4">
                    <button
                        onClick={() => setConfig({ ...config, showDebug: !config.showDebug })}
                        className={`flex items-center gap-2 text-xs font-bold transition-colors ${config.showDebug ? 'text-orange-500' : 'text-slate-400'}`}
                    >
                        <ZapIcon size={14} />
                        {config.showDebug ? 'Hide Debug Artefacts' : 'Show Debug Artefacts (Spine)'}
                    </button>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                        <span className="text-[10px] font-bold uppercase text-slate-400">S1 Temp: {config.options.temperature1}</span>
                        <input
                            type="range" min="0" max="1" step="0.1"
                            value={config.options.temperature1}
                            onChange={(e) => setConfig({ ...config, options: { ...config.options, temperature1: parseFloat(e.target.value) } })}
                            className="w-full h-1 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer"
                        />
                    </div>
                    <div className="space-y-1">
                        <span className="text-[10px] font-bold uppercase text-slate-400">S2 Temp: {config.options.temperature2}</span>
                        <input
                            type="range" min="0" max="1" step="0.1"
                            value={config.options.temperature2}
                            onChange={(e) => setConfig({ ...config, options: { ...config.options, temperature2: parseFloat(e.target.value) } })}
                            className="w-full h-1 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer"
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
