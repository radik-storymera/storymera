import { useEffect, useRef, useState } from 'react';

export function SceneVideo({ src, poster, alt }: { src: string; poster?: string; alt: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [muted, setMuted] = useState(true);
  const [error, setError] = useState('');
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    const video = ref.current;
    return () => { active.current = false; video?.pause(); };
  }, []);
  async function play() {
    const video = ref.current;
    if (!video) return;
    setError('');
    if (video.ended) video.currentTime = 0;
    try {
      await video.play();
      if (!active.current) video.pause();
    } catch {
      if (active.current) { setPlaying(false); setError('Video could not start. Please try Play again.'); }
    }
  }
  return <div className="video-frame">
    <video ref={ref} src={src} poster={poster} playsInline muted={muted} preload="metadata" aria-label={alt}
      onPlaying={() => { setPlaying(true); setEnded(false); setError(''); }}
      onPause={() => setPlaying(false)}
      onEnded={() => { setPlaying(false); setEnded(true); }}
      onVolumeChange={() => setMuted(ref.current?.muted ?? true)}
      onError={() => { setPlaying(false); setError('Video is unavailable. You can still continue the story.'); }} />
    {!playing && <button className="video-play" onClick={play} aria-label={ended ? 'Replay video' : 'Play video'}><span aria-hidden="true">{ended ? '↻' : '▶'}</span>{ended ? 'Replay' : 'Play'}</button>}
    <div className="video-controls">
      <button onClick={() => ref.current?.pause()} disabled={!playing} aria-label="Pause video">Pause</button>
      <button onClick={() => { const video = ref.current; if (video) video.muted = !video.muted; }} aria-label={muted ? 'Unmute video' : 'Mute video'}>{muted ? 'Sound off' : 'Sound on'}</button>
    </div>
    {error && <p className="video-error" role="status">{error}</p>}
  </div>;
}
