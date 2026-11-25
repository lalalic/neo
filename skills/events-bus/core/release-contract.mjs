// Native package publication is observational, not a Job lifecycle event.
import { safeJobId } from '../mcp/validation.mjs';

const PACKAGE = /^[a-z][a-z0-9-]{0,63}$/;
const SHA = /^[0-9a-f]{40}$/;
export function releasePrefix(config) {
  return config.subjectPrefix.endsWith('.job')
    ? config.subjectPrefix.slice(0,-4)+'.release'
    : config.subjectPrefix+'.release';
}
export function expandReleaseEvent({type,source,data}) {
  const match = /^release\/([a-z][a-z0-9-]{0,63})\/([0-9a-f]{40})$/.exec(source ?? '');
  if (type !== 'package.published' || !match) throw Error('invalid native publication type/source');
  if (!data || typeof data !== 'object' || Array.isArray(data)
      || data.package !== match[1] || data.sha !== match[2]
      || !PACKAGE.test(data.package) || !SHA.test(data.sha)
      || typeof data.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(data.version)
      || data.registry !== 'native'
      || Object.keys(data).some(k=>!['package','sha','version','registry','jobId'].includes(k))
      || (data.jobId !== undefined && !safeJobId(data.jobId))) throw Error('invalid native publication data');
  return {kind:'release',type,source:{id:source},status:'succeeded',visibility:'orchestrator',
    message:'Published '+data.package+'@'+data.version,level:'info',
    event_id:'release:'+data.package+':'+data.sha+':package.published',
    ...(data.jobId === undefined ? {} : {job_id:data.jobId}),data};
}
export function releaseSubject(config,event) {
  return releasePrefix(config)+'.'+event.data.package+'.'+event.type;
}
export function validReleasePackage(value) { return typeof value === 'string' && PACKAGE.test(value); }
