/**
 * UA-CMS Editorial Engine - Deterministic Fixes
 * 
 * Rules:
 * 1. No AI calls allowed here.
 * 2. Focus on mechanical data integrity.
 * 3. Sanitization must be idempotent.
 */

/**
 * Normalizes UTF-8 and replaces common mojibake sequences.
 */
export function sanitizeEncoding(text: string): string {
    if (!text) return "";

    // Common Mojibake mapping
    const mapping: Record<string, string> = {
        "Â£": "£",
        "â€•": "—",
        "â€¢": "•",
        "â€™": "’",
        "â€œ": "“",
        "â€": "”", // Greedy match for ending quotes
        "â": "—",  // Catch-all for failed dashes
        "Â": "",   // Non-breaking space artifact
        "â€˜": "‘",
        "â€\u009D": "”",
        "â€\u0093": "–",
        "â€\u0094": "—",
        "â€¦": "...",
    };

    let sanitized = text;
    for (const [bad, good] of Object.entries(mapping)) {
        sanitized = sanitized.split(bad).join(good);
    }

    return sanitized;
}

/**
 * Converts footnote style markers [^1] to stable [SRC-xx] style
 * if mapping is provided or unambiguous.
 */
export function sanitizeCitations(text: string): string {
    if (!text) return "";

    // 1. Detect [^n] markers
    // We don't automatically convert unless we are sure of the mapping,
    // but we can strip the '^' if they are clearly numeric indices 
    // that the user wants to treat as SRC IDs (common drift)
    return text.replace(/\[\^(\d+)\]/g, "[SRC-$1]");
}

/**
 * Enforces canonical URLs and rejects redirects.
 * Denylist includes known search/AI redirect domains.
 */
export function validateUrl(url: string): { valid: boolean; reason?: string; canonical?: string } {
    if (!url) return { valid: false, reason: "Empty URL" };

    const redirectPatterns = [
        "google.com/search",
        "vertexai",
        "googlecloud",
        "atp.ai",
        "bing.com",
        "google.com/url",
        "t.co/",
        "bit.ly/"
    ];

    const isRedirect = redirectPatterns.some(p => url.toLowerCase().includes(p.toLowerCase()));

    if (isRedirect) {
        return { valid: false, reason: `Redirect URL detected: ${url}` };
    }

    if (url.length > 250) {
        return { valid: false, reason: `URL length (${url.length}) exceeds 250 character threshold.` };
    }

    return { valid: true };
}

/**
 * Applies all safe deterministic repairs.
 */
export function applyEditorialSanitization(text: string): string {
    let output = text;
    output = sanitizeEncoding(output);
    output = sanitizeCitations(output);
    return output;
}
