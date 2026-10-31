#!/usr/bin/env node
/** Run from a canonical dated Vlog run directory (not from a Git worktree). */
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {buildCinematicEpisode} from '../lib/cinematic-episode.mjs';
const file=process.argv[2];if(!file)throw Error('Usage: node build-cinematic-episode.mjs episode-input.json [Markcut repo path]');
const root=process.cwd(),input=JSON.parse(await readFile(resolve(root,file),'utf8'));
const markcutRoot=process.argv[3]||process.env.MARKCUT_ROOT;
const result=await buildCinematicEpisode(input,{runDir:root,markcutRoot});
process.stdout.write(JSON.stringify({video:result.video,route:result.route,finalSceneCount:result.finalSceneCount},null,2)+'\n');
