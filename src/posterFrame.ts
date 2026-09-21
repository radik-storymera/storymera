export async function posterFromVideo(file:File):Promise<File>{
 const url=URL.createObjectURL(file),video=document.createElement('video');
 video.muted=true;video.playsInline=true;video.preload='auto';
 try{
  const frame=await new Promise<HTMLCanvasElement>((resolve,reject)=>{
   const timer=window.setTimeout(()=>reject(Error('No decodable video frame was found. Upload a poster image manually.')),10000);
   const fail=()=>{clearTimeout(timer);reject(Error('Could not decode the video. Upload a poster image manually.'));};
   video.onerror=fail;
   video.onloadeddata=()=>{
    clearTimeout(timer);
    if(!video.videoWidth||!video.videoHeight){fail();return;}
    const canvas=document.createElement('canvas'),scale=Math.min(1,960/Math.max(video.videoWidth,video.videoHeight));
    canvas.width=Math.max(1,Math.round(video.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.videoHeight*scale));
    const context=canvas.getContext('2d');if(!context){reject(Error('Canvas unavailable. Upload a poster image manually.'));return;}
    context.drawImage(video,0,0,canvas.width,canvas.height);resolve(canvas);
   };
   video.src=url;video.load();
  });
  const blob=await new Promise<Blob>((resolve,reject)=>frame.toBlob(value=>value?resolve(value):reject(Error('Could not create a poster image. Upload one manually.')),'image/jpeg',0.82));
  return new File([blob],`video-poster-${crypto.randomUUID().slice(0,8)}.jpg`,{type:'image/jpeg'});
 }finally{video.pause();video.removeAttribute('src');video.load();URL.revokeObjectURL(url);}
}
