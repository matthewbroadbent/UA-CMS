import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { StorageService } from '@/lib/storage';

export async function GET() {
    try {
        const items = await (prisma as any).weeklyInquiry.findMany({
            include: {
                article: {
                    include: {
                        assets: true
                    }
                },
                generationRuns: {
                    include: {
                        outputs: true
                    },
                    orderBy: {
                        createdAt: 'desc'
                    }
                },
                driveOutputs: true,
                assets: true,
                textPosts: {
                    include: {
                        assets: true
                    }
                },
                scripts: {
                    include: {
                        scenes: {
                            orderBy: {
                                index: 'asc'
                            }
                        },
                        driveOutputs: true,
                        assets: true
                    }
                }
            },
            orderBy: {
                createdAt: 'desc',
            },
        });

        // Enrich with signed URLs for Supabase assets
        const enrichedItems = await Promise.all(items.map(async (item: any) => {
            const enrichAssets = async (assets: any[]) => {
                if (!assets) return [];
                return Promise.all(assets.map(async (asset) => ({
                    ...asset,
                    signedUrl: asset.provider === 'supabase' ? await StorageService.getSignedUrl(asset) : asset.driveWebViewLink
                })));
            };

            item.assets = await enrichAssets(item.assets);
            if (item.article) {
                item.article.assets = await enrichAssets(item.article.assets);
            }
            item.scripts = await Promise.all(item.scripts.map(async (script: any) => ({
                ...script,
                assets: await enrichAssets(script.assets),
                scenes: script.scenes ? await Promise.all(script.scenes.map(async (scene: any) => ({
                    ...scene,
                    assetUrl: (scene.assetUrl && !scene.assetUrl.startsWith('http'))
                        ? await StorageService.getSignedUrl({
                            provider: 'supabase',
                            bucket: (scene.type === 'VIDEO') ? (process.env.UA_SUPABASE_VIDEO_BUCKET || 'ua-video') : (process.env.UA_SUPABASE_VIDEO_BUCKET || 'ua-video'),
                            objectKey: scene.assetUrl
                        })
                        : scene.assetUrl
                }))) : []
            })));
            item.textPosts = await Promise.all(item.textPosts.map(async (post: any) => ({
                ...post,
                assets: await enrichAssets(post.assets)
            })));

            return item;
        }));

        return NextResponse.json(enrichedItems);
    } catch (error: any) {
        console.error('API Error /api/kanban:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
