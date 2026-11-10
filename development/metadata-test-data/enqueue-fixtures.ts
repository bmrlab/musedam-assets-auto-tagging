import { loadEnvConfig } from '@next/env';
import { randomUUID } from 'node:crypto';
async function main(){
 loadEnvConfig(process.cwd());
 if(process.env.MUSEDAM_API_ENV_TAG!=='version-env-09'||process.env.QUEUE_PAUSED!=='true')throw new Error('Requires env 9 and paused global queue');
 const [{default:prisma},{syncSingleAssetFromMuseDAM},{MuseDAMID},{enqueueTaggingTask}]=await Promise.all([import('../../src/prisma/prisma'),import('../../src/musedam/assets'),import('../../src/musedam/types'),import('../../src/app/(tagging)/queue')]);
 try{
  const team=await prisma.team.findUniqueOrThrow({where:{slug:'t/135'},select:{id:true,slug:true}});
  const ids=process.argv.slice(2);if(!ids.length||ids.some(id=>!['6964801','6964802','6964803','6964804'].includes(id)))throw new Error('Explicit fixture material IDs required');
  for(const id of ids){const {assetObject}=await syncSingleAssetFromMuseDAM({team,musedamAssetId:MuseDAMID.from(id)}); const job=await enqueueTaggingTask({assetObject,taskType:'manual',featureClassify:false});const attempt='metadata-m2-'+randomUUID(); const claimed=await prisma.taggingQueueItem.updateMany({where:{id:job.id,status:'pending'},data:{status:'processing',startsAt:new Date(),extra:{...(job.extra as Record<string,unknown>),executionAttempt:attempt}}});if(claimed.count!==1)throw new Error('Fixture job claimed by another worker'); console.log(JSON.stringify({materialId:id,assetObjectId:assetObject.id,name:assetObject.name,queueItemId:job.id}));}
 }finally{await prisma.$disconnect();}
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)});
