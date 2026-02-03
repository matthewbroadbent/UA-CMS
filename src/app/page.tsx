import KanbanBoard from '@/components/kanban/KanbanBoard';

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <header className="p-6 border-b border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-950/50 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-[1800px] mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Unemployable Advisor <span className="text-blue-600">CMS</span>
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">Human-in-the-Loop Content Pipeline</p>
          </div>

          <div className="flex items-center gap-4">
            <a href="/new" className="px-4 py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity">
              + New Inquiry
            </a>
          </div>
        </div>
      </header>

      <div className="max-w-[1800px] mx-auto">
        <KanbanBoard />
      </div>
    </main>
  );
}
