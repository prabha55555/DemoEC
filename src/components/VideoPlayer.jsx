import React, { useRef, useState } from 'react';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

function fmtTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec < 10 ? '0' : ''}${sec}`;
}

// Custom-chrome video player (play/pause, seek, speed, captions) used by
// the About page's "Our Journey" video.
export default function VideoPlayer({ src, caption }) {
  const videoRef = useRef(null);
  const [paused, setPaused] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [ccOn, setCcOn] = useState(false);

  function toggleVideo() {
    const v = videoRef.current;
    if (!v) return;
    // play() returns a promise that rejects (AbortError) if pause() interrupts it
    // before it resolves -- a normal outcome of a quick double-click, not an error.
    if (v.paused) v.play()?.catch(() => {}); else v.pause();
  }

  function handleSeek(e) {
    const v = videoRef.current;
    const val = Number(e.target.value);
    setCurrentTime(val);
    if (v) v.currentTime = val;
  }

  function cycleSpeed(e) {
    e.stopPropagation();
    const i = SPEEDS.indexOf(speed);
    const next = SPEEDS[(i + 1) % SPEEDS.length];
    setSpeed(next);
    if (videoRef.current) videoRef.current.playbackRate = next;
  }

  const barBtn = {
    background: 'none', border: 'none', cursor: 'pointer', padding: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#F2EFE4',
  };

  return (
    <div
      onClick={toggleVideo}
      onContextMenu={(e) => e.preventDefault()}
      style={{ position: 'relative', cursor: 'pointer', lineHeight: 0, display: 'flex', justifyContent: 'center', background: '#000', border: '1px solid var(--line)' }}
    >
      <video
        ref={videoRef}
        key={src}
        src={src}
        loop
        playsInline
        preload="metadata"
        disablePictureInPicture
        controlsList="nodownload"
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
        onTimeUpdate={e => setCurrentTime(e.target.currentTime)}
        onLoadedMetadata={e => setDuration(e.target.duration)}
        style={{ width: 'auto', maxWidth: '100%', height: 'auto', maxHeight: '80vh', display: 'block' }}
      />

      {paused && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.28)' }}>
          <div style={{ width: 76, height: 76, borderRadius: '50%', background: 'rgba(0,0,0,.55)', border: '1px solid rgba(242,239,228,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="30" height="30" viewBox="0 0 24 24" fill="#F2EFE4" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
          </div>
        </div>
      )}

      {ccOn && caption && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 46, textAlign: 'center', padding: '0 16px' }}>
          <span style={{ background: 'rgba(0,0,0,.72)', color: '#F2EFE4', fontFamily: "var(--font-body)", fontSize: 15, fontStyle: 'normal', padding: '5px 12px', borderRadius: 2, display: 'inline-block' }}>{caption}</span>
        </div>
      )}

      {/* CONTROL BAR */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          background: 'linear-gradient(to top, rgba(0,0,0,.75), rgba(0,0,0,0))',
          padding: '20px 14px 10px',
          display: 'flex', flexDirection: 'column', gap: 6,
        }}
      >
        <input
          type="range"
          className="tt-video-seek"
          min={0}
          max={duration || 0}
          step={0.1}
          value={currentTime}
          onChange={handleSeek}
          style={{ width: '100%', cursor: 'pointer' }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {/* minWidth/minHeight, not just padding, so this bare-icon button (no
              visible text label) reaches a real ~40px touch target -- it used
              to be exactly its 18px svg with zero padding. aria-label since
              title alone isn't reliably exposed to every screen reader. */}
          <button onClick={toggleVideo} title={paused ? 'Play' : 'Pause'} aria-label={paused ? 'Play' : 'Pause'} style={{ ...barBtn, minWidth: 40, minHeight: 40 }}>
            {paused ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="#F2EFE4"><path d="M8 5v14l11-7z" /></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="#F2EFE4"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
            )}
          </button>

          <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, letterSpacing: '.03em', color: 'rgba(242,239,228,.85)', minWidth: 74 }}>
            {fmtTime(currentTime)} / {fmtTime(duration)}
          </span>

          <div style={{ flex: 1 }} />

          {/* These two have a visible text label (their own accessible name),
              so they don't need aria-label -- just a bit more padding for an
              easier tap, without the bare-icon button's full 40px box. */}
          <button onClick={cycleSpeed} title="Playback speed" style={{ ...barBtn, fontFamily: "'Inter', sans-serif", fontWeight: 600, fontSize: 11, letterSpacing: '.05em', border: '1px solid rgba(242,239,228,.4)', padding: '9px 10px', minHeight: 36, borderRadius: 2 }}>
            {speed}x
          </button>

          {caption && (
            <button
              onClick={e => { e.stopPropagation(); setCcOn(c => !c); }}
              title="Captions"
              style={{ ...barBtn, fontFamily: "'Inter', sans-serif", fontWeight: 600, fontSize: 10.5, letterSpacing: '.05em', border: `1px solid ${ccOn ? 'var(--gd)' : 'rgba(242,239,228,.4)'}`, color: ccOn ? 'var(--gd)' : '#F2EFE4', padding: '9px 10px', minHeight: 36, borderRadius: 2 }}
            >
              CC
            </button>
          )}
        </div>
      </div>

      <style>{`
        .tt-video-seek { -webkit-appearance: none; appearance: none; height: 3px; background: rgba(242,239,228,.35); border-radius: 2px; outline: none; }
        .tt-video-seek::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 12px; height: 12px; border-radius: 50%; background: var(--gd); cursor: pointer; margin-top: -4.5px; }
        .tt-video-seek::-webkit-slider-runnable-track { height: 3px; background: rgba(242,239,228,.35); border-radius: 2px; }
        .tt-video-seek::-moz-range-thumb { width: 12px; height: 12px; border-radius: 50%; background: var(--gd); border: none; cursor: pointer; }
        .tt-video-seek::-moz-range-track { height: 3px; background: rgba(242,239,228,.35); border-radius: 2px; }
      `}</style>
    </div>
  );
}
