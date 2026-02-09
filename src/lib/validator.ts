/**
 * UA-CMS Editorial Engine - Tri-State Validator
 * 
 * Severities:
 * 1. SYSTEM-BLOCK (Hard): Data integrity issues, corruption, or missing prerequisites.
 * 2. EDITOR-REVIEW (Soft): Formatting or tonal issues requiring human judgement.
 * 3. ADVISORY (Meta): Suggestions that don't block publication.
 */

export type Severity = 'SYSTEM-BLOCK' | 'EDITOR-REVIEW' | 'ADVISORY';

export interface ValidationItem {
    code: string;
    message: string;
    severity: Severity;
    evidence?: string;
    line?: number;
}

export interface ValidationReport {
    status: 'PASS' | 'SYSTEM-BLOCK' | 'EDITOR-REVIEW';
    items: ValidationItem[];
    h1Count: number;
    metrics: {
        wordCount: number;
        sectionCount: number;
        citationCount: number;
    };
}

export function validateArticle(
    text: string,
    contracts: { researchPack?: any, spineContract?: any }
): ValidationReport {
    const items: ValidationItem[] = [];
    const lines = text.split('\n');
    const wordCount = text.trim().split(/\s+/).length;

    // --- SYSTEM-BLOCKS (HARD FAILS) ---

    // 1. Encoding
    const mojibake = ["Â£", "â€•", "â€¢", "â€™", "â€œ", "â€", "â", "Â"];
    for (const char of mojibake) {
        if (text.includes(char)) {
            items.push({
                code: 'ENCODING_CORRUPTION',
                message: `Encoding corruption detected: Found "${char}".`,
                severity: 'SYSTEM-BLOCK',
                evidence: char
            });
        }
    }

    // 2. Prerequisites
    if (!contracts.researchPack) {
        items.push({
            code: 'MISSING_RESEARCH',
            message: 'Research Pack is missing or invalid.',
            severity: 'SYSTEM-BLOCK'
        });
    }
    if (!contracts.spineContract) {
        items.push({
            code: 'MISSING_SPINE',
            message: 'Spine Contract is missing.',
            severity: 'SYSTEM-BLOCK'
        });
    }

    // 3. Essential Citations
    const citationMatches = text.match(/\[SRC-\d+\]/g) || [];
    const citationCount = citationMatches.length;
    if (citationCount === 0 && wordCount > 300) {
        items.push({
            code: 'NO_CITATIONS',
            message: 'No stable citations ([SRC-XX]) found in article.',
            severity: 'SYSTEM-BLOCK'
        });
    }

    // 4. Redirect URLs
    const urls = text.match(/https?:\/\/[^\s\)]+/g) || [];
    const redirectPatterns = ["google.com/search", "vertexai", "googlecloud", "atp.ai"];
    urls.forEach(url => {
        if (redirectPatterns.some(p => url.toLowerCase().includes(p))) {
            items.push({
                code: 'REDIRECT_URL',
                message: `Redirect/Opaque URL detected: ${url}`,
                severity: 'SYSTEM-BLOCK',
                evidence: url
            });
        }
    });

    // --- EDITOR-REVIEWS (SOFT FAILS) ---

    // 1. Heading Levels
    const h1s = text.match(/^#\s.+/gm) || [];
    const h1Count = h1s.length;

    if (h1Count > 1) {
        items.push({
            code: 'SINGLE_H1_CONSTRAINT',
            message: `Found ${h1Count} H1 headers. Only the Chapter Heading should be H1.`,
            severity: 'EDITOR-REVIEW',
            evidence: h1s.join(' | ')
        });
    }

    if (!text.includes("**THE UNEMPLOYABLE ADVISOR**")) {
        items.push({
            code: 'MISSING_PUB_LABEL',
            message: "Missing publication label (**THE UNEMPLOYABLE ADVISOR**).",
            severity: 'EDITOR-REVIEW'
        });
    }
    if (!text.match(/^# Chapter/m)) {
        items.push({
            code: 'WRONG_CHAPTER_LEVEL',
            message: "Chapter header should be H1 (# Chapter...).",
            severity: 'EDITOR-REVIEW'
        });
    }

    // 2. Section Titles
    const sectionH2s = (text.match(/^##\s.+/gm) || []).filter(h => !h.includes('## Chapter'));
    const sectionCount = sectionH2s.length;
    if (sectionCount !== 5) {
        items.push({
            code: 'SECTION_COUNT_MISMATCH',
            message: `Found ${sectionCount} sections, expected exactly 5.`,
            severity: 'EDITOR-REVIEW',
            evidence: `Found: ${sectionH2s.join(', ')}`
        });
    }

    sectionH2s.forEach(h => {
        const title = h.replace('## ', '').trim();
        const words = title.split(/\s+/).length;
        if (words < 3 || words > 6) {
            items.push({
                code: 'TITLE_LENGTH_BREACH',
                message: `Section title "${title}" is ${words} words (Requirement: 3-6).`,
                severity: 'EDITOR-REVIEW',
                evidence: title
            });
        }
    });

    // --- ADVISORIES (OPTIONAL) ---

    // 1. Ending Resolution
    const lastLines = text.trim().split('\n').slice(-3).join('\n').toLowerCase();
    if (text.trim().endsWith('?')) {
        items.push({
            code: 'INTERACTIVE_ENDING',
            message: "Ending with a question may be too interactive for a 'thinking surface'.",
            severity: 'ADVISORY'
        });
    }

    // Final Status Calculation
    let status: ValidationReport['status'] = 'PASS';
    if (items.some(i => i.severity === 'SYSTEM-BLOCK')) {
        status = 'SYSTEM-BLOCK';
    } else if (items.some(i => i.severity === 'EDITOR-REVIEW')) {
        status = 'EDITOR-REVIEW';
    }

    return {
        status,
        items,
        h1Count,
        metrics: {
            wordCount,
            sectionCount,
            citationCount
        }
    };
}
