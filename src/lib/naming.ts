/**
 * Generates an intelligible, human-readable filename for assets.
 * Pattern: [UA-ID]_[TYPE]_[DETAIL]_[TIMESTAMP].[EXT]
 */
export function getIntelligibleName(params: {
    uaId: string;
    type: 'ARTICLE' | 'POST' | 'VOICE' | 'SCENE' | 'VIDEO' | 'CAPTIONS' | 'SCRIPT' | 'JSON';
    detail?: string; // e.g., '30s', 'scene_2'
    extension: string;
}) {
    // Timestamp: YYYYMMDDHHMM
    const ts = new Date().toISOString()
        .replace(/[-:T]/g, '')
        .split('.')[0]
        .slice(0, 12);

    const typePart = params.type.toUpperCase();
    const detailPart = params.detail ? `_${params.detail.toUpperCase().replace(/\s+/g, '_')}` : '';
    const cleanUaId = params.uaId.replace(/\s+/g, '_');

    return `${cleanUaId}_${typePart}${detailPart}_${ts}.${params.extension}`;
}
