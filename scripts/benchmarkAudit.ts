import { performance } from 'node:perf_hooks';
import { foldFromGenesis, type CommitNode } from '../src/engine/head';
import { buildPortfolioRows } from '../src/engine/portfolio/buildPortfolioRows';
import type { ElementsHeadRow } from '../src/contracts/rows';

// Read-only, synthetic engine benchmark. No database, network or browser access.
const results: unknown[] = [];
for (const count of [500, 2000, 5000, 10000, 20000]) {
  const nodes = new Map<string, CommitNode>();
  for (let i = 0; i < count; i++) {
    nodes.set(`c${String(i)}`, {
      id: `c${String(i)}`, parent_commit_id: i ? `c${String(i - 1)}` : null,
      merged_branch_head_commit_id: null, depth: i,
      org_id: 'benchmark-org', model_id: 'benchmark-model', branch_id: 'benchmark-branch',
      kind: 'manual', title: 'Benchmark update', body: null, head_hash: null,
      author_id: 'benchmark', created_at: '2026-11-10T00:00:00Z',
      deltas: [i === 0
        ? {kind:'element.create',id:'d0',elementId:'s',elementType:'system',name:'System',parentId:null,attributes:{vendor:'v0'},sourceId:'source',confidence:1}
        : {kind:'element.update',id:`d${String(i)}`,elementId:'s',elementType:'system',attribute:'vendor',value:`v${String(i)}`,previousDeltaId:`d${String(i-1)}`,sourceId:'source',confidence:1}],
    } as CommitNode);
  }
  const start = performance.now();
  try {
    const head = foldFromGenesis(`c${String(count-1)}`, id => nodes.get(id));
    results.push({kind:'history',commits:count,ms:Math.round((performance.now()-start)*10)/10,ok:head.elements.get('s')?.attributes.vendor===`v${String(count-1)}`});
  } catch (error) {
    results.push({kind:'history',commits:count,ms:Math.round((performance.now()-start)*10)/10,error:String(error)});
  }
}
for (const count of [200, 2000, 10000]) {
  const caps = Math.max(10, count/10);
  const row = (id:string,type:string,attributes:object):ElementsHeadRow => ({element_id:id,element_type:type,name:id,parent_id:null,attributes,exists_delta_id:`d-${id}`} as ElementsHeadRow);
  const systems = Array.from({length:count},(_,i)=>row(`s${String(i)}`,'system',{annualRunCost:'250k_1m',lifecycleStatus:'active',criticality:'high'}));
  const capabilities = Array.from({length:caps},(_,i)=>row(`cap${String(i)}`,'capability',{}));
  const supportsEdges = systems.flatMap((s,i)=>[0,1,2].map(j=>({relationship_id:`r${String(i)}-${String(j)}`,relationship_type:'supports' as const,from_element_id:s.element_id,to_element_id:`cap${String((i+j)%caps)}`,attributes:{role:'secondary',fitForPurpose:'good'},exists_delta_id:`d-r${String(i)}-${String(j)}`})));
  const input = {systems,capabilities,containers:[],actors:[],supportsEdges,ownsEdges:[],now:new Date('2026-11-10T00:00:00Z')};
  const timings:number[]=[];
  for(let n=0;n<4;n++) {
    const start=performance.now();
    const built=buildPortfolioRows(input);
    if(built.rows.length!==count) throw new Error('Unexpected portfolio size');
    if(n>0) timings.push(performance.now()-start);
  }
  timings.sort((a,b)=>a-b);
  results.push({kind:'portfolio',systems:count,capabilities:caps,supportEdges:supportsEdges.length,medianMs:Math.round((timings.at(1) ?? NaN)*10)/10});
}
console.log(JSON.stringify({node:process.version,platform:process.platform,results},null,2));
