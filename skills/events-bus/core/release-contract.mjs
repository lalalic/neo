// Package publication is observational, not a Job lifecycle event.
import { safeJobId } from '../mcp/validation.mjs';

const PACKAGE = /^[a-z][a-z0-9-]{0,63}$/;
const SHA = /^[0-9a-f]{40}$/;
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const ARTIFACT = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
export function releasePrefix(config) {
  return config.subjectPrefix.endsWith('.job')
    ? config.subjectPrefix.slice(0,-4)+'.release'
    : config.subjectPrefix+'.release';
}
export function expandReleaseEvent({type,source,data}) {
  const match = /^release\/([a-z][a-z0-9-]{0,63})\/([0-9a-f]{40})$/.exec(source ?? '');
  const success=type==='package.published';
  if ((!success && type!=='package.publish_failed') || !match) throw Error('invalid publication type/source');
  if (!data || typeof data !== 'object' || Array.isArray(data)
      || data.package !== match[1] || data.sha !== match[2]
      || !PACKAGE.test(data.package) || !SHA.test(data.sha)
      || !['native','npm'].includes(data.registry)
      || (success && (typeof data.version!=='string'||!VERSION.test(data.version)))
      || (!success && (typeof data.stage!=='string'||!data.stage.trim()||data.stage.length>128))
      || (data.version!==undefined && (typeof data.version!=='string'||!VERSION.test(data.version)))
      || Object.keys(data).some(k=>!['package','sha','version','registry','jobId','repository','artifact','stage'].includes(k))
      || (success && data.stage!==undefined)
      || (data.jobId !== undefined && !safeJobId(data.jobId))) throw Error('invalid publication data');
  // The release package is the canonical local Git repository basename.
  // A scoped npm artifact has a separate name and explicit GitHub identity.
  if (data.repository!==undefined && (typeof data.repository!=='string'
      || !/^[A-Za-z0-9_.-]+\/[a-z][a-z0-9-]{0,63}$/.test(data.repository)
      || data.repository.split('/')[1]!==data.package)) throw Error('invalid release repository');
  if (data.artifact!==undefined && (typeof data.artifact!=='string'||data.artifact.length>214||!ARTIFACT.test(data.artifact))) throw Error('invalid release artifact');
  if (data.registry==='npm'&&(!data.repository||!data.artifact)) throw Error('npm publication requires repository and artifact');
  return {kind:'release',type,source:{id:source},status:success?'succeeded':'failed',visibility:'orchestrator',
    message:success?'Published '+(data.artifact||data.package)+'@'+data.version:'Publication failed: '+data.stage,
    level:success?'info':'error',
    event_id:'release:'+data.package+':'+data.sha+':'+type,
    ...(data.jobId === undefined ? {} : {job_id:data.jobId}),data};
}
export function releaseSubject(config,event) {
  return releasePrefix(config)+'.'+event.data.package+'.'+event.type;
}
export function validReleasePackage(value) { return typeof value === 'string' && PACKAGE.test(value); }
