const {spawnSync}=require('node:child_process');
const r=spawnSync(process.execPath,[require.resolve('next/dist/bin/next'),'build','--webpack'],{stdio:'inherit',env:{...process.env,BUILD_TARGET:'server',NEXT_PUBLIC_BASE_PATH:''}});
process.exit(r.status??1);
