import {readFileSync} from 'node:fs';
import {database as createDatabase,snapshot as readSnapshot} from './dmca-lifecycle-database.mjs';
export {seed,notice,takeDown,eligible,restore,id,operatorQuery} from './dmca-lifecycle-database.mjs';
// Current deployed functions load directly with their captured full permissions.
// Older migration-regression fixtures keep their independent baseline schema.
export const schema=JSON.parse(readFileSync(new URL('../fixtures/dmca-case-callers-current.json',import.meta.url),'utf8'));
export const database=()=>createDatabase(schema);
export const snapshot=db=>readSnapshot(db,schema);
