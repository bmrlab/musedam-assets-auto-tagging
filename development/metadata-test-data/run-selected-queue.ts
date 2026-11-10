/** Run only explicitly selected M2 fixture jobs against env 9. Global queue stays paused. */
import { loadEnvConfig } from '@next/env';
import { randomUUID } from 'node:crypto';

async function main() {
  loadEnvConfig(process.cwd());
  if (process.env.MUSEDAM_API_ENV_TAG !== 'version-env-09' || process.env.QUEUE_PAUSED !== 'true')
    throw new Error('Requires env 9 and paused global queue');
  const [{default: prisma}, {processQueueItem}, {runWithQueueExecution}] = await Promise.all([
    import('../../src/prisma/prisma'), import('../../src/app/(tagging)/queue'),
    import('../../src/lib/tagging/queue-execution'),
  ]);
  const ids = process.argv.slice(2).map(Number);
  if (!ids.length || ids.some(id=>!Number.isSafeInteger(id)||id<=0)) throw new Error('Explicit queue IDs required');
  try {
    for (const id of ids) {
      const item = await prisma.taggingQueueItem.findUniqueOrThrow({where:{id},include:{assetObject:true,team:true}});
      if(item.team.slug !== 't/135' || !['a/6964801','a/6964802','a/6964803','a/6964804','local-test-32f5ec6d-d070-495f-afd3-283e3fd19ab2','local-test-f09faa2f-7ece-4ee4-a743-d9c55c886480'].includes(item.assetObject?.slug??''))
        throw new Error('Selected job is outside this test fixture set');
      const existingAttempt=(item.extra as Record<string,unknown>)?.executionAttempt;
      const preclaimed=item.status==='processing'&&typeof existingAttempt==='string'&&existingAttempt.startsWith('metadata-m2-');
      const attempt=preclaimed ? existingAttempt as string : 'metadata-m2-'+randomUUID(), startsAt=item.startsAt??new Date();
      const extra={...(item.extra as Record<string,unknown>??{}),executionAttempt:attempt};
      const claimed=preclaimed?{count:1}:await prisma.taggingQueueItem.updateMany({where:{id,status:'pending'},data:{status:'processing',startsAt,endsAt:null,extra}});
      if(claimed.count!==1) throw new Error('Selected job is not pending');
      const controller=new AbortController();
      const assertOwned=async()=>{
        const owner=await prisma.taggingQueueItem.findFirst({where:{id,status:'processing',extra:{path:['executionAttempt'],equals:attempt}},select:{id:true}});
        if(!owner)throw new Error('Selected job ownership changed');
      };
      const heartbeat=setInterval(()=>{void prisma.taggingQueueItem.updateMany({where:{id,status:'processing',extra:{path:['executionAttempt'],equals:attempt}},data:{status:'processing'}}).catch(()=>controller.abort());},15000);
      try { await runWithQueueExecution({queueItemId:id,attempt,signal:controller.signal,assertOwned},()=>processQueueItem({...item,extra,status:'processing',startsAt})); }
      finally {clearInterval(heartbeat);}
      const result=await prisma.taggingQueueItem.findUniqueOrThrow({where:{id},select:{id:true,status:true,result:true}});
      console.log(JSON.stringify(result));
      if(result.status!=='completed')throw new Error('Fixture processing did not complete');
    }
  } finally {await prisma.$disconnect();}
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)});
