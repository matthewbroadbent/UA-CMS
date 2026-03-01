import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { StorageService } from '@/lib/storage';

export async function GET() {
    try {
        const items = await (prisma as any).weeklyInquiry.findMany({
            // Note: relationLoadStrategy: 'join' is disabled for now
            // because the current Prisma runtime rejects it as an
            // unknown argument. The includes below already ensure
            // Prisma batches relation queries efficiently.
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
        // We do this sequentially to avoid "Bad Gateway" (502) errors from Supabase
        // when making too many concurrent Storage requests.
        for (const item of items) {
            const enrichAssets = async (assets: any[]) => {
                if (!assets) return [];
                const enriched = [];
                for (const asset of assets) {
                    enriched.push({
                        ...asset,
                        signedUrl: asset.provider === 'supabase'
                            ? await StorageService.getSignedUrl(asset)
                            : asset.driveWebViewLink
                    });
                }
                return enriched;
            };

            item.assets = await enrichAssets(item.assets);
            if (item.article) {
                item.article.assets = await enrichAssets(item.article.assets);
            }

            if (item.scripts) {
                for (const script of item.scripts) {
                    script.assets = await enrichAssets(script.assets);
                    if (script.scenes) {
                        for (const scene of script.scenes) {
                            scene.assetUrl = (scene.assetUrl && !scene.assetUrl.startsWith('http'))
                                ? await StorageService.getSignedUrl({
                                    provider: 'supabase',
                                    bucket: (scene.type === 'VIDEO') ? (process.env.UA_SUPABASE_VIDEO_BUCKET || 'ua-video') : (process.env.UA_SUPABASE_VIDEO_BUCKET || 'ua-video'),
                                    objectKey: scene.assetUrl
                                })
                                : scene.assetUrl;
                        }
                    }
                }
            }

            if (item.textPosts) {
                for (const post of item.textPosts) {
                    post.assets = await enrichAssets(post.assets);
                }
            }
        }

        return NextResponse.json(items);
    } catch (error: any) {
        console.error('API Error /api/kanban:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
