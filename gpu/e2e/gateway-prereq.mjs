// A persistent gateway may not inherit the invoking CLI's HF_TOKEN environment.
// Check the standard private file that the gateway transport reads, not merely
// the parent terminal's credentials, before a paid web E2E starts.
import {statSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
export function gatewayCredentialReady(home=homedir()){
  const file=join(home,'.cache','huggingface','token');
  const status=statSync(file,{throwIfNoEntry:false});
  return Boolean(status?.isFile() && (status.mode&0o077)===0 && status.size>20);
}
