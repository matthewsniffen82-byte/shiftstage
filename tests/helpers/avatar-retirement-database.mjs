import {readFileSync} from 'node:fs';
import {createGalleryRetirementDatabase} from './gallery-retirement-database.mjs';
export {seedGalleryRetirementDatabase,claimGalleryRetirement,galleryRetirementSnapshot,fixtureId} from './gallery-retirement-database.mjs';
export const avatarRetirementMigrationPath='supabase/migrations/20260910134200_support_canonical_avatar_retirement.sql';
export const avatarRetirementMigration=readFileSync(new URL('../../'+avatarRetirementMigrationPath,import.meta.url),'utf8').replace(/\r\n/g,'\n');
export async function createAvatarRetirementDatabase({migrate=true}={}){
 const db=await createGalleryRetirementDatabase();
 try{if(migrate){await db.exec('reset role');await db.exec(avatarRetirementMigration);}return db;}catch(error){await db.close();throw error;}
}
