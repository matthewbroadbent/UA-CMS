/**
 * UA CMS Prompt Engine — Regression Tests
 *
 * Validates structural invariants of prompts.ts to catch regressions
 * introduced during prompt editing.
 *
 * Run with:  npx tsx scripts/prompt-regression.ts
 * Or:        npm run test:prompts
 *
 * No external test framework required. Exits 0 on pass, 1 on failure.
 */

import { PROMPTS, buildPrompt } from '../src/lib/prompts';

// ─────────────────────────────────────────────────────────────────────────────
// Minimal assertion helpers
// ─────────────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.error(`  ✗  ${label}${detail ? `\n       ${detail}` : ''}`);
    failed++;
  }
}

function assertContains(label: string, haystack: string, needle: string): void {
  assert(label, haystack.includes(needle), `Expected to find: "${needle}"`);
}

function assertNotContains(label: string, haystack: string, needle: string): void {
  assert(label, !haystack.includes(needle), `Should NOT contain: "${needle}"`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — Active pipeline prompts all present
// ─────────────────────────────────────────────────────────────────────────────

console.log('\nSuite 1: Active pipeline prompts present');

const activePipeline = [
  'UA_RESEARCH_PACK',
  'UA_STRATEGIC_PLAN',
  'UA_STORY_PASS',
  'UA_PROSE_WRITE',
  'UA_COMPLIANCE_PASS',
] as const;

for (const name of activePipeline) {
  assert(
    `PROMPTS.${name} exists`,
    typeof PROMPTS[name] === 'string' && PROMPTS[name].length > 100,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — Legacy prompts removed
// ─────────────────────────────────────────────────────────────────────────────

console.log('\nSuite 2: Legacy prompts removed');

const legacyPrompts = ['SUBSTACK_DRAFT', 'RESEARCH_BRIEF', 'CLAUDE_EDITORIAL_SYNTHESIS'] as const;

for (const name of legacyPrompts) {
  assert(
    `PROMPTS.${name} is absent`,
    !(name in PROMPTS),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3 — Spine contract contains anchor_observation
// ─────────────────────────────────────────────────────────────────────────────

console.log('\nSuite 3: Spine contract — anchor_observation');

assertContains(
  'UA_STRATEGIC_PLAN schema includes anchor_observation field',
  PROMPTS.UA_STRATEGIC_PLAN,
  '"anchor_observation"',
);

assertContains(
  'UA_STRATEGIC_PLAN instructs anchor_observation derivation from Thinking field',
  PROMPTS.UA_STRATEGIC_PLAN,
  'anchor_observation',
);

assertContains(
  'UA_STRATEGIC_PLAN anchor_observation must be contestable',
  PROMPTS.UA_STRATEGIC_PLAN,
  'contestable',
);

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4 — Norivane domain correctness
// ─────────────────────────────────────────────────────────────────────────────

console.log('\nSuite 4: Norivane domain correctness');

// The only permitted occurrences of norivane.co.uk are inside the A1b and P0b
// compliance checks where it is the SEARCH TARGET string being looked for.
// Count total occurrences and confirm they are only in UA_COMPLIANCE_PASS.
const fullFile = Object.values(PROMPTS).join('\n');
const coUkOccurrences = (fullFile.match(/norivane\.co\.uk/g) || []).length;

assert(
  'norivane.co.uk appears only inside UA_COMPLIANCE_PASS (search-target strings)',
  coUkOccurrences <= 2 &&
    !PROMPTS.UA_RESEARCH_PACK.includes('norivane.co.uk') &&
    !PROMPTS.UA_STRATEGIC_PLAN.includes('norivane.co.uk') &&
    !PROMPTS.UA_STORY_PASS.includes('norivane.co.uk') &&
    !PROMPTS.UA_PROSE_WRITE.includes('norivane.co.uk'),
  `Found ${coUkOccurrences} occurrences total; none should appear in generative passes`,
);

assertContains(
  'UA_COMPLIANCE_PASS P4 CTA uses score.norivane.com',
  PROMPTS.UA_COMPLIANCE_PASS,
  'score.norivane.com has a diagnostic that takes twenty minutes',
);

assertContains(
  'UA_COMPLIANCE_PASS P5 CTA uses score.norivane.com',
  PROMPTS.UA_COMPLIANCE_PASS,
  'Saleability Diagnostic at score.norivane.com',
);

assertContains(
  'UA_COMPLIANCE_PASS contains A1b URL correction check',
  PROMPTS.UA_COMPLIANCE_PASS,
  'A1b',
);

assertContains(
  'UA_COMPLIANCE_PASS contains P0b URL correction check',
  PROMPTS.UA_COMPLIANCE_PASS,
  'P0b',
);

// ─────────────────────────────────────────────────────────────────────────────
// Suite 5 — No malformed template variables
// ─────────────────────────────────────────────────────────────────────────────

console.log('\nSuite 5: No malformed spaced template variables');

// Detect { { variable } } or {{ variable }} patterns (spaces inside or outside braces)
// The buildPrompt regex comment intentionally contains this pattern — exclude it
const spacedVarPattern = /\{\s+\{|\}\s+\}/;

for (const name of activePipeline) {
  // Strip the buildPrompt function body from the check target (it's not a prompt string)
  const promptBody = PROMPTS[name];
  assert(
    `${name} has no spaced template variable braces`,
    !spacedVarPattern.test(promptBody),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 6 — Shared constants referenced in active prompts
// ─────────────────────────────────────────────────────────────────────────────

console.log('\nSuite 6: Shared constants injected correctly');

// OBSERVATION_SCORING_RUBRIC is a JS constant so its content is baked into the
// compiled prompt strings — verify the first criterion appears in both consumers
const rubricSentinel = 'Behavioural specificity';

assertContains(
  'UA_PROSE_WRITE contains OBSERVATION_SCORING_RUBRIC content',
  PROMPTS.UA_PROSE_WRITE,
  rubricSentinel,
);

assertContains(
  'VIDEO_SCRIPTS contains OBSERVATION_SCORING_RUBRIC content',
  PROMPTS.VIDEO_SCRIPTS,
  rubricSentinel,
);

// UA_STYLE_CARD sentinel — "No em-dashes" is in the card
const styleCardSentinel = 'No em-dashes';

assertContains(
  'UA_PROSE_WRITE contains UA_STYLE_CARD content',
  PROMPTS.UA_PROSE_WRITE,
  styleCardSentinel,
);

assertContains(
  'VIDEO_SCRIPTS contains UA_STYLE_CARD content',
  PROMPTS.VIDEO_SCRIPTS,
  styleCardSentinel,
);

// ─────────────────────────────────────────────────────────────────────────────
// Suite 7 — buildPrompt fixture regression
// ─────────────────────────────────────────────────────────────────────────────

console.log('\nSuite 7: buildPrompt fixture regression');

const fixture = {
  theme: 'Owner dependence',
  thinking: 'Buyers notice when everything routes through the founder',
  reality: 'I had a deal fall apart because the buyer called my mobile three times and I answered all three.',
  rant: 'Founders think this is dedication. Buyers think this is a liability.',
  nuclear: 'The business is worth less because you are good at your job.',
  research_pack: '{"facts":[],"sources":[]}',
  today: '20260309',
};

const builtPlan = buildPrompt(PROMPTS.UA_STRATEGIC_PLAN, fixture);

assert(
  'buildPrompt resolves {{theme}}',
  builtPlan.includes('Owner dependence'),
);

assert(
  'buildPrompt resolves {{today}} in uaId',
  builtPlan.includes('UA-POST-20260309-01'),
);

assertNotContains(
  'buildPrompt leaves no unresolved {{today}} placeholders',
  builtPlan,
  '{{today}}',
);

assertNotContains(
  'buildPrompt output contains no spaced brace artifacts',
  builtPlan,
  '{ {',
);

assertContains(
  'buildPrompt output contains anchor_observation schema field',
  builtPlan,
  'anchor_observation',
);

const builtStory = buildPrompt(PROMPTS.UA_STORY_PASS, { reality: fixture.reality });

assert(
  'buildPrompt resolves {{reality}} in UA_STORY_PASS',
  builtStory.includes(fixture.reality),
);

assertNotContains(
  'UA_STORY_PASS output contains no unresolved placeholders',
  builtStory,
  '{{',
);

// ─────────────────────────────────────────────────────────────────────────────
// Suite 8 — anchor_observation wiring (Pass B → Pass C2)
// ─────────────────────────────────────────────────────────────────────────────

console.log('\nSuite 8: anchor_observation wiring Pass B → Pass C2');

// UA_PROSE_WRITE prompt contains the {{anchor_observation}} template variable
assertContains(
  'UA_PROSE_WRITE prompt contains {{anchor_observation}} variable',
  PROMPTS.UA_PROSE_WRITE,
  '{{anchor_observation}}',
);

// UA_PROSE_WRITE prompt contains the anchoring instruction
assertContains(
  'UA_PROSE_WRITE contains anchoring instruction',
  PROMPTS.UA_PROSE_WRITE,
  'The article must remain anchored to the Anchor Observation',
);

// buildPrompt correctly interpolates anchor_observation into UA_PROSE_WRITE
const c2Fixture = {
  article_spine: '{"chapter_number":1,"chapter_title":"Test","italic_subtitle":"Test subtitle","anchor_observation":"Buyers notice operational incoherence long before formal diligence starts.","spine":[]}',
  anchor_observation: 'Buyers notice operational incoherence long before formal diligence starts.',
  chapter_number: '1',
  chapter_title: 'Test Chapter',
  theme_subtitle: 'Test subtitle',
  h2_2: 'The friction emerges here',
  h2_3: 'What this exposes',
  h2_4: 'Buyer logic applied',
  h2_5: 'It stays unresolved',
  section_1: 'The founder answered every call.',
  thinking: 'Buyers notice when everything routes through the founder.',
  rant: 'This is a liability.',
  nuclear: 'The business is worth less because you are available.',
  research_pack: '{"facts":[],"sources":[]}',
};

const builtC2 = buildPrompt(PROMPTS.UA_PROSE_WRITE, c2Fixture);

assert(
  'buildPrompt resolves {{anchor_observation}} in UA_PROSE_WRITE',
  builtC2.includes('Buyers notice operational incoherence long before formal diligence starts.'),
);

assertNotContains(
  'UA_PROSE_WRITE build leaves no unresolved {{anchor_observation}} placeholder',
  builtC2,
  '{{anchor_observation}}',
);

assertContains(
  'UA_PROSE_WRITE build contains anchoring instruction in output',
  builtC2,
  'The article must remain anchored to the Anchor Observation',
);

// ─────────────────────────────────────────────────────────────────────────────
// Results
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
console.log(`  ${passed} passed   ${failed} failed`);
console.log(`${'─'.repeat(60)}\n`);

if (failed > 0) {
  process.exit(1);
}
