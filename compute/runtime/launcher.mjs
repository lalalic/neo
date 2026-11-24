// One immutable container contract, selectable by the service build manifest.
const mode=process.env.NEO_GPU_MODE || 'batch';
if(mode==='web') await import('./web.mjs');
else if(mode==='batch') await import('./service.mjs');
else {console.error('Invalid NEO_GPU_MODE');process.exitCode=2;}
