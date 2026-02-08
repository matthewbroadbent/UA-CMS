# 🗺️ Project Roadmap: UA CMS Phase 3

We have stabilized the **Sequential Rendering Pipeline** and achieved perfect 1:1, 9:16, and 16:9 renders. The system is now robust and production-ready.

## ✅ Accomplished in this session:
1.  **Sequential Rendering Breakthrough**: Refactored `renderer.ts` to render scene-by-scene, eliminating OOM crashes on 60s/HD masters.
2.  **Visual Quality Lock**: Fix font issues (`DejaVu Serif`), re-enabled High-Impact Ken Burns, and verified full-duration audio sync.
3.  **UI Sync Fix**: Forced video player refresh via React keys to ensure instant preview of fresh renders.
4.  **16:9 Support**: Fully implemented widescreen masters for YouTube/X.

## 🚀 The Next Steps (Client Acquisition Phase):

### 1. VPS Migration
- [ ] Transfer the application to the VPS (using the existing `deploy.sh` and production config).
- [ ] Setup DNS and SSL for remote access.
- [ ] Configure environment variables for production (Anthropic, Fal, Prisma).

### 2. Google Drive Distribution System
- [ ] **Remote-First Storage**: Ensure completed videos are uploaded directly to Google Drive.
- [ ] **Space Optimization**: 
    -   Videos should **not** sync with the local hard drive (save local disk space).
    -   Videos should **not** take up permanent space on the VPS (auto-cleanup after upload).
- [ ] **Organized Hierarchy**: Separate Google Drive directories for:
    -   **X (Twitter)**
    -   **Instagram / Facebook**
    -   **YouTube**
    -   **LinkedIn**

### 3. Branding & Strategy
- [ ] Talk to Claire about how to boost brand theme.

## 📝 Files for context on return:
- [renderer.ts](src/lib/renderer.ts) (The master render logic)
- [KanbanBoard.tsx](src/components/kanban/KanbanBoard.tsx) (UI for triggering renders)
- [deploy.sh](deploy.sh) (VPS deployment script)

**Good luck with the client acquisition work! See you when you're back.**
