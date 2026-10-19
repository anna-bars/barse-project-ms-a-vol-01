'use client';

import { useEffect, useRef, useState } from 'react';
import {
  useRive,
  useStateMachineInput,
  Layout,
  Fit,
  Alignment,
} from '@rive-app/react-webgl2';

// ---- Names exactly as they appear in ms_a.riv ----
const SM = 'Ms A Controller';

const BODY_STATES = [
  { value: 0, label: 'Idle', anim: 'IDLE' },
  { value: 1, label: 'Thinking', anim: 'THINKING' },
  { value: 2, label: 'Talking', anim: 'RESPONDING / TALKING' },
];

const EYEBROWS = [
  { value: 0, label: 'Neutral', anim: 'Eyebrow_Neutral' },
  { value: 100, label: 'Thinking', anim: 'Eyebrow_Thinking' },
  { value: 200, label: 'Curious', anim: 'Eyebrow_Curious' },
];

const VISEMES = [
  { n: 0, name: 'Neutral', anim: 'Viseme_00_Neutral' },
  { n: 1, name: 'Closed', anim: 'Viseme_01_Closed' },
  { n: 2, name: 'E / EH', anim: 'Viseme_02_E_EH' },
  { n: 3, name: 'A / AA', anim: 'Viseme_03_A_AA' },
  { n: 4, name: 'I / EE', anim: 'Viseme_04_I_EE' },
  { n: 5, name: 'L', anim: 'Viseme_05_L' },
  { n: 6, name: 'F / V', anim: 'Viseme_06_F_V' },
  { n: 7, name: 'O', anim: 'Viseme_07_O' },
  { n: 8, name: 'U / OO', anim: 'Viseme_08_U_OO' },
  { n: 9, name: 'TH', anim: 'Viseme_09_TH' },
  { n: 10, name: 'S / Z', anim: 'Viseme_10_S_Z' },
  { n: 11, name: 'D / T / N', anim: 'Viseme_11_D_T_N' },
  { n: 12, name: 'SH / CH / J', anim: 'Viseme_12_SH_CH_J' },
  { n: 13, name: 'W / Q', anim: 'Viseme_13_W_Q' },
  { n: 14, name: 'Smile', anim: 'Viseme_14_Smile_Soft_Open' },
];

const CLIPS = [
  { id: '02', dur: 4.3 },
  { id: '03', dur: 4.2 },
  { id: '04', dur: 4.8 },
  { id: '05', dur: 4.8 },
  { id: '06', dur: 3.4 },
  { id: '07', dur: 6.8 },
  { id: '08', dur: 14.7 },
  { id: '09', dur: 3.4 },
  { id: '10', dur: 5.8 },
];

// The .riv is not in /public and not behind a public URL. It lives in a PRIVATE
// Supabase bucket and is served by the server route app/api/rive/route.js.
const RIVE_URL = '/api/rive';

const layout = new Layout({ fit: Fit.Contain, alignment: Alignment.Center });

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export default function Page() {
  const { rive, RiveComponent } = useRive({
    src: RIVE_URL,
    stateMachines: SM,
    autoplay: true,
    layout,
  });

  const eyebrowIn = useStateMachineInput(rive, SM, 'EyebrowState');
  const blinkIn = useStateMachineInput(rive, SM, 'Blink');
  const lookXIn = useStateMachineInput(rive, SM, 'LookX');
  const lookYIn = useStateMachineInput(rive, SM, 'LookY');
  const bodyIn = useStateMachineInput(rive, SM, 'BodyState');
  const ackIn = useStateMachineInput(rive, SM, 'Acknowledge');
  const mouthIn = useStateMachineInput(rive, SM, 'MouthViseme');

  const ready = !!(eyebrowIn && blinkIn && lookXIn && lookYIn && bodyIn && ackIn && mouthIn);

  const [body, setBody] = useState(0);
  const [eyebrow, setEyebrow] = useState(0);
  const [look, setLook] = useState({ x: 50, y: 50 });
  const [viseme, setViseme] = useState(0);
  const [playing, setPlaying] = useState(null);
  const [counts, setCounts] = useState({ blink: 0, ack: 0 });

  // keep latest inputs available to the audio loop
  const mouthRef = useRef(null);
  const bodyRef = useRef(null);
  useEffect(() => { mouthRef.current = mouthIn; }, [mouthIn]);
  useEffect(() => { bodyRef.current = bodyIn; }, [bodyIn]);

  useEffect(() => { if (bodyIn) bodyIn.value = body; }, [bodyIn, body]);
  useEffect(() => { if (eyebrowIn) eyebrowIn.value = eyebrow; }, [eyebrowIn, eyebrow]);
  useEffect(() => {
    if (lookXIn) lookXIn.value = look.x;
    if (lookYIn) lookYIn.value = look.y;
  }, [lookXIn, lookYIn, look]);

  const applyViseme = (n) => {
    if (mouthRef.current) mouthRef.current.value = n;
    setViseme(n);
  };

  const fireBlink = () => {
    if (blinkIn) blinkIn.fire();
    setCounts((c) => ({ ...c, blink: c.blink + 1 }));
  };
  const fireAck = () => {
    if (ackIn) ackIn.fire();
    setCounts((c) => ({ ...c, ack: c.ack + 1 }));
  };

  // ---------- look pad ----------
  const padRef = useRef(null);
  const dragging = useRef(false);
  const moveLook = (e) => {
    const r = padRef.current.getBoundingClientRect();
    const x = clamp(((e.clientX - r.left) / r.width) * 100, 0, 100);
    const y = clamp(100 - ((e.clientY - r.top) / r.height) * 100, 0, 100);
    setLook({ x: Math.round(x), y: Math.round(y) });
  };

  // ---------- audio + lip sync ----------
  const audioRef = useRef(null);
  const ctxRef = useRef(null);
  const analyserRef = useRef(null);
  const rafRef = useRef(null);
  const lastSwitch = useRef(0);
  const lastViseme = useRef(0);

  const stopLoop = () => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  };

  const loop = () => {
    const an = analyserRef.current;
    if (!an) return;
    const td = new Uint8Array(an.fftSize);
    const fd = new Uint8Array(an.frequencyBinCount);
    an.getByteTimeDomainData(td);
    an.getByteFrequencyData(fd);

    let sum = 0;
    for (let i = 0; i < td.length; i++) {
      const v = (td[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / td.length);

    let num = 0;
    let den = 0;
    const binHz = ctxRef.current.sampleRate / an.fftSize;
    for (let i = 0; i < fd.length; i++) {
      num += i * binHz * fd[i];
      den += fd[i];
    }
    const centroid = den > 0 ? num / den : 0;

    let next;
    if (rms < 0.015) next = 0;
    else if (rms < 0.05) next = 1;
    else if (centroid > 3200) next = 10;
    else if (centroid > 2200) next = 4;
    else if (centroid > 1500) next = 2;
    else if (centroid > 1000) next = 3;
    else if (centroid > 700) next = 7;
    else next = 8;

    const now = performance.now();
    if (next !== lastViseme.current && now - lastSwitch.current > 70) {
      lastViseme.current = next;
      lastSwitch.current = now;
      applyViseme(next);
    }
    rafRef.current = requestAnimationFrame(loop);
  };

  const endPlayback = () => {
    stopLoop();
    applyViseme(0);
    if (bodyRef.current) bodyRef.current.value = 0;
    setBody(0);
    setPlaying(null);
  };

  const playClip = async (id) => {
    if (playing === id) {
      audioRef.current.pause();
      endPlayback();
      return;
    }
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.crossOrigin = 'anonymous';
      audioRef.current.addEventListener('ended', endPlayback);
    }
    if (!ctxRef.current) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctxRef.current = new AC();
      const src = ctxRef.current.createMediaElementSource(audioRef.current);
      analyserRef.current = ctxRef.current.createAnalyser();
      analyserRef.current.fftSize = 1024;
      analyserRef.current.smoothingTimeConstant = 0.4;
      src.connect(analyserRef.current);
      analyserRef.current.connect(ctxRef.current.destination);
    }
    await ctxRef.current.resume();
    stopLoop();
    audioRef.current.src = `/audio/${id}.mp3`;
    setPlaying(id);
    setBody(2);
    try {
      await audioRef.current.play();
      rafRef.current = requestAnimationFrame(loop);
    } catch (err) {
      endPlayback();
    }
  };

  useEffect(() => () => {
    stopLoop();
    if (audioRef.current) audioRef.current.pause();
  }, []);

  const bodyLabel = BODY_STATES.find((b) => b.value === body)?.label;
  const visemeLabel = VISEMES.find((v) => v.n === viseme);

  return (
    <>
      {/* ================= HERO — LIVE DEMO ================= */}
      <div className="layout">
        <div className="stage">
          <div className="stage-grid" />
          <div className="pane show">
            <div className="canvas-wrap">
              <RiveComponent />
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="top-tag">
            <span className="pulse" />
            Live State Machine
            <span className="update-pill">Voice character · v1</span>
          </div>
          <h1>Ms A Voice Character</h1>
          <p className="sub">
            One artboard, one state machine: body states, eyebrows, look
            direction, blink and 15 mouth visemes, plus audio clips that
            drive the mouth live.
          </p>

          <div className="group-label">
            Audio clips · lip sync
            {!ready && <span className="locked-tag">waiting on .riv</span>}
          </div>
          <div className="audio-list">
            {CLIPS.map((c) => (
              <button
                key={c.id}
                className={`chip-btn ${playing === c.id ? 'on' : ''}`}
                disabled={!ready}
                onClick={() => playClip(c.id)}
              >
                <span className="chip-dot" />
                {playing === c.id ? 'Stop' : `Clip ${c.id}`}
                <small>{c.dur.toFixed(1)}s</small>
              </button>
            ))}
          </div>

          <div className="group-label">Body state (BodyState)</div>
          <div className="chip-row" style={{ marginBottom: 12 }}>
            {BODY_STATES.map((b) => (
              <button
                key={b.value}
                className={`chip-btn ${body === b.value ? 'on' : ''}`}
                disabled={!bodyIn}
                onClick={() => setBody(b.value)}
              >
                <span className="chip-dot" />{b.label}
              </button>
            ))}
            <button className="chip-btn" disabled={!ackIn} onClick={fireAck}>
              <span className="chip-dot" />Acknowledge
            </button>
            <button className="chip-btn" disabled={!blinkIn} onClick={fireBlink}>
              <span className="chip-dot" />Blink
            </button>
          </div>

          <div className="group-label">Eyebrows (EyebrowState 0 – 200)</div>
          <div className="chip-row" style={{ marginBottom: 12 }}>
            {EYEBROWS.map((e) => (
              <button
                key={e.value}
                className={`chip-btn ${eyebrow === e.value ? 'on' : ''}`}
                disabled={!eyebrowIn}
                onClick={() => setEyebrow(e.value)}
              >
                <span className="chip-dot" />{e.label}
              </button>
            ))}
          </div>
          <div className="card slider-card" style={{ marginBottom: 24 }}>
            <input
              className="range"
              type="range"
              min="0"
              max="200"
              step="1"
              value={eyebrow}
              disabled={!eyebrowIn}
              style={{ '--p': `${(eyebrow / 200) * 100}%` }}
              onChange={(e) => setEyebrow(Number(e.target.value))}
              aria-label="EyebrowState"
            />
          </div>

          <div className="group-label">Look direction (LookX / LookY)</div>
          <div className="pad-row">
            <div>
              <div
                ref={padRef}
                className="eye-pad"
                onPointerDown={(e) => {
                  if (!lookXIn) return;
                  dragging.current = true;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  moveLook(e);
                }}
                onPointerMove={(e) => dragging.current && moveLook(e)}
                onPointerUp={() => { dragging.current = false; }}
              >
                <div className="eye-pad-cross-h" />
                <div className="eye-pad-cross-v" />
                <div
                  className="eye-pad-dot"
                  style={{ left: `${look.x}%`, top: `${100 - look.y}%` }}
                />
              </div>
              <div className="eye-pad-readout">X {look.x} · Y {look.y}</div>
            </div>
            <div className="pad-side">
              <button className="chip-btn ghost" onClick={() => setLook({ x: 50, y: 50 })} disabled={!lookXIn}>
                <span className="chip-dot" />Center
              </button>
            </div>
          </div>

          <div className="group-label">Mouth visemes (MouthViseme 0 – 14)</div>
          <div className="viseme-grid hero">
            {VISEMES.map((v) => (
              <button
                key={v.n}
                className={`viseme-chip ${viseme === v.n ? 'on' : ''}`}
                disabled={!mouthIn}
                onClick={() => applyViseme(v.n)}
              >
                <span className="viseme-num">{v.n}</span>
                <span className="viseme-name">{v.name}</span>
              </button>
            ))}
          </div>

          <div className="state-readout">
            <span className="live-dot" />
            body: <b>{bodyLabel}</b> · eyebrows: <b>{eyebrow}</b> · mouth: <b>{visemeLabel?.n} {visemeLabel?.name}</b>
          </div>

          <a className="scroll-cue" href="#overview">
            <span>Integration docs</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        </div>
      </div>

      {/* ================= DOCUMENTATION ================= */}
      <div className="docs">
        <div className="docs-shell">
          <DocsNav />

          <div className="docs-body">
            <DocSection id="overview" eyebrow="Overview" title="One file, one state machine">
              <p>
                Ms A ships as a single <code>.riv</code> file with one state
                machine, <code>{SM}</code>. Every part of the character is
                controlled by a small set of inputs: one number per
                feature, plus two triggers.
              </p>
              <div className="update-grid">
                <div className="update-card system-a">
                  <div className="update-card-title">Body and face</div>
                  <ul>
                    <li><code>BodyState</code> switches Idle, Thinking, Talking</li>
                    <li><code>EyebrowState</code> blends Neutral, Thinking, Curious</li>
                    <li><code>LookX</code> / <code>LookY</code> move the eyes, 0 to 100</li>
                  </ul>
                </div>
                <div className="update-card">
                  <div className="update-card-title">Voice</div>
                  <ul>
                    <li><code>MouthViseme</code> selects one of 15 mouth shapes</li>
                    <li>Nine audio clips, played with buttons, drive the mouth live</li>
                    <li><code>Blink</code> and <code>Acknowledge</code> are one-shot triggers</li>
                  </ul>
                </div>
              </div>
            </DocSection>

            <DocSection id="body" eyebrow="Body" title="Body states and eyebrows">
              <p>
                <code>BodyState</code> is a number input. The Main layer
                moves between three looping body animations and a one-shot
                reaction.
              </p>
              <table className="stage-table">
                <thead>
                  <tr><th>BodyState</th><th>State</th><th>Animation</th></tr>
                </thead>
                <tbody>
                  {BODY_STATES.map((b) => (
                    <tr key={b.value}><td>{b.value}</td><td>{b.label}</td><td><code>{b.anim}</code></td></tr>
                  ))}
                  <tr><td>trigger</td><td>Acknowledge</td><td><code>ACKNOWLEDGE / REACT</code></td></tr>
                </tbody>
              </table>
              <p>
                <code>Acknowledge</code> plays the reaction once from any
                state and returns to Idle when it finishes.
              </p>
              <h3>Eyebrows</h3>
              <p>
                <code>EyebrowState</code> runs on its own layer, so the
                eyebrows can change while the body is in any state. It is a
                1D blend, so values between two stops mix the two poses.
              </p>
              <table className="stage-table">
                <thead>
                  <tr><th>EyebrowState</th><th>Pose</th><th>Animation</th></tr>
                </thead>
                <tbody>
                  {EYEBROWS.map((e) => (
                    <tr key={e.value}><td>{e.value}</td><td>{e.label}</td><td><code>{e.anim}</code></td></tr>
                  ))}
                </tbody>
              </table>
            </DocSection>

            <DocSection id="look" eyebrow="Eyes" title="Look direction and blink">
              <p>
                <code>LookX</code> and <code>LookY</code> are numbers from 0
                to 100 with 50 as the center. Each has its own layer, so the
                eyes move independently of everything else.
              </p>
              <table className="stage-table">
                <thead>
                  <tr><th>Input</th><th>0</th><th>50 (default)</th><th>100</th></tr>
                </thead>
                <tbody>
                  <tr><td><code>LookX</code></td><td><code>Look_Left</code></td><td><code>Look_Center_X</code></td><td><code>Look_Right</code></td></tr>
                  <tr><td><code>LookY</code></td><td><code>Look_Down</code></td><td><code>Look_Center_Y</code></td><td><code>Look_Up</code></td></tr>
                </tbody>
              </table>
              <h3>Blink</h3>
              <p>
                The Blink layer contains an automatic blink loop
                (<code>Blink_Auto</code>). The <code>Blink</code> trigger
                plays one extra blink on demand, for example right after the
                character reacts.
              </p>
              <LiveFeed
                label="Triggers fired from this page"
                text={
                  counts.blink + counts.ack === 0
                    ? 'waiting for first trigger…'
                    : `${counts.blink} blink · ${counts.ack} acknowledge`
                }
              />
            </DocSection>

            <DocSection id="visemes" eyebrow="Voice" title="Mouth visemes">
              <p>
                <code>MouthViseme</code> is a number from 0 to 14. Each value
                shows one mouth shape immediately. It has its own
                layer, so the mouth works in every body state.
              </p>
              <div className="viseme-grid">
                {VISEMES.map((v) => (
                  <div className="viseme-chip" key={v.n}>
                    <span className="viseme-num">{v.n}</span>
                    <span className="viseme-name">{v.name}</span>
                  </div>
                ))}
              </div>
              <table className="stage-table" style={{ marginTop: 22 }}>
                <thead>
                  <tr><th>MouthViseme</th><th>Animation</th></tr>
                </thead>
                <tbody>
                  {VISEMES.map((v) => (
                    <tr key={v.n}><td>{v.n}</td><td><code>{v.anim}</code></td></tr>
                  ))}
                </tbody>
              </table>
            </DocSection>

            <DocSection id="audio" eyebrow="Voice" title="Audio and lip sync">
              <p>
                The nine clips in <code>/public/audio</code> play through the
                Web Audio API. While a clip plays, the page reads loudness and
                brightness of the sound every frame, picks a viseme and
                writes it to <code>MouthViseme</code>. It also sets
                <code> BodyState</code> to Talking and returns to Idle when
                the clip ends.
              </p>
              <div className="note-box">
                This demo estimates the mouth shape from the audio signal, so
                it moves in time with the voice but does not know the
                words. For exact lip sync in the app, send the viseme number
                and its timestamp from your speech service
                (text to speech services return these) and write each one
                to <code>MouthViseme</code> at that time.
              </div>
            </DocSection>

            <DocSection id="state-machine" eyebrow="Architecture" title="State machine">
              <div className="tree-block">{`${SM}
  Layer "Main"
    Entry → IDLE
    IDLE ⇄ THINKING              [BodyState = 1]
    IDLE ⇄ RESPONDING / TALKING  [BodyState = 2]
    Any State → ACKNOWLEDGE / REACT  [Acknowledge trigger]
    ACKNOWLEDGE / REACT → IDLE   (when finished)
  Layer "Mouth Visemes"
    15 states, Viseme_00 … Viseme_14   [MouthViseme = 0 … 14]
  Layer "Eyebrows"
    1D blend on EyebrowState
    0 Neutral · 100 Thinking · 200 Curious
  Layer "LookX"   1D blend on LookX   0 Left · 50 Center · 100 Right
  Layer "LookY"   1D blend on LookY   0 Down · 50 Center · 100 Up
  Layer "Blink"
    Blink_Auto loop, Blink [Trigger] → plays Blink once`}</div>
            </DocSection>

            <DocSection id="inputs" eyebrow="Reference" title="Input reference">
              <div className="inputs-grid">
                <InputCard kind="Number" name="BodyState" desc="0 Idle, 1 Thinking, 2 Talking." />
                <InputCard kind="Number" name="EyebrowState" desc="0 to 200. Blends Neutral, Thinking, Curious." />
                <InputCard kind="Number" name="LookX" desc="0 to 100, default 50. Left to right." />
                <InputCard kind="Number" name="LookY" desc="0 to 100, default 50. Down to up." />
                <InputCard kind="Number" name="MouthViseme" desc="0 to 14. Selects the mouth shape." />
                <InputCard kind="Trigger" name="Acknowledge" desc="Plays the reaction once." />
                <InputCard kind="Trigger" name="Blink" desc="Plays one blink, then resets." />
              </div>
            </DocSection>

            <DocSection id="js" eyebrow="JavaScript" title="Web integration example">
              <CodeBlock code={JS_EXAMPLE} />
            </DocSection>

            <DocSection id="rn" eyebrow="React Native" title="React Native example">
              <CodeBlock code={RN_EXAMPLE} />
            </DocSection>

            <DocSection id="files" eyebrow="Files" title="Where the files live">
              <p>
                The <code>.riv</code> file lives in a private Supabase Storage
                bucket (<code>rive-assets</code>) and is served by the app
                through <code>/api/rive</code>, so it can be replaced without
                redeploying. The audio clips are static assets in{' '}
                <code>/public</code>.
              </p>
              <div className="tree-block">{`Supabase Storage / rive-assets /
  ms_a.riv          state machine "Ms A Controller"

public/
  audio/
    02.mp3 … 10.mp3   nine voice clips`}</div>
            </DocSection>

            <DocSection id="checklist" eyebrow="Integration Checklist" title="Ship it">
              <ul className="check-list boxes">
                <li>Load <code>ms_a.riv</code> with state machine <code>Ms A Controller</code></li>
                <li>Write <code>BodyState</code> (0, 1, 2) and <code>EyebrowState</code> (0 to 200)</li>
                <li>Bind pointer or gaze to <code>LookX</code> / <code>LookY</code> (0 to 100)</li>
                <li>Fire <code>Acknowledge</code> and <code>Blink</code> when needed</li>
                <li>Write the current viseme (0 to 14) to <code>MouthViseme</code> while audio plays</li>
                <li>Done</li>
              </ul>
            </DocSection>

            <footer className="docs-footer">
              Ms A Voice Character · Rive integration docs
            </footer>
          </div>
        </div>
      </div>
    </>
  );
}

function DocsNav() {
  const items = [
    ['overview', 'Overview'],
    ['body', 'Body & Eyebrows'],
    ['look', 'Look & Blink'],
    ['visemes', 'Mouth Visemes'],
    ['audio', 'Audio & Lip Sync'],
    ['state-machine', 'State Machine'],
    ['inputs', 'Inputs'],
    ['js', 'JavaScript'],
    ['rn', 'React Native'],
    ['files', 'Files'],
    ['checklist', 'Checklist'],
  ];
  return (
    <nav className="docs-nav">
      <div className="docs-nav-label">Contents</div>
      {items.map(([id, label]) => (
        <a key={id} href={`#${id}`}>{label}</a>
      ))}
    </nav>
  );
}

function DocSection({ id, eyebrow, title, children }) {
  return (
    <section id={id} className="doc-section">
      <div className="doc-eyebrow">{eyebrow}</div>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function InputCard({ kind, name, desc }) {
  return (
    <div className="input-card">
      <div className="input-kind">{kind}</div>
      <code>{name}</code>
      <p>{desc}</p>
    </div>
  );
}

function LiveFeed({ label, text }) {
  return (
    <div className="live-feed">
      <span className="live-feed-dot" />
      <span className="live-feed-label">{label}</span>
      <span className="live-feed-value">{text}</span>
    </div>
  );
}

function CodeBlock({ code }) {
  return <pre className="code-block"><code>{code}</code></pre>;
}

const JS_EXAMPLE = `import { Rive, Fit, Alignment, Layout } from '@rive-app/canvas'

const SM = 'Ms A Controller'

const msA = new Rive({
  src: '/ms_a.riv',
  canvas: document.getElementById('canvas'),
  stateMachines: SM,
  autoplay: true,
  layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),
  onLoad: () => {
    const inputs = msA.stateMachineInputs(SM)
    const get = (name) => inputs.find((i) => i.name === name)

    get('BodyState').value = 0        // 0 Idle, 1 Thinking, 2 Talking
    get('EyebrowState').value = 0     // 0 Neutral, 100 Thinking, 200 Curious
    get('LookX').value = 50           // 0 left, 50 center, 100 right
    get('LookY').value = 50           // 0 down, 50 center, 100 up

    get('Acknowledge').fire()
    get('Blink').fire()

    // while audio plays: write the viseme number (0 to 14)
    get('MouthViseme').value = 3
  },
})`;

const RN_EXAMPLE = `import Rive from 'rive-react-native'

const SM = 'Ms A Controller'

export function MsA({ body, eyebrow, viseme }) {
  const riveRef = useRef(null)

  useEffect(() => {
    riveRef.current?.setInputState(SM, 'BodyState', body)
  }, [body])

  useEffect(() => {
    riveRef.current?.setInputState(SM, 'EyebrowState', eyebrow)
  }, [eyebrow])

  useEffect(() => {
    riveRef.current?.setInputState(SM, 'MouthViseme', viseme)   // 0 to 14
  }, [viseme])

  return (
    <Rive
      ref={riveRef}
      resourceName="ms_a"
      stateMachineName={SM}
      autoplay
      style={{ width: '100%', height: 420 }}
    />
  )
}

// triggers
// riveRef.current?.fireState(SM, 'Acknowledge')
// riveRef.current?.fireState(SM, 'Blink')`;
