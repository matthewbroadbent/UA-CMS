const { runMediaPipeline, runRenderPipeline } = require('./src/lib/pipeline.ts');

async function main() {
    const inquiryId = 'cmle41ub60000i419hehtgci5';
    const scriptId = 'cmlea09tg001ak3191jw796nw';

    console.log(`--- Triggering targeted Media Pipeline for script: ${scriptId} ---`);
    await runMediaPipeline(inquiryId, [scriptId]);

    console.log(`--- Media complete. Triggering Render Pipeline ---`);
    await runRenderPipeline(scriptId);
    console.log(`--- All steps triggered for 30s. ---`);
}

main().catch(console.error);
