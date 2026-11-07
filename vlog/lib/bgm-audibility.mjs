/** Detect an inaudible BGM before costly rendering. Mean dBFS is a guardrail,
 * not an approval of creative music balance or a replacement for listening. */
export const MIN_BGM_MEAN_DBFS = -30;

export function rootBackgroundMusic(markdown) {
  const lines=String(markdown).split(/\r?\n/);
  const leaves=lines.filter(line=>/^\s*- audio\s/.test(line)&&/\bisBackground:true\b/.test(line));
  if(!leaves.length)return null;
  if(leaves.length!==1)throw Error('BGM_AMBIGUOUS: expected one root background music leaf');
  const line=leaves[0];
  const src=line.match(/\bsrc:([^\s]+)/)?.[1];
  const gain=line.match(/\bvolume:([0-9]+(?:\.[0-9]+)?)/)?.[1];
  if(!src||gain===undefined)throw Error('BGM_SPEC_INVALID: background source and playback gain required');
  const volume=Number(gain);
  if(!(volume>0&&volume<=1))throw Error('BGM_SPEC_INVALID: playback volume must be in (0,1]');
  return {src,volume};
}

export function evaluateMusicAudibility(spec, ffmpegOutput) {
  const matched=String(ffmpegOutput).match(/mean_volume:\s*(-?[0-9]+(?:\.[0-9]+)?|-inf)\s*dB/i);
  if(!matched)throw Error('BGM_MEASUREMENT_MISSING: FFmpeg volumedetect did not report mean_volume');
  const sourceMeanDbFS=matched[1].toLowerCase()==='-inf'?-Infinity:Number(matched[1]);
  const playedMeanDbFS=sourceMeanDbFS+20*Math.log10(spec.volume);
  if(playedMeanDbFS<MIN_BGM_MEAN_DBFS)
    throw Error('BGM_INAUDIBLE: estimated music mean '+playedMeanDbFS.toFixed(1)+
      ' dBFS is below '+MIN_BGM_MEAN_DBFS+' dBFS; Editor must rebalance source music, not only raise root volume');
  return {sourceMeanDbFS,playedMeanDbFS:Number(playedMeanDbFS.toFixed(1)),
    rootVolume:spec.volume,minimumMeanDbFS:MIN_BGM_MEAN_DBFS,pass:true};
}
