#!/usr/bin/env node
/** Canonical Producer command; automatically builds a narrated GPS subvideo. */
import {readFileSync,copyFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildCinematicEpisode} from '../lib/cinematic-episode.mjs';

const [inputFile,outputFile]=process.argv.slice(2);
if(!inputFile||!outputFile)throw Error('Usage: node compile-cinematic-vlog.mjs <episode-input.json> <video.md>');
const root=process.cwd();
const input=JSON.parse(readFileSync(resolve(root,inputFile),'utf8'));
// The typical deployment has Neo and Markcut as siblings in Workspace.
const markcutRoot=process.env.MARKCUT_ROOT||resolve(dirname(fileURLToPath(import.meta.url)),'../../../markcut');
const result=await buildCinematicEpisode(input,{runDir:root,markcutRoot});
const target=resolve(root,outputFile);
if(target!==result.video)copyFileSync(result.video,target);
process.stdout.write(JSON.stringify({path:target,route:result.route,sceneCount:result.finalSceneCount},null,2)+'\n');
