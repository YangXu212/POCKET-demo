/* POCKET listening companion. No dependencies, analytics, or remote services. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const orderedLabels = ['Input', 'NLMS', 'STFT-KF', 'HB-DNN-NLMS', 'Meta-AF', 'NKF', 'Neural-MLMS', 'POCKET', 'Target'];
  const normalize = (value) => String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  const defaultIds = ['input', 'nlms', 'stft_kf', 'hb_dnn_nlms', 'meta_af', 'nkf', 'neural_mlms', 'pocket', 'target'];
  const pageSize = 8;
  let manifest, samples = [], methods = [], filtered = [], page = 0, sample = null, activeMethod = '';
  let context, gain, source, currentBuffer, playing = false, loop = false, offset = 0, startTime = 0;
  let operation = 0, scrubbing = false, scrubWasPlaying = false, toastTimer;
  const bufferCache = new Map();

  function seconds(value, precise = false) {
    const safe = Math.max(0, Number(value) || 0);
    const mins = Math.floor(safe / 60);
    const secs = precise ? (safe % 60).toFixed(1).padStart(4, '0') : Math.floor(safe % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  }
  function methodInfo(id) { return methods.find((item) => item.id === id); }
  function exampleName(item) { return `Example ${String(samples.indexOf(item) + 1).padStart(2, '0')}`; }
  function scenarioName(value) {
    const labels = {DT:'Double-talk', FS:'Far-end single-talk', NS:'Near-end single-talk', static:'static echo path', EPC:'echo-path change'};
    return String(value || '').split('·').map((part) => labels[part.trim()] || part.trim()).join(' · ');
  }
  function conditionFacts(item) {
    return [...String(item.note || '').matchAll(/(?:SER|SNR)\s+[-+−]?\d+(?:\.\d+)?\s*dB/g)].map((match) => match[0]);
  }
  function trackFor(id) { return sample?.tracks?.[id] || null; }
  function duration() { return Number(sample?.duration) || currentBuffer?.duration || 0; }
  function position() {
    if (!playing || !context) return offset;
    let pos = offset + Math.max(0, context.currentTime - startTime);
    const length = duration();
    if (loop && length > 0) pos %= length;
    return Math.min(pos, length || pos);
  }
  function announce(message) { $('playback-status').textContent = message; }
  function toast(message) {
    $('toast').textContent = message;
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500);
  }
  function ensureContext() {
    if (!context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) throw new Error('This browser does not support Web Audio. Please use a current browser.');
      context = new AudioContext();
      gain = context.createGain();
      gain.gain.value = Number($('volume-slider').value);
      gain.connect(context.destination);
    }
    return context;
  }
  async function loadBuffer(path) {
    if (bufferCache.has(path)) {
      const cached = bufferCache.get(path);
      bufferCache.delete(path); bufferCache.set(path, cached);
      return cached;
    }
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Audio could not be loaded (${response.status}).`);
    const audio = await response.arrayBuffer();
    const buffer = await context.decodeAudioData(audio);
    bufferCache.set(path, buffer);
    while (bufferCache.size > 14) bufferCache.delete(bufferCache.keys().next().value);
    return buffer;
  }
  function stopSource(at) {
    if (source) {
      source.onended = null;
      try { source.stop(at); } catch (_) { /* A previously ended source needs no stop. */ }
      source = null;
    }
  }
  function startBuffer(buffer, requestedOffset, scheduledTime) {
    const when = scheduledTime ?? context.currentTime;
    stopSource(when);
    currentBuffer = buffer;
    const length = Math.min(duration() || buffer.duration, buffer.duration);
    offset = Math.max(0, Math.min(requestedOffset, Math.max(0, length - 0.001)));
    startTime = when;
    source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    source.loopStart = 0;
    source.loopEnd = length;
    source.connect(gain);
    const newSource = source;
    source.onended = () => {
      if (source !== newSource || loop) return;
      offset = length;
      playing = false;
      source = null;
      updatePlaybackUI();
      announce('End of example.');
    };
    source.start(when, offset);
    if (!loop && buffer.duration > length + 0.001) source.stop(when + length - offset);
    playing = true;
    updatePlaybackUI();
  }
  function pause() {
    operation++;
    offset = position();
    playing = false;
    stopSource();
    updatePlaybackUI();
    announce('Paused.');
  }
  async function chooseMethod(id, autoplay = true) {
    const track = trackFor(id);
    if (!track?.audio) return;
    const request = ++operation;
    const oldSample = sample.id;
    try {
      ensureContext();
      await context.resume();
      announce(`Loading ${methodInfo(id).label}…`);
      const buffer = await loadBuffer(track.audio);
      if (request !== operation || sample.id !== oldSample) return;
      let pos = position();
      if (pos >= duration() - 0.01) pos = 0;
      const wasPlaying = playing;
      activeMethod = id;
      if (autoplay) {
        // A single audio clock schedules the old track stop and new track start.
        const switchAt = context.currentTime + 0.015;
        if (wasPlaying) pos += switchAt - context.currentTime;
        if (loop && duration()) pos %= duration();
        startBuffer(buffer, pos, switchAt);
        announce(`Playing ${methodInfo(id).label}.`);
      } else {
        offset = pos;
        playing = false;
        stopSource();
        currentBuffer = buffer;
        updatePlaybackUI();
        announce(`${methodInfo(id).label} selected at ${seconds(pos, true)}.`);
      }
    } catch (error) {
      if (request !== operation) return;
      announce(error.message || 'Audio playback failed.');
      toast(error.message || 'Audio playback failed.');
      updatePlaybackUI();
    }
  }
  function seek(value, resume = playing) {
    operation++;
    const pos = Math.min(Math.max(Number(value) || 0, 0), duration());
    if (resume && currentBuffer && context) startBuffer(currentBuffer, pos >= duration() ? 0 : pos);
    else { playing = false; stopSource(); offset = pos; updatePlaybackUI(); }
    drawPosition();
  }
  function updatePlaybackUI() {
    const label = methodInfo(activeMethod)?.label || 'Select a method';
    $('now-method').textContent = label;
    $('play-toggle').innerHTML = `<span aria-hidden="true">${playing ? 'Ⅱ' : '▶'}</span>`;
    $('play-toggle').setAttribute('aria-label', `${playing ? 'Pause' : 'Play'} ${label}`);
    $('play-toggle').disabled = !trackFor(activeMethod)?.audio;
    document.querySelectorAll('.method-row').forEach((row) => {
      const selected = row.dataset.method === activeMethod;
      row.classList.toggle('selected', selected);
      const button = row.querySelector('.method-button');
      button.setAttribute('aria-pressed', String(selected));
      const method = methodInfo(row.dataset.method);
      button.setAttribute('aria-label', `${selected && playing ? 'Pause' : 'Listen to'} ${method.label}`);
      row.querySelector('.method-icon').textContent = selected && playing ? 'Ⅱ' : '▶';
    });
  }
  function drawPosition() {
    const pos = position();
    const length = duration();
    $('elapsed-time').textContent = seconds(pos, true);
    if (!scrubbing) $('time-slider').value = pos;
    document.querySelectorAll('.playhead').forEach((head) => { head.style.left = `${length ? Math.min(100, pos / length * 100) : 0}%`; });
  }
  function tick() { if (sample) drawPosition(); requestAnimationFrame(tick); }

  function options(values, title, display = (value) => value) {
    return `<option value="">${esc(title)}</option>` + [...new Set(values.filter(Boolean))].sort().map((value) => `<option value="${esc(value)}">${esc(display(value))}</option>`).join('');
  }
  function applyFilters(resetPage = true) {
    const dataset = $('dataset-filter').value;
    const scenario = $('scenario-filter').value;
    const query = $('search-filter').value.trim().toLowerCase();
    filtered = samples.filter((item) => (!dataset || item.dataset === dataset) && (!scenario || item.scenario === scenario) && (!query || [exampleName(item), item.dataset, scenarioName(item.scenario), item.scenario, ...conditionFacts(item), ...(item.tags || [])].join(' ').toLowerCase().includes(query)));
    if (resetPage) page = 0;
    page = Math.min(page, Math.max(0, Math.ceil(filtered.length / pageSize) - 1));
    renderIndex();
    if (filtered.length && (!filtered.some((item) => item.id === sample?.id) || $('sample-content').hidden)) selectSample(filtered[0].id, false);
    if (!filtered.length) {
      pause();
      $('sample-content').hidden = true;
      $('load-message').hidden = false;
      $('load-message').textContent = 'No examples match these filters. Try a different condition or reset the filters.';
    }
  }
  function renderIndex() {
    $('result-count').textContent = `${filtered.length} ${filtered.length === 1 ? 'example' : 'examples'}`;
    $('sample-list').innerHTML = filtered.slice(page * pageSize, (page + 1) * pageSize).map((item) => `<button type="button" class="sample-choice" data-sample="${esc(item.id)}" aria-current="${item.id === sample?.id}"><span class="choice-top"><span>${exampleName(item)}</span><span>${Number(item.duration).toFixed(1)} s</span></span><span class="choice-title">${esc(scenarioName(item.scenario))}</span><span class="choice-bottom">${esc(item.dataset)}</span></button>`).join('') || '<p class="empty-index">No matching examples.</p>';
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    $('page-label').textContent = `${page + 1} / ${pages}`;
    $('prev-page').disabled = page === 0;
    $('next-page').disabled = page >= pages - 1;
    $('sample-list').querySelectorAll('button').forEach((button) => button.addEventListener('click', () => selectSample(button.dataset.sample)));
  }
  function eventMarkers() {
    return (sample.events || []).filter((event) => Number.isFinite(Number(event.time))).map((event) => `<span class="event-marker" style="left:${Math.max(0, Math.min(100, Number(event.time) / duration() * 100))}%" title="${esc(event.label)} at ${seconds(event.time, true)}"></span>`).join('');
  }
  function spectrumMarkup(id, large = false) {
    const track = trackFor(id);
    const name = methodInfo(id).label;
    return `<button type="button" class="spectrum-button${large ? ' expanded-spectrum' : ''}" data-spectrum="${esc(id)}" aria-label="Seek in ${esc(name)} spectrogram" ${!track?.audio ? 'disabled' : ''}>${track?.spectrogram ? `<img src="${esc(track.spectrogram)}" alt="${esc(name)} full-length magnitude spectrogram" loading="lazy" draggable="false">` : `<span class="spectrum-empty">${track?.audio ? 'Spectrogram unavailable' : 'Not available'}</span>`}${track?.audio ? `${eventMarkers()}<span class="playhead" aria-hidden="true"></span>` : ''}</button>`;
  }
  function metricEntries(track) {
    if (!track?.metrics) return [];
    return Object.entries(track.metrics).map(([label, value]) => {
      if (value && typeof value === 'object') return [label, value.value, value.unit || ''];
      return [label, value, ''];
    });
  }
  function metricMarkup(track) {
    const entries = metricEntries(track);
    if (!entries.length) return '<span class="no-metrics">—</span>';
    return entries.map(([label, value, unit]) => {
      const precision = /ESTOI|AECMOS/i.test(label) ? 3 : 2;
      const display = value == null || value === '' || (typeof value === 'number' && !Number.isFinite(value)) ? '—' : typeof value === 'number' ? value.toFixed(precision) : String(value);
      return `<span class="metric"><span class="metric-label">${esc(label)}</span><span class="metric-value">${esc(display)}${unit && display !== '—' ? ` ${esc(unit)}` : ''}</span></span>`;
    }).join('');
  }
  function category(method) {
    const label = normalize(method.label);
    if (label === 'input') return 'Microphone mixture';
    if (label === 'target') return 'Reference signal';
    if (label === 'pocket') return 'Proposed';
    return '';
  }
  function renderMatrix() {
    $('method-matrix').innerHTML = methods.map((method) => {
      const track = trackFor(method.id);
      const caption = track?.audio ? category(method) : 'Unavailable';
      return `<div class="method-row${normalize(method.label) === 'pocket' ? ' ours' : ''}${!track?.audio ? ' unavailable-row' : ''}" data-method="${esc(method.id)}"><button class="method-button" type="button" data-play="${esc(method.id)}" aria-pressed="false" ${!track?.audio ? 'disabled' : ''}><span class="method-icon" aria-hidden="true">▶</span><span><span class="method-label">${esc(method.label)}</span>${caption ? `<span class="method-category">${caption}</span>` : ''}</span></button>${spectrumMarkup(method.id)}<div class="method-metrics">${metricMarkup(track)}</div></div>`;
    }).join('');
    $('method-matrix').querySelectorAll('[data-play]').forEach((button) => button.addEventListener('click', () => {
      if (button.dataset.play === activeMethod && playing) pause();
      else chooseMethod(button.dataset.play);
    }));
    bindSpectra($('method-matrix'));
  }
  function bindSpectra(parent) {
    parent.querySelectorAll('[data-spectrum]').forEach((button) => {
      button.addEventListener('click', (event) => {
        if (!trackFor(button.dataset.spectrum)?.audio) return;
        const box = button.getBoundingClientRect();
        const ratio = event.detail === 0 ? (duration() ? position() / duration() : 0) : Math.max(0, Math.min(1, (event.clientX - box.left) / box.width));
        const shouldResume = playing;
        seek(ratio * duration(), false);
        if (button.dataset.spectrum !== activeMethod || shouldResume) chooseMethod(button.dataset.spectrum, shouldResume);
        else announce(`Position set to ${seconds(position(), true)}. Press play to listen.`);
      });
      const img = button.querySelector('img');
      if (img) img.addEventListener('error', () => { img.hidden = true; const missing = document.createElement('span'); missing.className = 'spectrum-empty'; missing.textContent = 'Spectrogram unavailable'; button.prepend(missing); }, {once:true});
    });
  }
  function renderLargeSpectra() {
    const a = $('compare-a').value, b = $('compare-b').value;
    const maxKHz = (sample.spectrogram_max_hz || manifest.spectrogram_max_hz || (sample.sample_rate || 16000) / 2) / 1000;
    $('large-spectra').innerHTML = [[a, 'A'], [b, 'B']].filter(([id]) => id).map(([id, mark]) => `<div class="large-spectrum"><div class="large-spectrum-header"><strong>${mark} · ${esc(methodInfo(id).label)}</strong><span>${esc($('frequency-label').textContent)} · click to seek</span></div><div class="large-spectrum-plot"><div class="frequency-axis" aria-label="Frequency in kilohertz"><span>${maxKHz} kHz</span><span>${maxKHz/2} kHz</span><span>0 kHz</span></div>${spectrumMarkup(id, true)}</div><div class="spectrum-axis"><span>0 s</span><span>${(duration()/2).toFixed(1)} s</span><span>${duration().toFixed(1)} s</span></div></div>`).join('');
    bindSpectra($('large-spectra'));
    drawPosition();
  }
  function renderProvenance() {
    const fields = [
      ['Source', sample.source], ['Playback', sample.processing], ['License', sample.license],
      ...Object.entries(sample.provenance || {})
    ].filter(([,value]) => value !== undefined && value !== null && value !== '');
    $('sample-provenance').innerHTML = `<dl>${fields.map(([key, value]) => `<dt>${esc(key)}</dt><dd>${esc(typeof value === 'object' ? JSON.stringify(value) : value)}</dd>`).join('')}</dl>`;
  }
  function selectSample(id, updateHash = true) {
    const next = samples.find((item) => item.id === id);
    if (!next) return;
    operation++;
    playing = false; stopSource(); offset = 0; currentBuffer = null;
    sample = next;
    const available = methods.filter((method) => sample.tracks?.[method.id]?.audio);
    activeMethod = available.find((method) => normalize(method.label) === 'pocket')?.id || available[0]?.id || '';
    $('load-message').hidden = true;
    $('sample-content').hidden = false;
    $('sample-title').textContent = `${exampleName(sample)} — ${scenarioName(sample.scenario)}`;
    $('sample-kicker').textContent = sample.dataset;
    const targetNote = /Target includes the original noise|retained background noise/i.test(sample.note || '') ? 'Target includes background noise.' : '';
    $('sample-note').textContent = targetNote;
    $('sample-note').hidden = !targetNote;
    const facts = [`${duration().toFixed(1)} s`, sample.sample_rate ? `${sample.sample_rate / 1000} kHz` : null, ...conditionFacts(sample), ...(sample.events || []).map((event) => `${event.label}: ${Number(event.time).toFixed(2)} s`)].filter(Boolean);
    $('sample-facts').innerHTML = facts.map((fact) => `<span class="fact">${esc(fact)}</span>`).join('');
    $('time-slider').max = duration(); $('time-slider').value = 0;
    $('total-time').textContent = seconds(duration(), true);
    $('axis-duration').textContent = `${duration().toFixed(1)} s`;
    $('frequency-label').textContent = `0–${(sample.spectrogram_max_hz || manifest.spectrogram_max_hz || (sample.sample_rate || 16000) / 2) / 1000} kHz`;
    renderMatrix();
    const selectOptions = available.map((method) => `<option value="${esc(method.id)}">${esc(method.label)}</option>`).join('');
    $('compare-a').innerHTML = selectOptions; $('compare-b').innerHTML = selectOptions;
    $('compare-a').value = available.find((method) => normalize(method.label) === 'nkf')?.id || available[0]?.id || '';
    $('compare-b').value = activeMethod;
    renderLargeSpectra(); renderProvenance(); updatePlaybackUI(); renderIndex(); drawPosition();
    announce('Ready.');
    if (updateHash) history.replaceState(null, '', `#sample=${encodeURIComponent(id)}`);
  }

  function bindControls() {
    $('dataset-filter').addEventListener('change', () => applyFilters());
    $('scenario-filter').addEventListener('change', () => applyFilters());
    $('search-filter').addEventListener('input', () => applyFilters());
    $('clear-filters').addEventListener('click', () => { $('dataset-filter').value = ''; $('scenario-filter').value = ''; $('search-filter').value = ''; applyFilters(); });
    $('prev-page').addEventListener('click', () => { page--; renderIndex(); });
    $('next-page').addEventListener('click', () => { page++; renderIndex(); });
    $('play-toggle').addEventListener('click', () => playing ? pause() : chooseMethod(activeMethod));
    $('loop-toggle').addEventListener('click', () => {
      const pos = position(); loop = !loop;
      $('loop-toggle').setAttribute('aria-pressed', String(loop));
      if (playing && currentBuffer) startBuffer(currentBuffer, pos);
      announce(loop ? 'Full-example looping enabled.' : 'Looping disabled.');
    });
    $('volume-slider').addEventListener('input', () => { if (gain) gain.gain.setTargetAtTime(Number($('volume-slider').value), context.currentTime, 0.012); });
    $('time-slider').addEventListener('pointerdown', () => { scrubbing = true; scrubWasPlaying = playing; if (playing) pause(); });
    $('time-slider').addEventListener('input', (event) => { if (!scrubbing) { scrubWasPlaying = playing; if (playing) pause(); } scrubbing = true; offset = Number(event.target.value); drawPosition(); });
    $('time-slider').addEventListener('change', (event) => { scrubbing = false; seek(Number(event.target.value), scrubWasPlaying); scrubWasPlaying = false; });
    $('time-slider').addEventListener('pointercancel', () => { scrubbing = false; if (scrubWasPlaying && currentBuffer) seek(offset, true); scrubWasPlaying = false; });
    ['compare-a', 'compare-b'].forEach((id) => $(id).addEventListener('change', renderLargeSpectra));
    $('play-a').addEventListener('click', () => chooseMethod($('compare-a').value));
    $('play-b').addEventListener('click', () => chooseMethod($('compare-b').value));
    document.addEventListener('keydown', (event) => {
      if (!sample || /INPUT|SELECT|TEXTAREA|BUTTON|SUMMARY|A/.test(event.target.tagName) || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.code === 'Space') { event.preventDefault(); playing ? pause() : chooseMethod(activeMethod); }
      else if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') { event.preventDefault(); seek(position() + (event.code === 'ArrowLeft' ? -2 : 2)); }
    });
    window.addEventListener('pagehide', () => { if (playing) pause(); });
  }

  async function init() {
    try {
      const response = await fetch('data/manifest.json');
      if (!response.ok) throw new Error(`The example manifest could not be loaded (${response.status}).`);
      manifest = await response.json();
      samples = Array.isArray(manifest.samples) ? manifest.samples : [];
      if (!samples.length) throw new Error('The listening collection has no available examples yet.');
      const declared = (manifest.methods || []).map((method) => typeof method === 'string' ? {id:method, label:method} : method);
      methods = orderedLabels.map((label, index) => declared.find((method) => normalize(method.label || method.id) === normalize(label)) || {id:defaultIds[index], label});
      // Accept standard separator variants without requiring data duplication.
      samples.forEach((item) => {
        item.tracks = item.tracks || {};
        methods.forEach((method) => { if (!item.tracks[method.id]) { const key = Object.keys(item.tracks).find((id) => normalize(id) === normalize(method.id) || normalize(id) === normalize(method.label)); if (key) item.tracks[method.id] = item.tracks[key]; } });
      });
      $('dataset-filter').innerHTML = options(samples.map((item) => item.dataset), 'All datasets');
      $('scenario-filter').innerHTML = options(samples.map((item) => item.scenario), 'All scenarios', scenarioName);
      $('collection-count').textContent = `(${samples.length})`;
      bindControls();
      filtered = [...samples];
      const linkedId = new URLSearchParams(location.hash.slice(1)).get('sample');
      const initial = samples.find((item) => item.id === linkedId) || samples.find((item) => item.featured) || samples[0];
      page = Math.floor(samples.indexOf(initial) / pageSize);
      selectSample(initial.id, false);
      requestAnimationFrame(tick);
    } catch (error) {
      $('load-message').classList.add('error');
      $('load-message').textContent = `${error.message} ${location.protocol === 'file:' ? 'Open this companion through a local web server or its GitHub Pages URL.' : 'Please refresh or check the collection files.'}`;
      $('result-count').textContent = 'Collection unavailable';
      $('prev-page').disabled = true; $('next-page').disabled = true;
    }
  }
  init();
})();
